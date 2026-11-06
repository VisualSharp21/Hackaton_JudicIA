// Testes do Copilot Nível 1 sem banco: `npm test` (node:test, sem dependências).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const loader = await import('../src/copilot/data-loader.js');
const { getMachine, listMachines, listProcedures, searchKnowledge, searchPrecedents, stepsForOs, DATASET_DIR, detectStation } = loader;
const { extractMeetLink, meetCheckTrigger, openAiToolDefinitions, listTools, validateArguments, getTool, executeTool } = await import('../src/copilot/tools.js');
const { resolveLlmConfig, describeEngine, parseHermesToolCalls, chatCompletion } = await import('../src/copilot/llm-client.js');
const { hearingContext, applyOperationalRules } = await import('../src/copilot/policy.js');
const { runCopilotTurn, detectIntent, extractStepsFromReply } = await import('../src/copilot/agent.js');
const { sanitizeMeetReport, assessMeetReport } = await import('../src/copilot/meet-report.js');
const { buildTicketTitle, buildTicketSections, sectionsToHtml } = await import('../src/copilot/escalation.js');
const { renderMarkdown } = await import('../public/js/markdown.js');
const triage = await import('../src/triage.js');

// Classificação determinística: sem Laya, o pipeline usa o classificador local.
process.env.JEVMODEL_BASE_URL = '';
process.env.JEVMODEL_API_KEY = '';

const triageConfig = {
  questions: triage.decisionQuestions,
  thresholds: triage.TRIAGE_THRESHOLDS,
  routing: triage.TRIAGE_ROUTING,
  routingRules: triage.TRIAGE_ROUTING_RULES,
  calibrationRules: triage.TRIAGE_CALIBRATION_RULES,
  priorityMatrix: triage.TRIAGE_PRIORITY_MATRIX,
  automationApproved: false,
  payloadTemplate: triage.DEFAULT_LAYA_PAYLOAD_TEMPLATE,
  systemOptionMappings: {},
  categoryOptionMappings: {},
};
const rulesOnly = resolveLlmConfig({ provider: 'rules', fallbackRules: true }, {});
const tickets = JSON.parse(fs.readFileSync(path.join(DATASET_DIR, 'chamados-classificados.json'), 'utf8'));

async function conversation(machineId, messages, llmConfig = rulesOnly) {
  let state = {};
  const turns = [];
  for (const message of messages) {
    const result = await runCopilotTurn({ state, machine: getMachine(machineId), message, triageConfig, queueCategoryIds: { SUPORTE_HARDWARE: '3' }, llmConfig });
    state = result.state;
    turns.push(result);
  }
  return turns;
}

describe('dataset e consciência de hardware', () => {
  test('carrega as 30 estações com ficha, inventário GLPI e perfil do setor', () => {
    const machines = listMachines();
    assert.equal(machines.length, 30);
    const m4 = getMachine('lab-pje-004');
    assert.equal(m4.chip, 'LAB-PJE-004 - Sala de audiência (Dell Latitude / Windows 11)');
    assert.equal(m4.so.familia, 'windows');
    assert.ok(m4.salaDeAudiencia);
    assert.deepEqual(m4.softwares, ['Mozilla Firefox', 'PJeOffice Pro']);
    assert.ok(m4.perifericos.some((p) => /Jabra/.test(p)));
    assert.equal(getMachine('LAB-PJE-005').so.familia, 'linux');
    assert.equal(getMachine('LAB-PJE-012').disco.alerta, true, '20,48 GB livres de 256 GB');
    assert.equal(getMachine('LAB-PJE-999'), null, 'estação inexistente não cai em outra');
  });

  test('identifica a estação pelo IP da rede interna', async () => {
    assert.deepEqual(await detectStation('::ffff:192.0.2.14'), { machineId: 'LAB-PJE-004', metodo: 'ip', valor: '192.0.2.14' });
    assert.equal(await detectStation('127.0.0.1'), null);
  });

  test('todos os procedimentos da base têm passos para algum SO', () => {
    for (const p of listProcedures()) assert.ok(stepsForOs(p, 'windows') || stepsForOs(p, 'linux'), p.id);
  });
});

describe('resolução universal (base procedural no SO certo)', () => {
  const expected = {
    '001': 'pjeoffice-conexao', '002': 'pje-lentidao', '003': 'impressao-spooler', '004': 'meet-microfone', '005': 'vpn-rota-linux',
    '006': 'token-a3', '007': 'pje-sessao', '008': 'rede-sem-conexao', '009': 'meet-camera', '010': 'pjeoffice-conexao-linux',
    '011': 'email-cota', '012': 'monitor-sem-sinal', '013': 'hardware-nao-liga', '014': 'meet-eco', '015': 'script-permissao-linux',
    '016': 'senha-expirada', '017': 'cadeia-icp', '018': 'scanner', '019': 'meet-permissao', '020': 'rede-dns-linux',
    '021': 'navegador-pdf', '022': 'pje-assinatura-lote', '023': 'teclado-mouse', '024': 'meet-conexao', '025': 'api-oauth-401',
    '026': 'disco-cheio', '027': 'audio-saida', '028': 'portal-erro-5xx', '029': 'notebook-energia', '030': 'tls-ca-interna',
  };
  for (const ticket of tickets) {
    const number = ticket.id.slice(-3);
    test(`${ticket.id} → ${expected[number]}`, () => {
      const [top] = searchKnowledge(ticket.relato, { machine: getMachine(ticket.computador.nome) });
      assert.equal(top?.procedure.id, expected[number]);
    });
  }

  test('a mesma queixa recebe passos do Windows ou do Ubuntu conforme a estação', () => {
    const text = 'a impressora travou com documentos presos na fila';
    assert.equal(searchKnowledge(text, { machine: getMachine('LAB-PJE-003') })[0].procedure.id, 'impressao-spooler');
    assert.equal(searchKnowledge(text, { machine: getMachine('LAB-PJE-005') })[0].procedure.id, 'impressao-cups');
    const pjeoffice = listProcedures().find((p) => p.id === 'pjeoffice-conexao');
    assert.ok(!stepsForOs(pjeoffice, 'windows').some((s) => /linux/i.test(s.texto)), 'passo de Linux fora da estação Windows');
    assert.equal(stepsForOs(pjeoffice, 'linux'), null, 'sem passos Windows para Ubuntu');
  });

  test('texto sem relação não casa com procedimento', () => {
    assert.deepEqual(searchKnowledge('xyz abc nada a ver', { machine: getMachine('LAB-PJE-001') }), []);
  });
});

describe('RAG de precedentes', () => {
  test('encontra o precedente com resolução comprovada', () => {
    const [p] = searchPrecedents("Não foi possível conectar ao PJeOffice quando clico em Assinar", null, { machine: getMachine('LAB-PJE-002') });
    assert.equal(p.id, 'CHAM-2026-001');
    assert.equal(p.padrao.numero, 2);
    assert.ok(p.padrao.resolucao.some((s) => /PJeOffice Pro/.test(s)));
    assert.ok(p.similaridade > 0 && p.similaridade <= 100);
  });

  test('o sintoma da base procedural orienta o ranking', () => {
    const query = 'teste pré-audiência no Google Meet: rede instável com perda de pacotes';
    const [p] = searchPrecedents(query, null, { machine: getMachine('LAB-PJE-005'), procedureIds: ['meet-conexao'], minSimilarity: 0.1 });
    assert.equal(p.id, 'CHAM-2026-024');
  });
});

describe('regras operacionais do Hermes', () => {
  const at = (hh, mm) => new Date(Date.UTC(2026, 10, 5, hh + 3, mm)); // America/Belem = UTC-3
  test('audiência: em andamento, em X minutos e horário marcado', () => {
    assert.equal(hearingContext('estamos no meio do depoimento pelo Google Meet').status, 'em_andamento');
    assert.equal(hearingContext('audiência em 10 minutos e a câmera não liga').status, 'iminente');
    assert.equal(hearingContext('audiência às 10:00 pelo Meet', null, at(9, 50)).minutos, 10);
    assert.equal(hearingContext('audiência às 10:00 pelo Meet', null, at(9, 0)).status, 'agendada');
    assert.equal(hearingContext('a impressora não imprime').mencionada, false);
  });

  const base = { category: 'NETWORK', system: 'INTERNET', impact: 'LOW', urgency: 'LOW', possibleIncident: false, isSupportRequest: true, confidence: 0.9 };
  test('audiência iminente vira prioridade crítica', () => {
    const r = applyOperationalRules({ decision: { ...base, category: 'HARDWARE', system: 'COMPUTER' }, text: 'audiência em 5 minutos e ninguém nos ouve', triageConfig });
    assert.equal(r.decision.urgency, 'CRITICAL');
    assert.equal(r.priority, 'CRITICAL');
  });
  test('queda de rede coletiva vai para SUPORTE_REDE como incidente', () => {
    const r = applyOperationalRules({ decision: base, text: 'a internet caiu e ninguém do setor consegue acessar', triageConfig });
    assert.equal(r.queue, 'SUPORTE_REDE');
    assert.equal(r.decision.possibleIncident, true);
  });
  test('falha física de hardware vai direto para SUPORTE_HARDWARE', () => {
    const r = applyOperationalRules({ decision: { ...base, category: 'SYSTEM', system: 'PJE' }, text: 'o computador não liga, nenhuma luz acende', triageConfig });
    assert.equal(r.queue, 'SUPORTE_HARDWARE');
    assert.equal(r.escalarDireto, true);
  });
});

describe('Tool Registry', () => {
  test('link do Meet: padrão, apelido e código solto', () => {
    assert.deepEqual(extractMeetLink('link: https://meet.google.com/abc-defg-hij.'), { url: 'https://meet.google.com/abc-defg-hij', codigo: 'abc-defg-hij', codigoPadrao: true });
    assert.equal(extractMeetLink('https://meet.google.com/aud-vara-001').codigoPadrao, false);
    assert.equal(extractMeetLink('sala xyz-uvwx-rst').url, 'https://meet.google.com/xyz-uvwx-rst');
  });
  test('gatilho do run_meet_check', () => {
    assert.equal(meetCheckTrigger('https://meet.google.com/abc-defg-hij', getMachine('LAB-PJE-001')).motivo, 'link_meet');
    assert.equal(meetCheckTrigger('a audiência vai começar', getMachine('LAB-PJE-001')).motivo, 'mencao_audiencia');
    assert.equal(meetCheckTrigger('a impressora travou', getMachine('LAB-PJE-004')).motivo, 'estacao_sala_audiencia');
    assert.equal(meetCheckTrigger('a impressora travou', getMachine('LAB-PJE-001')), null);
  });
  test('só ferramentas ativas vão para a LLM; planejadas ficam registradas', () => {
    assert.deepEqual(openAiToolDefinitions().map((t) => t.function.name).sort(), ['escalate_glpi_ticket', 'run_meet_check', 'search_precedents']);
    assert.ok(listTools().some((t) => t.name === 'check_spooler' && t.status === 'planejada'));
  });
  test('valida argumentos e nunca lança ao executar', async () => {
    assert.throws(() => validateArguments(getTool('escalate_glpi_ticket'), { machineId: 'X' }), /obrigatório/);
    assert.throws(() => validateArguments(getTool('escalate_glpi_ticket'), { machineId: 'X', category: 'A', queue: 'B', priority: 'URGENTE', title: 't', technicalSummary: 's' }), /inválido/);
    assert.equal((await executeTool('check_spooler', {}, {})).status, 'erro');
    assert.equal((await executeTool('nao_existe', {}, {})).status, 'erro');
  });
});

describe('cliente LLM plugável', () => {
  test('placeholder de chave não conta como configurado; Ollama e rede interna dispensam chave', () => {
    assert.equal(resolveLlmConfig({}, { COPILOT_LLM_BASE_URL: 'https://openrouter.ai/api/v1', COPILOT_LLM_API_KEY: 'sua-chave-aqui' }).configured, false);
    assert.equal(resolveLlmConfig({}, { COPILOT_LLM_PROVIDER: 'ollama' }).configured, true);
    assert.equal(resolveLlmConfig({}, { COPILOT_LLM_BASE_URL: 'http://10.2.3.4:8000/v1' }).configured, true);
    assert.equal(resolveLlmConfig({ provider: 'rules' }, {}).configured, false);
  });
  test('describeEngine nunca expõe a chave', () => {
    const engine = describeEngine(resolveLlmConfig({ provider: 'groq', apiKey: 'gsk_segredo' }, {}));
    assert.ok(!JSON.stringify(engine).includes('gsk_segredo'));
    assert.equal(engine.hasApiKey, true);
  });
  test('parser de <tool_call> do Hermes', () => {
    const { calls, text } = parseHermesToolCalls('Vou testar.\n<tool_call>\n{"name": "run_meet_check", "arguments": {"machineId": "LAB-PJE-004"}}\n</tool_call>\n<tool_call>{"name":"search_precedents","arguments":"{\\"query\\":\\"microfone\\"}"}</tool_call><tool_call>{quebrado</tool_call>');
    assert.deepEqual(calls.map((c) => c.name), ['run_meet_check', 'search_precedents']);
    assert.equal(calls[1].arguments.query, 'microfone');
    assert.equal(text, 'Vou testar.');
  });
});

describe('motor de regras (fallback sem LLM)', () => {
  test('audiência em andamento: crítica, fila de hardware, cartão do Meet e passos do Windows', async () => {
    const [t] = await conversation('LAB-PJE-004', ['Estamos no meio da audiência pelo Google Meet https://meet.google.com/abc-defg-hij e ninguém nos ouve, o microfone do Jabra não capta a voz']);
    assert.equal(t.turn.engine.mode, 'regras');
    assert.equal(t.turn.triage.prioridade, 'CRITICAL');
    assert.equal(t.turn.triage.fila, 'SUPORTE_HARDWARE');
    assert.equal(t.turn.triage.filaGlpiId, 3);
    assert.equal(t.turn.tools[0].tool, 'run_meet_check');
    assert.equal(t.turn.solution.familiaSo, 'windows');
    assert.match(t.turn.reply, /Identifiquei que na estação \*\*LAB-PJE-004\*\*/);
    assert.equal(t.request.priority, 'CRITICAL');
  });

  test('"não funcionou" oferece outro caminho e depois recomenda o chamado', async () => {
    const turns = await conversation('LAB-PJE-002', ["Não foi possível conectar ao PJeOffice ao assinar no PJe", 'não funcionou', 'continua igual', 'ainda não resolveu', 'nada mudou']);
    const ids = turns.map((t) => t.turn.solution?.procedimentoId || null);
    assert.equal(ids[0], 'pjeoffice-conexao');
    assert.equal(new Set(ids.filter(Boolean)).size, ids.filter(Boolean).length, 'não repete procedimento');
    assert.equal(turns.at(-1).turn.solution, null);
    assert.equal(turns.at(-1).turn.sugerirEscalacao, true);
  });

  test('saudação pede detalhes; "funcionou" orienta a registrar; fora do escopo não inventa solução', async () => {
    const [hi] = await conversation('LAB-PJE-001', ['oi']);
    assert.equal(hi.turn.triage, null);
    assert.equal(hi.request, null);
    const [, ok] = await conversation('LAB-PJE-001', ['minha senha expirou e a conta bloqueou', 'funcionou, obrigado']);
    assert.match(ok.turn.reply, /Consegui resolver/);
    const [legal] = await conversation('LAB-PJE-001', ['qual o prazo para recurso de apelação?']);
    assert.equal(legal.turn.solution, null);
    assert.equal(legal.turn.triage.escopo, false);
  });

  test('Ubuntu nunca recebe passos de Windows', async () => {
    const [t] = await conversation('LAB-PJE-005', ['o PJeOffice não sobe na porta 8800 depois da atualização do Java']);
    assert.equal(t.turn.solution.procedimentoId, 'pjeoffice-conexao-linux');
    assert.ok(!/Win \+ R|services\.msc|Painel de Controle/.test(JSON.stringify(t.turn.solution)));
  });
});

describe('laudo do run_meet_check', () => {
  const report = (over = {}) => sanitizeMeetReport({
    schema: 'pulso-meet-check-1', runId: 'MEET-1', sala: { url: 'https://meet.google.com/abc-defg-hij', codigo: 'abc-defg-hij', codigoPadrao: true },
    navegador: { contextoSeguro: true, permissoes: { camera: 'granted', microfone: 'granted' } },
    microfone: { status: 'ok', picoPct: 60 }, camera: { status: 'ok' }, rede: { status: 'ok', latenciaMs: 8, perdaPct: 0 },
    zabbix: { simulado: true, status: 'OPTIMAL', latenciaMs: 20, perdaPct: 0 }, veredito: 'PRONTA', ...over,
  });
  test('schema desconhecido é rejeitado', () => assert.throws(() => sanitizeMeetReport({ schema: 'x' })));
  test('cada falha aponta a correção da base', () => {
    assert.equal(assessMeetReport(report()).veredito, 'PRONTA');
    const denied = assessMeetReport(report({ microfone: { status: 'negado' }, navegador: { contextoSeguro: true, permissoes: { camera: 'granted', microfone: 'denied' } } }));
    assert.equal(denied.veredito, 'BLOQUEADA');
    assert.equal(denied.falhas[0].correcao.procedureId, 'meet-permissao');
    assert.equal(assessMeetReport(report({ microfone: { status: 'mudo', picoPct: 1 } })).falhas[0].correcao.procedureId, 'meet-microfone');
    assert.equal(assessMeetReport(report({ camera: { status: 'ocupado' } })).falhas[0].correcao.procedureId, 'meet-camera');
    assert.equal(assessMeetReport(report({ rede: { status: 'degradada', latenciaMs: 220, perdaPct: 9 } })).falhas[0].correcao.procedureId, 'meet-conexao');
  });
  test('o servidor recalcula o veredito em vez de confiar no navegador', async () => {
    const [, t] = await (async () => {
      let state = {};
      const out = [];
      for (const input of [{ message: 'audiência agora pelo Meet e ninguém nos ouve' }, { meetReport: report({ microfone: { status: 'ausente' }, veredito: 'PRONTA' }) }]) {
        const r = await runCopilotTurn({ state, machine: getMachine('LAB-PJE-004'), triageConfig, llmConfig: rulesOnly, ...input });
        state = r.state;
        out.push(r);
      }
      return out;
    })();
    assert.equal(t.turn.tools[0].laudo.veredito, 'BLOQUEADA');
  });
});

describe('escalação para o GLPI', () => {
  test('título e corpo seguem o PASSO 6', async () => {
    const turns = await conversation('LAB-PJE-013', ['o computador não liga depois da queda de energia, nenhuma luz acende']);
    const session = { id: 'COP-12345678', machineDetection: 'seletor', state: turns.at(-1).state };
    const machine = getMachine('LAB-PJE-013');
    const request = { id: 'REQ-1', provider: 'local_rules', triage_status: 'NEEDS_REVIEW', corrected_decision: null };
    assert.equal(buildTicketTitle(session, machine), '[Distribuição] Computador Não Liga Após Queda de Energia - Estação LAB-PJE-013');
    const sections = buildTicketSections({ session, machine, request, decision: turns.at(-1).request.decision, priority: 'LOW', queue: 'SUPORTE_HARDWARE', queueCategoryId: 3, user: { displayName: 'Teste', email: 't@t' } });
    const text = JSON.stringify(sections);
    for (const piece of ['Patrimônio: DEMO-PAT-013', 'Serial: DEMO-PJE-SN-013', 'HP ProDesk 600 G6', 'Windows 11', 'IP 192.0.2.23', 'SUPORTE_HARDWARE / ID 3', 'Prioridade calculada', 'PROCEDIMENTOS JÁ TENTADOS'])
      assert.ok(text.includes(piece), piece);
    assert.ok(!sectionsToHtml([{ titulo: '<b>', linhas: ['<script>x</script>'] }]).includes('<script>'));
  });
});

describe('Markdown seguro no navegador', () => {
  test('escapa HTML e só cria links http(s)', () => {
    const html = renderMarkdown('**ok** `cmd` <script>alert(1)</script> [x](javascript:alert(1)) [y](https://tjpa.jus.br)');
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('href="javascript'));
    assert.ok(html.includes('<strong>ok</strong>') && html.includes('<code>cmd</code>'));
    assert.ok(html.includes('href="https://tjpa.jus.br"'));
  });
  test('não transforma caminho com asteriscos em itálico', () => {
    assert.ok(!renderMarkdown('apague Printers\\*.* e reinicie').includes('<em>'));
  });
});

describe('agente com LLM (tool calling) contra um endpoint falso', () => {
  let server;
  let url;
  const calls = [];
  let mode = 'native';
  before(async () => {
    server = http.createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const payload = JSON.parse(body);
      calls.push(payload);
      // O prompt de sistema do modo Hermes explica o <tool_response>; só contam as mensagens seguintes.
      const hasToolResult = payload.messages.slice(1).some((m) => m.role === 'tool' || /<tool_response>/.test(m.content || ''));
      let message;
      if (mode === 'down') {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end('{"error":{"message":"falha simulada"}}');
      }
      if (!hasToolResult && mode === 'native')
        message = { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'search_precedents', arguments: JSON.stringify({ query: 'PJeOffice porta 8800' }) } }] };
      else if (!hasToolResult && mode === 'hermes')
        message = { role: 'assistant', content: '<tool_call>\n{"name": "search_precedents", "arguments": {"query": "PJeOffice porta 8800"}}\n</tool_call>' };
      else
        message = { role: 'assistant', content: 'Identifiquei que na estação LAB-PJE-007 (Gabinete) ocorreu a mesma falha ao assinar e foi resolvido reiniciando o PJeOffice.\n\n### Passo a passo\n1. Feche o PJeOffice pelo ícone perto do relógio.\n2. Abra o PJeOffice Pro pelo menu Iniciar.\n3. Recarregue o PJe com `Ctrl + F5`.\n\nFuncionou?' };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ model: 'hermes-falso', choices: [{ index: 0, message, finish_reason: 'stop' }] }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/v1`;
  });
  after(() => server.close());

  for (const toolMode of ['native', 'hermes']) {
    test(`laço de ferramentas no formato ${toolMode}`, async () => {
      mode = toolMode;
      calls.length = 0;
      const llm = resolveLlmConfig({ provider: toolMode === 'hermes' ? 'hermes' : 'openai_compatible', baseUrl: url, model: 'hermes-falso', apiKey: 'x', toolMode }, {});
      const [t] = await conversation('LAB-PJE-002', ["Não foi possível conectar ao PJeOffice ao assinar"], llm);
      assert.equal(t.turn.engine.mode, 'llm');
      assert.deepEqual(t.turn.engine.ferramentas, ['search_precedents']);
      assert.equal(t.turn.solution.origem, 'llm');
      assert.equal(t.turn.solution.passos.length, 3);
      assert.ok(!t.turn.reply.includes('### Passo a passo'));
      assert.equal(calls.length, 2);
      if (toolMode === 'native') assert.ok(calls[0].tools?.length === 3);
      else {
        assert.equal(calls[0].tools, undefined);
        assert.match(calls[0].messages[0].content, /<tools>/);
      }
      assert.match(calls[0].messages[0].content, /LAB-PJE-002/);
      assert.match(calls[0].messages[0].content, /TRIAGEM DO LAYA/);
    });
  }

  test('LLM fora do ar: fallback para o motor de regras (ou erro, se desligado)', async () => {
    mode = 'down';
    const llm = resolveLlmConfig({ baseUrl: url, model: 'x', apiKey: 'x', fallbackRules: true }, {});
    const [t] = await conversation('LAB-PJE-002', ['Não foi possível conectar ao PJeOffice'], llm);
    assert.equal(t.turn.engine.mode, 'regras');
    assert.equal(t.turn.engine.fallback, true);
    const strict = resolveLlmConfig({ baseUrl: url, model: 'x', apiKey: 'x', fallbackRules: false }, {});
    await assert.rejects(conversation('LAB-PJE-002', ['Não foi possível conectar ao PJeOffice'], strict));
  });

  test('chatCompletion lê <tool_call> mesmo quando o servidor ignora `tools`', async () => {
    mode = 'hermes';
    const llm = resolveLlmConfig({ baseUrl: url, model: 'x', apiKey: 'x', toolMode: 'native' }, {});
    const result = await chatCompletion(llm, { messages: [{ role: 'user', content: 'oi' }], tools: openAiToolDefinitions() });
    assert.equal(result.toolCalls[0].name, 'search_precedents');
  });
});

describe('intenção e extração de passos', () => {
  test('detectIntent', () => {
    assert.equal(detectIntent('não funcionou'), 'negativo');
    assert.equal(detectIntent('funcionou, obrigado'), 'positivo');
    assert.equal(detectIntent('bom dia'), 'saudacao');
    assert.equal(detectIntent('o PJe não abre'), 'informacao');
  });
  test('extractStepsFromReply mantém blocos de código no passo', () => {
    const r = extractStepsFromReply('Oi\n\n### Passo a passo\n1. A\n2. B\n   ```cmd\n   ipconfig /flushdns\n   ```\n3. C\n\nFuncionou?');
    assert.equal(r.steps.length, 3);
    assert.equal(r.steps[1].codigo.conteudo, 'ipconfig /flushdns');
    assert.equal(r.text, 'Oi\n\nFuncionou?');
  });
});
