import { invalid, textField } from './agenda.js';
import { randomUUID } from 'node:crypto';

export async function saveSupportRecord(store, kind, input, actor, clock = () => Date.now()) {
  if (!['certificate','change','local-contact'].includes(kind)) throw invalid('Cadastro inválido.');
  if (!['REAL','DEMO'].includes(input.mode)) throw invalid('Informe a origem REAL ou DEMO.');
  const value = { id: randomUUID(), kind, mode: input.mode, locality: textField(input.locality,'comarca'),
    label: textField(input.label,'identificação técnica'), evidence: textField(input.evidence,'fonte / evidência',2000), actor, createdAt: new Date(clock()).toISOString(), source: 'CADASTRO_TIC' };
  if (kind === 'certificate' || kind === 'change') {
    if (typeof input.date !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(input.date) || !Number.isFinite(Date.parse(input.date))) throw invalid('Informe data/hora com fuso explícito.');
    value.date = new Date(input.date).toISOString();
  }
  if (kind === 'change') value.category = textField(input.category, 'componente',100);
  if (kind === 'local-contact') { value.contact = textField(input.contact,'contato institucional',200); value.skills = textField(input.skills,'capacitações',1000); }
  await store.transaction(async (tx) => { await tx.put('support-registry',value); await tx.audit('', 'SUPPORT_REGISTRY_CREATED',actor,{ id:value.id, kind, mode:value.mode },clock()); });
  return value;
}

export async function supportOverview(store, clock = () => Date.now()) {
  const records = await store.list('support-registry'); const hearings = await store.list('hearing'); const now = clock();
  const jobs = await store.list('job');
  const failures = hearings.flatMap((h) => {
    const historical = jobs.filter((j)=>j.hearingId===h.id).flatMap((j)=>(j.history || []).flatMap((run)=>run.checks || []));
    return [...historical,...(h.lastChecks || [])].filter((c)=>c.status==='FAIL' && c.mode===h.mode).map((c)=>({...c,hearingId:h.id,stationId:h.stationId,locality:h.locality,mode:h.mode}));
  });
  const changes = records.filter((r) => r.kind === 'change').map((r) => {
    const at = Date.parse(r.date); const window = 3*3600000;
    const matching = failures.filter((c) => c.name === r.category && c.mode === r.mode && c.locality === r.locality);
    const count = (start,end) => new Set(matching.filter((c) => Date.parse(c.observedAt) >= start && Date.parse(c.observedAt) < end).map((c) => c.hearingId)).size;
    const before = count(at-window,at); const after = count(at,at+window);
    return {...r,correlation:{before,after,windowHours:3,status:now < at+window ? 'OBSERVING' : after >= 5 && before > 0 && after > before*1.5 ? 'TEMPORAL_ASSOCIATION' : 'INSUFFICIENT_EVIDENCE',explanation:'Comparação de audiências com falha no componente nas 3 horas anteriores/posteriores. Associação temporal não comprova causa; ausência de histórico não comprova ausência de problemas.'}};
  });
  const groups = new Map();
  for (const c of failures.filter((c) => Date.parse(c.observedAt) >= now-30*86400000)) {
    const key=JSON.stringify([c.mode,c.stationId,c.name]); if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(c);
  }
  const training = [...groups.values()].filter((items) => new Set(items.map((c)=>c.hearingId)).size>=3).map((items) => ({ mode:items[0].mode,stationId:items[0].stationId,component:items[0].name,occurrences:new Set(items.map((c)=>c.hearingId)).size,
    recommendation:'Revisar a infraestrutura e orientar a equipe com um procedimento validado para o componente recorrente. Não atribuir automaticamente a causa ao usuário.' }));
  return { certificates:records.filter((r)=>r.kind==='certificate').map((r)=>({...r,daysRemaining:Math.ceil((Date.parse(r.date)-now)/86400000),status:Date.parse(r.date)<now?'EXPIRED':Date.parse(r.date)-now<=7*86400000?'EXPIRING':'CURRENT'})), changes, contacts:records.filter((r)=>r.kind==='local-contact'), training };
}
