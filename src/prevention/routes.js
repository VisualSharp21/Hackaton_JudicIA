import { invalid, MINUTE } from './agenda.js';
import { publicStation, registerStation, tokenMatches, ingestAgentReport, check, readiness } from './diagnostics.js';
import { hearingGuidance } from '../copilot/hearing-assist.js';
import { saveSupportRecord, supportOverview } from './support-registry.js';

export const mayReadHearing = (user, h) => ['tic', 'gestor'].includes(user.role) || h.responsible === user.id || h.createdBy === user.id;
export const mayManage = (user) => ['tic', 'gestor'].includes(user.role);
const visibleEscalation = (e, user) => {
  if (mayManage(user)) return e;
  const { collectiveEvidence, collectiveHearingRefs, ...own } = e; return own;
};
export async function hearingSnapshot(store, user, clock = () => Date.now()) {
  const hearings = (await store.list('hearing')).filter((h) => mayReadHearing(user, h)).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const ids = new Set(hearings.map((h) => h.id));
  const escalations = (await store.list('escalation')).filter((e) => ids.has(e.hearingId)).map((e) => visibleEscalation(e, user));
  const stations = (await store.list('station')).filter((s) => mayManage(user) || hearings.some((h) => h.stationId === s.id)).map(publicStation);
  const incidents = (await store.list('collective-incident')).filter((i) => i.hearingIds.some((id) => ids.has(id)));
  const allEscalations = await store.list('escalation');
  const visibleIncidents = incidents.map((i) => {
    const e = allEscalations.find((e) => e.id === i.primaryEscalationId);
    const support = e ? { status:e.status, ticketId:e.ticket?.id || null } : null;
    return mayManage(user) ? { ...i, support } : { id: i.id, mode: i.mode, locality: i.locality, status: i.status, title: i.title, openedAt: i.openedAt, hearingIds: i.hearingIds.filter((id) => ids.has(id)), support };
  });
  const notices = (await store.list('notice')).filter((n) => incidents.some((i) => i.id === n.incidentId)).sort((a,b) => Date.parse(b.at)-Date.parse(a.at)).slice(0, 20);
  return { hearings, escalations, stations, incidents: visibleIncidents, notices, serverTime: new Date(clock()).toISOString() };
}

export async function handlePreventionRoute({ req, res, url, user, services, bodyJson, send, sessionValid = () => true, demoOnly = false }) {
  const path = url.pathname;
  if (!path.startsWith('/api/hearings') && !path.startsWith('/api/prevention/') && !path.startsWith('/api/operational-knowledge')) return false;
  const { store, agenda, knowledge, operations, clock } = services;
  const method = req.method;
  const sendResult = (status, result) => { send(res, status, result); return true; };
  const requireManage = () => { if (!mayManage(user)) throw invalid('Perfil sem permissão para alterar a agenda.', 403); };
  const requireTic = () => { if (user.role !== 'tic') throw invalid('Esta operação exige perfil TIC.', 403); };
  if (path === '/api/prevention/support-registry' && method === 'GET') { requireManage(); return sendResult(200, await supportOverview(store, clock)); }
  if (path === '/api/prevention/support-registry' && method === 'POST') { requireTic(); const body = await bodyJson(req); return sendResult(201, await saveSupportRecord(store, body.kind, body, user.id, clock)); }
  if (path === '/api/prevention/demo/collective' && method === 'POST') {
    requireTic(); if (!demoOnly && process.env.DEMO_MODE !== 'true') throw invalid('Modo DEMO não está habilitado.', 409);
    return sendResult(201, await operations.prepareCollectiveDemo(agenda, user.id));
  }
  if (path === '/api/prevention/operations' && method === 'GET') { requireManage(); return sendResult(200, await hearingSnapshot(store, user, clock)); }
  if (path === '/api/prevention/executive-report' && method === 'GET') {
    requireManage(); const report = await operations.executive(url.searchParams.get('mode') || 'REAL', Number(url.searchParams.get('days') || 30));
    await store.transaction((tx) => tx.audit('', 'EXECUTIVE_REPORT_GENERATED', user.id, { mode: report.mode, days: report.days }, clock()));
    return sendResult(200, report);
  }
  const incidentAction = path.match(/^\/api\/prevention\/incidents\/([^/]+)\/(close|review)$/);
  if (incidentAction && method === 'POST') {
    requireTic(); const input = await bodyJson(req);
    return sendResult(200, await operations[incidentAction[2] === 'close' ? 'closeIncident' : 'reviewReport'](decodeURIComponent(incidentAction[1]), input, user.id));
  }
  const contingencyAction = path.match(/^\/api\/hearings\/([^/]+)\/contingency\/([a-z]+)$/);
  if (contingencyAction && method === 'POST') {
    requireTic(); const h = await store.get('hearing', decodeURIComponent(contingencyAction[1]));
    if (!h || !mayReadHearing(user, h)) throw invalid('Audiência não encontrada.', 404);
    return sendResult(200, await operations.updateStep(h, contingencyAction[2], await bodyJson(req), user.id));
  }
  const recheck = path.match(/^\/api\/hearings\/([^/]+)\/recheck$/);
  if (recheck && method === 'POST') {
    requireTic(); const input = await bodyJson(req);
    await store.transaction(async (tx) => {
      const h = await tx.get('hearing', decodeURIComponent(recheck[1]));
      if (!h || h.lifecycle !== 'ATIVA' || h.revision !== input.expectedRevision) throw invalid('Audiência alterada ou encerrada.', 409);
      const j = await tx.get('job', `${h.id}:${h.revision}`);
      if (j.status === 'RUNNING') throw invalid('Verificação já está em andamento.', 409);
      if (j.status !== 'PENDING') j.attempts = 0;
      j.status = 'PENDING'; j.nextAt = clock(); await tx.put('job', j);
      await tx.audit(h.id, 'RECHECK_REQUESTED', user.id, {}, clock());
    }); return sendResult(200, { queued: true });
  }
  if (path === '/api/hearings' && method === 'GET') return sendResult(200, await hearingSnapshot(store, user, clock));
  if (path === '/api/hearings/events' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    let sending = false;
    const push = async () => {
      if (sending || res.destroyed) return; sending = true;
      try {
        if (!await sessionValid()) { res.end(); return; }
        const snapshot = await hearingSnapshot(store, user, clock);
        if (!res.destroyed) res.write(`event: hearings\ndata: ${JSON.stringify(snapshot)}\n\n`);
      } catch { if (!res.destroyed) res.write('event: unavailable\ndata: {}\n\n'); }
      finally { sending = false; }
    };
    const timer = setInterval(() => void push(), 5000); timer.unref?.();
    const expiry = setTimeout(() => res.end(), 60000); expiry.unref?.();
    res.on('close', () => { clearInterval(timer); clearTimeout(expiry); }); await push(); return true;
  }
  if (path === '/api/prevention/stations' && method === 'POST') {
    requireTic(); const input = await bodyJson(req, 16000);
    if (demoOnly && input.mode !== 'DEMO') throw invalid('Servidor de demonstração aceita apenas DEMO.');
    return sendResult(201, await registerStation(store, input, user.id));
  }
  if (path === '/api/hearings' && method === 'POST') {
    requireManage(); const input = await bodyJson(req);
    if (demoOnly && input.mode !== 'DEMO') throw invalid('Servidor de demonstração aceita apenas DEMO.');
    return sendResult(201, await agenda.save(input, user.id));
  }
  if (path === '/api/hearings/import' && method === 'POST') {
    requireManage(); const input = await bodyJson(req, 200000);
    if (demoOnly && input.hearings?.some((h) => h.mode !== 'DEMO')) throw invalid('A importação deve ser DEMO.');
    return sendResult(200, { hearings: await agenda.import(input.hearings, user.id) });
  }
  const match = path.match(/^\/api\/hearings\/([^/]+)(?:\/(history|cancel|complete|browser-report|assist))?$/);
  if (match) {
    const id = decodeURIComponent(match[1]); const h = await store.get('hearing', id);
    if (!h || !mayReadHearing(user, h)) throw invalid('Audiência não encontrada.', 404);
    if (method === 'GET' && match[2] === 'history') {
      const jobs = (await store.list('job')).filter((j) => j.hearingId === h.id).map(({ agentNonce, agentNonceHash, lease, ...job }) => job);
      const precedents = await knowledge.search((h.lastChecks || []).map((c) => c.evidence).join(' '), { mode: h.mode, locality: h.locality, stationId: h.stationId });
      const incident = h.collectiveIncidentId ? await store.get('collective-incident', h.collectiveIncidentId) : null;
      if (incident) { const e = incident.primaryEscalationId ? await store.get('escalation', incident.primaryEscalationId) : null; incident.support = e ? { status:e.status,ticketId:e.ticket?.id || null } : null; }
      return sendResult(200, { hearing: h, jobs, precedents, contingency: await store.get('contingency', `${h.id}:${h.revision}`),
        localContacts: (await store.list('support-registry')).filter((r)=>r.kind==='local-contact' && r.mode===h.mode && r.locality===h.locality).map(({label,contact,skills})=>({label,contact,skills})),
        incident: incident && (mayManage(user) ? incident : { id: incident.id, mode: incident.mode, locality: incident.locality, status: incident.status, title: incident.title, hearingIds: [h.id], support:incident.support }),
        escalations: (await store.list('escalation')).filter((e) => e.hearingId === h.id || (incident?.primaryEscalationId === e.id && mayManage(user))).map((e) => visibleEscalation(e, user)), audit: await store.auditLog(h.id) });
    }
    if (method === 'PUT' && !match[2]) { requireManage(); return sendResult(200, await agenda.save(await bodyJson(req), user.id, id)); }
    if (method === 'POST' && ['cancel', 'complete'].includes(match[2])) { requireManage(); return sendResult(200, await agenda.end(id, match[2] === 'cancel' ? 'CANCELADA' : 'CONCLUÍDA', user.id)); }
    if (method === 'POST' && match[2] === 'assist') {
      const input = await bodyJson(req);
      const job = await store.get('job', `${h.id}:${h.revision}`);
      const context = { hearing: h, remainingMinutes: Math.ceil((Date.parse(h.startsAt) - clock()) / MINUTE), diagnostics: h.lastChecks || [], failures: (h.lastChecks || []).filter((c) => c.status === 'FAIL'), attemptedActions: job?.action ? [job.action] : [], previousChecks: job?.history || [] };
      const incident = h.collectiveIncidentId ? await store.get('collective-incident', h.collectiveIncidentId) : null;
      context.collectiveIncident = incident ? { id: incident.id, status: incident.status, title: incident.title, locality: incident.locality, resolution: incident.resolution } : null;
      context.contingency = await store.get('contingency', `${h.id}:${h.revision}`);
      context.localContacts = (await store.list('support-registry')).filter((r) => r.kind === 'local-contact' && r.locality === h.locality && r.mode === h.mode).map(({label,contact,skills})=>({label,contact,skills}));
      const message = `Contexto da audiência: ${JSON.stringify(context)}. ${String(input.message || 'Explique a falha e oriente a próxima verificação.').slice(0, 2000)}`;
      const conversationId = `${h.id}:${h.revision}:${user.id}`;
      const conversation = await store.get('hearing-conversation', conversationId);
      const precedents = await knowledge.search((h.lastChecks || []).map((c) => c.evidence).join(' '), { mode: h.mode, locality: h.locality, stationId: h.stationId });
      const guidance = await hearingGuidance({ message, hearing: h, context, history: conversation?.messages || [], demoOnly });
      const finding = context.failures.length ? context.failures.map((c) => c.evidence).join(' ') : 'Não há falha confirmada nos testes disponíveis; verificações pendentes continuam sem comprovação.';
      const precedent = precedents[0];
      guidance.reply = `${h.mode === 'DEMO' ? 'SIMULAÇÃO DEMO. ' : ''}${h.label}, ${h.room}, estação ${h.stationId}. Tempo até o início: ${context.remainingMinutes} minutos. ${finding}\n\n${precedent ? `Precedente encontrado (${precedent.source}, ${precedent.ticketId}): ${precedent.solution}\nResultado anterior: ${precedent.successEvidence}\n\n` : ''}${guidance.reply}`;
      if (incident?.status === 'OPEN') guidance.reply = `Problema coletivo conhecido: ${incident.title}, ${incident.locality}. Ocorrência ${incident.id}. Consulte o suporte vinculado antes de abrir outro chamado. A normalização ainda não foi confirmada.\n\n${guidance.reply}`;
      await store.transaction((tx) => tx.put('hearing-conversation', { id: conversationId, messages: [...(conversation?.messages || []), { role: 'user', content: message }, { role: 'assistant', content: guidance.reply }].slice(-12) }));
      await store.transaction((tx) => tx.audit(h.id, 'COPILOT_ASSISTED_GUIDANCE', user.id, { provider: guidance.provider, integrationError: guidance.integrationError }));
      return sendResult(200, { ...guidance, context, precedents, conversationId });
    }
    if (method === 'POST' && match[2] === 'browser-report') {
      const input = await bodyJson(req);
      if (h.mode !== 'REAL' || h.lifecycle !== 'ATIVA' || !['PASS', 'FAIL', 'UNVERIFIABLE'].includes(input.status)) throw invalid('Laudo inválido.');
      if (input.expectedRevision !== undefined && input.expectedRevision !== h.revision) throw invalid('A audiência foi reagendada. Recarregue antes de testar.', 409);
      if (input.component && !['camera_functional', 'microphone_functional'].includes(input.component)) throw invalid('Componente inválido.');
      const jobId = `${h.id}:${h.revision}`;
      await store.transaction(async (tx) => {
        const current = await tx.get('hearing', id);
        const job = await tx.get('job', jobId);
        if (current.revision !== h.revision || current.lifecycle !== 'ATIVA' || !job?.attempts) throw invalid('Nenhuma execução atual para receber este laudo.', 409);
        const s = await tx.get('station', h.stationId);
        s.browserReport = { jobId, status: input.status, speakerConfirmed: input.speakerConfirmed === true, receivedAt: clock(), source: 'USER_BROWSER_REPORT', actor: user.id,
          evidence: `Relato do navegador autenticado; estação declarada ${h.stationId}. ${String(input.evidence || '').slice(0, 1000)}` };
        if (input.component) {
          job.browserChecks = { ...job.browserChecks, [input.component]: s.browserReport };
          const items = Object.values(job.browserChecks);
          s.browserReport = { ...s.browserReport, status: items.some((c) => c.status === 'FAIL') ? 'FAIL' : items.length === 2 && items.every((c) => c.status === 'PASS') ? 'PASS' : 'UNVERIFIABLE' };
        }
        job.browserReport = s.browserReport;
        await tx.put('job', job);
        const name = input.component || 'capture';
        current.lastChecks = [...(current.lastChecks || []).filter((c) => c.name !== name), check(name, 'BROWSER', input.status, job.browserChecks?.[name]?.evidence || s.browserReport.evidence, 'REAL', clock())];
        current.state = readiness(current.lastChecks, Date.parse(current.startsAt) - clock());
        await tx.put('hearing', current);
        await tx.put('station', s); await tx.audit(h.id, 'BROWSER_REPORT', user.id, s.browserReport, clock());
        if (job.status === 'DONE') { job.status = 'PENDING'; job.nextAt = clock(); await tx.put('job', job); }
      });
      return sendResult(200, { accepted: true });
    }
  }
  if (path === '/api/operational-knowledge' && method === 'GET') {
    requireTic(); const records = await store.list('knowledge');
    return sendResult(200, { records: records.map(({ embedding, ...r }) => r) });
  }
  if (path === '/api/operational-knowledge/search' && method === 'GET') {
    if (!mayManage(user)) throw invalid('Acesso restrito à equipe.', 403);
    return sendResult(200, { records: await knowledge.search((url.searchParams.get('q') || '').slice(0, 2000)) });
  }
  if (path === '/api/operational-knowledge' && method === 'POST') { requireTic(); return sendResult(201, await knowledge.capture(await bodyJson(req, 20000), user.id)); }
  const recovery = path.match(/^\/api\/prevention\/escalations\/([^/]+)\/retry$/);
  if (recovery && method === 'POST') {
    requireTic();
    await store.transaction(async (tx) => {
      const e = await tx.get('escalation', decodeURIComponent(recovery[1]));
      if (!e || !['BLOCKED', 'REVIEW_REQUIRED', 'UNCERTAIN'].includes(e.status)) throw invalid('Escalação não disponível para recuperação.', 409);
      e.status = e.status === 'BLOCKED' ? 'PENDING' : 'UNCERTAIN'; e.nextAt = clock(); e.attempts = 0;
      await tx.put('escalation', e); await tx.audit(e.hearingId, 'ESCALATION_RECOVERY_REQUESTED', user.id, { id: e.id, status: e.status }, clock());
    });
    return sendResult(200, { queued: true });
  }
  const validation = path.match(/^\/api\/operational-knowledge\/([^/]+)\/validate$/);
  const reconcile = path.match(/^\/api\/operational-knowledge\/([^/]+)\/reconcile$/);
  if (reconcile && method === 'POST') { requireTic(); const body = await bodyJson(req); return sendResult(200, await knowledge.reconcile(decodeURIComponent(reconcile[1]), body.solutionId, user.id)); }
  if (validation && method === 'POST') { requireTic(); const body = await bodyJson(req); if (typeof body.approved !== 'boolean') throw invalid('Informe approved booleano.'); return sendResult(200, await knowledge.validate(decodeURIComponent(validation[1]), body.approved, user.id)); }
  return sendResult(404, { error: 'Operação não encontrada.' });
}

// Agent endpoints bypass browser sessions only after a station-scoped token check.
export async function handleAgentRoute({ req, res, url, store, bodyJson, send, clock = () => Date.now() }) {
  const stationId = url.searchParams.get('stationId');
  const station = await store.get('station', stationId || '');
  const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
  if (!station || station.mode !== 'REAL' || !tokenMatches(token, station.tokenHash)) throw invalid('Agente não autorizado.', 401);
  if (url.pathname === '/api/prevention/agent/tasks' && req.method === 'GET') {
    const hearings = (await store.list('hearing')).filter((h) => h.stationId === stationId && h.lifecycle === 'ATIVA');
    const jobs = (await store.list('job')).filter((j) => ['RUNNING', 'PENDING'].includes(j.status) && j.attempts > 0 && !j.reportNonceUsed && hearings.some((h) => h.id === j.hearingId && h.revision === j.revision));
    send(res, 200, { tasks: jobs.map((j) => ({ jobId: j.id, nonce: j.agentNonce,
      target: station.target?.host || null, action: j.action?.status === 'REQUESTED' && station.authorizedActions.includes(j.action.name) ? { ...j.action, deviceIds: j.action.deviceIds.filter((id) => station.authorizedDeviceIds.includes(id)) } : null })) }); return;
  }
  if (url.pathname === '/api/prevention/agent/report' && req.method === 'POST') {
    send(res, 200, await ingestAgentReport(store, stationId, await bodyJson(req, 20000), clock())); return;
  }
  send(res, 404, { error: 'Rota de agente inexistente.' });
}
