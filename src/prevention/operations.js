import { randomUUID } from 'node:crypto';
import { invalid, MINUTE, textField, normalizeHearing } from './agenda.js';

const network = new Set(['connectivity', 'dns', 'latency', 'packet_loss', 'zabbix_availability', 'zabbix_latency', 'zabbix_loss']);
const recent = (c, now) => Number.isFinite(Date.parse(c.observedAt)) && now - Date.parse(c.observedAt) <= 15 * MINUTE && Date.parse(c.observedAt) <= now + 10000;
const steps = () => [
  { id: 'local', title: 'Acionar o responsável local e registrar disponibilidade' },
  { id: 'room', title: 'Verificar sala alternativa e sua prontidão' },
  { id: 'equipment', title: 'Verificar equipamento reserva autorizado' },
  { id: 'network', title: 'Solicitar à TIC avaliação da rede ou contingência autorizada' },
  { id: 'communicate', title: 'Confirmar com a equipe da audiência o encaminhamento' },
].map((s) => ({ ...s, status: 'PENDING', responsible: '', evidence: '', at: null }));

export class PreventiveOperations {
  constructor(store, clock = () => Date.now()) { this.store = store; this.clock = clock; }

  async prepareCollectiveDemo(agenda, actor) {
    return this.store.transaction(async (tx) => {
      const now = this.clock(); const old = await tx.get('settings', 'collective-demo');
      if (old && old.expiresAt > now) return old;
      const ids = [];
      for (let i = 1; i <= 2; i++) {
        const stationId = `DEMO-COLLECTIVE-${i}`;
        const station = await tx.get('station', stationId);
        if (station && station.mode !== 'DEMO') throw invalid('Identificador reservado ocupado por estação REAL.', 409);
        await tx.put('station', { id: stationId, locality: 'Comarca DEMO coletiva', mode: 'DEMO', demoScenario: 'network', authorizedActions: [], authorizedDeviceIds: [] });
        const h = await agenda.saveInTransaction(tx, normalizeHearing({ label: `Contingência de rede DEMO ${i}`, stationId, locality: 'Comarca DEMO coletiva', room: `Sala DEMO ${i}`, responsible: 'Equipe fictícia DEMO', mode: 'DEMO', startsAt: new Date(now + (8+i) * MINUTE).toISOString(), durationMinutes: 30, conferenceUrl: `https://video.example.invalid/collective/${i}`, devices: ['Câmera sintética','Microfone sintético'] }), actor, null);
        ids.push(h.id);
      }
      const value = { id: 'collective-demo', hearingIds: ids, expiresAt: now + 40 * MINUTE };
      await tx.put('settings', value); return value;
    });
  }

  async synchronize() {
    return this.store.transaction(async (tx) => {
      const now = this.clock(); const hearings = await tx.list('hearing');
      const incidents = await tx.list('collective-incident'); const groups = new Map();
      for (const h of hearings.filter((h) => h.lifecycle === 'ATIVA')) {
        const failures = (h.lastChecks || []).filter((c) => c.status === 'FAIL');
        if (failures.length && !await tx.get('contingency', `${h.id}:${h.revision}`)) {
          await tx.put('contingency', { id: `${h.id}:${h.revision}`, hearingId: h.id, revision: 1, mode: h.mode, steps: steps() });
        }
        const checks = failures.filter((c) => network.has(c.name) && c.mode === h.mode && recent(c, now));
        if (!checks.length) continue;
        const key = JSON.stringify([h.mode, h.locality, 'network']);
        const closed = incidents.filter((i) => i.key === key && i.status === 'CLOSED').sort((a,b) => Date.parse(b.closedAt)-Date.parse(a.closedAt))[0];
        if (closed && checks.every((c) => Date.parse(c.observedAt) <= Date.parse(closed.closedAt))) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ h, checks });
      }
      for (const [key, affected] of groups) {
        let incident = incidents.find((i) => i.key === key && i.status === 'OPEN');
        const existingCount = incident?.hearingIds.length;
        if (!incident && new Set(affected.map((a) => a.h.stationId)).size < 2) continue;
        if (!incident) {
          incident = { id: randomUUID(), key, mode: affected[0].h.mode, locality: affected[0].h.locality, family: 'network', status: 'OPEN',
            title: 'Possível falha coletiva de rede', openedAt: new Date(now).toISOString(), revision: 1, hearingIds: [], timeline: [], resolution: null };
          incident.timeline.push({ at: incident.openedAt, text: 'Correlação automática: falhas de rede em pelo menos duas estações da mesma comarca. Causa comum ainda requer confirmação.' });
          await tx.put('notice', { id: `${incident.id}:opened`, incidentId: incident.id, mode: incident.mode, locality: incident.locality, at: incident.openedAt,
            text: 'Instabilidade de rede correlacionada nesta comarca. Consulte a ocorrência e o andamento do suporte antes de abrir outro chamado.' });
          await tx.audit('', 'COLLECTIVE_INCIDENT_OPENED', 'scheduler', { incidentId: incident.id, locality: incident.locality, mode: incident.mode }, now);
        }
        for (const { h, checks } of affected) {
          if (!incident.hearingIds.includes(h.id)) {
            incident.hearingIds.push(h.id); incident.timeline.push({ at: new Date(now).toISOString(), text: `Audiência associada: ${h.label}, ${h.room}, ${h.stationId}.` });
            await tx.audit(h.id, 'COLLECTIVE_INCIDENT_LINKED', 'scheduler', { incidentId: incident.id }, now);
          }
          h.collectiveIncidentId = incident.id; await tx.put('hearing', h);
        }
        if (existingCount !== undefined && existingCount !== incident.hearingIds.length) incident.revision++;
        const escalations = (await tx.list('escalation')).filter((e) => incident.hearingIds.includes(e.hearingId) && e.mode === incident.mode && !['CANCELLED', 'LINKED'].includes(e.status));
        let primary = escalations.find((e) => e.id === incident.primaryEscalationId) || escalations.find((e) => ['SENT','SENDING','UNCERTAIN','REVIEW_REQUIRED'].includes(e.status)) || escalations[0];
        if (primary) {
          incident.primaryEscalationId = primary.id;
          primary.collectiveIncidentId = incident.id;
          primary.collectiveHearingRefs = hearings.filter((h) => incident.hearingIds.includes(h.id)).map((h) => ({ id: h.id, revision: h.revision }));
          if (affected.some(({h}) => Date.parse(h.startsAt)-now <= 15*MINUTE)) primary.priority = 'CRITICAL';
          primary.collectiveEvidence = affected.map(({h, checks}) => ({ hearingId: h.id, stationId: h.stationId, room: h.room, checks }));
          await tx.put('escalation', primary);
          // These states mean no remote POST is outstanding. Ambiguous/SENT
          // deliveries retain their own identities and are never silently merged.
          for (const e of escalations.filter((e) => e.id !== primary.id && ['PENDING', 'BLOCKED'].includes(e.status))) {
            e.status = 'LINKED'; e.linkedTo = primary.id; e.collectiveIncidentId = incident.id; e.nextAt = null; await tx.put('escalation', e);
            await tx.audit(e.hearingId, 'ESCALATION_LINKED_TO_COLLECTIVE', 'scheduler', { primary: primary.id, incidentId: incident.id }, now);
          }
        }
        incident.updatedAt = new Date(now).toISOString(); await tx.put('collective-incident', incident);
      }
    });
  }

  async updateStep(hearing, stepId, input, actor) {
    if (!['PENDING','IN_PROGRESS','DONE','NOT_APPLICABLE'].includes(input.status)) throw invalid('Situação da etapa inválida.');
    const evidence = textField(input.evidence, 'resultado / justificativa', 2000);
    const responsible = textField(input.responsible, 'responsável', 160);
    return this.store.transaction(async (tx) => {
      const current = await tx.get('hearing', hearing.id);
      if (current.lifecycle !== 'ATIVA' || current.revision !== hearing.revision) throw invalid('Audiência alterada ou encerrada.', 409);
      const plan = await tx.get('contingency', `${hearing.id}:${hearing.revision}`);
      if (!plan || plan.revision !== input.expectedRevision) throw invalid('Plano alterado; atualize a página.', 409);
      const step = plan.steps.find((s) => s.id === stepId); if (!step) throw invalid('Etapa não encontrada.', 404);
      Object.assign(step, { status: input.status, responsible, evidence, actor, at: new Date(this.clock()).toISOString() });
      plan.revision++; await tx.put('contingency', plan);
      await tx.audit(hearing.id, 'CONTINGENCY_UPDATED', actor, { step }, this.clock()); return plan;
    });
  }

  async closeIncident(id, input, actor) {
    const resolution = textField(input.resolution, 'solução e evidência de normalização', 3000);
    return this.store.transaction(async (tx) => {
      const incident = await tx.get('collective-incident', id); if (!incident) throw invalid('Ocorrência não encontrada.', 404);
      if (incident.status === 'CLOSED') return incident;
      if (incident.revision !== input.expectedRevision) throw invalid('Ocorrência alterada; atualize a página.', 409);
      const now = this.clock(); incident.status = 'CLOSED'; incident.closedAt = new Date(now).toISOString(); incident.resolution = resolution; incident.closedBy = actor; incident.revision++;
      incident.timeline.push({ at: incident.closedAt, text: `Normalização confirmada por ${actor}: ${resolution}` });
      const hearings = (await tx.list('hearing')).filter((h) => incident.hearingIds.includes(h.id));
      const plans = (await tx.list('contingency')).filter((p) => incident.hearingIds.includes(p.hearingId));
      incident.report = { status: 'DRAFT', generatedAt: incident.closedAt, mode: incident.mode, title: `Pós-incidente — ${incident.locality}`,
        durationMinutes: Math.max(0, Math.round((now - Date.parse(incident.openedAt)) / MINUTE)),
        potentiallyAffectedHearings: hearings.map((h) => ({ id: h.id, label: h.label, room: h.room, stationId: h.stationId, startsAt: h.startsAt })),
        evidence: hearings.flatMap((h) => (h.lastChecks || []).map((c) => ({ hearingId: h.id, ...c }))),
        timeline: incident.timeline, procedures: plans, resolution, prevention: 'Revisar a causa com a equipe de redes e verificar a disponibilidade de contingência autorizada.',
        limitation: 'Audiências associadas indicam exposição ao incidente; não comprovam adiamento, horas perdidas ou prejuízo processual.' };
      await tx.put('collective-incident', incident);
      for (const e of await tx.list('escalation')) {
        if (e.collectiveIncidentId === id && ['PENDING', 'BLOCKED'].includes(e.status)) { e.status = 'CANCELLED'; e.nextAt = null; e.resolution = resolution; await tx.put('escalation',e); }
      }
      await tx.put('notice', { id: `${id}:closed`, incidentId: id, mode: incident.mode, locality: incident.locality, at: incident.closedAt, text: 'Normalização confirmada pela TIC. Consulte a verificação específica da sala antes de considerar a audiência pronta.' });
      for (const h of hearings) await tx.audit(h.id, 'COLLECTIVE_INCIDENT_CLOSED', actor, { incidentId: id, resolution }, now);
      return incident;
    });
  }

  async reviewReport(id, input, actor) {
    return this.store.transaction(async (tx) => {
      const i = await tx.get('collective-incident', id);
      if (!i?.report || i.revision !== input.expectedRevision) throw invalid('Relatório indisponível ou alterado.', 409);
      i.report.reviewNote = textField(input.reviewNote, 'revisão técnica', 3000); i.report.status = 'REVIEWED'; i.report.reviewedBy = actor; i.report.reviewedAt = new Date(this.clock()).toISOString(); i.revision++;
      await tx.put('collective-incident', i); await tx.audit('', 'POST_INCIDENT_REVIEWED', actor, { incidentId: id }, this.clock()); return i;
    });
  }

  async executive(mode = 'REAL', days = 30) {
    if (!['REAL','DEMO'].includes(mode) || !Number.isInteger(days) || days < 1 || days > 365) throw invalid('Período ou origem inválidos.');
    const cutoff = this.clock() - days * 86400000;
    const hearings = (await this.store.list('hearing')).filter((h) => h.mode === mode && Date.parse(h.startsAt) >= cutoff && Date.parse(h.startsAt) <= this.clock());
    const incidents = (await this.store.list('collective-incident')).filter((i) => i.mode === mode && Date.parse(i.openedAt) >= cutoff);
    const jobs = (await this.store.list('job')).filter((j) => hearings.some((h) => h.id === j.hearingId));
    return { generatedAt: new Date(this.clock()).toISOString(), mode, days, hearings: hearings.length,
      automaticallyChecked: hearings.filter((h) => h.lastJobId).length,
      readyAtLastCheck: hearings.filter((h) => h.lastChecks?.length && h.lastChecks.every((c) => c.status === 'PASS')).length,
      withFailureEvidence: hearings.filter((h) => h.lastChecks?.some((c) => c.status === 'FAIL')).length,
      withPrecedent: new Set(jobs.filter((j) => j.precedents?.length).map((j) => j.hearingId)).size,
      incidents, localities: [...new Set(hearings.map((h) => h.locality))].map((locality) => ({ locality, hearings: hearings.filter((h) => h.locality === locality).length, withFailures: hearings.filter((h) => h.locality === locality && h.lastChecks?.some((c) => c.status === 'FAIL')).length })),
      limitation: 'Indicadores observados da prevenção. Não estimam audiências salvas, economia financeira ou equidade por uma pontuação arbitrária.' };
  }
}
