import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { sqliteStore } from '../src/prevention/sqlite-store.js';
import { createServices } from '../src/prevention/runtime.js';
import { handlePreventionRoute, handleAgentRoute } from '../src/prevention/routes.js';
import { registerStation } from '../src/prevention/diagnostics.js';

test('API HTTP: agenda, SSE, permissões, agente vinculado e nonce de uso único', async () => {
  const store = sqliteStore(); let now = Date.parse('2026-11-05T10:00:00-03:00'); const clock = () => now;
  const services = createServices(store, { clock });
  const station = await registerStation(store, { id: 'REAL-1', mode: 'REAL', locality: 'Belém' }, 'tic');
  const send = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  const bodyJson = async (req) => { let body = ''; for await (const chunk of req) body += chunk; return JSON.parse(body || '{}'); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.includes('/agent/')) return await handleAgentRoute({ req, res, url, store, bodyJson, send, clock });
      await handlePreventionRoute({ req, res, url, user: { id: req.headers['x-user'] || 'tic', role: req.headers['x-role'] || 'tic' }, services, bodyJson, send });
    } catch (e) { send(res, e.status || 500, { error: e.message }); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const data = { label: 'Teste HTTP', locality: 'Belém', room: 'Sala', stationId: 'REAL-1', startsAt: '2026-11-05T10:30:00-03:00', mode: 'REAL', responsible: 'tic' };
  try {
    let response = await fetch(base + '/api/hearings', { method: 'POST', body: JSON.stringify(data), headers: { 'x-role': 'solicitante' } }); assert.equal(response.status, 403);
    response = await fetch(base + '/api/hearings', { method: 'POST', body: JSON.stringify(data) }); assert.equal(response.status, 201); const h = await response.json();
    const empty = await (await fetch(base + '/api/hearings', { headers: { 'x-role': 'solicitante', 'x-user': 'another' } })).json(); assert.equal(empty.hearings.length, 0);
    await services.scheduler.tick();
    response = await fetch(base + '/api/hearings/events'); assert.equal(response.headers.get('content-type'), 'text/event-stream'); const reader = response.body.getReader(); const chunk = new TextDecoder().decode((await reader.read()).value); assert.ok(chunk.includes('event: hearings')); assert.ok(!chunk.includes('tokenHash')); await reader.cancel();
    response = await fetch(base + '/api/prevention/agent/tasks?stationId=REAL-1'); assert.equal(response.status, 401);
    const headers = { Authorization: `Bearer ${station.agentToken}` };
    const { tasks } = await (await fetch(base + '/api/prevention/agent/tasks?stationId=REAL-1', { headers })).json(); assert.equal(tasks.length, 1);
    const report = { jobId: tasks[0].jobId, nonce: tasks[0].nonce, checks: [{ name: 'camera', status: 'PASS', evidence: 'PnP detectado' }] };
    response = await fetch(base + '/api/prevention/agent/report?stationId=REAL-1', { method: 'POST', headers, body: JSON.stringify(report) }); assert.equal(response.status, 200);
    assert.equal((await store.get('station', 'REAL-1')).report.checks[0].status, 'DETECTED');
    response = await fetch(base + '/api/prevention/agent/report?stationId=REAL-1', { method: 'POST', headers, body: JSON.stringify(report) }); assert.equal((await response.json()).duplicate, true);
    const history = await (await fetch(base + `/api/hearings/${h.id}/history`)).text(); assert.ok(!history.includes(tasks[0].nonce));
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await store.close(); }
});
