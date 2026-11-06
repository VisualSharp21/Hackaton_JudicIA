import { randomUUID } from 'node:crypto';

export function escalationContent(item) {
  return [`JUDICI.A — prevenção de audiência (${item.mode})`,
    `Chave de correlação: ${item.id}`, `Audiência: ${item.hearingId}`, `Início: ${item.startsAt}`,
    `Comarca: ${item.locality} | Sala: ${item.room} | Estação: ${item.stationId}`,
    `Responsável: ${item.responsible} | Prioridade: ${item.priority}`,
    'Problemas e diagnósticos executados:', ...item.checks.map((c) => `- ${c.layer}/${c.name}: ${c.status} [${c.mode}] ${c.evidence}`),
    'Ações autorizadas:', JSON.stringify(item.actions), 'Histórico de verificações:', JSON.stringify(item.history),
    ...(item.collectiveIncidentId ? [`Ocorrência coletiva: ${item.collectiveIncidentId}`, 'Audiências e evidências correlacionadas:', JSON.stringify(item.collectiveEvidence)] : []),
  ].join('\n');
}

async function activeEscalation(tx, e) {
  for (const ref of e.collectiveHearingRefs || [{ id: e.hearingId, revision: e.revision }]) {
    const h = await tx.get('hearing', ref.id);
    if (h?.lifecycle === 'ATIVA' && h.revision === ref.revision) return true;
  }
  return false;
}

// Transactional outbox. Once a remote POST might have been sent, never resend it
// blindly: reconcile by correlation marker. This prevents duplicates after crashes.
export class EscalationOutbox {
  constructor({ store, transport, clock = () => Date.now() }) { Object.assign(this, { store, transport, clock }); }
  async flush() {
    const rows = (await this.store.list('escalation')).filter((r) => ['PENDING', 'SENDING', 'UNCERTAIN'].includes(r.status));
    for (const item of rows.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
      if (item.nextAt > this.clock()) continue;
      const claimed = await this.store.transaction(async (tx) => {
        const e = await tx.get('escalation', item.id);
        if (!await activeEscalation(tx, e)) {
          if (e.status === 'PENDING') { e.status = 'CANCELLED'; await tx.put('escalation', e); }
          return null;
        }
        if (!['PENDING', 'SENDING', 'UNCERTAIN'].includes(e.status) || e.nextAt > this.clock()) return null;
        const reconcile = e.status !== 'PENDING';
        e.status = 'SENDING'; e.nextAt = this.clock() + 120000; e.attempts++; e.claim = randomUUID();
        await tx.put('escalation', e); return { ...e, reconcile };
      });
      if (!claimed) continue;
      let result; let status; let errorCode; let mayHavePosted = false;
      try {
        if (claimed.mode === 'DEMO') { result = { id: `DEMO-${claimed.id}`, source: 'DEMO' }; status = 'SENT'; }
        else if (!this.transport) { status = 'BLOCKED'; errorCode = 'GLPI_NOT_CONFIGURED'; }
        else {
          result = await this.transport.find(claimed.id);
          if (!result && !claimed.reconcile) {
            const canPost = await this.store.transaction(async (tx) => {
              const latest = await tx.get('escalation', claimed.id);
              if (latest.claim !== claimed.claim || latest.status !== 'SENDING' || latest.nextAt <= this.clock()) return false;
              if (!await activeEscalation(tx, latest)) { latest.status = 'CANCELLED'; await tx.put('escalation', latest); return false; }
              return true;
            });
            if (!canPost) continue;
            mayHavePosted = true; result = await this.transport.create(claimed, escalationContent(claimed));
          }
          status = result ? 'SENT' : 'UNCERTAIN';
        }
      } catch { status = mayHavePosted || claimed.reconcile ? 'UNCERTAIN' : claimed.attempts < 5 ? 'PENDING' : 'BLOCKED'; errorCode = mayHavePosted || claimed.reconcile ? 'GLPI_DELIVERY_UNCONFIRMED' : 'GLPI_LOOKUP_UNAVAILABLE'; }
      await this.store.transaction(async (tx) => {
        const e = await tx.get('escalation', claimed.id);
        if (e.claim !== claimed.claim || e.status !== 'SENDING') return;
        e.status = status; e.ticket = result || null; e.errorCode = errorCode || null;
        e.nextAt = ['UNCERTAIN', 'PENDING'].includes(status) ? this.clock() + 60000 * Math.min(e.attempts, 10) : null;
        // Bounded automatic reconciliation; never convert ambiguity into a fresh POST.
        if (e.attempts >= 10 && status === 'UNCERTAIN') e.status = 'REVIEW_REQUIRED';
        await tx.put('escalation', e);
        await tx.audit(e.hearingId, 'ESCALATION_' + e.status, 'scheduler', { key: e.id, ticket: e.ticket, errorCode: e.errorCode }, this.clock());
      });
    }
  }
}
