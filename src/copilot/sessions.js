/**
 * Persistência do Copilot no banco local do tenant:
 *   - copilot_sessions: estado da conversa (mensagens, ferramentas, laudos, tentativas);
 *   - requests/decisions: a solicitação triada pelo Laya, a mesma tabela do restante do
 *     sistema (aparece em Qualidade, Piloto e nos chamados);
 *   - service_events/request_feedback: autoatendimento resolvido e nota de satisfação.
 *
 * Usa queryRaw (SQL nativo do MariaDB) porque as mensagens do chat são texto livre.
 */
import { randomUUID } from 'node:crypto';
import { queryRaw, queryRawJson, sqlValue } from '../database.js';
import { listServiceLocalities } from '../repository.js';
import { loadHermesMemory } from './data-loader.js';
import { normalize } from './text.js';

export const SESSION_STATUS = Object.freeze({ active: 'EM_ANDAMENTO', resolved: 'RESOLVIDO_AUTOATENDIMENTO', escalated: 'ESCALADO_GLPI' });
const json = (value) => sqlValue(JSON.stringify(value ?? null));

function parseJsonColumn(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

const sessionSelect = `SELECT JSON_OBJECT('id',id,'requestId',request_id,'machineId',machine_id,'machineDetection',machine_detection,'status',status,'engine',engine,'state',JSON_EXTRACT(state,'$'),'ticketId',ticket_id,'createdBy',created_by,'createdAt',created_at,'updatedAt',updated_at) FROM copilot_sessions`;

export function createCopilotSession({ userId, machineId, detection = 'seletor' }) {
  const id = `COP-${randomUUID().slice(0, 8).toUpperCase()}`;
  const state = { version: 1, machineId, machineDetection: detection, messages: [], llmHistory: [], attemptedProcedures: [], tools: {} };
  queryRaw(`INSERT INTO copilot_sessions(id,machine_id,machine_detection,status,engine,state,created_by) VALUES(${sqlValue(id)},${sqlValue(machineId)},${sqlValue(detection)},'${SESSION_STATUS.active}','regras',${json(state)},${sqlValue(userId)})`);
  return getCopilotSession(id);
}

/** Sessão pelo id; solicitantes só enxergam as próprias (TIC enxerga todas do tenant). */
export function getCopilotSession(id, viewer = null) {
  if (!/^COP-[0-9A-F]{8}$/.test(String(id || ''))) return null;
  const row = queryRawJson(`${sessionSelect} WHERE id=${sqlValue(id)} LIMIT 1`, null);
  if (!row) return null;
  if (viewer && viewer.role !== 'tic' && row.createdBy !== viewer.id) return null;
  return { ...row, state: parseJsonColumn(row.state, {}) };
}

export function saveCopilotSession(session) {
  queryRaw(`UPDATE copilot_sessions SET state=${json(session.state)},status=${sqlValue(session.status)},engine=${sqlValue(String(session.engine || 'regras').slice(0, 190))},request_id=${sqlValue(session.requestId)},ticket_id=${sqlValue(session.ticketId)},machine_id=${sqlValue(session.machineId)},machine_detection=${sqlValue(session.machineDetection)},updated_at=CURRENT_TIMESTAMP(3) WHERE id=${sqlValue(session.id)}`);
}

/** Comarca ativa correspondente à unidade da estação ("Belém" ➔ "Comarca de Belém"). */
export function localityForMachine(machine) {
  const unit = normalize(machine?.unidade || '');
  const active = listServiceLocalities(false) || [];
  const match = active.find((l) => normalize(l.name) === unit) || active.find((l) => unit && normalize(l.name).includes(unit));
  return (match?.name || machine?.unidade || 'Não informada').slice(0, 255);
}

function articleSnapshot(solution) {
  if (!solution) return null;
  return {
    id: solution.procedimentoId ? `KB-COPILOT:${solution.procedimentoId}` : 'KB-COPILOT',
    title: solution.titulo,
    category: null,
    system: null,
    problem: solution.titulo,
    solution: solution.diagnostico || '',
    steps: solution.passos.map((s) => s.texto),
    sourceProvider: 'copilot',
    fonte: solution.fonte,
  };
}

/**
 * Cria (primeira mensagem com relato) ou atualiza a solicitação ligada à sessão.
 * Não sobrescreve correções humanas nem solicitações já encerradas.
 */
export function upsertCopilotRequest(session, request, { userId, machine }) {
  if (!request) return session.requestId || null;
  const decision = request.decision;
  const snapshot = articleSnapshot(request.solution);
  const snapshotSql = snapshot ? json(snapshot) : 'NULL';
  const confidence = Math.max(0, Math.min(1, Number(request.confidence) || 0));
  if (!session.requestId) {
    const id = `REQ-${randomUUID().slice(0, 8).toUpperCase()}`;
    queryRaw(`INSERT INTO requests(id,description,decision,priority,queue,confidence,article_id,article_snapshot,provider,triage_status,locality,created_by) VALUES(${sqlValue(id)},${sqlValue(request.description)},${json(decision)},${sqlValue(request.priority)},${sqlValue(request.queue)},${confidence},NULL,${snapshotSql},${sqlValue(String(request.provider).slice(0, 100))},${sqlValue(request.triageStatus)},${sqlValue(localityForMachine(machine))},${sqlValue(userId)})`);
    queryRaw(`INSERT INTO decisions(request_id,payload,provider) VALUES(${sqlValue(id)},${json(request.rawDecision)},${sqlValue(String(request.provider).slice(0, 100))})`);
    session.requestId = id;
    session.state.lastLoggedDecision = JSON.stringify(decision);
    return id;
  }
  const changed = session.state.lastLoggedDecision !== JSON.stringify(decision);
  queryRaw(`UPDATE requests SET description=${sqlValue(request.description)},decision=${json(decision)},priority=${sqlValue(request.priority)},queue=${sqlValue(request.queue)},confidence=${confidence},article_snapshot=COALESCE(${snapshotSql},article_snapshot),provider=${sqlValue(String(request.provider).slice(0, 100))},triage_status=${sqlValue(request.triageStatus)} WHERE id=${sqlValue(session.requestId)} AND corrected_decision IS NULL AND status='ANALYZED'`);
  if (changed) {
    queryRaw(`INSERT INTO decisions(request_id,payload,provider) VALUES(${sqlValue(session.requestId)},${json(request.rawDecision)},${sqlValue(String(request.provider).slice(0, 100))})`);
    session.state.lastLoggedDecision = JSON.stringify(decision);
  }
  return session.requestId;
}

export function getRequestRow(requestId) {
  if (!requestId) return null;
  const row = queryRawJson(`SELECT JSON_OBJECT('id',id,'description',description,'decision',JSON_EXTRACT(decision,'$'),'corrected_decision',JSON_EXTRACT(corrected_decision,'$'),'priority',priority,'queue',queue,'confidence',confidence,'triage_status',triage_status,'locality',locality,'status',status,'provider',provider,'created_by',created_by,'created_at',created_at) FROM requests WHERE id=${sqlValue(requestId)} LIMIT 1`, null);
  if (!row) return null;
  return { ...row, decision: parseJsonColumn(row.decision, {}), corrected_decision: parseJsonColumn(row.corrected_decision, null), confidence: Number(row.confidence) || 0 };
}

export function ticketForRequest(requestId) {
  return queryRawJson(`SELECT JSON_OBJECT('id',id,'protocol',protocol,'queue',assigned_queue,'priority',priority,'status',status,'glpiCategoryId',glpi_category_id,'queueRouting',queue_routing,'createdAt',created_at) FROM tickets WHERE request_id=${sqlValue(requestId)} ORDER BY created_at DESC LIMIT 1`, null);
}

/** "✅ Consegui resolver!": registra o autoatendimento (service_events) na solicitação. */
export function resolveCopilotSession(session) {
  const request = getRequestRow(session.requestId);
  if (!request) throw Object.assign(new Error('Descreva o problema antes de concluir o atendimento.'), { status: 409 });
  if (request.status === 'TICKET_CREATED') throw Object.assign(new Error('Este atendimento já virou chamado no GLPI.'), { status: 409 });
  if (request.status !== 'SELF_SERVICE_RESOLVED') {
    queryRaw(`UPDATE requests SET status='SELF_SERVICE_RESOLVED' WHERE id=${sqlValue(request.id)}`);
    const procedure = session.state.lastSolution?.procedimentoId ? `KB-COPILOT:${session.state.lastSolution.procedimentoId}` : null;
    queryRaw(`INSERT INTO service_events(type,request_id,knowledge_article_id) VALUES('SELF_SERVICE_RESOLVED',${sqlValue(request.id)},${sqlValue(procedure)})`);
  }
  session.status = SESSION_STATUS.resolved;
  session.state.resolution = { ...(session.state.resolution || {}), resolvidoEm: new Date().toISOString(), procedimento: session.state.lastSolution?.titulo || null };
  saveCopilotSession(session);
  return session;
}

/** Nota de satisfação (1–5) do autoatendimento. */
export function saveCopilotFeedback(session, rating, comment = '') {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw Object.assign(new Error('A nota deve ser de 1 a 5.'), { status: 400 });
  if (session.status !== SESSION_STATUS.resolved || !session.requestId)
    throw Object.assign(new Error('A avaliação é registrada depois de concluir o autoatendimento.'), { status: 409 });
  const note = String(comment || '').trim().slice(0, 500) || null;
  queryRaw(`INSERT INTO request_feedback(request_id,rating,comment) VALUES(${sqlValue(session.requestId)},${rating},${sqlValue(note)}) ON DUPLICATE KEY UPDATE rating=VALUES(rating),comment=VALUES(comment),created_at=CURRENT_TIMESTAMP(3)`);
  session.state.resolution = { ...(session.state.resolution || {}), nota: rating, comentario: note };
  saveCopilotSession(session);
  return { saved: true, rating };
}

// ------------------------------------------------- registro da sessão (.md) --

/**
 * Registro do atendimento no formato de hermes-memory/sessoes/template-sessao.md
 * (placeholders preenchidos; blocos de ferramenta e de histórico repetidos por item).
 */
export function renderSessionLog(session, machine) {
  const template = loadHermesMemory().sessoes?.['template-sessao.md'] || '';
  const state = session.state || {};
  const triage = state.lastTriage || {};
  const tools = [];
  if (state.tools?.meet)
    tools.push({ name: 'run_meet_check', args: JSON.stringify({ machineId: session.machineId, meetUrl: state.tools.meet.meetUrl || null }), output: state.tools.meet.laudo ? `${state.tools.meet.laudo.veredito} — ${state.tools.meet.laudo.resumo}` : `${state.tools.meet.status} (cartão exibido)` });
  if (state.escalationProposal) tools.push({ name: 'escalate_glpi_ticket', args: JSON.stringify({ title: state.escalationProposal.titulo }), output: 'Proposta exibida ao usuário' });
  const pairs = [];
  let pending = null;
  for (const message of state.messages || []) {
    if (message.role === 'user') pending = { user: message.text, agent: '' };
    else if (pending) {
      pending.agent = message.text;
      pairs.push(pending);
      pending = null;
    }
  }
  const one = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  const statusLine = session.status;
  const scalars = {
    '{session_id}': session.id,
    '{timestamp_inicio}': session.createdAt,
    '{machine_id}': session.machineId,
    '{machine_model}': machine ? `${machine.fabricante} ${machine.modelo}` : '—',
    '{os}': machine ? machine.so.nome : '—',
    '{machine_sector}': machine ? `${machine.setor} (${machine.unidade})` : '—',
    '{category}': triage.categoria || '—',
    '{system}': triage.sistema || '—',
    '{urgency}': triage.urgencia || '—',
    '{priority}': triage.prioridade || '—',
    '{glpi_ticket_id_ou_null}': state.escalation?.protocol || 'null',
  };
  const out = [];
  for (const line of template.split(/\r?\n/)) {
    if (line.includes('{tool_name}') || line.includes('{tool_arguments}') || line.includes('{tool_output}')) {
      if (line.includes('{tool_name}')) {
        if (!tools.length) out.push('- **Ferramenta:** `nenhuma`');
        for (const tool of tools) out.push(line.replace('{tool_name}', tool.name), `- **Parâmetros Enviados:** \`${tool.args}\``, `- **Laudo Retornado:** \`${one(tool.output)}\``);
      }
      continue;
    }
    if (line.includes('{user_message_1}')) {
      for (const pair of pairs) out.push(`- **Usuário:** \`${one(pair.user)}\``, `- **Copilot:** \`${one(pair.agent)}\``);
      continue;
    }
    if (line.includes('{agent_message_1}')) continue;
    let filled = line;
    if (/EM_ANDAMENTO \| RESOLVIDO_AUTOATENDIMENTO \| ESCALADO_GLPI/.test(filled)) filled = filled.replace(/`EM_ANDAMENTO \| RESOLVIDO_AUTOATENDIMENTO \| ESCALADO_GLPI`/, `\`${statusLine}\``);
    if (/`Sim \/ Não`/.test(filled)) filled = filled.replace('`Sim / Não`', `\`${session.status === SESSION_STATUS.resolved ? 'Sim' : 'Não'}\``);
    for (const [key, value] of Object.entries(scalars)) filled = filled.split(key).join(String(value ?? '—'));
    out.push(filled);
  }
  return out.join('\n');
}
