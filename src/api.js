import { randomUUID } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import { frontendOrigins as FRONTEND_ORIGINS } from './config.js';
import { query, queryJson, sqlValue } from './database.js';
import { setTenantContext } from './tenant-context.js';
import {
  createSession,
  csrfCookie,
  csrfTokenForRequest,
  expiredSessionCookie,
  getSession,
  revokeSession,
  sessionCookie,
  verifyCsrfToken,
  verifyUserCredentials,
  createUser,
  listUsers,
  updateManagedUserRole,
} from './auth.js';
import { classifyWithProvider } from './decision-provider.js';
import { evaluateSavedFeedbackCases } from './quality-evaluation.js';
import { ticketingAdapter } from './ticketing/index.js';
import {
  listTickets,
  listIncidents,
  bootstrap,
  dashboard,
  qualitySummary,
  evaluationCases,
  getFeedbackEvaluationReport,
  getTriageConfiguration,
  normalizeTriageRouting,
  normalizeTriageRoutingRules,
  normalizeTriageCalibrationRules,
  normalizeTriagePriorityMatrix,
  normalizeTriageThresholdSettings,
  saveTriageConfiguration,
  normalizeTriageQuestionSettings,
  normalizeTriagePayloadTemplate,
  normalizeSystemOptionMappings,
  normalizeCategoryOptionMappings,
  triageBenchmarkCases,
  getPilotConfiguration,
  savePilotConfiguration,
  pilotMetrics,
  saveRequestFeedback,
  redactEvaluationText,
  requestOwnedBy,
  ticketOwnedBy,
  listServiceLocalities,
  createServiceLocality,
  setServiceLocalityActive,
  serviceLocalityIsActive,
  getTenantTicketingSettings,
  saveTenantTicketingSettings,
} from './repository.js';
import {
  applyAutomationGate,
  calibrateDecision,
  statusForDescription,
  calculatePriority,
  routeQueue,
  validateHumanDecision,
} from './triage.js';
import { handleCopilotRoute } from './copilot/routes.js';

let feedbackEvaluationInProgress = false;
const loginAttempts = new Map();
const loginAttemptWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 8;

// Pré-diagnóstico: tokens de uso único que ligam a execução do script local
// (via protocolo pulsodiag://) à sessão autenticada que o solicitou.
const prediagTokens = new Map();
const prediagTokenTtlMs = 10 * 60 * 1000;
function prunePrediagTokens() {
  const now = Date.now();
  for (const [token, value] of prediagTokens)
    if (now - value.createdAt >= prediagTokenTtlMs) prediagTokens.delete(token);
}

function send(res, status, obj) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}
async function bodyJson(req, maxBytes = 12000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > maxBytes) throw new Error('Corpo da solicitação excede o limite.');
  }
  return raw ? JSON.parse(raw) : {};
}
function triageSettingsAuthorized(req) {
  const required = process.env.TRIAGE_SETTINGS_KEY || '';
  if (!required) return true;
  const authorization = String(req.headers.authorization || '');
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const expectedBuffer = Buffer.from(required);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function originAllowed(origin) {
  return Boolean(origin) && FRONTEND_ORIGINS.includes(origin);
}

function consumeLoginAttempt(req, email) {
  const now = Date.now();
  const key = `${req.socket.remoteAddress || 'unknown'}:${String(email || '').trim().toLowerCase()}:${String(req.headers['x-tenant-slug'] || '').trim().toLowerCase()}`;
  let state = loginAttempts.get(key);
  if (!state || now - state.startedAt >= loginAttemptWindowMs) {
    state = { startedAt: now, attempts: 0 };
    loginAttempts.set(key, state);
  }
  if (state.attempts >= maxLoginAttempts) return false;
  state.attempts++;
  if (loginAttempts.size > 5000)
    for (const [attemptKey, value] of loginAttempts)
      if (now - value.startedAt >= loginAttemptWindowMs) loginAttempts.delete(attemptKey);
  return true;
}

function clearLoginAttempts(req, email) {
  const key = `${req.socket.remoteAddress || 'unknown'}:${String(email || '').trim().toLowerCase()}`;
  loginAttempts.delete(key);
}

function roleCanAccess(user, pathname, method) {
  const role = user.role;
  if (role === 'tic') return true;
  if (method === 'GET' && pathname === '/api/bootstrap') return true;

  if (role === 'solicitante') {
    // Copilot Nível 1: chat, sessões próprias, autoatendimento e escalação.
    if (method === 'GET' && (pathname === '/api/copilot/machines' || /^\/api\/copilot\/sessions\/COP-[0-9A-F]{8}(?:\/log)?$/.test(pathname))) return true;
    if (method === 'POST' && ['/api/copilot/chat', '/api/copilot/escalate', '/api/copilot/resolve', '/api/copilot/feedback'].includes(pathname)) return true;
    if (method === 'GET' && pathname === '/api/knowledge/search') return true;
    if (method === 'POST' && ['/api/requests/analyze', '/api/tickets'].includes(pathname)) return true;
    if (method === 'GET' && pathname === '/api/tickets') return true;
    if (method === 'GET' && /^\/api\/tickets\/[^/]+(?:\/status)?$/.test(pathname)) return true;
    if (method === 'POST' && /^\/api\/requests\/[^/]+\/correction$/.test(pathname)) return true;
    if (method === 'POST' && /^\/api\/requests\/[^/]+\/(?:feedback|resolve)$/.test(pathname)) return true;
    return false;
  }

  if (role === 'gestor') {
    if (method === 'GET' && pathname === '/api/admin/users') return true;
    if (method === 'GET' && pathname === '/api/admin/localities') return true;
    if (method === 'POST' && pathname === '/api/admin/users') return true;
    if (method === 'POST' && pathname === '/api/admin/localities') return true;
    if (method === 'PUT' && /^\/api\/admin\/users\/[0-9a-f-]+\/role$/i.test(pathname)) return true;
    if (method === 'PUT' && /^\/api\/admin\/localities\/\d+\/status$/.test(pathname)) return true;
    if (method === 'GET' && ['/api/dashboard', '/api/tickets', '/api/incidents', '/api/pilot/settings', '/api/pilot/metrics'].includes(pathname)) return true;
    if (method === 'GET' && /^\/api\/tickets\/[^/]+(?:\/status)?$/.test(pathname)) return true;
    if (method === 'GET' && /^\/api\/incidents\/[^/]+$/.test(pathname)) return true;
  }
  return false;
}

function requireCsrf(req, session) {
  return verifyCsrfToken(session, String(req.headers['x-csrf-token'] || ''));
}
export async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    const origin = req.headers.origin;
    if (origin && !originAllowed(origin))
      return send(res, 403, { error: 'Origem não autorizada.' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-Pulso-Slot');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname === '/api/health' && req.method === 'GET') {
      let healthSession = null;
      try { healthSession = getSession(req); } catch {}
      if (healthSession) setTenantContext(healthSession.user.tenantId);
      let database = 'ok';
      try {
        query('SELECT 1');
      } catch {
        database = 'unavailable';
      }
      const base = process.env.JEVMODEL_BASE_URL || '';
      const configured = Boolean(process.env.JEVMODEL_API_KEY || base);
      const provider = !configured
        ? 'local_rules'
        : base.includes('127.0.0.1:8000') || base.includes('localhost:8000')
          ? 'laya'
          : base.includes('openrouter.ai')
            ? 'openrouter'
            : 'typesafe';
      return send(res, 200, {
        status: database === 'ok' ? 'ok' : 'degraded',
        database,
        decisionProvider: provider,
        jevConfigured: configured,
        automationApproved: getTriageConfiguration().automationApproved,
        ticketing: ticketingAdapter.info,
      });
    }
    // Copilot: eco mínimo, sem sessão nem banco, para o teste de audiência medir a latência
    // real entre a estação e o servidor central. Não devolve dado nenhum.
    if (url.pathname === '/api/copilot/ping' && req.method === 'GET')
      return send(res, 200, { ok: true, t: Date.now() });
    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      if (!originAllowed(origin))
        return send(res, 403, { error: 'Origem do login não autorizada.' });
      const body = await bodyJson(req);
      const email = typeof body.email === 'string' ? body.email : '';
      const tenantSlug = typeof body.tenantSlug === 'string' ? body.tenantSlug : '';
      req.headers['x-tenant-slug'] = tenantSlug;
      if (!consumeLoginAttempt(req, email))
        return send(res, 429, { error: 'Muitas tentativas. Aguarde 15 minutos antes de tentar novamente.' });
      const user = await verifyUserCredentials(email, body.password, tenantSlug);
      if (!user) return send(res, 401, { error: 'E-mail ou senha inválidos.' });
      clearLoginAttempts(req, email);
      const newSession = await createSession(user.id, user.tenantId);
      res.setHeader('Set-Cookie', [
        sessionCookie(newSession.sessionToken, req),
        csrfCookie(newSession.csrfToken, req),
      ]);
      return send(res, 200, { user, csrfToken: newSession.csrfToken });
    }
    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      const currentSession = getSession(req);
      return currentSession
        ? send(res, 200, { user: currentSession.user })
        : send(res, 401, { error: 'Sessão ausente ou expirada.' });
    }
    if (url.pathname === '/api/auth/csrf' && req.method === 'GET') {
      const currentSession = getSession(req);
      if (!currentSession) return send(res, 401, { error: 'Sessão ausente ou expirada.' });
      const csrfToken = csrfTokenForRequest(req, currentSession);
      res.setHeader('Set-Cookie', csrfCookie(csrfToken, req));
      return send(res, 200, { csrfToken });
    }
    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      if (!originAllowed(origin))
        return send(res, 403, { error: 'Origem do logout não autorizada.' });
      const currentSession = getSession(req);
      if (currentSession && !requireCsrf(req, currentSession))
        return send(res, 403, { error: 'Token de segurança inválido. Atualize a página e tente novamente.' });
      if (currentSession) revokeSession(currentSession);
      res.setHeader('Set-Cookie', expiredSessionCookie(req));
      return send(res, 200, { ok: true });
    }

    // Pré-diagnóstico: emite um token de uso único para a sessão atual.
    if (url.pathname === '/api/prediag/token' && req.method === 'POST') {
      if (!originAllowed(origin))
        return send(res, 403, { error: 'Origem não autorizada.' });
      const tokenSession = getSession(req);
      if (!tokenSession) return send(res, 401, { error: 'Faça login para continuar.' });
      prunePrediagTokens();
      const token = randomUUID();
      prediagTokens.set(token, {
        tenantId: tokenSession.user.tenantId,
        userId: tokenSession.user.id,
        createdAt: Date.now(),
        result: null,
      });
      return send(res, 200, { token, expiresInMs: prediagTokenTtlMs });
    }

    // Pré-diagnóstico: a página consulta o resultado enviado pelo script local.
    if (url.pathname === '/api/prediag/result' && req.method === 'GET') {
      if (!originAllowed(origin))
        return send(res, 403, { error: 'Origem não autorizada.' });
      const resultSession = getSession(req);
      if (!resultSession) return send(res, 401, { error: 'Faça login para continuar.' });
      prunePrediagTokens();
      const token = url.searchParams.get('token') || '';
      const entry = prediagTokens.get(token);
      if (
        !entry ||
        entry.userId !== resultSession.user.id ||
        entry.tenantId !== resultSession.user.tenantId
      )
        return send(res, 404, { error: 'Token não encontrado ou expirado.' });
      return send(res, 200, { status: entry.result ? 'ready' : 'pending', data: entry.result });
    }

    // Pré-diagnóstico: o script local (protocolo pulsodiag://) envia o JSON.
    // Autenticado apenas pelo token de uso único — sem sessão/CORS de navegador.
    if (url.pathname === '/api/prediag/ingest' && req.method === 'POST') {
      const body = await bodyJson(req, 300000);
      const token = typeof body.token === 'string' ? body.token : '';
      const payload = body.payload;
      prunePrediagTokens();
      const entry = prediagTokens.get(token);
      if (!entry) return send(res, 404, { error: 'Token não encontrado ou expirado.' });
      if (!payload || payload.schema !== 'pulso-prediag-1')
        return send(res, 400, { error: 'Dados de pré-diagnóstico inválidos.' });
      entry.result = payload;
      entry.receivedAt = Date.now();
      return send(res, 200, { ok: true });
    }

    const currentSession = getSession(req);
    if (!currentSession) return send(res, 401, { error: 'Faça login para continuar.' });
    const user = currentSession.user;
    setTenantContext(user.tenantId);
    if (!roleCanAccess(user, url.pathname, req.method))
      return send(res, 403, { error: 'Seu perfil não tem acesso a este módulo.' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      if (!originAllowed(origin) || !requireCsrf(req, currentSession))
        return send(res, 403, { error: 'Requisição bloqueada pela proteção contra CSRF.' });
    }
    if (url.pathname.startsWith('/api/copilot/'))
      return handleCopilotRoute({
        req,
        res,
        url,
        user,
        send: (status, obj) => send(res, status, obj),
        readBody: async (maxBytes) => {
          try {
            const parsed = await bodyJson(req, maxBytes);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
          } catch (error) {
            throw Object.assign(new Error(error instanceof SyntaxError ? 'JSON inválido.' : error.message), { status: 400 });
          }
        },
      });
    if (url.pathname === '/api/triage/settings' && req.method === 'GET')
      return send(res, 200, {
        ...getTriageConfiguration(),
      });
    if (url.pathname === '/api/triage/settings' && req.method === 'PUT') {
      try {
        return send(res, 200, saveTriageConfiguration(await bodyJson(req, 64000)));
      } catch (error) {
        return send(res, 400, { error: error.message || 'NÃ£o foi possÃ­vel salvar as instruÃ§Ãµes.' });
      }
    }
    if (url.pathname === '/api/triage/benchmark-cases' && req.method === 'GET')
      return send(res, 200, triageBenchmarkCases());
    if (url.pathname === '/api/triage/preview' && req.method === 'POST') {
      const body = await bodyJson(req, 64000);
      const description = String(body.description || '').trim();
      if (description.length < 8 || description.length > 1000)
        return send(res, 400, { error: 'O exemplo deve ter entre 8 e 1000 caracteres.' });
      try {
        const current = getTriageConfiguration();
        const questions = normalizeTriageQuestionSettings(body.questions || {});
        const thresholds = normalizeTriageThresholdSettings(body.thresholds || current.thresholds);
        const routing = normalizeTriageRouting(body.routing || current.routing);
        const configuredCategories = Object.keys(questions.category.criteria);
        const configuredSystems = Object.keys(questions.system.criteria);
        const routingRules = normalizeTriageRoutingRules(body.routingRules || current.routingRules, configuredCategories, configuredSystems);
        const calibrationRules = normalizeTriageCalibrationRules(body.calibrationRules || current.calibrationRules, configuredCategories, configuredSystems);
        const priorityMatrix = normalizeTriagePriorityMatrix(body.priorityMatrix || current.priorityMatrix);
        const payloadTemplate = normalizeTriagePayloadTemplate(body.payloadTemplate || current.payloadTemplate);
        const evaluated = await classifyWithProvider(description, questions, { thresholds, calibrationRules, payloadTemplate, systemOptionMappings: normalizeSystemOptionMappings(body.systemOptionMappings || current.systemOptionMappings, questions.system.criteria), categoryOptionMappings: normalizeCategoryOptionMappings(body.categoryOptionMappings || current.categoryOptionMappings, questions.category.criteria) });
        const decision = calibrateDecision(description, evaluated.decision, calibrationRules, configuredCategories, configuredSystems);
        const status = statusForDescription(description, decision, thresholds, calibrationRules);
        const triageStatus = applyAutomationGate(
          { triageStatus: status },
          body.automationApproved === true,
        ).triageStatus;
        const actual = {
          supportRequest: decision.isSupportRequest,
          category: decision.category,
          system: decision.system,
          impact: decision.impact,
          urgency: decision.urgency,
          possibleIncident: decision.possibleIncident,
          outage: decision.outage,
          status: triageStatus,
        };
        const expected = body.expected && typeof body.expected === 'object' ? body.expected : null;
        const comparison = expected
          ? Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, { expected: value, actual: actual[key], matches: actual[key] === value }]))
          : null;
        return send(res, 200, {
          provider: evaluated.provider,
          decision,
          modelChoices: evaluated.modelChoices || null,
          triageStatus,
          priority: calculatePriority(decision, priorityMatrix),
          queue: routeQueue(decision, routing, routingRules),
          comparison,
        });
      } catch (error) {
        return send(res, 400, { error: error.message || 'Falha ao gerar a prévia.' });
      }
    }
    if (url.pathname === '/api/pilot/settings' && req.method === 'GET')
      return send(res, 200, getPilotConfiguration());
    if (url.pathname === '/api/pilot/settings' && req.method === 'PUT') {
      if (!triageSettingsAuthorized(req))
        return send(res, 401, { error: 'Chave de configuração ausente ou inválida.' });
      try {
        return send(res, 200, savePilotConfiguration(await bodyJson(req)));
      } catch (error) {
        return send(res, 400, { error: error.message || 'Não foi possível salvar o plano do piloto.' });
      }
    }
    if (url.pathname === '/api/pilot/metrics' && req.method === 'GET')
      return send(res, 200, pilotMetrics());
    if (url.pathname === '/api/ticketing/health' && req.method === 'GET') {
      try {
        return send(res, 200, await ticketingAdapter.checkConnection());
      } catch (error) {
        return send(res, 503, {
          ...ticketingAdapter.info,
          status: 'unavailable',
          error: error.message || 'Não foi possível verificar o conector de chamados.',
        });
      }
    }
    if (url.pathname === '/api/ticketing/settings' && req.method === 'GET')
      return send(res, 200, getTenantTicketingSettings());
    if (url.pathname === '/api/ticketing/settings' && req.method === 'PUT') {
      try {
        return send(res, 200, saveTenantTicketingSettings(await bodyJson(req)));
      } catch (error) {
        return send(res, 400, { error: error.message || 'Não foi possível salvar as configurações.' });
      }
    }
    if (url.pathname === '/api/bootstrap' && req.method === 'GET')
      return send(res, 200, bootstrap(user));
    if (url.pathname === '/api/admin/users' && req.method === 'GET')
      return send(res, 200, listUsers());
    if (url.pathname === '/api/admin/localities' && req.method === 'GET')
      return send(res, 200, listServiceLocalities(true));
    if (url.pathname === '/api/admin/localities' && req.method === 'POST') {
      try {
        const { name } = await bodyJson(req);
        return send(res, 201, createServiceLocality(name));
      } catch (error) {
        const duplicate = /service_localities_(tenant_)?name_lower_uidx|service_localities_tenant_name_lower_uidx|duplicate key/i.test(error.message);
        return send(res, 400, { error: duplicate ? 'Esse município ou comarca já está cadastrado.' : error.message || 'Não foi possível cadastrar o município ou comarca.' });
      }
    }
    const localityStatusMatch = url.pathname.match(/^\/api\/admin\/localities\/(\d+)\/status$/);
    if (localityStatusMatch && req.method === 'PUT') {
      try {
        const { active } = await bodyJson(req);
        if (typeof active !== 'boolean') return send(res, 400, { error: 'Informe se o município ou comarca ficará ativo.' });
        return send(res, 200, setServiceLocalityActive(localityStatusMatch[1], active));
      } catch (error) {
        return send(res, 400, { error: error.message || 'Não foi possível atualizar o cadastro.' });
      }
    }
    if (url.pathname === '/api/admin/users' && req.method === 'POST') {
      try {
        const body = await bodyJson(req);
        const created = await createUser({
          email: body.email,
          displayName: body.displayName,
          role: body.role,
          password: body.password,
        });
        return send(res, 201, created);
      } catch (error) {
        return send(res, 400, { error: error.message || 'Não foi possível criar a conta.' });
      }
    }
    const managedRoleMatch = url.pathname.match(/^\/api\/admin\/users\/([0-9a-f-]+)\/role$/i);
    if (managedRoleMatch && req.method === 'PUT') {
      try {
        const body = await bodyJson(req);
        const updated = updateManagedUserRole(managedRoleMatch[1], body.role, user.id);
        return send(res, 200, updated);
      } catch (error) {
        return send(res, 400, { error: error.message || 'Não foi possível alterar o perfil.' });
      }
    }
    if (url.pathname === '/api/dashboard' && req.method === 'GET')
      return send(res, 200, dashboard());
    if (url.pathname === '/api/quality' && req.method === 'GET')
      return send(res, 200, qualitySummary());
    if (url.pathname === '/api/quality/feedback-evaluation' && req.method === 'GET')
      return send(res, 200, getFeedbackEvaluationReport());
    if (url.pathname === '/api/quality/feedback-evaluation' && req.method === 'POST') {
      if (!triageSettingsAuthorized(req))
        return send(res, 401, { error: 'Informe a chave de configuração para avaliar os casos.' });
      if (feedbackEvaluationInProgress)
        return send(res, 409, { error: 'Já existe uma avaliação de feedback em andamento.' });
      feedbackEvaluationInProgress = true;
      try {
        return send(res, 200, await evaluateSavedFeedbackCases());
      } catch (error) {
        return send(res, 400, { error: error.message || 'Não foi possível avaliar os casos aprovados.' });
      } finally {
        feedbackEvaluationInProgress = false;
      }
    }
    if (url.pathname === '/api/quality/evaluation-cases' && req.method === 'GET')
      return send(res, 200, evaluationCases());
    if (url.pathname === '/api/quality/evaluation-cases' && req.method === 'POST') {
      const body = await bodyJson(req),
        requestId = String(body.requestId || '').trim(),
        rawText = String(body.text || '').trim();
      if (body.confirmAnonymized !== true)
        return send(res, 400, {
          error:
            'Confirme que revisou e removeu nomes, números de processo e outros dados pessoais.',
        });
      const text = redactEvaluationText(rawText);
      if (text.length < 8 || text.length > 1000)
        return send(res, 400, {
          error: 'O exemplo anonimizado deve ter entre 8 e 1000 caracteres.',
        });
      const row = queryJson(
        `SELECT row_to_json(r) FROM requests r WHERE id=${sqlValue(requestId)} AND corrected_decision IS NOT NULL AND synthetic=false LIMIT 1`,
        null,
      );
      if (!row)
        return send(res, 404, {
          error: 'A solicitação precisa ter uma correção humana salva antes de virar exemplo.',
        });
      let expected;
      try {
        const correctedDecision =
          typeof row.corrected_decision === 'string'
            ? JSON.parse(row.corrected_decision)
            : row.corrected_decision;
        expected = validateHumanDecision(correctedDecision, Object.keys(getTriageConfiguration().questions.category.criteria), Object.keys(getTriageConfiguration().questions.system.criteria));
      } catch {
        return send(res, 409, {
          error: 'A correção humana salva está incompleta ou inválida.',
        });
      }
      const label = {
        supportRequest: true,
        category: expected.category,
        system: expected.system,
        impact: expected.impact,
        urgency: expected.urgency,
        possibleIncident: expected.possibleIncident,
        outage: expected.outage,
      };
      query(
        `INSERT INTO evaluation_cases(source_request_id,text,expected) VALUES(${sqlValue(requestId)},${sqlValue(text)},${sqlValue(JSON.stringify(label))}::jsonb) ON CONFLICT(source_request_id) DO UPDATE SET text=EXCLUDED.text,expected=EXCLUDED.expected,created_at=now()`,
      );
      return send(res, 201, { ok: true, expected: label, text });
    }
    if (url.pathname === '/api/tickets' && req.method === 'GET')
      return send(res, 200, listTickets(user.role === 'solicitante' ? user.id : null));
    if (url.pathname === '/api/tickets/sync' && req.method === 'POST') {
      if (typeof ticketingAdapter.syncStatuses !== 'function')
        return send(res, 200, { synchronized: 0, errors: [], message: 'A sincronização ao vivo está disponível no conector GLPI.' });
      return send(res, 200, await ticketingAdapter.syncStatuses());
    }
    if (url.pathname === '/api/incidents' && req.method === 'GET')
      return send(res, 200, listIncidents());
    if (url.pathname === '/api/knowledge/search' && req.method === 'GET')
      return send(
        res,
        200,
        await ticketingAdapter.searchKnowledge({
          category: url.searchParams.get('category') || 'OTHER',
          system: url.searchParams.get('system') || 'UNKNOWN',
          description: url.searchParams.get('description') || '',
        }),
      );
    if (url.pathname === '/api/requests/analyze' && req.method === 'POST') {
      const b = await bodyJson(req),
        description = String(b.description || '').trim(),
        locality = String(b.locality || '').trim();
      if (description.length < 8 || description.length > 1000)
        return send(res, 400, { error: 'A descrição deve ter entre 8 e 1000 caracteres.' });
      if (locality.length < 2 || locality.length > 120)
        return send(res, 400, { error: 'Informe a comarca ou município (2 a 120 caracteres).' });
      if (!serviceLocalityIsActive(locality))
        return send(res, 400, { error: 'Selecione uma comarca ou município ativo na lista.' });
      const triageConfig = getTriageConfiguration();
      const evaluated = await classifyWithProvider(description, triageConfig.questions, triageConfig),
        calibratedDecision = calibrateDecision(description, evaluated.decision, triageConfig.calibrationRules, Object.keys(triageConfig.questions.category.criteria), Object.keys(triageConfig.questions.system.criteria));
      const calibrated = {
        ...evaluated,
        decision: calibratedDecision,
        triageStatus: statusForDescription(description, calibratedDecision, triageConfig.thresholds, triageConfig.calibrationRules),
      };
      const result = applyAutomationGate(
        calibrated,
        triageConfig.automationApproved,
      );
      const { provider, triageStatus } = result;
      const decision = result.decision;
      const p = calculatePriority(decision, triageConfig.priorityMatrix),
        q = routeQueue(decision, triageConfig.routing, triageConfig.routingRules),
        id = `REQ-${randomUUID().slice(0, 8).toUpperCase()}`;
      const matches =
          triageStatus === 'OUT_OF_SCOPE'
            ? []
            : await ticketingAdapter.searchKnowledge({
                category: decision.category,
                system: decision.system,
                description,
              }),
        article = matches[0] || null;
      const articleId = article?.sourceProvider === 'glpi' ? null : article?.id || null;
      const articleSnapshot = article ? `${sqlValue(JSON.stringify(article))}::jsonb` : 'NULL';
      query(
        `INSERT INTO requests(id,description,decision,priority,queue,confidence,article_id,article_snapshot,provider,triage_status,locality,created_by) VALUES(${sqlValue(id)},${sqlValue(description)},${sqlValue(JSON.stringify(decision))}::jsonb,${sqlValue(p)},${sqlValue(q)},${Number(decision.confidence) || 0},${sqlValue(articleId)},${articleSnapshot},${sqlValue(provider)},${sqlValue(triageStatus)},${sqlValue(locality)},${sqlValue(user.id)}::uuid)`,
      );
      query(
        `INSERT INTO decisions(request_id,payload,provider) VALUES(${sqlValue(id)},${sqlValue(JSON.stringify(decision))}::jsonb,${sqlValue(provider)})`,
      );
      return send(res, 201, {
        id,
        description,
        locality,
        decision,
        priority: p,
        queue: q,
        article,
        provider,
        createdAt: new Date().toISOString(),
        triageStatus,
        review: triageStatus !== 'READY',
        automationGate: result.automationGate || null,
        modelConfidence: decision.confidence,
        modelChoices: evaluated.modelChoices || null,
      });
    }
    const correctionMatch = url.pathname.match(/^\/api\/requests\/([^/]+)\/correction$/);
    if (correctionMatch && req.method === 'POST') {
      const id = decodeURIComponent(correctionMatch[1]),
        body = await bodyJson(req);
      const row = queryJson(
        `SELECT row_to_json(r) FROM requests r WHERE id=${sqlValue(id)} LIMIT 1`,
        null,
      );
      if (!row) return send(res, 404, { error: 'Solicitação não encontrada.' });
      if (user.role === 'solicitante' && row.created_by !== user.id)
        return send(res, 404, { error: 'Request not found.' });
      const config = getTriageConfiguration();
      if (row.triage_status === 'OUT_OF_SCOPE' && body.confirmSupport !== true)
        return send(res, 409, { error: `Confirme que esta mensagem pertence ao servi\u00e7o ${config.supportProfile.serviceName}.` });
      const decision = validateHumanDecision(body.decision || body, Object.keys(config.questions.category.criteria), Object.keys(config.questions.system.criteria)),
        p = calculatePriority(decision, config.priorityMatrix),
        q = routeQueue(decision, config.routing, config.routingRules),
        matches = await ticketingAdapter.searchKnowledge({
          category: decision.category,
          system: decision.system,
          description: row.description,
        }),
        article = matches[0] || null;
      const articleId = article?.sourceProvider === 'glpi' ? null : article?.id || null;
      const articleSnapshot = article ? `${sqlValue(JSON.stringify(article))}::jsonb` : 'NULL';
      const reason =
        String(body.reason || '')
          .trim()
          .slice(0, 500) || null;
      query(
        `UPDATE requests SET corrected_decision=${sqlValue(JSON.stringify(decision))}::jsonb,corrected_at=now(),correction_reason=${sqlValue(reason)},triage_status='READY',status='REVIEWED',priority=${sqlValue(p)},queue=${sqlValue(q)},article_id=${sqlValue(articleId)},article_snapshot=${articleSnapshot} WHERE id=${sqlValue(id)}`,
      );
      const expectedLabels = {
        supportRequest: true,
        category: decision.category,
        system: decision.system,
        impact: decision.impact,
        urgency: decision.urgency,
        possibleIncident: decision.possibleIncident,
        outage: decision.outage,
      };
      query(
        `UPDATE evaluation_cases SET expected=${sqlValue(JSON.stringify(expectedLabels))}::jsonb WHERE source_request_id=${sqlValue(id)}`,
      );
      query(
        `INSERT INTO decisions(request_id,payload,provider) VALUES(${sqlValue(id)},${sqlValue(JSON.stringify(decision))}::jsonb,'human_correction')`,
      );
      query(
        `INSERT INTO service_events(type,request_id,knowledge_article_id) VALUES('HUMAN_CORRECTION',${sqlValue(id)},${sqlValue(article?.id || null)})`,
      );
      return send(res, 201, {
        id,
        description: row.description,
        decision: { ...decision, confidence: Number(row.confidence) },
        priority: p,
        queue: q,
        article,
        provider: 'human_correction',
        triageStatus: 'READY',
        review: false,
        corrected: true,
        modelConfidence: Number(row.confidence),
      });
    }
    const feedbackMatch = url.pathname.match(/^\/api\/requests\/([^/]+)\/feedback$/);
    if (feedbackMatch && req.method === 'POST') {
      const body = await bodyJson(req);
      const requestId = decodeURIComponent(feedbackMatch[1]);
      if (user.role === 'solicitante' && !requestOwnedBy(requestId, user.id))
        return send(res, 404, { error: 'Solicitação não encontrada.' });
      try {
        return send(res, 201, saveRequestFeedback(
          requestId,
          Number(body.rating),
          body.comment,
        ));
      } catch (error) {
        return send(res, 400, { error: error.message || 'Não foi possível registrar sua avaliação.' });
      }
    }
    const resolveMatch = url.pathname.match(/^\/api\/requests\/([^/]+)\/resolve$/);
    if (resolveMatch && req.method === 'POST') {
      const id = decodeURIComponent(resolveMatch[1]),
        row = queryJson(
          `SELECT row_to_json(r) FROM requests r WHERE id=${sqlValue(id)} LIMIT 1`,
          null,
        );
      if (!row) return send(res, 404, { error: 'Solicitação não encontrada.' });
      if (user.role === 'solicitante' && row.created_by !== user.id)
        return send(res, 404, { error: 'Solicitação não encontrada.' });
      if (row.triage_status !== 'READY')
        return send(res, 409, {
          error: 'Revise a classificação antes de concluir o autoatendimento.',
        });
      query(`UPDATE requests SET status='SELF_SERVICE_RESOLVED' WHERE id=${sqlValue(id)}`);
      query(
        `INSERT INTO service_events(type,request_id,knowledge_article_id) VALUES('SELF_SERVICE_RESOLVED',${sqlValue(id)},${sqlValue(row.article_id)})`,
      );
      return send(res, 201, { ok: true });
    }
    if (url.pathname === '/api/tickets' && req.method === 'POST') {
      const b = await bodyJson(req),
        r = queryJson(
          `SELECT row_to_json(r) FROM requests r WHERE id=${sqlValue(b.requestId)} LIMIT 1`,
          null,
        );
      if (!r) return send(res, 404, { error: 'Solicitação não encontrada.' });
      if (user.role === 'solicitante' && r.created_by !== user.id)
        return send(res, 404, { error: 'Solicitação não encontrada.' });
      if (r.triage_status !== 'READY')
        return send(res, 409, { error: 'Revise a classificação antes de abrir o chamado.' });
      if (r.status === 'TICKET_CREATED')
        return send(res, 409, { error: 'Já existe um chamado para esta solicitação.' });
      const d =
          typeof r.corrected_decision === 'string'
            ? JSON.parse(r.corrected_decision)
            : r.corrected_decision || r.decision,
        config = getTriageConfiguration(),
        p = calculatePriority(d, config.priorityMatrix),
        q = routeQueue(d, config.routing, config.routingRules);
      const ticket = await ticketingAdapter.createTicket({
        request: r,
        decision: d,
        priority: p,
        queue: q,
      });
      return send(res, 201, ticket);
    }
    const ticketStatusMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)\/status$/);
    if (ticketStatusMatch && req.method === 'GET') {
      const ticketId = decodeURIComponent(ticketStatusMatch[1]);
      if (user.role === 'solicitante' && !ticketOwnedBy(ticketId, user.id))
        return send(res, 404, { error: 'Chamado não encontrado.' });
      const status = await ticketingAdapter.getTicketStatus(
        ticketId,
      );
      return status
        ? send(res, 200, status)
        : send(res, 404, { error: 'Chamado nÃ£o encontrado.' });
    }
    const ticketMatch = url.pathname.match(/^\/api\/tickets\/([^/]+)$/);
    if (ticketMatch && req.method === 'GET') {
      const id = decodeURIComponent(ticketMatch[1]);
      if (user.role === 'solicitante' && !ticketOwnedBy(id, user.id))
        return send(res, 404, { error: 'Chamado não encontrado.' });
      const t = await ticketingAdapter.getTicket(id);
      return t ? send(res, 200, t) : send(res, 404, { error: 'Chamado não encontrado.' });
    }
    const incidentMatch = url.pathname.match(/^\/api\/incidents\/([^/]+)$/);
    if (incidentMatch && req.method === 'GET') {
      const id = decodeURIComponent(incidentMatch[1]),
        i = listIncidents().find((x) => x.id === id || x.code === id);
      if (!i) return send(res, 404, { error: 'Incidente não encontrado.' });
      i.tickets = listTickets().filter((t) => i.ticketIds.includes(t.id));
      return send(res, 200, i);
    }
    return send(res, 404, { error: 'API endpoint not found.' });
  } catch (error) {
    console.error(`[${req.method} ${url.pathname}]`, error);
    return send(res, 500, { error: error.message || 'Erro interno.' });
  }
}
