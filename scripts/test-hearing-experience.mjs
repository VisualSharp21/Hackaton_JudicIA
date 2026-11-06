import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteStore } from '../src/prevention/sqlite-store.js';
import { createServices } from '../src/prevention/runtime.js';
import { ensureDemoAgenda } from '../src/prevention/demo.js';
import { handlePreventionRoute } from '../src/prevention/routes.js';
import { registerStation, diagnose } from '../src/prevention/diagnostics.js';

async function route(services, path, body = {}, method = 'POST') {
  let result;
  await handlePreventionRoute({ req: { method }, res: {}, url: new URL(path, 'http://localhost'), user: { id: 'tic', role: 'tic' }, services,
    bodyJson: async () => body, send: (_, status, value) => { result = { status, ...value }; }, demoOnly: true });
  return result;
}

test('DEMO: horários relativos, histórico, inicialização idempotente e scheduler independente do frontend', async () => {
  const store = sqliteStore(); let now = Date.now(); const services = createServices(store, { clock: () => now });
  try {
    assert.equal(await ensureDemoAgenda(services, false), false);
    assert.equal((await store.list('hearing')).length, 0);
    assert.equal(await ensureDemoAgenda(services, true), true);
    assert.equal(await ensureDemoAgenda(services, true), false);
    const all = await store.list('hearing'); assert.equal(all.length, 7);
    const future = all.filter((h) => h.lifecycle === 'ATIVA').sort((a,b) => Date.parse(a.startsAt)-Date.parse(b.startsAt));
    assert.deepEqual(future.map((h) => (Date.parse(h.startsAt)-now)/60000), [8,22,45,90,180]);
    assert.ok(all.every((h) => h.mode === 'DEMO' && h.conferenceUrl.includes('example.invalid') && h.department && h.type));
    services.scheduler.start(10);
    for (let n = 0; n < 100 && !(await store.get('hearing', future[1].id)).lastChecks; n++) await new Promise((r) => setTimeout(r, 10));
    services.scheduler.stop();
    assert.equal((await store.get('hearing', future[0].id)).state, 'PRONTA');
    assert.equal((await store.get('hearing', future[1].id)).state, 'ATENÇÃO');
    assert.equal((await store.get('job', `${future[2].id}:1`)).attempts, 0);
    const detail = await route(services, `/api/hearings/${future[1].id}/history`, {}, 'GET');
    assert.equal(detail.precedents[0].mode, 'DEMO'); assert.ok(detail.precedents[0].successEvidence);
    const assisted = await route(services, `/api/hearings/${future[1].id}/assist`);
    assert.equal(assisted.context.hearing.id, future[1].id); assert.equal(assisted.context.remainingMinutes, 22);
    assert.ok(assisted.context.failures.some((c) => c.name === 'microphone')); assert.ok(assisted.precedents.length);
    assert.equal((await store.get('hearing-conversation', assisted.conversationId)).messages.length, 2);
    now += 16000; await services.scheduler.tick(); now += 31000; await services.scheduler.tick(); await services.scheduler.tick();
    assert.equal((await store.list('escalation')).length, 1); assert.equal((await store.list('escalation'))[0].mode, 'DEMO');
    assert.equal((await store.list('job')).length, 7);
    now += 16*60000; await services.scheduler.tick();
    assert.ok((await store.get('hearing', future[2].id)).lastChecks.some((c) => c.name === 'latency' && c.status === 'FAIL'));
    now += 155*60000; await services.scheduler.tick();
    const recovered = await store.get('job', `${future[4].id}:1`); assert.equal(recovered.action.status, 'EXECUTED'); assert.ok(recovered.precedents.length);
  } finally { services.scheduler.stop(); await store.close(); }
});

test('Captura funcional pertence à audiência e revisão; persiste ambos os componentes sem afetar outra sessão', async () => {
  const store = sqliteStore(); const now = Date.now(); const services = createServices(store, { clock: () => now });
  try {
    await registerStation(store, { id: 'LOCAL', locality: 'Comarca', mode: 'REAL' }, 'tic');
    const input = { label: 'Sessão', room: 'Sala', locality: 'Comarca', stationId: 'LOCAL', responsible: 'tic', mode: 'REAL', startsAt: new Date(now + 600000).toISOString() };
    const a = await services.agenda.save(input, 'tic'); const b = await services.agenda.save(input, 'tic'); await services.scheduler.tick();
    for (const component of ['camera_functional', 'microphone_functional']) {
      await route(services, `/api/hearings/${a.id}/browser-report`, { component, status: 'PASS', evidence: 'Frames/sinal RMS coletados no navegador', expectedRevision: 1 });
    }
    const job = await store.get('job', `${a.id}:1`); assert.equal(Object.keys(job.browserChecks).length, 2);
    assert.equal(job.browserChecks.camera_functional.receivedAt, now);
    assert.ok((await store.get('hearing', a.id)).lastChecks.some((c) => c.name === 'camera_functional' && c.status === 'PASS'));
    const other = await store.get('job', `${b.id}:1`); assert.equal(other.browserChecks, undefined);
    const checks = await diagnose({ hearing: b, station: await store.get('station', 'LOCAL'), job: other, now });
    assert.equal(checks.find((c) => c.name === 'capture').status, 'UNVERIFIABLE');
    await assert.rejects(route(services, `/api/hearings/${a.id}/browser-report`, { status: 'PASS', expectedRevision: 99 }), /reagendada/);
  } finally { await store.close(); }
});
