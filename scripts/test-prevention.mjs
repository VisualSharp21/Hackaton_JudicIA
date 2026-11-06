import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sqliteStore } from '../src/prevention/sqlite-store.js';
import { Agenda, MINUTE } from '../src/prevention/agenda.js';
import { HearingScheduler } from '../src/prevention/scheduler.js';
import { EscalationOutbox, escalationContent } from '../src/prevention/escalation.js';
import { registerStation, diagnose, readiness } from '../src/prevention/diagnostics.js';
import { zabbixMonitor } from '../src/prevention/monitoring.js';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const startsAt = '2026-11-05T10:30:00-03:00';
async function setup({ scenario = 'ready', filename, mode = 'DEMO', diagnostics, transport } = {}) {
  let now = Date.parse('2026-11-05T09:59:59-03:00');
  const store = sqliteStore(filename); const clock = () => now;
  await registerStation(store, { id: 'STA-1', locality: 'Belém', mode, demoScenario: scenario }, 'tic');
  const agenda = new Agenda(store, clock);
  const data = { label: 'Sala técnica 1', locality: 'Belém', room: 'Sala 1', stationId: 'STA-1', responsible: 'Equipe TIC', startsAt, mode };
  const outbox = new EscalationOutbox({ store, clock, transport });
  const scheduler = new HearingScheduler({ store, clock, escalation: outbox, diagnostics });
  return { store, clock, agenda, data, scheduler, advance: (ms) => { now += ms; } };
}
test('10:30 é detectada às 10:00 sem clique, com persistência e idempotência', async () => {
  const s = await setup(); const h = await s.agenda.save(s.data, 'tic');
  await s.scheduler.tick(); assert.equal((await s.store.get('job', `${h.id}:1`)).attempts, 0);
  s.advance(1000); await s.scheduler.tick();
  assert.equal((await s.store.get('hearing', h.id)).state, 'PRONTA');
  await s.scheduler.tick(); assert.equal((await s.store.get('job', `${h.id}:1`)).attempts, 1);
  assert.ok((await s.store.auditLog(h.id)).some((a) => a.event === 'CHECK_STARTED'));
  await s.store.close();
});
test('falha persistente registra evidências e gera escalação enriquecida automaticamente', async () => {
  const s = await setup({ scenario: 'critical' }); const h = await s.agenda.save(s.data, 'tic');
  s.advance(16 * MINUTE); await s.scheduler.tick();
  const [e] = await s.store.list('escalation'); assert.equal(e.status, 'SENT');
  for (const value of [h.id, 'STA-1', 'Sala 1', 'microphone', 'DEMO']) assert.ok(escalationContent(e).includes(value));
  assert.equal((await s.store.get('hearing', h.id)).state, 'CRÍTICA');
  await s.store.close();
});
test('correção autorizada DEMO executa e reavalia; preserva antes/depois', async () => {
  const s = await setup({ scenario: 'recoverable' }); const h = await s.agenda.save(s.data, 'tic');
  s.advance(1000); await s.scheduler.tick(); const job = await s.store.get('job', `${h.id}:1`);
  assert.equal(job.action.status, 'EXECUTED'); assert.equal(job.history.length, 2);
  assert.equal((await s.store.get('hearing', h.id)).state, 'PRONTA'); await s.store.close();
});
test('duas audiências simultâneas e dois workers não duplicam execução', async () => {
  const s = await setup(); await s.agenda.save(s.data, 'tic'); await s.agenda.save(s.data, 'tic'); s.advance(1000);
  const worker2 = new HearingScheduler({ store: s.store, clock: s.clock });
  await Promise.all([s.scheduler.tick(), worker2.tick()]);
  const jobs = await s.store.list('job'); assert.equal(jobs.length, 2); assert.ok(jobs.every((j) => j.attempts === 1)); await s.store.close();
});
test('reinício de processo preserva execução e chamado sem duplicação', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'judicia-test-')); const filename = path.join(dir, 'state.sqlite');
  try {
    const s = await setup({ scenario: 'critical', filename }); await s.agenda.save(s.data, 'tic'); s.advance(16 * MINUTE); await s.scheduler.tick(); await s.store.close();
    const reopened = sqliteStore(filename); const restarted = new HearingScheduler({ store: reopened, clock: s.clock, escalation: new EscalationOutbox({ store: reopened, clock: s.clock }) });
    await restarted.tick(); assert.equal((await reopened.list('escalation')).length, 1); assert.equal((await reopened.list('job'))[0].attempts, 1); await reopened.close();
  } finally { await rm(dir, { recursive: true }); }
});
test('cancelamento e reagendamento invalidam execução pendente e exigem revisão', async () => {
  const s = await setup(); const h = await s.agenda.save(s.data, 'tic');
  const changed = await s.agenda.save({ ...s.data, startsAt: '2026-11-05T14:00:00-03:00', expectedRevision: 1 }, 'tic', h.id);
  assert.equal(changed.revision, 2); s.advance(1000); await s.scheduler.tick(); assert.equal((await s.store.get('job', `${h.id}:1`)).status, 'CANCELLED');
  await s.agenda.end(h.id, 'CANCELADA', 'tic'); s.advance(10 * 60 * MINUTE); await s.scheduler.tick(); assert.equal((await s.store.get('job', `${h.id}:2`)).attempts, 0); await s.store.close();
});
test('REAL sem agente não inventa telemetria ou funcionamento de periféricos', async () => {
  const checks = await diagnose({ hearing: { mode: 'REAL' }, station: {}, job: { id: 'x' }, now: Date.now() });
  assert.ok(checks.every((c) => c.status === 'UNVERIFIABLE' && c.mode === 'REAL')); assert.ok(checks.every((c) => !c.metrics));
});
test('PRONTA em REAL exige captura e reprodução confirmadas, além do inventário', () => {
  const checks = ['camera', 'microphone', 'audio'].map((name) => ({ name, status: 'DETECTED' }));
  assert.equal(readiness(checks, 1800000), 'NÃO_VERIFICÁVEL');
  checks.push({ name: 'capture', status: 'PASS' }); assert.equal(readiness(checks, 1800000), 'NÃO_VERIFICÁVEL');
  checks.push({ name: 'playback_configuration', status: 'PASS' }); assert.equal(readiness(checks, 1800000), 'PRONTA');
});
test('indisponibilidade de integração e LLM não interrompe scheduler', async () => {
  const s = await setup({ diagnostics: async () => { throw new Error('offline'); } }); const h = await s.agenda.save(s.data, 'tic'); s.advance(1000);
  await s.scheduler.tick(); assert.equal((await s.store.get('hearing', h.id)).state, 'NÃO_VERIFICÁVEL'); assert.equal((await s.store.get('job', `${h.id}:1`)).status, 'PENDING'); await s.store.close();
});
test('importação atômica, idempotente e horários com fuso obrigatório', async () => {
  const s = await setup(); await assert.rejects(s.agenda.save({ ...s.data, startsAt: '2026-11-05T10:30' }, 'tic'));
  const first = await s.agenda.import([{ ...s.data, externalRef: 'agenda-1' }], 'tic'); const second = await s.agenda.import([{ ...s.data, externalRef: 'agenda-1' }], 'tic');
  assert.equal(first[0].id, second[0].id); await s.store.close();
});

test('timer do backend inicia verificação sem requisição HTTP', async () => {
  const s = await setup(); await s.agenda.save(s.data, 'tic'); s.advance(1000);
  s.scheduler.start(10);
  try {
    for (let n = 0; n < 100 && (await s.store.list('job'))[0].status !== 'DONE'; n++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await s.store.list('job'))[0].status, 'DONE');
  } finally { s.scheduler.stop(); await s.store.close(); }
});
test('processo interrompido recupera lease persistente e mantém um único job', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'judicia-restart-')); const filename = path.join(dir, 'state.sqlite');
  try {
    const s = await setup({ filename }); const h = await s.agenda.save(s.data, 'tic'); s.advance(1000); await s.store.close();
    const code = `import {sqliteStore} from ${JSON.stringify(pathToFileURL(path.resolve('src/prevention/sqlite-store.js')).href)};
      import {HearingScheduler} from ${JSON.stringify(pathToFileURL(path.resolve('src/prevention/scheduler.js')).href)};
      const store=sqliteStore(${JSON.stringify(filename)}); const worker=new HearingScheduler({store,clock:()=>${s.clock()}});
      await worker.claim(${JSON.stringify(`${h.id}:1`)}); await store.close();`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', windowsHide: true }); assert.equal(child.status, 0, child.stderr);
    const reopened = sqliteStore(filename); s.advance(121000);
    await new HearingScheduler({ store: reopened, clock: s.clock }).tick();
    assert.equal((await reopened.list('job')).length, 1); assert.equal((await reopened.list('job'))[0].status, 'DONE');
    assert.ok((await reopened.auditLog(h.id)).some((e) => e.event === 'LEASE_RECOVERED')); await reopened.close();
  } finally { await rm(dir, { recursive: true }); }
});
test('reagendamento durante diagnóstico descarta resultado antigo', async () => {
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const s = await setup({ diagnostics: async (ctx) => { await gate; return diagnose(ctx); } });
  const h = await s.agenda.save(s.data, 'tic'); s.advance(1000); const context = await s.scheduler.claim(`${h.id}:1`);
  const pending = s.scheduler.execute(context);
  await s.agenda.save({ ...s.data, expectedRevision: 1, startsAt: '2026-11-05T12:00:00-03:00' }, 'tic', h.id); release(); await pending;
  assert.equal((await s.store.get('hearing', h.id)).state, 'AGENDADA'); assert.equal((await s.store.get('job', `${h.id}:1`)).status, 'CANCELLED'); await s.store.close();
});
test('timeout após criar chamado remoto é reconciliado sem repetir POST', async () => {
  let remote = null; let posts = 0;
  const transport = { find: async () => remote, create: async () => { posts++; remote = { id: '123', source: 'GLPI' }; throw new Error('response lost'); } };
  const s = await setup({ mode: 'REAL', transport, diagnostics: async ({ now }) => [{ name: 'network', layer: 'SERVER', mode: 'REAL', status: 'FAIL', evidence: 'Falha TCP medida', observedAt: new Date(now).toISOString() }] });
  await s.agenda.save(s.data, 'tic'); s.advance(16 * MINUTE); await s.scheduler.tick(); assert.equal((await s.store.list('escalation'))[0].status, 'UNCERTAIN');
  s.advance(121000); await s.scheduler.tick(); assert.equal((await s.store.list('escalation'))[0].status, 'SENT'); assert.equal(posts, 1); await s.store.close();
});
test('Zabbix: origem real, conversão segundos/ms, limiar, amostra obsoleta e isolamento', async () => {
  const now = Date.now(); let called = 0;
  const monitor = zabbixMonitor({ url: 'http://fixture/api_jsonrpc.php', token: 'test', tenantId: 'tenant-a', mappings: { 'tenant-a': { 's1': { latency: { id: '1' }, loss: { id: '2' }, service: { id: '3' } } } }, fetchImpl: async (_, options) => {
    called++; assert.equal(JSON.parse(options.body).method, 'item.get');
    return { ok: true, json: async () => ({ result: [
      { itemid: '1', lastclock: String(Math.floor(now / 1000)), lastvalue: '0.02', units: 's', state: '0', status: '0' },
      { itemid: '2', lastclock: String(Math.floor(now / 1000)), lastvalue: '15', units: '%', state: '0', status: '0' },
      { itemid: '3', lastclock: '0', lastvalue: '1', state: '0', status: '0' },
    ] }) };
  } });
  const checks = await monitor({ id: 's1' }, now);
  assert.equal(checks[0].metrics.latencyMs, 20); assert.equal(checks[1].status, 'FAIL'); assert.equal(checks[2].status, 'UNVERIFIABLE'); assert.ok(checks.every((c) => c.mode === 'REAL'));
  await monitor({ id: 's2' }, now); assert.equal(called, 1);
});
