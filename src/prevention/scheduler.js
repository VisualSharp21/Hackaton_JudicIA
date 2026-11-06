import { randomUUID, randomBytes } from 'node:crypto';
import { diagnose, readiness, hashToken } from './diagnostics.js';
import { MINUTE } from './agenda.js';

export class HearingScheduler {
  constructor({ store, clock = () => Date.now(), diagnostics = diagnose, lookup = async () => [], escalation, operations, maxAttempts = 3, leaseMs = 120000 }) {
    Object.assign(this, { store, clock, diagnostics, lookup, escalation, operations, maxAttempts, leaseMs });
    this.running = false;
  }
  start(intervalMs = 5000) {
    if (this.timer) return;
    const run = () => this.tick().catch((error) => console.error('[prevention] tick failed', error.code || error.name));
    this.timer = setInterval(run, intervalMs); this.timer.unref?.(); void run();
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  async claim(id) {
    return this.store.transaction(async (tx) => {
      const now = this.clock(); const job = await tx.get('job', id);
      if (!job || !['PENDING', 'RUNNING'].includes(job.status) || job.nextAt > now) return null;
      const hearing = await tx.get('hearing', job.hearingId);
      if (!hearing || hearing.lifecycle !== 'ATIVA' || hearing.revision !== job.revision) { job.status = 'CANCELLED'; await tx.put('job', job); return null; }
      if (now >= Date.parse(hearing.startsAt) + hearing.durationMinutes * MINUTE) {
        hearing.state = 'CONCLUÍDA'; hearing.lifecycle = 'CONCLUÍDA'; job.status = 'DONE';
        await tx.put('job', job); await tx.put('hearing', hearing); return null;
      }
      if (job.status === 'RUNNING') await tx.audit(hearing.id, 'LEASE_RECOVERED', 'scheduler', { jobId: id }, now);
      job.status = 'RUNNING'; job.lease = randomUUID(); job.nextAt = now + this.leaseMs; job.attempts++;
      if (!job.agentNonce || job.reportNonceUsed) {
        job.agentNonce = randomBytes(24).toString('base64url'); job.agentNonceHash = hashToken(job.agentNonce); job.reportNonceUsed = false;
      }
      hearing.state = 'VERIFICAÇÃO_PENDENTE'; await tx.audit(hearing.id, 'VERIFICAÇÃO_PENDENTE', 'scheduler', { jobId: id }, now);
      hearing.state = 'VERIFICANDO';
      await tx.put('job', job); await tx.put('hearing', hearing);
      await tx.audit(hearing.id, 'CHECK_STARTED', 'scheduler', { attempt: job.attempts, mode: hearing.mode }, now);
      return { job, hearing, station: await tx.get('station', hearing.stationId), now };
    });
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // Explicit end time also applies to hearings whose checks already finished.
      await this.store.transaction(async (tx) => {
        for (const h of await tx.activeHearings(this.clock())) {
          if (this.clock() < Date.parse(h.startsAt) + h.durationMinutes * MINUTE) {
            if (h.lastChecks?.some((c) => c.status === 'FAIL') && h.state !== 'VERIFICANDO') {
              const nextState = readiness(h.lastChecks, Date.parse(h.startsAt) - this.clock());
              if (nextState !== h.state) {
                h.state = nextState; await tx.put('hearing', h);
                const e = await tx.get('escalation', `${h.id}:${h.revision}`);
                if (e && nextState === 'CRÍTICA') { e.priority = 'CRITICAL'; await tx.put('escalation', e); }
                await tx.audit(h.id, 'TIME_PRIORITY_UPDATED', 'scheduler', { state: nextState }, this.clock());
              }
            }
            continue;
          }
          h.lifecycle = 'CONCLUÍDA'; h.state = 'CONCLUÍDA'; await tx.put('hearing', h);
          const j = await tx.get('job', `${h.id}:${h.revision}`); if (j && j.status !== 'DONE') { j.status = 'CANCELLED'; await tx.put('job', j); }
          await tx.audit(h.id, 'HEARING_WINDOW_ENDED', 'scheduler', {}, this.clock());
        }
      });
      const due = await this.store.due(this.clock());
      // Bounded concurrency, ordered by due time (= closest hearing first).
      for (let offset = 0; offset < due.length; offset += 4) {
        await Promise.all(due.slice(offset, offset + 4).map(async (candidate) => {
          const context = await this.claim(candidate.id);
          if (context) await this.execute(context);
        }));
      }
      if (this.operations) await this.operations.synchronize();
      if (this.escalation) await this.escalation.flush();
    } finally { this.running = false; }
  }
  async execute(context) {
    const { job, hearing, station } = context;
    let checks; let integrationError = null; let precedents = [];
    try {
      checks = await this.diagnostics(context);
      if (checks.some((c) => c.status === 'FAIL')) {
        try { precedents = await this.lookup(checks.map((c) => c.evidence).join(' '), { mode: hearing.mode, stationId: station.id, locality: hearing.locality }); }
        catch { integrationError = 'KNOWLEDGE_UNAVAILABLE'; }
      }
      // A deliberately isolated simulated reversible correction exercises the same workflow.
      if (hearing.mode === 'DEMO' && station.demoScenario === 'recoverable' && !job.demoCorrected) {
        job.demoCorrected = true;
        job.action = { id: `${job.id}:audio`, name: 'enable_audio_device', status: 'EXECUTED', mode: 'DEMO', evidence: 'DEMO: reativação simulada; reversão disponível.' };
        job.history.push({ at: new Date(this.clock()).toISOString(), checks, phase: 'BEFORE_ACTION' });
        checks = await this.diagnostics({ ...context, job });
      }
    } catch (error) {
      integrationError = `DIAGNOSTIC_${error.code || error.name}`;
      checks = [{ name: 'diagnostics', layer: 'SERVER', status: 'UNVERIFIABLE', mode: hearing.mode, observedAt: new Date(this.clock()).toISOString(), evidence: 'Falha de integração no diagnóstico; retentativa controlada.' }];
    }
    await this.store.transaction(async (tx) => {
      const current = await tx.get('job', job.id); const h = await tx.get('hearing', hearing.id);
      if (!current || current.status !== 'RUNNING' || current.lease !== job.lease || h.lifecycle !== 'ATIVA' || h.revision !== job.revision) return;
      const now = this.clock(); const remaining = Date.parse(h.startsAt) - now;
      current.history = [...job.history, { at: new Date(now).toISOString(), checks, phase: 'CHECK', integrationError }];
      current.demoCorrected = job.demoCorrected || false;
      const localReportChanged = current.browserReport?.receivedAt !== job.browserReport?.receivedAt;
      current.precedents = precedents.map((p) => ({ id: p.id, relevance: p.relevance, validation: p.validation }));
      if (precedents.length) await tx.audit(h.id, 'PRECEDENT_FOUND', 'scheduler', { ids: precedents.map((p) => p.id), mode: h.mode }, now);
      if (job.action?.mode === 'DEMO') current.action = job.action;
      // Production actions are fixed, individually authorized, executed by the local agent.
      if (h.mode === 'REAL' && !current.action && station.authorizedActions.includes('enable_audio_device') && station.authorizedDeviceIds.length && checks.some((c) => c.layer === 'AGENT' && c.status === 'FAIL' && /DISABLED_CODE_22/.test(c.evidence))) {
        current.action = { id: `${job.id}:audio`, name: 'enable_audio_device', status: 'REQUESTED', deviceIds: station.authorizedDeviceIds, mode: 'REAL' };
        current.reportNonceUsed = true; // fresh challenge on the next claim
        await tx.audit(h.id, 'AUTHORIZED_ACTION_REQUESTED', 'scheduler', current.action, now);
      }
      h.state = readiness(checks, remaining); h.lastChecks = checks; h.lastJobId = job.id;
      const failed = checks.some((c) => c.status === 'FAIL');
      const retry = localReportChanged || (h.state !== 'PRONTA' && current.attempts < this.maxAttempts);
      current.status = retry ? 'PENDING' : 'DONE';
      current.nextAt = retry ? now + Math.min(60000, 15000 * 2 ** (current.attempts - 1)) : null;
      // A confirmed failure is escalated without a user's request. Missing evidence is explicit.
      if (failed && (remaining <= 15 * MINUTE || !retry)) {
        const key = `${h.id}:${h.revision}`;
        if (!await tx.get('escalation', key)) {
          await tx.put('escalation', { id: key, hearingId: h.id, revision: h.revision, stationId: h.stationId, room: h.room, locality: h.locality,
            responsible: h.responsible, startsAt: h.startsAt, mode: h.mode, priority: remaining <= 15 * MINUTE ? 'CRITICAL' : 'HIGH',
            status: 'PENDING', attempts: 0, nextAt: now, checks, precedents: current.precedents, actions: current.action ? [current.action] : [], history: current.history, createdAt: new Date(now).toISOString() });
          await tx.audit(h.id, 'ESCALATION_QUEUED', 'scheduler', { key, priority: remaining <= 15 * MINUTE ? 'CRITICAL' : 'HIGH' }, now);
        }
      }
      if (h.state === 'PRONTA') {
        const e = await tx.get('escalation', `${h.id}:${h.revision}`);
        if (e?.status === 'PENDING') { e.status = 'CANCELLED'; e.resolution = 'Subsequent checks passed before dispatch.'; await tx.put('escalation', e); }
      }
      await tx.put('job', current); await tx.put('hearing', h);
      await tx.audit(h.id, 'CHECK_FINISHED', 'scheduler', { jobId: job.id, state: h.state, checks, action: current.action, integrationError }, now);
    });
  }
}
