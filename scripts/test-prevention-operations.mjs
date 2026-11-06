import test from 'node:test';
import assert from 'node:assert/strict';
import { sqliteStore } from '../src/prevention/sqlite-store.js';
import { createServices } from '../src/prevention/runtime.js';
import { hearingSnapshot, handlePreventionRoute } from '../src/prevention/routes.js';
import { registerStation, check } from '../src/prevention/diagnostics.js';
import { serviceDeadline } from '../src/ticketing/service-deadline.js';
import { filterTicketQueue, liveDeadline } from '../public/pages/ticket-queue.js';
import { saveSupportRecord, supportOverview } from '../src/prevention/support-registry.js';

async function route(services, path, body = {}, role = 'tic', method = 'POST') {
  let result;
  await handlePreventionRoute({ req: { method }, res: {}, url: new URL(path, 'http://localhost'), user: { id: role, role }, services, demoOnly: true,
    bodyJson: async () => body, send: (_, status, value) => { result = { status, ...value }; } }); return result;
}

test('Duas audiências → uma ocorrência e um chamado; concorrência, avisos, Copilot e isolamento de acesso', async () => {
  const store = sqliteStore(); let now = Date.now(); const services = createServices(store, { clock: () => now });
  try {
    const demo = await services.operations.prepareCollectiveDemo(services.agenda, 'tic');
    assert.deepEqual((await services.operations.prepareCollectiveDemo(services.agenda, 'tic')).hearingIds, demo.hearingIds);
    await Promise.all([services.scheduler.tick(), services.scheduler.tick()]);
    await services.scheduler.tick();
    const incidents = await store.list('collective-incident'); assert.equal(incidents.length, 1);
    assert.equal(incidents[0].hearingIds.length, 2); assert.equal((await store.list('notice')).length, 1);
    const escalations = await store.list('escalation'); assert.equal(escalations.filter((e) => e.status === 'SENT').length, 1); assert.equal(escalations.filter((e) => e.status === 'LINKED').length, 1);
    assert.equal(escalations.find((e) => e.status === 'SENT').collectiveEvidence.length, 2);
    const assisted = await route(services, `/api/hearings/${demo.hearingIds[0]}/assist`);
    assert.equal(assisted.context.collectiveIncident.id, incidents[0].id); assert.match(assisted.reply, /Problema coletivo conhecido/);
    const empty = await hearingSnapshot(store, { id: 'other', role: 'solicitante' }); assert.equal(empty.hearings.length, 0); assert.equal(empty.incidents.length, 0); assert.equal(empty.notices.length, 0);
    const owned = await hearingSnapshot(store, { id: 'tic', role: 'solicitante' }); assert.equal(owned.incidents[0].report, undefined); assert.ok(owned.escalations.every((e) => !e.collectiveEvidence && !e.collectiveHearingRefs));
    await assert.rejects(route(services, '/api/prevention/operations', {}, 'solicitante', 'GET'), /permissão/);
    now += 5000; await services.scheduler.tick(); assert.equal((await store.list('collective-incident')).length, 1); assert.equal((await store.list('notice')).length, 1);
  } finally { await store.close(); }
});

test('Contingência exige autorização, evidência, revisão atual e não executa comandos; pós-incidente revisável', async () => {
  const store = sqliteStore(); let now = Date.now(); const services = createServices(store, { clock: () => now });
  try {
    const demo = await services.operations.prepareCollectiveDemo(services.agenda, 'tic'); await services.scheduler.tick();
    const h = await store.get('hearing', demo.hearingIds[0]);
    const path = `/api/hearings/${h.id}/contingency/room`;
    const body = { expectedRevision: 1, responsible: 'TIC DEMO', status: 'DONE', evidence: 'SIMULAÇÃO: sala alternativa verificada.' };
    await assert.rejects(route(services, path, body, 'gestor'), /perfil TIC/);
    await assert.rejects(route(services, path, { ...body, evidence: '' }), /resultado/);
    const plan = await route(services, path, body); assert.equal(plan.revision, 2); assert.equal(plan.steps.find((s) => s.id === 'room').actor, 'tic');
    await assert.rejects(route(services, path, body), /Plano alterado/);
    const i = (await store.list('collective-incident'))[0];
    await assert.rejects(route(services, `/api/prevention/incidents/${i.id}/close`, { resolution: 'teste', expectedRevision: 999 }), /alterada/);
    now += 1000;
    const closed = await route(services, `/api/prevention/incidents/${i.id}/close`, { resolution: 'SIMULAÇÃO: rede normalizada e verificada pela TIC.', expectedRevision: i.revision });
    assert.equal(closed.report.status, 'DRAFT'); assert.equal(closed.report.procedures.find((p) => p.hearingId === h.id).steps.find((s) => s.id === 'room').status, 'DONE');
    await services.operations.synchronize(); assert.equal((await store.list('collective-incident')).length, 1); assert.equal((await store.list('notice')).length, 2);
    await route(services, `/api/prevention/incidents/${i.id}/close`, { resolution: 'Reenvio idempotente', expectedRevision: i.revision }); assert.equal((await store.list('notice')).length, 2);
    const reviewed = await route(services, `/api/prevention/incidents/${i.id}/review`, { expectedRevision: closed.revision, reviewNote: 'Evidências e procedimentos conferidos pela TIC.' }); assert.equal(reviewed.report.status, 'REVIEWED');
    assert.ok((await store.auditLog(h.id)).some((a) => a.event === 'CONTINGENCY_UPDATED'));
  } finally { await store.close(); }
});

test('Correlação não mistura REAL/DEMO, comarcas, mesma estação ou evidências obsoletas', async () => {
  const store = sqliteStore(); const now = Date.now(); const services = createServices(store, { clock: () => now });
  try {
    const items = [['A','REAL','Norte',now],['B','DEMO','Norte',now],['C','REAL','Sul',now],['D','REAL','Norte',now-16*60000]];
    for (const [id,mode,locality,at] of items) {
      await registerStation(store, { id,mode,locality }, 'tic');
      const h = await services.agenda.save({ label: id, mode, locality, stationId:id, room:id, responsible:'tic', startsAt:new Date(now+600000).toISOString() }, 'tic');
      h.lastChecks = [check('latency','SERVER','FAIL','Evidência de latência',mode,at)]; await store.transaction((tx) => tx.put('hearing', h));
    }
    await services.operations.synchronize(); assert.equal((await store.list('collective-incident')).length, 0);
    const a = (await store.list('hearing')).find((h) => h.stationId === 'A');
    await services.agenda.save({ ...a, label:'Outra na mesma estação', startsAt:new Date(now+610000).toISOString() }, 'tic');
    const all = await store.list('hearing'); const second = all.find((h) => h.label === 'Outra na mesma estação'); second.lastChecks = a.lastChecks; await store.transaction((tx) => tx.put('hearing', second));
    await services.operations.synchronize(); assert.equal((await store.list('collective-incident')).length, 0);
    const d = all.find((h) => h.stationId === 'D'); d.lastChecks[0].observedAt=new Date(now).toISOString(); await store.transaction((tx) => tx.put('hearing', d));
    await services.operations.synchronize(); assert.equal((await store.list('collective-incident')).length, 1);
  } finally { await store.close(); }
});

test('Relatório executivo separa origem e período; sem economia ou equidade inventadas', async () => {
  const store = sqliteStore(); const now = Date.now(); const services = createServices(store, { clock: () => now });
  try {
    await services.operations.prepareCollectiveDemo(services.agenda, 'tic'); await services.scheduler.tick();
    const real = await route(services, '/api/prevention/executive-report?mode=REAL&days=30', {}, 'gestor', 'GET'); assert.equal(real.hearings, 0); assert.equal(real.incidents.length, 0);
    const demo = await services.operations.executive('DEMO'); assert.equal(demo.incidents.length, 1); assert.equal(demo.hearings, 0, 'Sessões futuras não entram como realizadas');
    await assert.rejects(services.operations.executive('REAL', -1), /inválidos/);
  } finally { await store.close(); }
});

test('Fila de chamados: metas configuradas, vencimento, encerramento, filtros e prioridade', () => {
  const now = Date.now(); const ticket = { id:'A',protocol:'A',description:'PJe sem acesso',locality:'Belém',priority:'HIGH',status:'OPEN',createdAt:new Date(now-50*60000).toISOString() };
  assert.equal(serviceDeadline(ticket, {}).status, 'UNCONFIGURED');
  ticket.serviceDeadline = serviceDeadline(ticket,{ resolution:{HIGH:60} },now); assert.equal(ticket.serviceDeadline.status,'AT_RISK'); assert.equal(liveDeadline(ticket,now+11*60000).status,'OVERDUE');
  assert.equal(serviceDeadline({...ticket,status:'RESOLVED',firstResolvedAt:new Date(now-5*60000).toISOString()}, {resolution:{HIGH:60}},now).status,'CLOSED_ON_TIME');
  assert.equal(serviceDeadline({...ticket,status:'CLOSED'}, {resolution:{HIGH:60}},now).status,'CLOSED_UNKNOWN');
  const b = {...ticket,id:'B',protocol:'B',priority:'CRITICAL',locality:'Breves'};
  assert.equal(filterTicketQueue([ticket,b],{},now)[0].id,'B');
  assert.deepEqual(filterTicketQueue([ticket,b],{q:'belem',sla:'AT_RISK'},now).map((t)=>t.id),['A']);
});

test('Radar, apoio local e mudanças usam cadastros com fonte e correlação explícita, separados por origem', async () => {
  const store=sqliteStore(); const now=Date.now(); const services=createServices(store,{clock:()=>now});
  try {
    await assert.rejects(route(services,'/api/prevention/support-registry',{kind:'certificate'},'gestor'),/perfil TIC/);
    const common={mode:'REAL',locality:'Belém',label:'Identificação técnica',evidence:'Registro conferido pela TIC'};
    await assert.rejects(saveSupportRecord(store,'certificate',{...common,date:'sem data'},'tic',()=>now),/fuso/);
    await saveSupportRecord(store,'certificate',{...common,date:new Date(now+2*86400000).toISOString()},'tic',()=>now);
    await saveSupportRecord(store,'local-contact',{...common,contact:'Contato institucional',skills:'Sala de audiência'},'tic',()=>now);
    await saveSupportRecord(store,'change',{...common,date:new Date(now-4*3600000).toISOString(),category:'latency'},'tic',()=>now);
    const data=await supportOverview(store,()=>now); assert.equal(data.certificates[0].daysRemaining,2); assert.equal(data.certificates[0].source,'CADASTRO_TIC');
    assert.equal(data.changes[0].correlation.status,'INSUFFICIENT_EVIDENCE'); assert.equal(data.contacts.length,1); assert.equal(data.training.length,0);
    const demo=await route(services,'/api/prevention/demo/collective'); assert.equal(demo.hearingIds.length,2);
  } finally { await store.close(); }
});
