/**
 * Teste de integração da API do Copilot contra o servidor em execução.
 *
 *   npm start   (em outro terminal)
 *   npm run test:copilot:api
 *
 * Usa um tenant isolado ("copilot-qa", criado se não existir) com um solicitante e um
 * TIC de teste; as senhas são novas e aleatórias a cada execução. Os dados de
 * demonstração do tenant padrão não são tocados. API: COPILOT_API_URL (padrão :3000).
 */
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { createTenant, tenantBySlug } from "../src/repository.js";
import { createUser, resetUserPassword } from "../src/auth.js";
import { setTenantContext } from "../src/tenant-context.js";

const BASE = process.env.COPILOT_API_URL || "http://localhost:3000";
const ORIGIN = (process.env.FRONTEND_ORIGINS || "http://localhost:5173").split(",")[0].trim();

async function provisionQaTenant() {
  const tenant = tenantBySlug("copilot-qa") || createTenant({ name: "Copilot QA (teste automatizado)", slug: "copilot-qa" });
  setTenantContext(tenant.id);
  const creds = { tenant: tenant.slug };
  for (const [role, email] of [["solicitante", "qa.solicitante@copilot.test"], ["tic", "qa.tic@copilot.test"]]) {
    const password = randomBytes(18).toString("base64url");
    try {
      await createUser({ email, displayName: `QA ${role}`, role, password, tenantId: tenant.id });
    } catch (error) {
      if (!/existe/i.test(error.message)) throw error;
      await resetUserPassword(email, password);
    }
    creds[role] = { email, password };
  }
  return creds;
}
const creds = await provisionQaTenant();

function client() {
  const jar = new Map();
  let csrf = '';
  async function call(path, { method = 'GET', body, raw = false } = {}) {
    const headers = { Origin: ORIGIN };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const cookie of res.headers.getSetCookie?.() || []) {
      const [pair] = cookie.split(';');
      const [k, v] = pair.split('=');
      jar.set(k.trim(), v);
    }
    const text = await res.text();
    let data = text;
    if (!raw) try { data = JSON.parse(text); } catch { /* texto */ }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    call,
    async login(user) {
      const r = await call('/api/auth/login', { method: 'POST', body: { tenantSlug: creds.tenant, email: user.email, password: user.password } });
      assert.equal(r.status, 200, `login ${user.email}: ${JSON.stringify(r.data)}`);
      csrf = r.data.csrfToken;
      return r.data.user;
    },
  };
}

const ok = (label) => console.log(`  ✔ ${label}`);
const sol = client();
const tic = client();
await sol.login(creds.solicitante);
await tic.login(creds.tic);
ok('login solicitante e TIC');

// 1. Catálogo de estações
const machines = await sol.call('/api/copilot/machines');
assert.equal(machines.status, 200);
assert.equal(machines.data.machines.length, 30);
assert.equal(machines.data.detected, null, 'localhost não casa com IP do catálogo');
assert.equal(machines.data.engine.mode, 'regras');
assert.equal(machines.data.engine.hasApiKey, false);
assert.ok(!JSON.stringify(machines.data).includes('apiKey"'), 'nunca expõe a chave');
const m4 = machines.data.machines.find((m) => m.id === 'LAB-PJE-004');
assert.equal(m4.chip, 'LAB-PJE-004 - Sala de audiência (Dell Latitude / Windows 11)');
assert.ok(m4.inventarioGlpi.softwares.includes('PJeOffice Pro'));
ok(`GET /api/copilot/machines → 30 estações, chip "${m4.chip}", motor "${machines.data.engine.label}"`);

// 2. Conversa de audiência em andamento
const msg = 'Estamos no meio da audiência pelo Google Meet https://meet.google.com/abc-defg-hij e ninguém nos ouve, o microfone do Jabra não capta a voz';
const t1 = await sol.call('/api/copilot/chat', { method: 'POST', body: { machineId: 'LAB-PJE-004', message: msg } });
assert.equal(t1.status, 200, JSON.stringify(t1.data));
const s1 = t1.data.session;
assert.match(s1.id, /^COP-[0-9A-F]{8}$/);
assert.match(s1.requestId, /^REQ-/);
const tr = t1.data.turn.triage;
assert.equal(tr.prioridade, 'CRITICAL');
assert.equal(tr.fila, 'SUPORTE_HARDWARE');
assert.ok(tr.regrasAplicadas.some((r) => r.regra === 'audiencia_iminente'));
assert.equal(t1.data.turn.solution.familiaSo, 'windows');
const meetCard = t1.data.turn.tools.find((t) => t.tool === 'run_meet_check');
assert.equal(meetCard.status, 'aguardando_execucao');
assert.equal(meetCard.meetUrl, 'https://meet.google.com/abc-defg-hij');
assert.ok(t1.data.turn.precedents[0].id === 'CHAM-2026-004');
ok(`POST /api/copilot/chat → ${s1.id} / ${s1.requestId}; prioridade ${tr.prioridade}; fila ${tr.fila}; cartão run_meet_check (${meetCard.runId})`);

// 3. Laudo do teste (microfone bloqueado pelo navegador)
const report = {
  schema: 'pulso-meet-check-1', runId: meetCard.runId, executadoEm: new Date().toISOString(),
  sala: { url: meetCard.meetUrl, codigo: 'abc-defg-hij', codigoPadrao: true },
  navegador: { nome: 'Chrome', contextoSeguro: true, permissoes: { camera: 'granted', microfone: 'denied' } },
  microfone: { status: 'negado', erro: 'NotAllowedError', picoPct: 0 },
  camera: { status: 'ok', dispositivo: 'Integrated Webcam', resolucao: '640x480' },
  rede: { status: 'ok', latenciaMs: 4.2, jitterMs: 0.8, perdaPct: 0, amostras: 6, destino: 'servidor central' },
  zabbix: { simulado: true, comarca: 'Belém', host: 'gw-belem.tjpa.jus.br', status: 'OPTIMAL', latenciaMs: 18, perdaPct: 0, jitterMs: 3 },
  veredito: 'PRONTA', // o servidor deve ignorar e recalcular
};
const t2 = await sol.call('/api/copilot/chat', { method: 'POST', body: { sessionId: s1.id, meetReport: report } });
assert.equal(t2.status, 200, JSON.stringify(t2.data));
const done = t2.data.turn.tools.find((t) => t.tool === 'run_meet_check');
assert.equal(done.status, 'concluido');
assert.equal(done.laudo.veredito, 'BLOQUEADA', 'veredito recalculado no servidor');
assert.equal(t2.data.turn.solution.procedimentoId, 'meet-permissao');
ok(`laudo → veredito ${done.laudo.veredito}; correção "${t2.data.turn.solution.titulo}"`);

const badReport = await sol.call('/api/copilot/chat', { method: 'POST', body: { sessionId: s1.id, meetReport: { schema: 'outro' } } });
assert.equal(badReport.status, 400);
ok('laudo com schema inválido → 400');

// 4. Escalação para o GLPI (conector mock no tenant de QA)
const esc = await sol.call('/api/copilot/escalate', { method: 'POST', body: { sessionId: s1.id } });
assert.equal(esc.status, 201, JSON.stringify(esc.data));
assert.match(esc.data.title, /^\[Sala de audiência\] .+ - Estação LAB-PJE-004$/);
for (const piece of ['Patrimônio: DEMO-PAT-004', 'Serial: DEMO-PJE-SN-004', 'Dell Latitude 5440', 'Windows 11 Pro', 'IP 192.0.2.14', 'Prioridade calculada: CRITICAL', 'Fila de destino no GLPI: SUPORTE_HARDWARE', 'LAUDO DO TESTE DE AUDIÊNCIA', 'Veredito: BLOQUEADA', 'PROCEDIMENTOS JÁ TENTADOS'])
  assert.ok(esc.data.body.includes(piece), `corpo sem "${piece}"`);
assert.match(esc.data.ticket.protocol, /^JUD-\d{6}$/);
assert.equal(esc.data.session.status, 'ESCALADO_GLPI');
ok(`POST /api/copilot/escalate → protocolo ${esc.data.ticket.protocol}; título "${esc.data.title}"`);
const again = await sol.call('/api/copilot/escalate', { method: 'POST', body: { sessionId: s1.id } });
assert.equal(again.status, 200);
assert.equal(again.data.alreadyEscalated, true);
ok('escalação idempotente (200, alreadyEscalated)');
const closed = await sol.call('/api/copilot/chat', { method: 'POST', body: { sessionId: s1.id, message: 'oi de novo' } });
assert.equal(closed.status, 409);
ok('chat em atendimento escalado → 409');

// 5. Autoatendimento resolvido + nota
const p1 = await sol.call('/api/copilot/chat', { method: 'POST', body: { machineId: 'LAB-PJE-002', message: "Quando clico em 'Assinar' no PJe aparece 'Não foi possível conectar ao PJeOffice'" } });
assert.equal(p1.status, 200);
assert.match(p1.data.turn.reply, /Identifiquei que na estação \*\*LAB-PJE-00[17]\*\*/);
const p2 = await sol.call('/api/copilot/chat', { method: 'POST', body: { sessionId: p1.data.session.id, message: 'funcionou, obrigado' } });
assert.equal(p2.data.turn.intent, 'positivo');
const early = await sol.call('/api/copilot/feedback', { method: 'POST', body: { sessionId: p1.data.session.id, rating: 5 } });
assert.equal(early.status, 409, 'nota antes de resolver');
const res = await sol.call('/api/copilot/resolve', { method: 'POST', body: { sessionId: p1.data.session.id } });
assert.equal(res.status, 200);
assert.equal(res.data.session.status, 'RESOLVIDO_AUTOATENDIMENTO');
const fb = await sol.call('/api/copilot/feedback', { method: 'POST', body: { sessionId: p1.data.session.id, rating: 5, comment: 'Resolveu rápido' } });
assert.equal(fb.status, 201);
const badFb = await sol.call('/api/copilot/feedback', { method: 'POST', body: { sessionId: p1.data.session.id, rating: 9 } });
assert.equal(badFb.status, 400);
const escAfter = await sol.call('/api/copilot/escalate', { method: 'POST', body: { sessionId: p1.data.session.id } });
assert.equal(escAfter.status, 409);
ok(`autoatendimento ${p1.data.session.id}: resolve → ${res.data.session.status}; nota 5 registrada; escalar depois → 409`);

// 6. Retomada e registro .md
const restored = await sol.call(`/api/copilot/sessions/${p1.data.session.id}`);
assert.equal(restored.status, 200);
assert.equal(restored.data.session.messages.length, 4);
const log = await sol.call(`/api/copilot/sessions/${s1.id}/log`, { raw: true });
assert.equal(log.status, 200);
assert.match(log.headers.get('content-type'), /text\/markdown/);
assert.ok(log.data.includes(`**ID da Sessão:** \`${s1.id}\``));
assert.ok(log.data.includes('`ESCALADO_GLPI`'));
assert.ok(log.data.includes('run_meet_check'));
ok('GET sessions/:id (retomada) e sessions/:id/log (template-sessao.md preenchido)');

// 7. Isolamento e permissões
const ticSession = await tic.call('/api/copilot/chat', { method: 'POST', body: { machineId: 'LAB-PJE-005', message: 'a impressora travou com documentos na fila' } });
assert.equal(ticSession.status, 200);
assert.equal(ticSession.data.turn.solution.procedimentoId, 'impressao-cups', 'Ubuntu recebe CUPS');
const peek = await sol.call(`/api/copilot/sessions/${ticSession.data.session.id}`);
assert.equal(peek.status, 404, 'solicitante não lê sessão de outro usuário');
const solSettings = await sol.call('/api/copilot/settings');
assert.equal(solSettings.status, 403);
const solPut = await sol.call('/api/copilot/settings', { method: 'PUT', body: { provider: 'openai', apiKey: 'x' } });
assert.equal(solPut.status, 403);
ok('isolamento: sessão alheia → 404; settings para solicitante → 403');

// 8. Settings (TIC): a chave nunca volta
const put = await tic.call('/api/copilot/settings', { method: 'PUT', body: { provider: 'groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', apiKey: 'gsk_teste_nao_real_123', fallbackRules: true } });
if (put.status === 400 && /TENANT_SECRETS_KEY/.test(put.data.error)) {
  ok('settings: sem TENANT_SECRETS_KEY a chave não é gravada (400 explícito)');
} else {
  assert.equal(put.status, 200, JSON.stringify(put.data));
  assert.equal(put.data.hasApiKey, true);
  assert.ok(!JSON.stringify(put.data).includes('gsk_teste'), 'chave não volta na resposta');
  const get = await tic.call('/api/copilot/settings');
  assert.ok(!JSON.stringify(get.data).includes('gsk_teste'));
  assert.equal(get.data.engine.mode, 'llm');
  const reset = await tic.call('/api/copilot/settings', { method: 'PUT', body: { useEnv: true } });
  assert.equal(reset.data.origem, 'env');
  ok('settings TIC: grava criptografado, nunca devolve a chave, volta ao .env');
}
const tools = await tic.call('/api/copilot/tools');
assert.ok(tools.data.tools.some((t) => t.name === 'run_meet_check' && t.status === 'ativa'));
assert.ok(tools.data.tools.some((t) => t.name === 'check_spooler' && t.status === 'planejada'));
ok(`Tool Registry: ${tools.data.tools.map((t) => `${t.name}(${t.status})`).join(', ')}`);

// 9. Validações
const empty = await sol.call('/api/copilot/chat', { method: 'POST', body: { machineId: 'LAB-PJE-001', message: '' } });
assert.equal(empty.status, 400);
const badMachine = await sol.call('/api/copilot/chat', { method: 'POST', body: { machineId: 'LAB-PJE-999', message: 'teste de máquina inexistente' } });
assert.equal(badMachine.status, 400);
const huge = await sol.call('/api/copilot/chat', { method: 'POST', body: { machineId: 'LAB-PJE-001', message: 'x'.repeat(2500) } });
assert.equal(huge.status, 400);
const noCsrf = await fetch(BASE + '/api/copilot/chat', { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(noCsrf.status, 401);
ok('validações: mensagem vazia, estação inexistente, mensagem longa → 400; sem sessão → 401');

console.log('\nAPI do Copilot: OK');
process.exit(0);
