/**
 * Tool Registry do Copilot Nível 1.
 *
 * Cada ferramenta declara nome, descrição e parâmetros (JSON Schema, o mesmo formato
 * aceito pelo `tools` do OpenAI Chat Completions e pelo bloco <tools> do Hermes),
 * onde executa ("servidor" ou "navegador"), um gatilho determinístico `when()` — usado
 * pelo motor de regras e como rede de segurança quando a LLM não chama a ferramenta —
 * e `run()`. Ferramentas com status "planejada" ficam registradas (extensibilidade),
 * mas não são oferecidas à LLM até ganharem implementação.
 *
 * Para plugar uma ferramenta nova: registerTool({ name, description, parameters,
 * execution, status: 'ativa', when, run, summarize }).
 */
import { randomUUID } from 'node:crypto';
import { searchPrecedents } from './data-loader.js';
import { hasTerm, normalize } from './text.js';

const registry = new Map();

export function registerTool(tool) {
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(tool?.name || '')) throw new Error('Nome de ferramenta inválido.');
  if (!tool.description || !tool.parameters || tool.parameters.type !== 'object')
    throw new Error(`A ferramenta ${tool.name} precisa de descrição e parâmetros (JSON Schema de objeto).`);
  if (!['ativa', 'planejada'].includes(tool.status)) throw new Error(`Status inválido para ${tool.name}.`);
  if (tool.status === 'ativa' && typeof tool.run !== 'function') throw new Error(`A ferramenta ativa ${tool.name} precisa implementar run().`);
  registry.set(tool.name, Object.freeze({ execution: 'servidor', when: () => null, summarize: (r) => JSON.stringify(r), ...tool }));
  return registry.get(tool.name);
}

export function getTool(name) {
  return registry.get(name) || null;
}

/** Ferramentas registradas (para listagem/diagnóstico), sem funções. */
export function listTools() {
  return [...registry.values()].map(({ name, description, parameters, execution, status, category }) => ({ name, description, parameters, execution, status, category: category || null }));
}

/** Definições no formato OpenAI `tools` (somente ferramentas ativas). */
export function openAiToolDefinitions() {
  return [...registry.values()]
    .filter((tool) => tool.status === 'ativa')
    .map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
}

/** Validação mínima de argumentos contra o JSON Schema declarado (tipos, required, enum, tamanho). */
export function validateArguments(tool, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Os argumentos devem ser um objeto JSON.');
  const schema = tool.parameters;
  for (const key of schema.required || []) {
    if (args[key] === undefined || args[key] === null || args[key] === '') throw new Error(`Parâmetro obrigatório ausente: ${key}.`);
  }
  const clean = {};
  for (const [key, spec] of Object.entries(schema.properties || {})) {
    if (args[key] === undefined || args[key] === null) continue;
    let value = args[key];
    if (spec.type === 'string') {
      if (typeof value !== 'string') value = String(value);
      value = value.slice(0, spec.maxLength || 2000);
      if (spec.enum && !spec.enum.includes(value)) throw new Error(`Valor inválido para ${key}.`);
    } else if (spec.type === 'number' || spec.type === 'integer') {
      value = Number(value);
      if (!Number.isFinite(value)) throw new Error(`Valor numérico inválido para ${key}.`);
    } else if (spec.type === 'boolean') value = value === true || value === 'true';
    clean[key] = value;
  }
  return clean;
}

/**
 * Executa uma ferramenta pedida pela LLM (ou pelo motor de regras). Nunca lança: erros
 * voltam como resultado `{ status: 'erro' }`, que é devolvido ao modelo.
 */
export async function executeTool(name, rawArgs, context) {
  const tool = getTool(name);
  if (!tool) return { tool: name, status: 'erro', erro: `Ferramenta desconhecida: ${name}.` };
  if (tool.status !== 'ativa') return { tool: name, status: 'erro', erro: `A ferramenta ${name} está registrada como planejada e ainda não executa.` };
  let args;
  try {
    args = validateArguments(tool, rawArgs || {});
  } catch (error) {
    return { tool: name, status: 'erro', erro: error.message };
  }
  try {
    return { tool: name, ...(await tool.run(args, context)) };
  } catch (error) {
    return { tool: name, status: 'erro', erro: error.message || 'Falha ao executar a ferramenta.' };
  }
}

// ------------------------------------------------------- Google Meet / audiência --

const MEET_URL = /https?:\/\/meet\.google\.com\/(?:lookup\/)?([a-z0-9][a-z0-9-]{2,60})/i;
const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const HEARING_TERMS = ['google meet', 'meet', 'audiencia', 'audiencias', 'videoconferencia', 'video conferencia', 'depoimento', 'oitiva', 'sala virtual', 'sessao virtual', 'teleaudiencia'];

/** Link do Meet no texto (aceita apelidos; `codigoPadrao` indica o formato xxx-yyyy-zzz). */
export function extractMeetLink(text = '') {
  const match = String(text).match(MEET_URL);
  if (match) {
    const code = match[1].toLowerCase().replace(/[^a-z0-9-]/g, '');
    return { url: `https://meet.google.com/${code}`, codigo: code, codigoPadrao: MEET_CODE.test(code) };
  }
  const bare = String(text).match(/\b([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i);
  if (bare) {
    const code = bare[1].toLowerCase();
    return { url: `https://meet.google.com/${code}`, codigo: code, codigoPadrao: true };
  }
  return null;
}

/** Motivo para acionar o diagnóstico de audiência (catalogo-ferramentas.md + perfil-sala-audiencia.md). */
export function meetCheckTrigger(text, machine) {
  const link = extractMeetLink(text);
  if (link) return { motivo: 'link_meet', descricao: 'Link do Google Meet identificado na mensagem.', link };
  const normalized = normalize(text);
  const term = HEARING_TERMS.find((t) => hasTerm(normalized, t));
  if (term) return { motivo: 'mencao_audiencia', descricao: `A mensagem menciona "${term}".`, link: null };
  if (machine?.salaDeAudiencia)
    return { motivo: 'estacao_sala_audiencia', descricao: `${machine.id} é estação de sala de audiência (perfil: sempre acionar o diagnóstico).`, link: null };
  return null;
}

registerTool({
  name: 'run_meet_check',
  category: 'AUDIENCIA_MEET',
  status: 'ativa',
  execution: 'navegador',
  description:
    'Executa o diagnóstico de pré-audiência virtual no navegador do usuário: permissões WebRTC, captação do microfone, câmera, latência até o servidor central e telemetria de rede da comarca. Use quando houver link meet.google.com, menção a audiência/videoconferência/depoimento/oitiva ou queixa de áudio/vídeo em sala de audiência. O resultado (laudo) chega depois que o usuário clica no botão do cartão.',
  parameters: {
    type: 'object',
    properties: {
      meetUrl: { type: 'string', description: 'URL da sala do Google Meet informada pelo solicitante', maxLength: 300 },
      machineId: { type: 'string', description: 'Identificador da estação de trabalho (ex: LAB-PJE-004)', maxLength: 32 },
    },
    required: ['machineId'],
  },
  when: ({ text, machine }) => meetCheckTrigger(text, machine),
  async run(args, context) {
    const link = extractMeetLink(args.meetUrl || '') || extractMeetLink(context.text || '');
    return {
      status: 'aguardando_execucao',
      runId: `MEET-${randomUUID().slice(0, 8).toUpperCase()}`,
      meetUrl: link?.url || null,
      codigoSala: link?.codigo || null,
      codigoPadrao: link ? link.codigoPadrao : null,
      machineId: context.machine?.id || args.machineId,
      verificacoes: ['link da sala', 'microfone', 'câmera', 'latência até o servidor central', 'telemetria da comarca'],
      instrucao: 'Cartão exibido ao usuário com o botão "Executar Teste Rápido de Microfone & Câmera". Aguarde o laudo antes de concluir o diagnóstico.',
    };
  },
  summarize: (result) =>
    result.status === 'concluido'
      ? `Laudo do teste de audiência: ${result.laudo?.resumo || result.laudo?.overallStatus || 'recebido'}.`
      : `Diagnóstico de audiência preparado${result.meetUrl ? ` para ${result.meetUrl}` : ''}; aguardando o usuário executar o teste.`,
});

// ------------------------------------------------------------- precedentes --

registerTool({
  name: 'search_precedents',
  category: 'RAG_PRECEDENTES',
  status: 'ativa',
  execution: 'servidor',
  description:
    'Consulta o acervo histórico de chamados resolvidos do TJPA por similaridade para resgatar precedentes de suporte (mesma falha em outra estação/setor e como foi resolvida).',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Termos de busca ou sintomas relatados', maxLength: 1000 },
      category: { type: 'string', description: 'Categoria ITIL sugerida pelo Laya', maxLength: 40 },
      system: { type: 'string', description: 'Sistema alvo (ex: PJE, PRINTER, INTERNET)', maxLength: 40 },
    },
    required: ['query'],
  },
  async run(args, context) {
    const matches = searchPrecedents(args.query, args.category || null, { system: args.system || null, machine: context.machine, limit: 3 });
    return {
      status: 'concluido',
      total: matches.length,
      precedentes: matches.map((p) => ({
        id: p.id,
        titulo: p.titulo,
        estacao: `${p.estacao.nome} (${p.estacao.setor}, ${p.estacao.so})`,
        similaridade: `${p.similaridade}%`,
        resolucaoComprovada: p.padrao ? { causaRaiz: p.padrao.causaRaiz, passos: p.padrao.resolucao, taxaAutoatendimento: p.padrao.taxaAutoatendimento, fonte: p.padrao.fonte } : null,
        procedimentoDaBase: p.procedimento?.titulo || null,
      })),
    };
  },
  summarize: (result) => `${result.total || 0} precedente(s) encontrado(s): ${(result.precedentes || []).map((p) => p.id).join(', ') || 'nenhum'}.`,
});

// -------------------------------------------------------------- escalação --

registerTool({
  name: 'escalate_glpi_ticket',
  category: 'ITSM_GLPI',
  status: 'ativa',
  execution: 'servidor',
  description:
    'Prepara a escalação da demanda não resolvida para o GLPI 11 com inventário da estação, triagem do Laya e laudos. O chamado só é aberto depois que o usuário confirmar no botão "Abrir Chamado"; fila, prioridade e categoria finais são recalculadas pelo servidor.',
  parameters: {
    type: 'object',
    properties: {
      machineId: { type: 'string', description: 'Identificador da máquina (ex: LAB-PJE-004)', maxLength: 32 },
      category: { type: 'string', description: 'Categoria ITIL (ex: HARDWARE, SYSTEM)', maxLength: 40 },
      queue: { type: 'string', description: 'Fila GLPI (ex: SUPORTE_HARDWARE, SUPORTE_PJE)', maxLength: 64 },
      priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
      title: { type: 'string', description: 'Título resumido do chamado', maxLength: 160 },
      technicalSummary: { type: 'string', description: 'Relatório estruturado com laudo e testes executados', maxLength: 4000 },
    },
    required: ['machineId', 'category', 'queue', 'priority', 'title', 'technicalSummary'],
  },
  async run(args, context) {
    return {
      status: 'aguardando_confirmacao',
      titulo: args.title,
      resumoTecnico: args.technicalSummary,
      sugestaoDoModelo: { categoria: args.category, fila: args.queue, prioridade: args.priority },
      calculadoPeloServidor: { fila: context.triage?.fila || null, prioridade: context.triage?.prioridade || null },
      instrucao: 'Proposta exibida ao usuário. Informe que o chamado será aberto ao clicar em "Ainda preciso de ajuda / Abrir Chamado".',
    };
  },
  summarize: (result) => `Escalação proposta ao usuário: "${result.titulo || ''}" (aguardando confirmação).`,
});

// --------------------------------------------- extensões futuras (planejadas) --

for (const planned of [
  ['test_pjeoffice_socket', 'PJE_ASSINADOR', 'Verifica se o serviço local do PJeOffice responde em 127.0.0.1:8800 na estação do usuário.', { port: { type: 'integer', description: 'Porta local do PJeOffice (padrão 8800)' } }],
  ['check_spooler', 'IMPRESSAO', 'Consulta o estado do spooler/CUPS e a fila de impressão da estação via agente local.', { machineId: { type: 'string', description: 'Estação (ex: LAB-PJE-003)' } }],
  ['reset_printer_spooler', 'IMPRESSAO', 'Reinicia o spooler de impressão e limpa trabalhos travados (requer agente local com permissão).', { machineId: { type: 'string', description: 'Estação (ex: LAB-PJE-003)' } }],
  ['verify_cert', 'PJE_ASSINADOR', 'Valida a cadeia ICP-Brasil e a validade do certificado do token A3 conectado.', { machineId: { type: 'string', description: 'Estação' } }],
  ['diagnose_dns', 'REDE', 'Mede a resolução de pje.tjpa.jus.br nos DNS internos (10.1.1.10/11) a partir da estação.', { hostname: { type: 'string', description: 'Nome a resolver' } }],
]) {
  registerTool({
    name: planned[0],
    category: planned[1],
    status: 'planejada',
    execution: 'navegador',
    description: planned[2],
    parameters: { type: 'object', properties: planned[3] },
  });
}
