/**
 * Regras operacionais do Hermes aplicadas sobre a triagem do Laya
 * (hermes-memory/core/regras-operacionais.md, §2 "Limiares de Escalação Imediata"):
 *
 *   1. Audiência em andamento ou em menos de 15 minutos ➔ prioridade CRÍTICA imediata.
 *   2. Queda de link/rede afetando várias pessoas ➔ possível incidente coletivo, fila SUPORTE_REDE.
 *   3. Falha de hardware físico (não liga, sem sinal de vídeo, fonte queimada) ➔ SUPORTE_HARDWARE,
 *      com patrimônio e modelo no chamado.
 *
 * Cada regra aplicada é devolvida em `appliedRules` para aparecer no chat e no chamado.
 */
import { TRIAGE_CALIBRATION_RULES, calculatePriority, routeQueue } from '../triage.js';
import { hasTerm, normalize } from './text.js';
import { extractMeetLink } from './tools.js';

const RULES_SOURCE = 'regras-operacionais.md › Limiares de Escalação Imediata';
const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const HEARING_WORDS = ['audiencia', 'audiencias', 'depoimento', 'oitiva', 'videoconferencia', 'sessao de julgamento', 'juri', 'google meet', 'meet', 'sala virtual', 'teleaudiencia'];
const ONGOING = /\b(em andamento|acontecendo agora|ao vivo|ja comec(ou|aram)|comecou|no meio d[oa] (audiencia|depoimento|sessao|oitiva)|durante a (audiencia|sessao|oitiva)|estamos (na|em) (audiencia|sessao)|fazendo (a |uma )?audiencia|ja esta presente na sala|juiz ja esta|os participantes (ficam|estao|nao)|interrompid[ao]|retomar (imediatamente )?a sala)\b/;
const IMMINENT = /\b(vai comecar|prestes a comecar|ja vai comecar|daqui a pouco|comeca agora|começa agora)\b/;
const COLLECTIVE_EXTRA = ['ninguem do setor', 'outros computadores', 'outras maquinas', 'varias maquinas', 'todos do setor', 'todo o forum', 'forum inteiro', 'predio inteiro', 'toda a comarca', 'mais de uma estacao', 'colegas tambem estao'];
const PHYSICAL_HARDWARE = ['nao liga', 'nao acende', 'nenhuma luz', 'fonte queimada', 'fonte queimou', 'cheiro de queimado', 'sem sinal de video', 'no signal', 'tela preta sem sinal', 'nao da sinal de vida'];

/** Hora e minuto atuais no fuso do Pará (America/Belem, UTC-3). */
export function nowInBelem(now = new Date()) {
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Belem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { hours: get('hour'), minutes: get('minute') };
}

/**
 * Contexto de audiência no relato: menção, link do Meet e quando ela acontece
 * (em andamento, minutos até o início ou horário marcado).
 */
export function hearingContext(text, machine = null, now = new Date()) {
  const normalized = normalize(text);
  const link = extractMeetLink(text);
  const mentioned = Boolean(link) || HEARING_WORDS.some((w) => hasTerm(normalized, w));
  const result = { mencionada: mentioned, link, status: 'sem_horario', minutos: null, horario: null, evidencia: null };
  if (!mentioned) return result;
  if (ONGOING.test(normalized)) return { ...result, status: 'em_andamento', evidencia: normalized.match(ONGOING)[0] };
  const inMinutes = normalized.match(/\b(?:em|daqui a|daqui)\s+(\d{1,3})\s*(?:min|minutos?)\b/) || normalized.match(/\b(\d{1,3})\s*minutos?\s+para\s+(?:comecar|iniciar|a audiencia)\b/);
  if (inMinutes) {
    const minutes = Number(inMinutes[1]);
    return { ...result, status: minutes <= 15 ? 'iminente' : 'agendada', minutos: minutes, evidencia: inMinutes[0] };
  }
  const clock = normalized.match(/\b(?:as|para as|marcada para|agendada para|inicio as)?\s*([01]?\d|2[0-3])\s*(?::|h)\s*([0-5]\d)?\b/);
  if (clock) {
    const target = Number(clock[1]) * 60 + Number(clock[2] || 0);
    const { hours, minutes } = nowInBelem(now);
    const diff = target - (hours * 60 + minutes);
    const horario = `${String(clock[1]).padStart(2, '0')}:${String(clock[2] || '00').padStart(2, '0')}`;
    if (diff >= -90 && diff < 0) return { ...result, status: 'em_andamento', minutos: diff, horario, evidencia: clock[0].trim() };
    if (diff >= 0 && diff <= 15) return { ...result, status: 'iminente', minutos: diff, horario, evidencia: clock[0].trim() };
    if (diff > 15) return { ...result, status: 'agendada', minutos: diff, horario, evidencia: clock[0].trim() };
    return { ...result, horario, evidencia: clock[0].trim() };
  }
  if (IMMINENT.test(normalized)) return { ...result, status: 'iminente', evidencia: normalized.match(IMMINENT)[0] };
  return result;
}

const raise = (current, target) => (LEVELS.indexOf(current) < LEVELS.indexOf(target) ? target : current);

/**
 * Aplica as regras operacionais sobre a decisão do Laya e recalcula prioridade e fila
 * com a matriz e o roteamento configurados no tenant.
 */
export function applyOperationalRules({ decision, text, machine = null, procedure = null, procedureScore = 0, triageStatus = null, triageConfig, now = new Date() }) {
  const adjusted = { ...decision };
  const applied = [];
  let queueOverride = null;
  let statusOverride = null;
  const normalized = normalize(text);

  // 0. Laya sem categoria útil (OTHER/UNKNOWN ou "fora do escopo") mas a base procedural
  //    reconhece o sintoma com segurança: usa categoria/sistema do procedimento e manda
  //    a classificação para revisão da TIC (a decisão original fica registrada).
  const weakLaya = adjusted.category === 'OTHER' || ['UNKNOWN', 'OTHER'].includes(adjusted.system) || triageStatus === 'OUT_OF_SCOPE' || adjusted.isSupportRequest === false;
  if (weakLaya && procedure?.categoria && procedure?.sistema && procedureScore >= 6) {
    const before = `${adjusted.category}/${adjusted.system}`;
    adjusted.category = procedure.categoria;
    adjusted.system = procedure.sistema;
    adjusted.isSupportRequest = true;
    if (triageStatus === 'OUT_OF_SCOPE') statusOverride = 'NEEDS_REVIEW';
    applied.push({
      regra: 'base_procedural',
      descricao: `O classificador não identificou o tipo do problema; a base procedural reconheceu "${procedure.titulo}".`,
      efeito: `Categoria ${before} ➔ ${procedure.categoria}/${procedure.sistema} (revisão da TIC)`,
      fonte: procedure.fonte,
    });
  }

  // 1. Audiência em andamento ou em até 15 minutos.
  const hearing = hearingContext(text, machine, now);
  if (hearing.status === 'em_andamento' || hearing.status === 'iminente') {
    const before = adjusted.urgency;
    adjusted.urgency = 'CRITICAL';
    adjusted.impact = raise(adjusted.impact, 'HIGH');
    adjusted.humanRequired = true;
    applied.push({
      regra: 'audiencia_iminente',
      descricao: hearing.status === 'em_andamento'
        ? 'Audiência em andamento: prioridade crítica imediata.'
        : `Audiência ${hearing.minutos !== null ? `em ${hearing.minutos} min` : 'prestes a começar'}${hearing.horario ? ` (${hearing.horario})` : ''}: prioridade crítica imediata.`,
      efeito: `Urgência ${before} ➔ CRITICAL`,
      fonte: RULES_SOURCE,
    });
  }

  // 2. Queda de rede coletiva.
  const networkTopic = adjusted.category === 'NETWORK' || adjusted.system === 'INTERNET' || /^(rede|meet-conexao|vpn)/.test(procedure?.grupo || '');
  const collectiveTerms = [...(triageConfig?.calibrationRules?.collectiveTerms || TRIAGE_CALIBRATION_RULES.collectiveTerms), ...COLLECTIVE_EXTRA];
  const collective = decision.possibleIncident === true || collectiveTerms.some((term) => hasTerm(normalized, term));
  if (networkTopic && collective) {
    adjusted.possibleIncident = true;
    adjusted.category = 'NETWORK';
    adjusted.system = 'INTERNET';
    adjusted.impact = raise(adjusted.impact, 'HIGH');
    queueOverride = 'network';
    applied.push({
      regra: 'incidente_coletivo_rede',
      descricao: 'Queda de rede afetando mais de uma pessoa: possível incidente coletivo.',
      efeito: 'Incidente coletivo sinalizado; fila de rede',
      fonte: RULES_SOURCE,
    });
  }

  // 3. Falha física de hardware.
  const physical = procedure?.escalar === true || PHYSICAL_HARDWARE.some((term) => hasTerm(normalized, term));
  if (physical && !queueOverride) {
    adjusted.category = 'HARDWARE';
    adjusted.system = 'COMPUTER';
    adjusted.humanRequired = true;
    queueOverride = 'hardware';
    applied.push({
      regra: 'hardware_fisico',
      descricao: 'Falha de hardware físico: escalar direto para a equipe de hardware com patrimônio e modelo.',
      efeito: 'Categoria HARDWARE; fila de hardware',
      fonte: RULES_SOURCE,
    });
  }

  const priority = calculatePriority(adjusted, triageConfig.priorityMatrix);
  const queue = queueOverride ? triageConfig.routing[queueOverride] : routeQueue(adjusted, triageConfig.routing, triageConfig.routingRules);
  adjusted.copilotPolicy = applied.map((rule) => rule.regra);
  return { decision: adjusted, priority, queue, appliedRules: applied, hearing, escalarDireto: physical, statusOverride };
}
