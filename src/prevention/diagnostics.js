import net from 'node:net';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { invalid, textField, MINUTE } from './agenda.js';

export const hashToken = (token) => createHash('sha256').update(String(token)).digest('hex');
export function tokenMatches(token, hash) {
  const actual = Buffer.from(hashToken(token)); const expected = Buffer.from(hash || '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function publicStation(station) { const { tokenHash, ...safe } = station; return safe; }
export async function registerStation(store, input, actor) {
  const id = textField(input.id, 'estação', 100);
  if (!/^[\w.-]+$/.test(id)) throw invalid('Identificador de estação inválido.');
  if (!['REAL', 'DEMO'].includes(input.mode)) throw invalid('Modo inválido.');
  const target = input.target || null;
  if (target && (!net.isIP(target.host) || !Number.isInteger(target.port) || target.port < 1 || target.port > 65535)) throw invalid('Alvo deve conter IP literal e porta TCP válida, definidos pela TIC.');
  const actions = input.authorizedActions || [];
  if (!Array.isArray(actions) || actions.some((x) => !['enable_audio_device'].includes(x))) throw invalid('Ação não permitida.');
  const deviceIds = input.authorizedDeviceIds || [];
  if (!Array.isArray(deviceIds) || deviceIds.length > 10 || deviceIds.some((x) => typeof x !== 'string' || x.length > 300)) throw invalid('Lista de dispositivos inválida.');
  const token = randomBytes(32).toString('base64url');
  const station = { id, locality: textField(input.locality, 'comarca'), mode: input.mode, target,
    authorizedActions: actions, authorizedDeviceIds: deviceIds, tokenHash: hashToken(token),
    demoScenario: ['ready', 'critical', 'recoverable', 'unknown', 'network', 'offline'].includes(input.demoScenario) ? input.demoScenario : 'ready' };
  await store.transaction(async (tx) => {
    const old = await tx.get('station', id);
    if (old && (old.mode !== station.mode || old.locality !== station.locality)) throw invalid('Modo e comarca da estação são imutáveis.');
    await tx.put('station', station); await tx.audit('', 'STATION_AUTHORIZED', actor, { id, actions, mode: station.mode });
  });
  return { station: publicStation(station), agentToken: token };
}

export const check = (name, layer, status, evidence, mode, observedAt, metrics = null) => ({ name, layer, status, evidence, mode, observedAt: new Date(observedAt).toISOString(), metrics });
export async function tcpProbe(target, timeoutMs = 2000) {
  const started = performance.now();
  return new Promise((resolve) => {
    const socket = net.createConnection(target);
    const end = (ok, reason) => { socket.destroy(); resolve({ ok, reason, connectMs: Math.round(performance.now() - started) }); };
    socket.setTimeout(timeoutMs, () => end(false, 'TCP_TIMEOUT'));
    socket.once('connect', () => end(true, 'TCP_CONNECTED'));
    socket.once('error', (e) => end(false, e.code || 'TCP_ERROR'));
  });
}

export async function diagnose({ hearing, station, job, now, probe = tcpProbe, monitor }) {
  if (hearing.mode === 'DEMO') {
    const scenario = station.demoScenario;
    const failing = scenario === 'critical' || (scenario === 'recoverable' && !job.demoCorrected);
    return [check('station_tcp', 'SERVER', scenario === 'offline' ? 'FAIL' : scenario === 'unknown' ? 'UNVERIFIABLE' : 'PASS', 'SIMULAÇÃO DEMO: disponibilidade da estação.', 'DEMO', now),
      ...['connectivity', 'dns', 'latency', 'packet_loss', 'camera', 'camera_functional', 'conference_access'].map((name) => check(name, 'SERVER', scenario === 'unknown' ? 'UNVERIFIABLE' : scenario === 'network' && ['latency', 'packet_loss'].includes(name) ? 'FAIL' : 'PASS', `SIMULAÇÃO DEMO: ${name}${scenario === 'network' ? '; latência sintética 450 ms; perda sintética 12%' : ''}.`, 'DEMO', now)),
      check('microphone', 'AGENT', scenario === 'unknown' ? 'UNVERIFIABLE' : failing ? 'FAIL' : 'PASS', failing ? 'DEMO: dispositivo de áudio desabilitado.' : 'DEMO: teste sintético.', 'DEMO', now),
      check('microphone_functional', 'BROWSER', scenario === 'unknown' ? 'UNVERIFIABLE' : failing ? 'FAIL' : 'PASS', 'SIMULAÇÃO DEMO: captura de microfone.', 'DEMO', now),
      check('capture', 'BROWSER', scenario === 'unknown' ? 'UNVERIFIABLE' : failing ? 'FAIL' : 'PASS', 'DEMO: captura simulada, sem acesso à câmera ou microfone real.', 'DEMO', now)];
  }
  const checks = [];
  if (station.target) {
    const result = await probe(station.target);
    checks.push(check('station_tcp', 'SERVER', result.ok ? 'PASS' : 'FAIL', `${result.reason}: ${station.target.host}:${station.target.port}. Conexão TCP não comprova saúde de periféricos.`, 'REAL', now, { tcpConnectMs: result.connectMs }));
  } else checks.push(check('station_tcp', 'SERVER', 'UNVERIFIABLE', 'Nenhum serviço TCP autorizado para esta estação.', 'REAL', now));
  checks.push(...(monitor ? await monitor(station, now) : [check('monitoring', 'SERVER', 'UNVERIFIABLE', 'Nenhum conector de monitoramento institucional foi configurado. TCP mede somente o serviço autorizado.', 'REAL', now)]));
  const report = station.report;
  const fresh = report && report.jobId === job.id && now - report.receivedAt <= 2 * MINUTE && report.receivedAt <= now;
  for (const name of ['camera', 'microphone', 'audio', 'connectivity']) {
    const item = fresh ? report.checks.find((c) => c.name === name) : null;
    checks.push(check(name, 'AGENT', item?.status || 'UNVERIFIABLE', item?.evidence || 'Agente autorizado não entregou evidência recente desta execução.', 'REAL', item ? report.receivedAt : now, item?.metrics));
  }
  const browser = job.browserReport || station.browserReport;
  const browserFresh = browser && browser.jobId === job.id && now - browser.receivedAt <= 2 * MINUTE;
  checks.push(check('capture', 'BROWSER', browserFresh ? browser.status : 'UNVERIFIABLE', browserFresh ? browser.evidence : 'Captura funcional e permissões WebRTC exigem interação no navegador da estação.', 'REAL', browserFresh ? browser.receivedAt : now));
  checks.push(check('playback_configuration', 'BROWSER', browserFresh && browser.speakerConfirmed ? 'PASS' : 'UNVERIFIABLE', browserFresh && browser.speakerConfirmed ? 'Usuário autenticado confirmou reprodução do sinal e seleção dos dispositivos na videoconferência.' : 'Reprodução de áudio e seleção na videoconferência ainda não confirmadas pelo usuário.', 'REAL', browserFresh ? browser.receivedAt : now));
  for (const name of ['camera_functional', 'microphone_functional']) {
    const item = job.browserChecks?.[name];
    if (item) checks.push(check(name, 'BROWSER', item.status, item.evidence, 'REAL', item.receivedAt));
  }
  return checks;
}

export function readiness(checks, remainingMs) {
  if (checks.some((c) => c.status === 'FAIL')) return remainingMs <= 15 * MINUTE ? 'CRÍTICA' : 'ATENÇÃO';
  const capture = checks.some((c) => c.name === 'capture' && c.status === 'PASS');
  const playback = checks.some((c) => c.name === 'playback_configuration' && c.status === 'PASS');
  if (checks.some((c) => (c.status === 'UNVERIFIABLE' || c.status === 'DETECTED') && !(capture && ['camera', 'microphone'].includes(c.name)) && !(playback && c.name === 'audio'))) return 'NÃO_VERIFICÁVEL';
  return 'PRONTA';
}

export async function ingestAgentReport(store, stationId, input, now = Date.now()) {
  if (!Array.isArray(input.checks) || input.checks.length > 10) throw invalid('Laudo de agente inválido.');
  const names = new Set();
  const checks = input.checks.map((c) => {
    if (!['camera', 'microphone', 'audio', 'connectivity'].includes(c.name) || names.has(c.name) || !['PASS', 'FAIL', 'DETECTED', 'UNVERIFIABLE'].includes(c.status)) throw invalid('Teste de agente inválido.');
    names.add(c.name);
    // PnP presence never proves that capture works.
    const status = ['camera', 'microphone', 'audio'].includes(c.name) && c.status === 'PASS' ? 'DETECTED' : c.status;
    const metrics = c.name === 'connectivity' && c.metrics ? {
      latencyMs: Number.isFinite(c.metrics.latencyMs) && c.metrics.latencyMs >= 0 ? c.metrics.latencyMs : null,
      packetLossPct: Number.isFinite(c.metrics.packetLossPct) && c.metrics.packetLossPct >= 0 && c.metrics.packetLossPct <= 100 ? c.metrics.packetLossPct : null,
    } : null;
    return { name: c.name, status, evidence: textField(c.evidence, 'evidência', 1000), metrics };
  });
  return store.transaction(async (tx) => {
    const station = await tx.get('station', stationId);
    const job = await tx.get('job', input.jobId);
    const h = job && await tx.get('hearing', job.hearingId);
    if (!station || station.mode !== 'REAL' || !h || h.stationId !== stationId || h.revision !== job.revision || h.lifecycle !== 'ATIVA' || !tokenMatches(input.nonce, job.agentNonceHash)) throw invalid('Execução ou desafio do agente inválido.', 403);
    if (job.reportNonceUsed) return { accepted: true, duplicate: true };
    job.reportNonceUsed = true;
    station.report = { jobId: job.id, receivedAt: now, checks };
    if (input.actionResult) {
      const action = job.action;
      if (!action || action.status !== 'REQUESTED' || input.actionResult.id !== action.id) throw invalid('Ação não autorizada.');
      action.status = ['EXECUTED', 'ROLLED_BACK', 'FAILED'].includes(input.actionResult.status) ? input.actionResult.status : 'FAILED';
      action.evidence = textField(input.actionResult.evidence, 'resultado', 1000);
      await tx.audit(h.id, 'AGENT_ACTION_RESULT', stationId, action, now);
    }
    await tx.put('station', station); await tx.put('job', job);
    await tx.audit(h.id, 'AGENT_REPORT', stationId, { jobId: job.id, checks }, now);
    return { accepted: true };
  });
}
