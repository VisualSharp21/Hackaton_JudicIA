/**
 * Rotas HTTP do Copilot Nível 1 (chamadas por src/api.js depois da autenticação):
 *
 *   GET  /api/copilot/machines              30 estações + estação detectada pela rede + motor ativo
 *   POST /api/copilot/chat                  mensagem (ou laudo do Meet) ➔ Laya + RAG + LLM/regras
 *   POST /api/copilot/escalate              chamado enriquecido no GLPI (ou conector mock)
 *   POST /api/copilot/resolve               "Consegui resolver!" ➔ autoatendimento no banco
 *   POST /api/copilot/feedback              nota de satisfação (1–5)
 *   GET  /api/copilot/sessions/:id          retoma a conversa (refresh da página)
 *   GET  /api/copilot/sessions/:id/log      registro .md no formato do template-sessao.md
 *   GET  /api/copilot/tools                 Tool Registry (ativas e planejadas)
 *   GET|PUT /api/copilot/settings, POST /api/copilot/settings/test   (perfil TIC)
 */
import { getTriageConfiguration, getTenantTicketingConfiguration } from '../repository.js';
import { ticketingAdapter } from '../ticketing/index.js';
import { COPILOT_LIMITS, runCopilotTurn } from './agent.js';
import { datasetSummary, detectStation, findMachineByHostname, getMachine, listMachines } from './data-loader.js';
import { escalateCopilotSession } from './escalation.js';
import { describeEngine, LlmError } from './llm-client.js';
import { sanitizeMeetReport } from './meet-report.js';
import {
  createCopilotSession,
  getCopilotSession,
  renderSessionLog,
  resolveCopilotSession,
  saveCopilotFeedback,
  saveCopilotSession,
  SESSION_STATUS,
  upsertCopilotRequest,
} from './sessions.js';
import { copilotSettingsView, effectiveLlmConfig, saveCopilotSettings, testCopilotLlm } from './settings.js';
import { listTools } from './tools.js';

const inFlight = new Set();
const DETECTIONS = new Set(['seletor', 'ip', 'hostname', 'prediagnostico']);

export function clientIp(req) {
  if (process.env.COPILOT_TRUST_PROXY === 'true') {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress || '';
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

/** Sessão no formato da interface (sem o histórico interno enviado à LLM). */
function sessionView(session) {
  const state = session.state || {};
  return {
    id: session.id,
    status: session.status,
    machineId: session.machineId,
    machineDetection: session.machineDetection,
    requestId: session.requestId,
    ticketId: session.ticketId,
    createdAt: session.createdAt,
    escalation: state.escalation ? { ...state.escalation, body: undefined } : null,
    resolution: state.resolution || null,
    meet: state.tools?.meet || null,
    messages: (state.messages || []).map((m) => (m.role === 'assistant' ? { role: m.role, at: m.at, turn: m.turn } : { role: m.role, at: m.at, text: m.text, laudo: m.laudo || false, system: m.system || false })),
  };
}

function ownedSession(id, user, { active = false } = {}) {
  const session = getCopilotSession(id, user);
  if (!session) throw httpError(404, 'Atendimento não encontrado.');
  if (active && session.status !== SESSION_STATUS.active)
    throw httpError(409, session.status === SESSION_STATUS.escalated ? 'Este atendimento já virou chamado. Inicie um novo atendimento para outro problema.' : 'Este atendimento foi encerrado. Inicie um novo atendimento.');
  return session;
}

async function resolveDetection(req, machineId, requested) {
  if (!DETECTIONS.has(requested)) return 'seletor';
  if (requested === 'ip' || requested === 'hostname') {
    const detected = await detectStation(clientIp(req));
    return detected?.machineId === machineId ? detected.metodo : 'seletor';
  }
  return requested;
}

async function handleChat(req, body, user) {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length > COPILOT_LIMITS.maxMessageChars) throw httpError(400, `A mensagem deve ter até ${COPILOT_LIMITS.maxMessageChars} caracteres.`);
  let meetReport = null;
  if (body.meetReport !== undefined && body.meetReport !== null) {
    try {
      meetReport = sanitizeMeetReport(body.meetReport);
    } catch (error) {
      throw httpError(400, error.message);
    }
  }
  if (!message && !meetReport) throw httpError(400, 'Escreva sua mensagem.');

  let session;
  if (body.sessionId) {
    session = ownedSession(body.sessionId, user, { active: true });
  } else {
    const machine = getMachine(body.machineId);
    if (!machine) throw httpError(400, 'Selecione a estação de trabalho antes de iniciar o atendimento.');
    session = createCopilotSession({ userId: user.id, machineId: machine.id, detection: await resolveDetection(req, machine.id, body.detection) });
  }
  if (body.machineId && body.machineId !== session.machineId) {
    const machine = getMachine(body.machineId);
    if (!machine) throw httpError(400, 'Estação inválida.');
    session.machineId = machine.id;
    session.machineDetection = 'seletor';
    session.state.messages.push({ role: 'user', system: true, intent: 'sistema', text: `[Estação alterada para ${machine.chip}]`, at: new Date().toISOString() });
    session.state.llmHistory = [...(session.state.llmHistory || []), { role: 'user', content: `[O solicitante trocou a estação para ${machine.chip}]` }];
    session.state.attemptedProcedures = [];
  }
  if ((session.state.messages || []).length >= COPILOT_LIMITS.maxMessages)
    throw httpError(409, 'Este atendimento atingiu o limite de mensagens. Abra o chamado ou inicie um novo atendimento.');
  if (inFlight.has(session.id)) throw httpError(429, 'Aguarde a resposta da mensagem anterior.');
  inFlight.add(session.id);
  try {
    const machine = getMachine(session.machineId);
    const ticketingConfig = getTenantTicketingConfiguration();
    const { turn, state, request } = await runCopilotTurn({
      state: session.state,
      machine,
      message,
      meetReport,
      triageConfig: getTriageConfiguration(),
      queueCategoryIds: ticketingConfig.queueCategoryIds || {},
      llmConfig: effectiveLlmConfig(),
    });
    session.state = state;
    upsertCopilotRequest(session, request, { userId: user.id, machine });
    session.engine = turn.engine.mode === 'llm' ? `llm:${turn.engine.provider}:${turn.engine.model}` : turn.engine.fallback ? 'regras:fallback' : 'regras';
    saveCopilotSession(session);
    return { session: sessionView(session), turn };
  } catch (error) {
    if (error instanceof LlmError) throw httpError(503, `O Copilot está indisponível: ${error.message}`);
    throw error;
  } finally {
    inFlight.delete(session.id);
  }
}

/**
 * Trata uma rota do Copilot. Devolve true se tratou. `send(status, obj)` e `readBody()` vêm
 * de api.js (mesmo JSON, cabeçalhos e limites do resto da API).
 */
export async function handleCopilotRoute({ req, res, url, user, send, readBody }) {
  const { pathname } = url;
  if (!pathname.startsWith('/api/copilot/')) return false;
  try {
    if (pathname === '/api/copilot/machines' && req.method === 'GET') {
      const detectedByNetwork = await detectStation(clientIp(req));
      const byHostname = url.searchParams.get('hostname') ? findMachineByHostname(url.searchParams.get('hostname')) : null;
      const detected = byHostname ? { machineId: byHostname.id, metodo: 'prediagnostico', valor: url.searchParams.get('hostname') } : detectedByNetwork;
      return send(200, { machines: listMachines(), detected, engine: describeEngine(effectiveLlmConfig()), dataset: datasetSummary() });
    }
    if (pathname === '/api/copilot/chat' && req.method === 'POST') return send(200, await handleChat(req, await readBody(64000), user));
    const sessionMatch = pathname.match(/^\/api\/copilot\/sessions\/(COP-[0-9A-F]{8})(\/log)?$/);
    if (sessionMatch && req.method === 'GET') {
      const session = ownedSession(sessionMatch[1], user);
      if (sessionMatch[2]) {
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="${session.id}.md"` });
        res.end(renderSessionLog(session, getMachine(session.machineId)));
        return true;
      }
      return send(200, { session: sessionView(session) });
    }
    if (pathname === '/api/copilot/escalate' && req.method === 'POST') {
      const body = await readBody(4000);
      const session = ownedSession(body.sessionId, user);
      if (session.status === SESSION_STATUS.resolved) throw httpError(409, 'Este atendimento foi encerrado como resolvido. Inicie um novo atendimento.');
      const ticketingConfig = getTenantTicketingConfiguration();
      const result = await escalateCopilotSession({
        session,
        machine: getMachine(session.machineId),
        user,
        triageConfig: getTriageConfiguration(),
        ticketing: ticketingAdapter,
        queueCategoryIds: ticketingConfig.queueCategoryIds || {},
      });
      return send(result.alreadyEscalated ? 200 : 201, { ...result, session: sessionView(getCopilotSession(session.id)) });
    }
    if (pathname === '/api/copilot/resolve' && req.method === 'POST') {
      const body = await readBody(4000);
      const session = ownedSession(body.sessionId, user);
      if (session.status === SESSION_STATUS.escalated) throw httpError(409, 'Este atendimento já virou chamado no GLPI.');
      return send(200, { session: sessionView(resolveCopilotSession(session)) });
    }
    if (pathname === '/api/copilot/feedback' && req.method === 'POST') {
      const body = await readBody(4000);
      const session = ownedSession(body.sessionId, user);
      return send(201, saveCopilotFeedback(session, Number(body.rating), body.comment));
    }
    if (pathname === '/api/copilot/tools' && req.method === 'GET') return send(200, { tools: listTools() });
    if (pathname === '/api/copilot/settings' && req.method === 'GET') return send(200, copilotSettingsView());
    if (pathname === '/api/copilot/settings' && req.method === 'PUT') {
      try {
        return send(200, saveCopilotSettings(await readBody(8000)));
      } catch (error) {
        throw httpError(400, error.message);
      }
    }
    if (pathname === '/api/copilot/settings/test' && req.method === 'POST') return send(200, await testCopilotLlm());
    return send(404, { error: 'Rota do Copilot não encontrada.' });
  } catch (error) {
    if (error.status) return send(error.status, { error: error.message });
    throw error;
  }
}
