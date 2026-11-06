import { randomUUID } from 'node:crypto';

export const STATES = ['AGENDADA', 'VERIFICAÇÃO_PENDENTE', 'VERIFICANDO', 'PRONTA', 'ATENÇÃO', 'CRÍTICA', 'NÃO_VERIFICÁVEL', 'CONCLUÍDA'];
export const MINUTE = 60000;
export function invalid(message, status = 400) { return Object.assign(new Error(message), { status }); }
export function textField(value, name, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw invalid(`Campo ${name} inválido (1–${max} caracteres).`);
  return value.trim();
}
export function normalizeHearing(input) {
  const startsAt = textField(input.startsAt, 'startsAt', 40);
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(startsAt) || !Number.isFinite(Date.parse(startsAt))) throw invalid('Informe horário ISO 8601 com fuso explícito, por exemplo 2026-11-05T10:30:00-03:00.');
  const timezone = input.timezone || 'America/Sao_Paulo';
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: timezone }); } catch { throw invalid('Fuso IANA inválido.'); }
  if (!['REAL', 'DEMO'].includes(input.mode)) throw invalid('Selecione REAL ou DEMO.');
  const durationMinutes = Number(input.durationMinutes ?? 60);
  if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 720) throw invalid('Duração deve ser de 5 a 720 minutos.');
  if (input.devices !== undefined && (!Array.isArray(input.devices) || input.devices.length > 20)) throw invalid('Informe até 20 dispositivos.');
  return {
    label: textField(input.label, 'identificação técnica', 120), locality: textField(input.locality, 'comarca'),
    room: textField(input.room, 'sala'), stationId: textField(input.stationId, 'estação', 100),
    responsible: textField(input.responsible, 'responsável'), startsAt: new Date(startsAt).toISOString(),
    timezone, durationMinutes, mode: input.mode,
    type: input.type ? textField(input.type, 'tipo', 120) : 'Audiência',
    department: input.department ? textField(input.department, 'vara/setor') : 'Não informado',
    conferenceUrl: input.conferenceUrl && /^https:\/\//i.test(input.conferenceUrl) ? textField(input.conferenceUrl, 'videoconferência', 500) : '',
    devices: (input.devices || []).map((d) => textField(d, 'dispositivo', 100)),
  };
}

export class Agenda {
  constructor(store, clock = () => Date.now()) { this.store = store; this.clock = clock; }
  async save(input, actor, id = null) {
    const normalized = { ...normalizeHearing(input), expectedRevision: input.expectedRevision };
    return this.store.transaction(async (tx) => this.saveInTransaction(tx, normalized, actor, id));
  }
  async saveInTransaction(tx, input, actor, id) {
    const old = id ? await tx.get('hearing', id) : null;
    if (id && !old) throw invalid('Audiência não encontrada.', 404);
    if (old && ['CANCELADA', 'CONCLUÍDA'].includes(old.lifecycle)) throw invalid('Audiência encerrada não pode ser reagendada.', 409);
    if (old && input.mode !== old.mode) throw invalid('O modo de uma audiência é imutável.');
    if (old && Number(input.expectedRevision) !== old.revision) throw invalid('A agenda mudou. Atualize a tela antes de salvar.', 409);
    const station = await tx.get('station', input.stationId);
    if (!station || station.mode !== input.mode || station.locality !== input.locality) throw invalid('Estação deve estar cadastrada na mesma comarca e modo.');
    if (old) {
      const job = await tx.get('job', `${old.id}:${old.revision}`);
      if (job) { job.status = 'CANCELLED'; await tx.put('job', job); }
    }
    const { expectedRevision, ...fields } = input;
    const h = { ...fields, id: id || randomUUID(), revision: (old?.revision || 0) + 1,
      lifecycle: 'ATIVA', state: 'AGENDADA', createdBy: old?.createdBy || actor, updatedAt: new Date(this.clock()).toISOString() };
    await tx.put('hearing', h);
    await tx.put('job', { id: `${h.id}:${h.revision}`, hearingId: h.id, revision: h.revision, status: 'PENDING',
      nextAt: Date.parse(h.startsAt) - 30 * MINUTE, attempts: 0, history: [], mode: h.mode });
    await tx.audit(h.id, old ? 'RESCHEDULED' : 'SCHEDULED', actor, { revision: h.revision, startsAt: h.startsAt, mode: h.mode }, this.clock());
    return h;
  }
  async import(rows, actor) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 100) throw invalid('Importe de 1 a 100 audiências por lote.');
    const normalized = rows.map(normalizeHearing);
    // An import reference is required and scoped to this tenant; retries are harmless.
    const refs = rows.map((r) => textField(r.externalRef, 'externalRef', 100));
    if (new Set(refs).size !== refs.length) throw invalid('externalRef duplicado no lote.');
    return this.store.transaction(async (tx) => {
      const result = [];
      for (let i = 0; i < normalized.length; i++) {
        const existing = await tx.get('import', refs[i]);
        if (existing) result.push(await tx.get('hearing', existing.hearingId));
        else {
          const h = await this.saveInTransaction(tx, normalized[i], actor, null);
          await tx.put('import', { id: refs[i], hearingId: h.id }); result.push(h);
        }
      }
      return result;
    });
  }
  async end(id, lifecycle, actor) {
    if (!['CANCELADA', 'CONCLUÍDA'].includes(lifecycle)) throw invalid('Situação inválida.');
    return this.store.transaction(async (tx) => {
      const h = await tx.get('hearing', id);
      if (!h) throw invalid('Audiência não encontrada.', 404);
      h.lifecycle = lifecycle; h.state = 'CONCLUÍDA';
      await tx.put('hearing', h);
      const job = await tx.get('job', `${id}:${h.revision}`);
      if (job) { job.status = 'CANCELLED'; await tx.put('job', job); }
      await tx.audit(id, lifecycle, actor, {}, this.clock()); return h;
    });
  }
}
