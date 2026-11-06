import { createHash } from 'node:crypto';
import { invalid, textField } from './agenda.js';

const normalize = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const stop = new Set(['para', 'com', 'sem', 'uma', 'nao', 'que', 'como', 'por', 'dos', 'das']);
const tokens = (s) => [...new Set((normalize(s).match(/[a-z0-9]{3,}/g) || []).filter((x) => !stop.has(x)))];
export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  const dot = a.reduce((n, v, i) => n + v * b[i], 0);
  return dot / (Math.hypot(...a) * Math.hypot(...b) || 1);
}
export function embeddingProvider(config = {}) {
  if (!config.baseUrl || !config.model) return null;
  return {
    model: `${config.baseUrl}:${config.model}`,
    async embed(text) {
      const result = await fetch(`${config.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
        body: JSON.stringify({ model: config.model, input: text.slice(0, 12000) }), signal: AbortSignal.timeout(8000),
      });
      if (!result.ok) throw new Error('EMBEDDING_HTTP_' + result.status);
      const vector = (await result.json())?.data?.[0]?.embedding;
      if (!Array.isArray(vector) || !vector.length || vector.length > 4096 || vector.some((x) => !Number.isFinite(x))) throw new Error('EMBEDDING_INVALID');
      return vector;
    },
  };
}

export class OperationalKnowledge {
  constructor({ store, glpi, embedder = null, clock = () => Date.now() }) { Object.assign(this, { store, glpi, embedder, clock }); }
  async capture(input, actor) {
    if (!this.glpi) throw invalid('GLPI real não configurado.', 409);
    const ticketId = textField(String(input.ticketId || ''), 'chamado GLPI', 30);
    const evidence = textField(input.successEvidence, 'evidência de sucesso confirmada', 2000);
    const ticket = await this.glpi.resolvedTicket(ticketId);
    const id = `GLPI:${ticketId}`;
    const record = { id, ticketId, source: 'GLPI', mode: 'REAL', validation: 'PENDING', status: 'EXTRACTING',
      date: new Date(this.clock()).toISOString(), successEvidence: evidence, confirmedBy: actor,
      title: ticket.title, problem: ticket.problem.replace(/<[^>]*>/g, ' ').slice(0, 4000),
      metadata: { category: String(input.category || '').slice(0, 80), system: String(input.system || '').slice(0, 80), locality: String(input.locality || '').slice(0, 160), stationId: String(input.stationId || '').slice(0, 100) },
      glpiStatus: ticket.status, glpiObservedAt: ticket.observedAt };
    await this.store.transaction(async (tx) => {
      if (await tx.get('knowledge', id)) throw invalid('Chamado já extraído ou aguardando reconciliação.', 409);
      await tx.put('knowledge', record); await tx.audit('', 'KNOWLEDGE_SOLUTION_CONFIRMED', actor, { id, ticketId });
    });
    try {
      // Persist before any remote write: a crash is reviewed, never silently retried.
      const solutionId = input.solutionId || await this.glpi.registerSolution(ticketId, textField(input.solution, 'solução', 8000), evidence);
      const solution = await this.glpi.readSolution(ticketId, solutionId);
      record.solutionId = solution.id; record.solution = solution.content.slice(0, 8000); record.status = 'PENDING_VALIDATION';
      record.contentHash = createHash('sha256').update(record.solution).digest('hex');
    } catch (error) {
      record.status = 'REVIEW_REQUIRED';
      await this.store.transaction(async (tx) => { await tx.put('knowledge', record); await tx.audit('', 'KNOWLEDGE_GLPI_UNCONFIRMED', actor, { id }); });
      throw error;
    }
    await this.store.transaction(async (tx) => { await tx.put('knowledge', record); await tx.audit('', 'KNOWLEDGE_EXTRACTED', actor, { id, solutionId: record.solutionId }); });
    return record;
  }
  async validate(id, approved, actor) {
    const record = await this.store.get('knowledge', id);
    if (!record || !record.solution || !record.successEvidence || !record.solutionId) throw invalid('Solução confirmada no GLPI e evidências são obrigatórias.');
    const previousValidation = record.validation; const previousDate = record.validatedAt || null;
    record.validation = approved ? 'VALIDATED' : 'REJECTED'; record.validatedBy = actor; record.validatedAt = new Date(this.clock()).toISOString();
    record.status = approved ? 'INDEXED' : 'REJECTED'; record.embedding = null; record.embeddingModel = null;
    if (approved && this.embedder) {
      try { record.embedding = await this.embedder.embed(`${record.title} ${record.problem} ${record.solution}`); record.embeddingModel = this.embedder.model; }
      catch { record.indexWarning = 'EMBEDDINGS_UNAVAILABLE_LEXICAL_ONLY'; }
    }
    await this.store.transaction(async (tx) => {
      const current = await tx.get('knowledge', id);
      if (current.validation !== previousValidation || (current.validatedAt || null) !== previousDate) throw invalid('A validação foi atualizada por outro técnico; recarregue.', 409);
      await tx.put('knowledge', record); await tx.audit('', 'KNOWLEDGE_' + record.validation, actor, { id, embeddingModel: record.embeddingModel });
    });
    return record;
  }
  async reconcile(id, solutionId, actor) {
    const record = await this.store.get('knowledge', id);
    if (!record || !['REVIEW_REQUIRED', 'EXTRACTING'].includes(record.status) || !this.glpi) throw invalid('Extração não disponível para reconciliação.', 409);
    await this.glpi.resolvedTicket(record.ticketId);
    const solution = await this.glpi.readSolution(record.ticketId, solutionId);
    record.solutionId = solution.id; record.solution = solution.content.slice(0, 8000); record.status = 'PENDING_VALIDATION'; record.validation = 'PENDING';
    record.contentHash = createHash('sha256').update(record.solution).digest('hex');
    await this.store.transaction(async (tx) => { await tx.put('knowledge', record); await tx.audit('', 'KNOWLEDGE_RECONCILED', actor, { id, solutionId }); });
    return record;
  }
  async search(query, metadata = {}) {
    const records = (await this.store.list('knowledge')).filter((r) => r.validation === 'VALIDATED' && r.status === 'INDEXED' && r.successEvidence && r.mode === (metadata.mode || 'REAL'));
    let vector = null;
    if (this.embedder && records.some((r) => r.embeddingModel === this.embedder.model)) {
      try { vector = await this.embedder.embed(query); } catch {}
    }
    const words = tokens(query);
    return records.map((r) => {
      const haystack = normalize(`${r.title} ${r.problem} ${r.solution}`);
      const matched = words.filter((w) => haystack.includes(w)); const lexical = matched.length / Math.max(1, words.length);
      const semantic = vector && r.embeddingModel === this.embedder.model ? Math.max(0, cosine(vector, r.embedding)) : 0;
      const matchingMetadata = Object.keys(r.metadata || {}).filter((k) => metadata[k] && normalize(metadata[k]) === normalize(r.metadata[k]));
      const score = lexical * (vector ? 0.5 : 0.85) + semantic * 0.35 + Math.min(0.15, matchingMetadata.length * 0.05);
      const { embedding, ...safe } = r;
      return { ...safe, score, relevance: { lexical, semantic: vector ? semantic : null, terms: matched, metadata: matchingMetadata, method: vector ? 'LEXICAL_EMBEDDINGS_METADATA' : 'LEXICAL_METADATA', explanation: `Termos: ${matched.join(', ') || 'sem coincidência lexical'}; metadados: ${matchingMetadata.join(', ') || 'nenhum'}; origem GLPI ${r.ticketId}, validação ${r.validatedAt}.` } };
    }).filter((r) => r.relevance.lexical > 0 || r.relevance.semantic > 0.6).sort((a, b) => b.score - a.score).slice(0, 5);
  }
}

export function toCopilotPrecedent(record) {
  return { ...record, titulo: record.title, relato: record.problem, resolucao_comprovada: record.solution,
    passos_resolucao: [record.solution], similarityScore: Math.round(record.score * 100),
    computador: { nome: record.metadata?.stationId, unidade: record.metadata?.locality },
  };
}
