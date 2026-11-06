/**
 * Escalação estruturada para o GLPI 11 (PASSO 6 do fluxo do Copilot).
 *
 * Título: "[Setor] Problema relatado - Estação LAB-PJE-XXX".
 * Corpo:  máquina (patrimônio, serial, modelo, SO, IP), triagem do Laya (categoria, sistema,
 *         urgência, impacto, prioridade calculada), fila de destino no GLPI (código / ID),
 *         laudo do teste do Meet (se executado), procedimentos já tentados no autoatendimento,
 *         precedentes e histórico da conversa.
 * O texto vai para o GLPI em HTML simples (o campo `content` é rich text) e fica salvo em
 * texto puro na tabela local de chamados.
 */
import { calculatePriority, routeQueue } from '../triage.js';
import { getProcedure } from './data-loader.js';
import { meetReportLines } from './meet-report.js';
import { getRequestRow, saveCopilotSession, SESSION_STATUS, ticketForRequest } from './sessions.js';

const fmtNumber = (value) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);
const fmtDate = (value) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Belem', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const clean = (text, max) => String(text || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
/** Texto do chat sem marcação Markdown (o GLPI e o detalhe do chamado mostram texto puro). */
const plain = (text) => String(text || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|\s)\*([^*\n]+)\*/g, '$1$2').replace(/`([^`]+)`/g, '$1').replace(/^#{1,4}\s+/gm, '');

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Resumo curto do problema para o título: sugestão da LLM (escalate_glpi_ticket), senão o
 * sintoma identificado na base procedural, senão a primeira frase do relato.
 */
export function problemSummary(session) {
  const proposal = clean(session.state.escalationProposal?.titulo, 90);
  if (proposal) return proposal.replace(/^\[[^\]]*\]\s*/, '').replace(/\s*-\s*Esta[cç][aã]o\s+LAB-PJE-\d+$/i, '');
  const procedure = getProcedure(session.state.lastProcedureId);
  if (procedure && procedure.id !== 'roteiro-geral') return clean(procedure.titulo.replace(/["“”]/g, ''), 90);
  const first = (session.state.messages || []).find((m) => m.role === 'user' && m.intent === 'informacao')?.text || 'Atendimento sem descrição';
  const sentence = clean(first.replace(/https?:\/\/\S+/g, ' '), 400).split(/(?<=[.!?])\s/)[0].replace(/[.!?]+$/, '').trim();
  if (sentence.length <= 80) return sentence;
  return `${sentence.slice(0, 77).replace(/\s+\S*$/, '')}…`;
}

export function buildTicketTitle(session, machine) {
  return `[${machine.setor}] ${problemSummary(session)} - Estação ${machine.id}`.slice(0, 250);
}

/** Seções do chamado como lista de { titulo, linhas } (texto puro). */
export function buildTicketSections({ session, machine, request, decision, priority, queue, queueCategoryId, user }) {
  const state = session.state;
  const triage = state.lastTriage || {};
  const reports = (state.messages || []).filter((m) => m.role === 'user' && ['informacao', 'laudo'].includes(m.intent) && m.text && !m.text.startsWith('[')).map((m) => clean(m.text, 1200));
  const attempted = (state.attemptedProcedures || []).map((id) => getProcedure(id)).filter(Boolean);
  const meet = state.tools?.meet || null;
  const precedents = (state.messages || []).flatMap((m) => m.turn?.precedents || []).filter((p, i, all) => all.findIndex((x) => x.id === p.id) === i).slice(0, 3);
  const detection = { ip: 'identificada pelo IP na rede interna', hostname: 'identificada pelo nome do computador (DNS)', prediagnostico: 'identificada pelo pré-diagnóstico local', seletor: 'selecionada pelo solicitante' }[session.machineDetection] || session.machineDetection;
  const sections = [
    {
      titulo: 'ESTAÇÃO (inventário GLPI)',
      linhas: [
        `Estação: ${machine.id} (${detection})`,
        `Patrimônio: ${machine.patrimonio} · Serial: ${machine.serial}`,
        `Modelo: ${machine.fabricante} ${machine.modelo} (${machine.tipo}) · ${machine.processador} · ${machine.memoriaGib} GB RAM`,
        `Disco: ${fmtNumber(machine.disco.livreGib)} GB livres de ${machine.disco.totalGib} GB (${machine.disco.livrePct}%)${machine.disco.alerta ? ' — pouco espaço' : ''}`,
        `Sistema operacional: ${machine.so.nome}${machine.so.nome.includes(machine.so.versao) ? '' : ` ${machine.so.versao}`} (${machine.so.arquitetura})`,
        `Rede: IP ${machine.rede.ip} · MAC ${machine.rede.mac}${machine.rede.descricao ? ` · ${machine.rede.descricao}` : ''}`,
        `Setor: ${machine.setor} · Unidade: ${machine.unidade} · Responsável: ${machine.responsavel}`,
      ],
    },
    {
      titulo: 'RELATO DO SOLICITANTE',
      linhas: reports.length ? reports.map((r) => `"${r}"`) : ['(sem relato textual)'],
    },
    {
      titulo: 'TRIAGEM DO LAYA',
      linhas: [
        `Categoria: ${decision.category} · Sistema: ${decision.system}`,
        `Urgência: ${decision.urgency} · Impacto: ${decision.impact} · Prioridade calculada: ${priority}`,
        `Fila de destino no GLPI: ${queue}${queueCategoryId ? ` / ID ${queueCategoryId}` : ' (sem ID de categoria GLPI configurado)'}`,
        `Incidente coletivo: ${decision.possibleIncident ? 'sim' : 'não'} · Indisponibilidade: ${decision.outage ? 'sim' : 'não'}`,
        `Classificador: ${request.provider} · Status da triagem: ${request.triage_status}${request.corrected_decision ? ' · corrigida por revisão humana' : request.triage_status !== 'READY' ? ' (a confirmar pela TIC)' : ''}`,
        ...(triage.regrasAplicadas?.length ? [`Regras operacionais aplicadas: ${triage.regrasAplicadas.map((r) => r.descricao).join(' ')}`] : []),
        ...(machine.perfil?.prioridadePadrao ? [`Prioridade padrão do setor (perfil): ${machine.perfil.prioridadePadrao}`] : []),
      ],
    },
    {
      titulo: 'LAUDO DO TESTE DE AUDIÊNCIA (run_meet_check)',
      linhas: meet?.laudo ? meetReportLines(meet.laudo) : meet ? [`Diagnóstico oferecido${meet.meetUrl ? ` para ${meet.meetUrl}` : ''}, mas não executado pelo solicitante.`] : ['Não se aplica a este atendimento.'],
    },
    {
      titulo: 'PROCEDIMENTOS JÁ TENTADOS NO AUTOATENDIMENTO',
      linhas: attempted.length
        ? attempted.map((p, i) => `${i + 1}. ${p.titulo} (${p.fonte})`).concat(['Desfecho: o solicitante pediu atendimento humano ("Ainda preciso de ajuda / Abrir Chamado"); o autoatendimento não resolveu.'])
        : ['Nenhum procedimento de autoatendimento foi apresentado antes da escalação.'],
    },
  ];
  if (precedents.length)
    sections.push({
      titulo: 'PRECEDENTES RELACIONADOS (RAG)',
      linhas: precedents.map((p) => `${p.id} (${p.similaridade}%) · ${p.estacao.nome} ${p.estacao.setor}: "${p.titulo}"${p.resolucao?.tipo === 'comprovada' ? ` — resolução comprovada: ${p.resolucao.passos.join('; ')}` : ''}`),
    });
  if (state.escalationProposal?.resumoTecnico)
    sections.push({ titulo: 'RESUMO TÉCNICO DO COPILOT', linhas: [clean(state.escalationProposal.resumoTecnico, 3000)] });
  const history = (state.messages || []).slice(-16).map((m) => `[${fmtDate(m.at)}] ${m.role === 'user' ? 'Solicitante' : 'Copilot'}: ${clean(plain(m.text), 400)}`);
  sections.push({ titulo: 'HISTÓRICO DA CONVERSA', linhas: history });
  sections.push({
    titulo: 'ORIGEM',
    linhas: [
      `Atendimento ${session.id} · Solicitação ${request.id} · aberto por ${user.displayName} (${user.email}) em ${fmtDate(new Date())}`,
      `Motor: ${state.lastEngine?.mode === 'llm' ? `${state.lastEngine.providerLabel || state.lastEngine.provider} · ${state.lastEngine.model}` : 'motor de regras local (memória Hermes + RAG)'}`,
    ],
  });
  return sections;
}

export function sectionsToText(sections) {
  return sections.map((s, i) => `${i + 1}. ${s.titulo}\n${s.linhas.map((l) => (/^\d+\.\s/.test(l) ? `   ${l}` : `- ${l}`)).join('\n')}`).join('\n\n');
}

export function sectionsToHtml(sections) {
  return sections
    .map((s, i) => `<p><strong>${i + 1}. ${escapeHtml(s.titulo)}</strong></p><ul>${s.linhas.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`)
    .join('');
}

/**
 * Abre o chamado no conector configurado (GLPI 11 ou mock). Idempotente: se a solicitação
 * já virou chamado, devolve o existente.
 */
export async function escalateCopilotSession({ session, machine, user, triageConfig, ticketing, queueCategoryIds = {} }) {
  const request = getRequestRow(session.requestId);
  if (!request) throw Object.assign(new Error('Descreva o problema no chat antes de abrir o chamado.'), { status: 409 });
  if (request.status === 'TICKET_CREATED') {
    const existing = ticketForRequest(request.id);
    return { alreadyEscalated: true, ticket: existing, title: session.state.escalation?.title || null, body: session.state.escalation?.body || null };
  }
  if (request.status === 'SELF_SERVICE_RESOLVED') throw Object.assign(new Error('Este atendimento foi encerrado como resolvido. Inicie um novo atendimento.'), { status: 409 });

  // Correção humana prevalece; sem ela, vale a decisão triada (Laya + regras operacionais).
  const decision = request.corrected_decision || request.decision;
  const priority = request.corrected_decision ? calculatePriority(decision, triageConfig.priorityMatrix) : request.priority;
  const queue = request.corrected_decision ? routeQueue(decision, triageConfig.routing, triageConfig.routingRules) : request.queue;
  const queueCategoryId = queueCategoryIds?.[queue] ? Number(queueCategoryIds[queue]) : null;
  const title = buildTicketTitle(session, machine);
  const sections = buildTicketSections({ session, machine, request, decision, priority, queue, queueCategoryId, user });
  const content = sectionsToText(sections);
  const contentHtml = sectionsToHtml(sections);

  const ticket = await ticketing.createTicket({ request, decision, priority, queue, title, content, contentHtml });
  session.status = SESSION_STATUS.escalated;
  session.ticketId = ticket.id;
  session.state.escalation = { ticketId: ticket.id, protocol: ticket.protocol, title, body: content, queue, queueCategoryId, priority, provider: ticket.integration?.provider || null, at: new Date().toISOString() };
  saveCopilotSession(session);
  return { alreadyEscalated: false, ticket: { ...ticket, glpiCategoryId: queueCategoryId }, title, body: content };
}
