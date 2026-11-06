/**
 * Orquestrador do Copilot Nível 1 (o "Hermes Agent" que roda no servidor central).
 *
 * A cada mensagem:
 *   1. Laya classifica a conversa (Categoria ITIL, Sistema, Impacto, Urgência, Fila) e,
 *      em paralelo, o RAG busca precedentes nos chamados resolvidos;
 *   2. as regras operacionais do Hermes ajustam prioridade/fila (audiência, rede coletiva, hardware);
 *   3. a base procedural escolhe a resolução universal já no SO da estação;
 *   4. as ferramentas do Tool Registry são acionadas (run_meet_check etc.);
 *   5. a LLM plugável escreve a resposta com tool calling — ou, sem LLM/sem conexão,
 *      o motor de regras local responde com os mesmos dados (COPILOT_FALLBACK_RULES).
 *
 * Não acessa o banco: recebe o estado da sessão e devolve o turno + estado novo.
 */
import { classifyWithProvider } from '../decision-provider.js';
import { applyAutomationGate, calibrateDecision, fallbackClassification, statusForDescription } from '../triage.js';
import { getProcedure, searchKnowledge, searchPrecedents, stepsForOs } from './data-loader.js';
import { buildSystemPrompt, chatCompletion, effectiveToolMode, hermesToolsPrompt, LlmError, osLabel } from './llm-client.js';

export { buildSystemPrompt, osLabel };
import { assessMeetReport, meetReportLines } from './meet-report.js';
import { applyOperationalRules } from './policy.js';
import { normalize } from './text.js';
import { executeTool, getTool, meetCheckTrigger, openAiToolDefinitions } from './tools.js';

export const COPILOT_LIMITS = Object.freeze({ maxMessageChars: 2000, maxMessages: 60, maxToolRounds: 3, classificationChars: 1000, historyMessages: 12 });
const PRECEDENT_CITATION_MIN = 25;
const MAX_SELF_SERVICE_ATTEMPTS = 3;
const TOPIC_DISK = new Set(['estacao-lenta', 'disco-cheio', 'pje-lentidao', 'navegador-pdf']);
const TOPIC_RAM = new Set(['estacao-lenta', 'pje-lentidao', 'navegador-pdf']);

const levelPt = { LOW: 'baixa', MEDIUM: 'média', HIGH: 'alta', CRITICAL: 'crítica' };
const fmtNumber = (value) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);

// ------------------------------------------------------------- intenção --

export function detectIntent(message = '') {
  const text = normalize(message);
  if (!text) return 'vazio';
  if (/\b(nao|n|ainda nao|nada)\s+(funcionou|resolveu|deu certo|adiantou|mudou|consegui|voltou)\b|\b(continua|persiste|mesmo erro|mesma coisa|nao adiantou|piorou|ainda (esta|ta) (igual|com|travad|sem))\b/.test(text)) return 'negativo';
  if (/\b(funcionou|resolveu|resolvido|deu certo|consegui|tudo certo|voltou a funcionar|(ja )?(esta|ta) funcionando)\b/.test(text)) return 'positivo';
  if (text.length <= 40 && /^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa|tudo bem|preciso de ajuda|ajuda|socorro)\b/.test(text)) return 'saudacao';
  return 'informacao';
}

/** Texto enviado ao Laya: relatos do usuário (sem respostas de feedback), até 1000 caracteres. */
export function classificationText(state, message, intent) {
  const informative = (m) => (m.intent === 'informacao' || m.intent === 'laudo') && m.text && !m.text.startsWith('[');
  const reports = (state.messages || []).filter((m) => m.role === 'user' && informative(m)).map((m) => m.text);
  if (message && (intent === 'informacao' || intent === 'laudo')) reports.push(message);
  let text = reports.join(' \n');
  if (text.length > COPILOT_LIMITS.classificationChars) {
    const first = reports[0] || '';
    const rest = reports.slice(1).join(' \n');
    text = `${first.slice(0, 600)} \n${rest.slice(-(COPILOT_LIMITS.classificationChars - Math.min(600, first.length) - 3))}`.slice(0, COPILOT_LIMITS.classificationChars);
  }
  return text.trim();
}

// ----------------------------------------------------------- Laya + RAG --

async function classify(text, triageConfig) {
  const categories = Object.keys(triageConfig.questions.category.criteria);
  const systems = Object.keys(triageConfig.questions.system.criteria);
  let evaluated;
  let layaError = null;
  try {
    evaluated = await classifyWithProvider(text, triageConfig.questions, triageConfig);
  } catch (error) {
    // Laya indisponível não derruba o atendimento: cai no classificador local e registra o motivo.
    layaError = error.message;
    evaluated = fallbackClassification(text, triageConfig.calibrationRules, triageConfig.thresholds);
  }
  const calibrated = calibrateDecision(text, evaluated.decision, triageConfig.calibrationRules, categories, systems);
  const status = statusForDescription(text, calibrated, triageConfig.thresholds, triageConfig.calibrationRules);
  const gated = applyAutomationGate({ triageStatus: status }, triageConfig.automationApproved);
  return {
    provider: evaluated.provider || 'local_rules',
    rawDecision: evaluated.decision,
    decision: calibrated,
    triageStatus: gated.triageStatus,
    automationGate: gated.automationGate || null,
    modelChoices: evaluated.modelChoices || null,
    layaError,
  };
}

function triageView({ classification, policy, queueCategoryIds }) {
  const d = policy.decision;
  return {
    provedor: classification.provider,
    layaIndisponivel: classification.layaError,
    statusTriagem: classification.triageStatus,
    portaoAutomacao: classification.automationGate,
    categoria: d.category,
    sistema: d.system,
    impacto: d.impact,
    urgencia: d.urgency,
    prioridade: policy.priority,
    fila: policy.queue,
    filaGlpiId: queueCategoryIds?.[policy.queue] ? Number(queueCategoryIds[policy.queue]) : null,
    incidenteColetivo: d.possibleIncident === true,
    indisponibilidade: d.outage === true,
    atendimentoHumano: d.humanRequired === true,
    confianca: Number.isFinite(Number(d.confidence)) ? Math.round(Number(d.confidence) * 100) : null,
    escopo: d.isSupportRequest !== false,
    regrasAplicadas: policy.appliedRules,
    audiencia: policy.hearing.mencionada ? policy.hearing : null,
    escalarDireto: policy.escalarDireto,
  };
}

function precedentView(p) {
  return {
    id: p.id,
    titulo: p.titulo,
    relato: p.relato,
    estacao: p.estacao,
    classificacao: p.classificacao,
    similaridade: p.similaridade,
    termosEmComum: p.termosEmComum,
    resolucao: p.padrao
      ? { tipo: 'comprovada', causaRaiz: p.padrao.causaRaiz, passos: p.padrao.resolucao, taxaAutoatendimento: p.padrao.taxaAutoatendimento, fonte: p.padrao.fonte, padrao: p.padrao.titulo }
      : p.procedimento
        ? { tipo: 'procedimento', titulo: p.procedimento.titulo, fonte: p.procedimento.fonte }
        : null,
  };
}

function solutionFromProcedure(match, machine, { origem = 'base', escalarDireto = false } = {}) {
  if (!match) return null;
  return {
    origem,
    procedimentoId: match.procedure.id,
    titulo: match.procedure.titulo,
    diagnostico: match.procedure.diagnostico,
    so: osLabel(machine),
    familiaSo: machine.so.familia,
    passos: match.steps.map((step) => ({ texto: step.texto, codigo: step.codigo || null })),
    fonte: match.procedure.fonte,
    escalarDireto,
  };
}

function genericSolution(machine) {
  const procedure = getProcedure('roteiro-geral');
  const steps = procedure && stepsForOs(procedure, machine.so.familia);
  return steps ? solutionFromProcedure({ procedure, steps }, machine, { origem: 'roteiro' }) : null;
}

/** Observações automáticas a partir do inventário (consciência de hardware). */
export function hardwareHints(machine, procedure) {
  const hints = [];
  const group = procedure?.grupo || '';
  if (machine.disco.alerta)
    hints.push({ tipo: 'disco', texto: `O inventário mostra só **${fmtNumber(machine.disco.livreGib)} GB livres (${machine.disco.livrePct}%)** no disco desta estação${TOPIC_DISK.has(group) ? ' — isso pode estar ligado ao problema' : ''}.` });
  if (machine.memoriaGib <= 8 && TOPIC_RAM.has(group))
    hints.push({ tipo: 'memoria', texto: `Esta estação tem **${machine.memoriaGib} GB de RAM**: com muitas abas e autos volumosos abertos, a memória se esgota rápido.` });
  if (machine.rede.tipo === 'wifi' && /^(rede|meet-conexao|meet-)/.test(group))
    hints.push({ tipo: 'rede', texto: 'A estação está conectada por **Wi-Fi**; para audiências e quedas de conexão, o cabo de rede (RJ-45) é o caminho mais estável.' });
  if (/^(pjeoffice|pje-assinatura-lote)$/.test(group) && machine.softwares.some((s) => /pjeoffice/i.test(s)))
    hints.push({ tipo: 'software', texto: 'O inventário GLPI confirma o **PJeOffice Pro** instalado nesta estação.' });
  return hints;
}

// -------------------------------------------------------- motor de regras --

const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);
const firstSentence = (text = '') => (String(text).match(/^.+?[.!?](\s|$)/)?.[0] || String(text)).trim();


function precedentSentence(p, machine) {
  const where = `na estação **${p.estacao.nome}** (${p.estacao.setor})`;
  const osNote = p.estacao.familiaSo !== machine.so.familia ? `, que usa ${p.estacao.familiaSo === 'linux' ? 'Ubuntu' : 'Windows'},` : '';
  if (p.resolucao?.tipo === 'comprovada') {
    const steps = p.resolucao.passos.slice(0, 3).map((s) => lowerFirst(s.replace(/\.$/, ''))).join('; ');
    const rate = p.resolucao.taxaAutoatendimento ? ` (taxa de resolução em autoatendimento: ${p.resolucao.taxaAutoatendimento})` : '';
    return `📚 Identifiquei que ${where}${osNote} ocorreu uma falha semelhante — *"${p.titulo}"* (${p.id}) — e foi resolvido assim: ${steps}${rate}.`;
  }
  return `📚 Caso semelhante no histórico: ${where}${osNote} houve *"${p.titulo}"* (${p.id})${p.resolucao?.tipo === 'procedimento' ? '; o procedimento da base para esse sintoma é o mesmo que preparei abaixo' : ''}.`;
}

function hearingSentence(hearing) {
  if (hearing.status === 'em_andamento') return '⏱️ **Audiência em andamento** — tratei este atendimento como **prioridade crítica**.';
  if (hearing.status === 'iminente')
    return `⏱️ **Audiência ${hearing.minutos !== null ? `em ${hearing.minutos} min` : 'prestes a começar'}${hearing.horario ? ` (${hearing.horario})` : ''}** — tratei este atendimento como **prioridade crítica**.`;
  return null;
}

function meetReportReply(ctx) {
  const { meetReport, machine } = ctx;
  const lines = [];
  if (meetReport.veredito === 'PRONTA') {
    lines.push(`✅ **Laudo do teste de audiência:** câmera, microfone e rede aprovados na estação **${machine.id}**. A sala está pronta.`);
    lines.push('Para evitar eco, mantenha só **um** equipamento com microfone e som ligados na sala física (o viva-voz). Se algo mudar durante a sessão, me avise aqui.');
    return lines.join('\n\n');
  }
  lines.push(`${meetReport.veredito === 'BLOQUEADA' ? '🚫' : '⚠️'} **Laudo do teste de audiência (${meetReport.veredito === 'BLOQUEADA' ? 'impedimento' : 'atenção'}):**`);
  for (const falha of meetReport.falhas) lines.push(`- **${falha.item.charAt(0).toUpperCase() + falha.item.slice(1)}:** ${falha.problema}`);
  const first = meetReport.falhas.find((f) => f.correcao);
  if (first) lines.push(`Preparei abaixo a correção exata para **${first.correcao.titulo.toLowerCase()}**. Depois de aplicar, rode o teste de novo no cartão.`);
  if (ctx.policy.hearing.status === 'em_andamento' || ctx.policy.hearing.status === 'iminente')
    lines.push('Como a audiência é agora, se não resolver em 2 minutos, clique em **🎫 Ainda preciso de ajuda / Abrir Chamado** para acionamento prioritário.');
  return lines.join('\n\n');
}

export function rulesReply(ctx) {
  const { machine, intent, primary, firstTurn, policy, meetCard, precedent, hints, exhausted } = ctx;
  if (ctx.meetReport) return meetReportReply(ctx);
  const L = [];
  if (intent === 'saudacao' && !primary) {
    L.push(`Olá! Sou o Copilot de TIC do Tribunal. Já carreguei a ficha da sua estação **${machine.id}** (${machine.fabricante} ${machine.modelo} · ${machine.so.curto} · ${machine.setor}).`);
    L.push('Me conte o que está acontecendo: qual sistema ou equipamento, a mensagem que aparece e desde quando.');
    return L.join('\n\n');
  }
  if (intent === 'positivo') {
    L.push('Que ótimo! Clique em **✅ Consegui resolver!** para registrar o autoatendimento e avaliar este atendimento.');
    return L.join('\n\n');
  }
  if (firstTurn)
    L.push(`Olá! Já carreguei a ficha da sua estação **${machine.id}** — ${machine.fabricante} ${machine.modelo} com **${osLabel(machine)}**, ${machine.setor} (${machine.unidade}).`);
  const hearing = hearingSentence(policy.hearing);
  if (hearing && (firstTurn || ctx.hearingChanged)) L.push(hearing);
  const meetPending = ctx.meetState?.status === 'aguardando_execucao';
  if (intent === 'negativo') {
    if (meetPending && !ctx.meetCard)
      L.push('Antes de seguir, rode o **Teste Rápido de Microfone & Câmera** no cartão de diagnóstico acima: o laudo mostra na hora se é permissão do navegador, microfone mudo, câmera ocupada ou rede.');
    if (primary && !exhausted) L.push(`${meetPending ? 'Enquanto isso, tente' : 'Entendi que ainda não resolveu. Vamos para'} o próximo caminho: **${primary.procedure.titulo}**.`);
    else {
      L.push(`${meetPending ? 'Se mesmo assim' : 'Entendi que ainda não resolveu.'} ${meetPending ? 'não resolver, os' : 'Os'} procedimentos de autoatendimento para este caso já foram apresentados.`);
      L.push(`Recomendo abrir o chamado: clique em **🎫 Ainda preciso de ajuda / Abrir Chamado** e eu envio ao GLPI o patrimônio **${machine.patrimonio}**, a triagem e tudo o que já foi testado (fila **${policy.queue}**, prioridade **${levelPt[policy.priority]}**).`);
      return L.join('\n\n');
    }
  } else if (primary && ctx.samePrimary) {
    L.push(`Registrei essa informação no atendimento. O procedimento indicado continua sendo **${primary.procedure.titulo}** (passos acima).`);
    L.push('Se você já testou e não resolveu, me diga **"não funcionou"** que eu sigo para o próximo caminho — ou clique em **🎫 Ainda preciso de ajuda / Abrir Chamado**.');
    return L.join('\n\n');
  } else if (primary) {
    L.push(`Pelo seu relato, o caso se encaixa em **${primary.procedure.titulo}**. ${firstSentence(primary.procedure.diagnostico)}`);
  } else if (ctx.triage && ctx.triage.escopo === false) {
    L.push('Pelo que entendi, isso não parece um problema de tecnologia (sistemas, equipamentos, rede, impressão ou acesso) — dúvidas jurídicas ou processuais são tratadas pela secretaria da vara.');
    L.push('Se for um problema técnico, me diga qual sistema ou equipamento está envolvido e a mensagem que aparece.');
    return L.join('\n\n');
  } else {
    L.push(`Ainda não consegui identificar o tipo exato do problema. Preparei abaixo um roteiro geral de verificação para ${machine.so.curto}. Se puder, me diga a mensagem de erro exata ou o que mudou desde a última vez que funcionou.`);
  }
  if (precedent) L.push(precedentSentence(precedent, machine));
  for (const hint of hints) L.push(`💡 ${hint.texto}`);
  if (meetCard) {
    const why = meetCard.motivo === 'estacao_sala_audiencia' ? 'esta é uma estação de sala de audiência' : 'o atendimento envolve audiência virtual';
    L.push(`🎥 Como ${why}, acionei a ferramenta **run_meet_check**: clique em **Executar Teste Rápido de Microfone & Câmera** no cartão abaixo${meetCard.meetUrl ? ` (sala ${meetCard.meetUrl})` : ''} para testar câmera, microfone e rede agora.`);
  }
  if (policy.appliedRules.some((r) => r.regra === 'incidente_coletivo_rede'))
    L.push(`📡 Como outras pessoas também foram afetadas, sinalizei **possível incidente coletivo de rede** (fila **${policy.queue}**).`);
  if (policy.escalarDireto)
    L.push(`🛠️ Por ser falha física de hardware, se o passo a passo não resolver, **abra o chamado** — a equipe de hardware recebe o patrimônio **${machine.patrimonio}** e o modelo ${machine.fabricante} ${machine.modelo} automaticamente.`);
  if (ctx.solution) L.push(`O passo a passo abaixo já está adaptado para **${machine.so.curto}**. Teste e me diga: funcionou?`);
  return L.join('\n\n');
}

/** Separa "### Passo a passo" (ou a primeira lista numerada) do restante da resposta da LLM. */
export function extractStepsFromReply(text = '') {
  const lines = String(text).split(/\r?\n/);
  let start = lines.findIndex((l) => /^#{2,4}\s*.*passo/i.test(l.trim()));
  let listStart = -1;
  const from = start >= 0 ? start + 1 : 0;
  for (let i = from; i < lines.length; i++) if (/^\s{0,3}\d+[.)]\s+/.test(lines[i])) { listStart = i; break; }
  if (listStart < 0) return { text: String(text).trim(), steps: [] };
  if (start < 0) start = listStart;
  const steps = [];
  let i = listStart;
  let fence = null;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (fence) {
      if (/^\s*```\s*$/.test(line)) { steps.at(-1).codigo = { linguagem: fence.lang, conteudo: fence.lines.join('\n') }; fence = null; }
      else fence.lines.push(line.replace(/^\s{0,6}/, ''));
      continue;
    }
    const item = line.match(/^\s{0,3}\d+[.)]\s+(.*)$/);
    if (item) { steps.push({ texto: item[1].trim(), codigo: null }); continue; }
    const open = line.match(/^\s*```\s*([\w-]*)\s*$/);
    if (open && steps.length) { fence = { lang: open[1] || '', lines: [] }; continue; }
    if (!line.trim()) { if (/^\s{0,3}\d+[.)]\s+/.test(lines[i + 1] || '') || /^\s{2,}\S/.test(lines[i + 1] || '')) continue; break; }
    if (/^\s{2,}\S/.test(line) && steps.length) { steps.at(-1).texto += ` ${line.trim()}`; continue; }
    break;
  }
  if (steps.length < 2) return { text: String(text).trim(), steps: [] };
  const rest = [...lines.slice(0, start), ...lines.slice(i)].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: rest, steps };
}

function historyForLlm(state) {
  return (state.llmHistory || []).slice(-COPILOT_LIMITS.historyMessages).map((m) => ({ role: m.role, content: m.content }));
}

async function runLlm(ctx, config) {
  const definitions = openAiToolDefinitions();
  const events = [];
  let mode = effectiveToolMode(config);
  for (let attempt = 0; attempt < 2; attempt++) {
    const system = buildSystemPrompt(ctx, { hermesTools: mode === 'hermes' ? hermesToolsPrompt(definitions) : null });
    const userContent = ctx.meetReport
      ? `${ctx.message ? `${ctx.message}\n\n` : ''}${mode === 'hermes' ? '<tool_response>\n' : ''}${JSON.stringify({ name: 'run_meet_check', content: { veredito: ctx.meetReport.veredito, resumo: ctx.meetReport.resumo, falhas: ctx.meetReport.falhas.map((f) => ({ item: f.item, problema: f.problema })), laudo: meetReportLines(ctx.meetReport) } })}${mode === 'hermes' ? '\n</tool_response>' : ''}`
      : ctx.message;
    const messages = [{ role: 'system', content: system }, ...historyForLlm(ctx.state), { role: 'user', content: userContent }];
    try {
      let rounds = 0;
      let result;
      for (;;) {
        rounds++;
        const lastRound = rounds > COPILOT_LIMITS.maxToolRounds;
        result = await chatCompletion(config, { messages, tools: lastRound ? [] : definitions });
        if (!result.toolCalls.length || lastRound) break;
        const native = result.toolCallFormat === 'native';
        messages.push(native
          ? { role: 'assistant', content: result.assistantMessage.content ?? null, tool_calls: result.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) } })) }
          : { role: 'assistant', content: result.rawText });
        for (const call of result.toolCalls.slice(0, 4)) {
          const output = await executeTool(call.name, call.arguments, ctx);
          events.push({ name: call.name, arguments: call.arguments, output, origem: 'llm', formato: call.format });
          const payload = JSON.stringify(output).slice(0, 6000);
          messages.push(native
            ? { role: 'tool', tool_call_id: call.id, content: payload }
            : { role: 'user', content: `<tool_response>\n${JSON.stringify({ name: call.name, content: output }).slice(0, 6000)}\n</tool_response>` });
        }
        if (rounds === COPILOT_LIMITS.maxToolRounds) messages.push({ role: 'user', content: 'Responda agora ao usuário com base nos resultados acima, sem chamar novas ferramentas.' });
      }
      return { text: result.text, events, rounds, model: result.model, toolMode: mode, usage: result.usage };
    } catch (error) {
      if (error instanceof LlmError && error.kind === 'trocar_para_hermes' && attempt === 0) {
        mode = 'hermes';
        continue;
      }
      throw error;
    }
  }
  throw new LlmError('Não foi possível obter resposta da LLM.');
}

// ---------------------------------------------------------------- turno --

/**
 * Processa uma mensagem (ou um laudo do run_meet_check) e devolve { turn, state, request }.
 * `request` traz o que deve ser gravado na tabela requests (sessions.js persiste).
 */
export async function runCopilotTurn({ state, machine, message = '', meetReport = null, triageConfig, queueCategoryIds = {}, llmConfig, now = new Date() }) {
  const intent = meetReport ? 'laudo' : detectIntent(message);
  const nextState = structuredClone(state);
  nextState.messages = nextState.messages || [];
  nextState.attemptedProcedures = nextState.attemptedProcedures || [];
  nextState.tools = nextState.tools || {};
  const firstTurn = !nextState.messages.some((m) => m.role === 'assistant');
  const text = classificationText(nextState, message, intent);
  const conversationText = [text, ...(nextState.messages || []).filter((m) => m.role === 'user').map((m) => m.text), message].join(' \n');

  // Laudo do run_meet_check: avaliado antes, porque as falhas detectadas orientam o RAG.
  const assessedReport = meetReport ? { ...meetReport, ...assessMeetReport(meetReport, machine.so.familia) } : null;

  // 1. Laya (assíncrono) em paralelo com o RAG de precedentes (síncrono, roda enquanto o Laya responde).
  const hasReport = text.length >= 8;
  const classificationPromise = hasReport ? classify(text, triageConfig) : Promise.resolve(null);
  // No laudo, as falhas detectadas pesam mais que o texto genérico ("teste", "Meet").
  const failures = assessedReport?.falhas?.map((f) => f.problema).join(' ') || '';
  const precedentQuery = failures ? `${text} ${failures} ${failures}` : text;
  const symptomIds = assessedReport
    ? assessedReport.falhas.map((f) => f.correcao?.procedureId).filter(Boolean)
    : hasReport ? searchKnowledge(text, { machine, limit: 1 }).map((k) => k.procedure.id) : [];
  const rawPrecedents = hasReport ? searchPrecedents(precedentQuery, null, { machine, limit: 3, minSimilarity: 0.22, procedureIds: symptomIds }) : [];
  const classification = await classificationPromise;

  // 2. Base procedural no SO da estação (evita repetir o que já foi tentado quando o usuário diz que não resolveu).
  const decisionForSearch = classification?.decision || null;
  const exclude = intent === 'negativo' ? nextState.attemptedProcedures : [];
  const tooManyAttempts = intent === 'negativo' && nextState.attemptedProcedures.length >= MAX_SELF_SERVICE_ATTEMPTS;
  let knowledge = hasReport && !tooManyAttempts ? searchKnowledge(text, { machine, decision: decisionForSearch, limit: 2, exclude }) : [];
  const exhausted = intent === 'negativo' && hasReport && !knowledge.length;
  if (meetReport) knowledge = [];
  // Para as regras, o sintoma de referência é o melhor da conversa inteira (mesmo que já tentado).
  const reference = hasReport ? searchKnowledge(text, { machine, decision: decisionForSearch, limit: 1 })[0] || null : null;

  // 3. Regras operacionais sobre a triagem.
  const policy = classification
    ? applyOperationalRules({ decision: classification.decision, text, machine, procedure: reference?.procedure || getProcedure(nextState.lastProcedureId), procedureScore: reference?.score || 0, triageStatus: classification.triageStatus, triageConfig, now })
    : null;
  if (classification && policy?.statusOverride) classification.triageStatus = policy.statusOverride;
  const triage = classification && policy ? triageView({ classification, policy, queueCategoryIds }) : null;
  const precedents = rawPrecedents.map(precedentView);
  const primary = knowledge[0] || null;
  // Cita no texto só um precedente novo, de padrão ainda não citado e ligado ao mesmo sintoma.
  const citedBefore = new Set(nextState.citedPrecedents || []);
  const citedPatterns = new Set(nextState.citedPatterns || []);
  const groupOf = (id) => getProcedure(id)?.grupo || null;
  const precedent = intent === 'informacao'
    ? precedents.find((p) => p.similaridade >= PRECEDENT_CITATION_MIN && !citedBefore.has(p.id)
        && !(p.resolucao?.padrao && citedPatterns.has(p.resolucao.padrao))
        && (p.resolucao?.tipo === 'comprovada' || (primary && groupOf(rawPrecedents.find((r) => r.id === p.id)?.procedimento?.id) === primary.procedure.grupo))) || null
    : null;
  const samePrimary = Boolean(primary && !firstTurn && intent === 'informacao' && primary.procedure.id === state.lastProcedureId);
  const shownHints = new Set(nextState.hintsShown || []);
  const hints = hardwareHints(machine, primary?.procedure).filter((h) => !shownHints.has(h.texto));
  nextState.hintsShown = [...shownHints, ...hints.map((h) => h.texto)];

  // 4. Ferramentas: laudo recebido ou gatilho determinístico do run_meet_check.
  const toolCards = [];
  if (assessedReport) {
    nextState.tools.meet = { ...(nextState.tools.meet || {}), status: 'concluido', runId: meetReport.runId || nextState.tools.meet?.runId || null, laudo: assessedReport, concluidoEm: now.toISOString() };
    toolCards.push({ tool: 'run_meet_check', status: 'concluido', runId: nextState.tools.meet.runId, meetUrl: assessedReport.sala.url || nextState.tools.meet.meetUrl || null, laudo: assessedReport });
  }
  const trigger = !meetReport && !['positivo', 'saudacao', 'vazio'].includes(intent) ? meetCheckTrigger(conversationText, machine) : null;
  const meetPending = nextState.tools.meet?.status === 'aguardando_execucao';
  const newLink = trigger?.link?.url && trigger.link.url !== nextState.tools.meet?.meetUrl;
  const hearingChanged = Boolean(policy && ['em_andamento', 'iminente'].includes(policy.hearing.status) && !(nextState.urgentHearingNoticed));
  if (hearingChanged) nextState.urgentHearingNoticed = true;
  const ctx = {
    state: nextState, machine, message, text, intent, firstTurn, triage, policy: policy || emptyPolicy(), precedents, precedent, knowledge, primary,
    hints, exhausted, samePrimary, meetReport: assessedReport, meetState: nextState.tools.meet || null, meetCard: null, hearingChanged,
  };
  if (trigger && (!nextState.tools.meet || newLink || (nextState.tools.meet.status === 'concluido' && intent === 'negativo'))) {
    const output = await executeTool('run_meet_check', { machineId: machine.id, meetUrl: trigger.link?.url || '' }, ctx);
    if (output.status === 'aguardando_execucao') {
      nextState.tools.meet = { status: output.status, runId: output.runId, meetUrl: output.meetUrl, codigoPadrao: output.codigoPadrao, motivo: trigger.motivo, criadoEm: now.toISOString() };
      ctx.meetCard = { ...output, motivo: trigger.motivo, descricaoMotivo: trigger.descricao, origem: 'regra' };
      ctx.meetState = nextState.tools.meet;
      toolCards.push(ctx.meetCard);
    }
  } else if (meetPending && !meetReport) {
    toolCards.push({ tool: 'run_meet_check', ...nextState.tools.meet, reaproveitado: true });
  }

  // 5. Resposta: LLM plugável com tool calling, ou motor de regras local.
  let reply;
  let solution = null;
  let engine;
  let escalationProposal = null;
  const llmEvents = [];
  if (llmConfig.configured) {
    try {
      const llm = await runLlm(ctx, llmConfig);
      llmEvents.push(...llm.events);
      const parsed = extractStepsFromReply(llm.text);
      if (!parsed.text && !parsed.steps.length) throw new LlmError('A LLM devolveu uma resposta vazia.', { kind: 'resposta' });
      reply = parsed.text;
      if (parsed.steps.length) {
        solution = {
          origem: 'llm',
          procedimentoId: primary?.procedure.id || null,
          titulo: primary?.procedure.titulo || 'Solução recomendada',
          diagnostico: primary?.procedure.diagnostico || null,
          so: osLabel(machine),
          familiaSo: machine.so.familia,
          passos: parsed.steps,
          fonte: primary ? `Copilot, com base em ${primary.procedure.fonte}` : 'Copilot',
          escalarDireto: policy?.escalarDireto || false,
        };
      }
      engine = { mode: 'llm', provider: llmConfig.provider, providerLabel: llmConfig.providerLabel, model: llm.model, toolMode: llm.toolMode, rounds: llm.rounds, ferramentas: llm.events.map((e) => e.name) };
    } catch (error) {
      if (!llmConfig.fallbackRules) throw error;
      // Detalhe do provedor só no log do servidor; o solicitante vê a categoria da falha.
      console.warn(`[copilot] LLM indisponível (${llmConfig.provider}/${llmConfig.model}); usando o motor de regras: ${error.message}`);
      engine = { mode: 'regras', fallback: true, motivo: publicLlmFailure(error), provider: llmConfig.provider, model: llmConfig.model };
    }
  } else {
    if (!llmConfig.fallbackRules) throw new LlmError(llmConfig.reason || 'LLM não configurada e fallback de regras desativado.', { kind: 'configuracao' });
    engine = { mode: 'regras', fallback: false, motivo: llmConfig.reason };
  }

  // Ferramentas pedidas pela LLM viram cartões (sem duplicar o run_meet_check da regra).
  for (const event of llmEvents) {
    if (event.name === 'run_meet_check' && event.output.status === 'aguardando_execucao' && !toolCards.some((c) => c.tool === 'run_meet_check')) {
      nextState.tools.meet = { status: event.output.status, runId: event.output.runId, meetUrl: event.output.meetUrl, codigoPadrao: event.output.codigoPadrao, motivo: 'llm', criadoEm: now.toISOString() };
      toolCards.push({ ...event.output, motivo: 'llm', descricaoMotivo: 'Acionada pela LLM (tool calling).', origem: 'llm' });
    }
    if (event.name === 'escalate_glpi_ticket' && event.output.status === 'aguardando_confirmacao') {
      escalationProposal = { titulo: event.output.titulo, resumoTecnico: event.output.resumoTecnico, sugestaoDoModelo: event.output.sugestaoDoModelo };
      nextState.escalationProposal = escalationProposal;
    }
    if (event.name === 'search_precedents' && event.output.status === 'concluido') {
      for (const found of event.output.precedentes || []) if (!precedents.some((p) => p.id === found.id)) {
        const full = searchPrecedents(found.titulo, null, { machine, limit: 5, minSimilarity: 0 }).find((p) => p.id === found.id);
        if (full) precedents.push(precedentView(full));
      }
    }
  }

  if (!solution) {
    if (assessedReport) {
      const fix = assessedReport.falhas.find((f) => f.correcao)?.correcao;
      solution = fix
        ? { origem: 'laudo', procedimentoId: fix.procedureId, titulo: `Correção pelo laudo: ${fix.titulo}`, diagnostico: assessedReport.resumo, so: osLabel(machine), familiaSo: machine.so.familia, passos: fix.passos.map((s) => ({ texto: s.texto, codigo: s.codigo || null })), fonte: fix.fonte, escalarDireto: false }
        : null;
    } else if (!['positivo', 'saudacao', 'vazio'].includes(intent) && !(intent === 'negativo' && exhausted) && !(engine.mode === 'regras' && samePrimary)) {
      const outOfScope = triage && triage.escopo === false && !primary;
      solution = primary ? solutionFromProcedure(primary, machine, { escalarDireto: policy?.escalarDireto }) : hasReport && !outOfScope ? genericSolution(machine) : null;
    }
  }
  ctx.solution = solution;
  if (engine.mode === 'regras') reply = rulesReply(ctx);

  // Estado para os próximos turnos.
  if (solution?.procedimentoId && !nextState.attemptedProcedures.includes(solution.procedimentoId)) nextState.attemptedProcedures.push(solution.procedimentoId);
  if (primary) nextState.lastProcedureId = primary.procedure.id;
  // O cartão de precedentes mostra só casos ainda não exibidos neste atendimento
  // (a LLM continua recebendo todos no prompt).
  const shownPrecedents = new Set(nextState.shownPrecedents || []);
  const freshPrecedents = precedents.filter((p) => !shownPrecedents.has(p.id)).slice(0, 3);
  nextState.shownPrecedents = [...shownPrecedents, ...freshPrecedents.map((p) => p.id)];
  if (precedent) {
    nextState.citedPrecedents = [...citedBefore, precedent.id];
    if (precedent.resolucao?.padrao) nextState.citedPatterns = [...citedPatterns, precedent.resolucao.padrao];
  }
  if (triage) nextState.lastTriage = triage;
  if (solution) nextState.lastSolution = solution;
  nextState.lastEngine = engine;
  const at = now.toISOString();
  if (message || meetReport) nextState.messages.push({ role: 'user', text: message || '[Laudo do teste de audiência enviado]', intent, at, laudo: Boolean(meetReport) });
  const turn = {
    id: `T${nextState.messages.filter((m) => m.role === 'assistant').length + 1}`,
    createdAt: at,
    intent,
    reply,
    engine,
    triage,
    precedents: freshPrecedents,
    solution,
    tools: toolCards,
    escalationProposal,
    hints,
    sugerirEscalacao: Boolean(exhausted || policy?.escalarDireto || assessedReport?.veredito === 'BLOQUEADA' || escalationProposal),
  };
  nextState.messages.push({ role: 'assistant', text: reply, at, turn });
  nextState.llmHistory = [
    ...(nextState.llmHistory || []),
    { role: 'user', content: message || `[Laudo run_meet_check] ${assessedReport?.resumo || ''}` },
    { role: 'assistant', content: [reply, solution ? `Passos apresentados (${solution.titulo}):\n${solution.passos.map((s, i) => `${i + 1}. ${s.texto}`).join('\n')}` : '', toolCards.length ? `[Ferramentas: ${toolCards.map((c) => `${c.tool} ${c.status}`).join(', ')}]` : ''].filter(Boolean).join('\n\n') },
  ].slice(-COPILOT_LIMITS.historyMessages * 2);

  const request = classification && policy
    ? { description: text, decision: policy.decision, rawDecision: classification.rawDecision, priority: policy.priority, queue: policy.queue, provider: classification.provider, triageStatus: classification.triageStatus, confidence: Number(policy.decision.confidence) || 0, solution }
    : null;
  return { turn, state: nextState, request };
}

function publicLlmFailure(error) {
  return {
    indisponivel: 'LLM fora do ar ou sem resposta',
    credencial: 'credencial da LLM recusada',
    limite: 'limite de uso da LLM atingido',
    modelo: 'modelo ou endpoint da LLM não encontrado',
    provedor: 'falha no provedor da LLM',
    resposta: 'resposta inválida da LLM',
  }[error?.kind] || 'LLM indisponível';
}

function emptyPolicy() {
  return { decision: {}, priority: null, queue: null, appliedRules: [], hearing: { mencionada: false, status: 'sem_horario', minutos: null, horario: null, link: null }, escalarDireto: false };
}

export function toolAvailable(name) {
  return getTool(name)?.status === 'ativa';
}
