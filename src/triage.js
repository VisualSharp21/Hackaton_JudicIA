export const CATEGORIES = [
  'ACCESS',
  'SYSTEM',
  'NETWORK',
  'HARDWARE',
  'SOFTWARE',
  'PRINTING',
  'OTHER',
];
export const SYSTEMS = [
  'PJE',
  'SEI',
  'EMAIL',
  'INTERNET',
  'COMPUTER',
  'PRINTER',
  'OTHER',
  'UNKNOWN',
];
export const LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const TRIAGE_PRIORITY_MATRIX = Object.freeze({
  LOW: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' },
  MEDIUM: { LOW: 'MEDIUM', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' },
  HIGH: { LOW: 'HIGH', MEDIUM: 'HIGH', HIGH: 'HIGH', CRITICAL: 'CRITICAL' },
  CRITICAL: { LOW: 'CRITICAL', MEDIUM: 'CRITICAL', HIGH: 'CRITICAL', CRITICAL: 'CRITICAL' },
});

export const TRIAGE_ROUTING = Object.freeze({ pje: 'SUPORTE_PJE', network: 'SUPORTE_REDE', hardware: 'SUPORTE_HARDWARE', systems: 'SUPORTE_SISTEMAS', general: 'SUPORTE_GERAL' });
export const TRIAGE_ROUTING_RULES = Object.freeze([
  { when: [{ field: 'system', value: 'PJE' }], target: 'pje' },
  { when: [{ field: 'category', value: 'NETWORK' }, { field: 'system', value: 'INTERNET' }], target: 'network' },
  { when: [{ field: 'category', value: 'HARDWARE' }, { field: 'category', value: 'PRINTING' }, { field: 'system', value: 'PRINTER' }, { field: 'system', value: 'COMPUTER' }], target: 'hardware' },
  { when: [{ field: 'category', value: 'SYSTEM' }, { field: 'category', value: 'SOFTWARE' }], target: 'systems' },
]);

export const TRIAGE_CALIBRATION_RULES = Object.freeze({
  technicalTerms: ['pje','sei','sistema','aplicativo','software','computador','notebook','desktop','pc','estacao de trabalho','impressora','imprimir','impressao','internet','wifi','wi-fi','rede','conexao','senha','login','autenticacao','e-mail','email','correio eletronico','navegador','vpn','teclado','mouse','monitor','scanner','certificado digital','camera','webcam','microfone','google meet','meet.google','videoconferencia'],
  outOfScopeTerms: ['advogado','prazo','recurso','peticao','processo judicial','processo','audiencia','sentenca','custas','juiz','decisao judicial','orientacao juridica','intimacao','comarca'],
  systemTerms: { PJE: ['pje'], SEI: ['sei'] },
  outOfScopeCategory: 'OTHER',
  fallbackUnknownSystem: 'UNKNOWN',
  categoryRules: [
    { groups: [['impressora','imprimir','impressao','toner','fila de impressao']], category: 'PRINTING', system: 'PRINTER' },
    { groups: [['internet','wifi','wi-fi','rede','conexao','sem sinal','roteador']], category: 'NETWORK', system: 'INTERNET' },
    { groups: [['camera','webcam','microfone','google meet','meet.google','videoconferencia']], category: 'HARDWARE', system: 'COMPUTER' },
    { groups: [['computador','notebook','desktop','pc','estacao de trabalho'], ['nao liga','nao inicia','travou','desliga','tela azul','muito lento','quebrou']], category: 'HARDWARE', system: 'COMPUTER' },
    { groups: [['e-mail','email','correio eletronico','outlook']], category: 'SYSTEM', system: 'EMAIL' },
    { groups: [['pje','sei'], ['senha','autenticacao','credencial','nao consigo entrar','nao consigo acessar','falha ao acessar','login']], category: 'ACCESS', systemFromText: true },
    { groups: [['pje','sei']], category: 'SYSTEM', systemFromText: true },
    { groups: [['senha','autenticacao','credencial','conta bloqueada','redefinir senha','nao consigo entrar','nao consigo acessar','falha ao acessar','login']], category: 'ACCESS', system: 'OTHER' },
  ],
  collectiveTerms: ['varias pessoas','varios usuarios','varios computadores','todos os usuarios','todos usuarios','toda a unidade','unidade inteira','todo o setor','setor inteiro','ninguem consegue','todos sem acesso','colegas tambem','mais de uma pessoa','a equipe inteira','servico compartilhado'],
  outageTerms: ['indisponivel','fora do ar','caiu','sem conexao','servico interrompido'],
  individualOnlyTerms: ['somente para mim','apenas eu','so para mim'],
  vagueTerms: ['nao funciona','nao esta funcionando','preciso de ajuda','esta com problema'],
  technicalDetailTerms: ['pje','sei','impressora','imprimir','internet','wifi','rede','computador','notebook','senha','login','email','e-mail','sistema'],
  impactOnIncident: 'HIGH',
  urgencyOnIncident: 'HIGH',
  defaultScoreLevel: 'MEDIUM',
  yesNoThreshold: 0.5,
  supportScopeProbability: 0.99,
  outOfScopeProbability: 0.01,
  fallbackMatchedScopeProbability: 0.94,
  fallbackUnmatchedScopeProbability: 0.12,
  fallbackConfidence: 0.4,
  fallbackImpact: 'LOW',
  fallbackUrgency: 'LOW',
  fallbackMatchedUrgency: 'MEDIUM',
  incidentConfidenceBoost: 0.9,
  outageConfidenceBoost: 0.85,
  collectiveConfidenceIncrease: 0.04,
  collectiveConfidenceMaximum: 0.98,
  confidenceAggregation: 'minimum',
  fallbackRules: [
    { terms: ['pje','processo judicial'], category: 'SYSTEM', system: 'PJE', confidence: 0.92 },
    { terms: ['impressora','imprimir','impressao'], category: 'PRINTING', system: 'PRINTER', confidence: 0.92 },
    { terms: ['internet','rede','wifi','wi-fi','conexao'], category: 'NETWORK', system: 'INTERNET', confidence: 0.9 },
    { terms: ['computador','notebook','estacao','nao liga'], category: 'HARDWARE', system: 'COMPUTER', confidence: 0.88 },
    { terms: ['senha','login','acessar','acesso','autenticacao'], category: 'ACCESS', system: 'UNKNOWN', confidence: 0.82 },
    { terms: ['email','e-mail','correio eletronico'], category: 'SYSTEM', system: 'EMAIL', confidence: 0.9 },
    { terms: ['camera','webcam','microfone','google meet','meet.google','videoconferencia'], category: 'HARDWARE', system: 'COMPUTER', confidence: 0.92 },
  ],
  fallbackUrgencyTerms: ['urgente','prazo','audiencia','hoje','desde esta manha'],
});

export const TRIAGE_THRESHOLDS = Object.freeze({
  outOfScope: 0.35,
  inScope: 0.7,
  answerConfidence: 0.7,
});

export const decisionQuestions = Object.freeze({
  category: {
    type: 'choice',
    instructions:
      'Classifique a solicitação de suporte de TIC. Escolha a categoria que melhor descreve o problema.',
    criteria: {
      ACCESS: 'Autenticação, conta ou credenciais',
      SYSTEM: 'Sistema institucional, como PJe ou SEI',
      NETWORK: 'Internet, rede ou conectividade',
      HARDWARE: 'Computador ou equipamento físico',
      SOFTWARE: 'Aplicativo ou programa',
      PRINTING: 'Impressão ou fila de impressão',
      OTHER: 'Problema de TIC não identificado nas demais categorias',
    },
  },
  system: {
    type: 'choice',
    instructions:
      'Identifique o sistema ou equipamento mencionado. Se não houver menção clara, escolha UNKNOWN.',
    criteria: {
      PJE: 'Sistema PJe',
      SEI: 'Sistema SEI',
      EMAIL: 'Correio eletrônico',
      INTERNET: 'Internet ou rede',
      COMPUTER: 'Computador ou estação de trabalho',
      PRINTER: 'Impressora',
      OTHER: 'Outro sistema identificado',
      UNKNOWN: 'Não identificado',
    },
  },
  impact: {
    type: 'score',
    instructions: 'Avalie o impacto operacional da solicitação para a unidade a partir do texto.',
    criteria: [
      'LOW — afeta apenas uma tarefa, sem bloqueio relevante',
      'MEDIUM — causa atraso ou dificuldade, mas há alternativa de trabalho',
      'HIGH — bloqueia trabalho importante de uma pessoa ou setor',
      'CRITICAL — paralisa serviço essencial ou várias unidades',
    ],
  },
  urgency: {
    type: 'score',
    instructions: 'Avalie a urgência explícita ou implícita da solicitação.',
    criteria: [
      'LOW — pode aguardar sem consequência imediata',
      'MEDIUM — precisa ser tratado em breve, sem prazo iminente',
      'HIGH — prejudica atividade importante ou tem prazo próximo',
      'CRITICAL — exige ação imediata para evitar interrupção ou dano grave',
    ],
  },
  is_it_support: {
    type: 'noul',
    instructions:
      'A mensagem descreve um problema, solicitação ou dúvida de tecnologia da informação que deve ser atendida pelo suporte de TIC do Tribunal? Responda não para assuntos pessoais, jurídicos ou sem relação com tecnologia.',
  },
  possible_incident: {
    type: 'noul',
    instructions:
      'Há evidências explícitas de que o problema afeta várias pessoas, uma unidade ou um serviço compartilhado? Não conclua que é coletivo apenas porque um sistema institucional foi mencionado.',
  },
  human_required: {
    type: 'noul',
    instructions:
      'Esta solicitação provavelmente exige intervenção humana da equipe de suporte, em vez de poder ser resolvida somente por uma orientação de autoatendimento?',
  },
  outage: {
    type: 'noul',
    instructions:
      'O texto indica indisponibilidade total ou parcial de sistema, rede ou equipamento? Não infira indisponibilidade apenas por um erro de login individual.',
  },
});

const clamp = (value) =>
  Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

export function answerConfidence(answer, fallback = 0) {
  if (answer?.answer_confidence != null) return clamp(answer.answer_confidence);
  if (answer?.confidence != null) return clamp(answer.confidence);
  const probabilities = Object.values(answer?.probabilities || {})
    .map(Number)
    .filter(Number.isFinite);
  return probabilities.length ? clamp(Math.max(...probabilities)) : clamp(fallback);
}

export function mapScore(answer, defaultLevel = 'MEDIUM', configuredLevels = LEVELS.length) {
  const score = Number(answer?.score);
  const index = Number.isFinite(score) ? Math.round(score) : Math.round(LEVELS.indexOf(defaultLevel) * (configuredLevels - 1) / (LEVELS.length - 1));
  if (index < 0 || index >= configuredLevels)
    throw new Error(`Nível de score fora do intervalo esperado: ${answer?.score}`);
  const internalIndex = configuredLevels <= 1 ? 0 : Math.round(index * (LEVELS.length - 1) / (configuredLevels - 1));
  return LEVELS[internalIndex];
}

export function calculatePriority(decision, matrix = TRIAGE_PRIORITY_MATRIX) {
  const priority = matrix?.[decision.impact]?.[decision.urgency];
  if (!LEVELS.includes(decision.impact) || !LEVELS.includes(decision.urgency) || !LEVELS.includes(priority))
    throw new Error('Impacto, urgência ou prioridade inválidos.');
  return priority;
}

export function routeQueue(decision, routing = TRIAGE_ROUTING, rules = TRIAGE_ROUTING_RULES) {
  const matched = rules.find((rule) => rule.when.some(({ field, value }) => decision[field] === value));
  return routing[matched?.target || 'general'];
}

export function triageStatus(scopeProbability, confidence, thresholds = TRIAGE_THRESHOLDS) {
  const scope = clamp(scopeProbability);
  if (scope < thresholds.outOfScope) return 'OUT_OF_SCOPE';
  if (scope < thresholds.inScope || clamp(confidence) < thresholds.answerConfidence)
    return 'NEEDS_REVIEW';
  return 'READY';
}

export function decisionFromAnswers(answers = {}, rules = TRIAGE_CALIBRATION_RULES, systemOptionMappings = {}, categoryOptionMappings = {}, questions = decisionQuestions) {
  const rawCategory = String(answers.category?.choice || '').toUpperCase();
  const configuredCategories = Object.keys(questions.category?.criteria || {});
  const category = configuredCategories.includes(rawCategory) ? rawCategory : String(categoryOptionMappings[rawCategory] || rawCategory).toUpperCase();
  const rawSystem = String(answers.system?.choice || '').toUpperCase();
  const configuredSystems = Object.keys(questions.system?.criteria || {});
  const system = configuredSystems.includes(rawSystem) ? rawSystem : String(systemOptionMappings[rawSystem] || '').toUpperCase();
  if (!configuredCategories.includes(category) && !CATEGORIES.includes(category))
    throw new Error(`Categoria inválida retornada pelo classificador: ${category || '(vazia)'}`);
  if (!configuredSystems.includes(system) && !SYSTEMS.includes(system))
    throw new Error(`Sistema inválido retornado pelo classificador: ${system || '(vazio)'}`);

  const scopeProbability = clamp(answers.is_it_support?.noul);
  const categoryConfidence = answerConfidence(answers.category);
  const systemConfidence = answerConfidence(answers.system, categoryConfidence);
  const impactConfidence = answerConfidence(answers.impact);
  const urgencyConfidence = answerConfidence(answers.urgency);
  const confidenceValues = [categoryConfidence, systemConfidence, impactConfidence, urgencyConfidence];
  const confidence = rules.confidenceAggregation === 'average'
    ? confidenceValues.reduce((total, value) => total + value, 0) / confidenceValues.length
    : Math.min(...confidenceValues);
  const yes = (answer) => clamp(answer?.noul) >= rules.yesNoThreshold;

  return {
    category,
    system,
    impact: mapScore(answers.impact, rules.defaultScoreLevel, questions.impact?.criteria?.length || LEVELS.length),
    urgency: mapScore(answers.urgency, rules.defaultScoreLevel, questions.urgency?.criteria?.length || LEVELS.length),
    isSupportRequest: scopeProbability >= rules.yesNoThreshold,
    scopeProbability,
    scopeConfidence: Math.max(scopeProbability, 1 - scopeProbability),
    possibleIncident: yes(answers.possible_incident),
    humanRequired: yes(answers.human_required),
    outage: yes(answers.outage),
    confidence,
    categoryConfidence,
    systemConfidence,
    impactConfidence,
    urgencyConfidence,
    incidentConfidence: answerConfidence(answers.possible_incident),
    humanConfidence: answerConfidence(answers.human_required),
    outageConfidence: answerConfidence(answers.outage),
    jevUsage: null,
  };
}

const normalizePortuguese = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

function containsTerm(text, terms = []) {
  return terms.some((term) => text.includes(normalizePortuguese(term)));
}

export function calibrateDecision(description, input, rules = TRIAGE_CALIBRATION_RULES, categories = CATEGORIES, systems = SYSTEMS) {
  const text = normalizePortuguese(description);
  const decision = { ...input };
  const identifiedSystem = systems.includes(String(input.system || '').toUpperCase()) && !['OTHER','UNKNOWN'].includes(String(input.system || '').toUpperCase());
  const technical = identifiedSystem || containsTerm(text, rules.technicalTerms);
  const outOfScope = !technical && containsTerm(text, rules.outOfScopeTerms);
  if (technical) {
    decision.isSupportRequest = true;
    decision.scopeProbability = rules.supportScopeProbability;
    decision.scopeConfidence = Math.max(rules.supportScopeProbability, 1 - rules.supportScopeProbability);
  } else if (outOfScope) {
    decision.isSupportRequest = false;
    decision.scopeProbability = rules.outOfScopeProbability;
    decision.scopeConfidence = Math.max(rules.outOfScopeProbability, 1 - rules.outOfScopeProbability);
  }

  const systemMatch = Object.entries(rules.systemTerms).find(([, terms]) => containsTerm(text, terms))?.[0];
  for (const rule of rules.categoryRules) {
    const matches = rule.groups.every((group) => containsTerm(text, group));
    if (!matches) continue;
    const modelSelectedCustomCategory = categories.includes(input.category) && !CATEGORIES.includes(input.category);
    if (categories.includes(rule.category) && !(modelSelectedCustomCategory && CATEGORIES.includes(rule.category))) decision.category = rule.category;
    if (rule.systemFromText) decision.system = systemMatch || (identifiedSystem ? input.system : rules.fallbackUnknownSystem);
    else if (identifiedSystem && ['OTHER','UNKNOWN'].includes(rule.system)) decision.system = input.system;
    else if (systems.includes(rule.system)) decision.system = rule.system;
    break;
  }

  const collectiveEvidence = technical && containsTerm(text, rules.collectiveTerms);
  decision.possibleIncident = collectiveEvidence;
  if (collectiveEvidence) {
    decision.incidentConfidence = Math.max(Number(decision.incidentConfidence) || 0, rules.incidentConfidenceBoost);
    if (LEVELS.indexOf(decision.impact) < LEVELS.indexOf(rules.impactOnIncident)) decision.impact = rules.impactOnIncident;
  }
  decision.outage = technical && containsTerm(text, rules.outageTerms) && (!containsTerm(text, rules.individualOnlyTerms) || collectiveEvidence);
  if (decision.outage) decision.outageConfidence = Math.max(Number(decision.outageConfidence) || 0, rules.outageConfidenceBoost);
  if (outOfScope) decision.category = rules.outOfScopeCategory;
  return decision;
}

export function statusForDescription(description, decision, thresholds = TRIAGE_THRESHOLDS, rules = TRIAGE_CALIBRATION_RULES) {
  const text = normalizePortuguese(description);
  const hasTechnicalDetail = containsTerm(text, rules.technicalDetailTerms);
  const vague = containsTerm(text, rules.vagueTerms) && !hasTechnicalDetail;
  return vague ? 'NEEDS_REVIEW' : triageStatus(decision.scopeProbability, decision.confidence, thresholds);
}

export function validateHumanDecision(input = {}, categories = CATEGORIES, systems = SYSTEMS) {
  const category = String(input.category || '').toUpperCase();
  const system = String(input.system || '').toUpperCase();
  const impact = String(input.impact || '').toUpperCase();
  const urgency = String(input.urgency || '').toUpperCase();
  if (!categories.includes(category) && !CATEGORIES.includes(category)) throw new Error('Selecione uma categoria válida.');
  if (!systems.includes(system) && !SYSTEMS.includes(system)) throw new Error('Selecione um sistema válido.');
  if (!LEVELS.includes(impact) || !LEVELS.includes(urgency))
    throw new Error('Selecione um impacto e uma urgência válidos.');
  return {
    category,
    system,
    impact,
    urgency,
    isSupportRequest: true,
    possibleIncident: input.possibleIncident === true,
    humanRequired: input.humanRequired !== false,
    outage: input.outage === true,
    confidence: null,
    categoryConfidence: null,
    systemConfidence: null,
    impactConfidence: null,
    urgencyConfidence: null,
    incidentConfidence: null,
    humanConfidence: null,
    outageConfidence: null,
    scopeConfidence: null,
    scopeProbability: 1,
    jevUsage: null,
    correctedByHuman: true,
  };
}

export function assessDecision(decision, thresholds = TRIAGE_THRESHOLDS) {
  const status = triageStatus(decision.scopeProbability, decision.confidence, thresholds);
  return { triageStatus: status, review: status !== 'READY' };
}

export function applyAutomationGate(result, approved = false) {
  if (approved || result.triageStatus !== 'READY') return result;
  return {
    ...result,
    triageStatus: 'NEEDS_REVIEW',
    review: true,
    automationGate: 'BENCHMARK_NOT_APPROVED',
  };
}

export function fallbackClassification(text, rules = TRIAGE_CALIBRATION_RULES, thresholds = TRIAGE_THRESHOLDS) {
  const value = normalizePortuguese(text);
  const matched = rules.fallbackRules.find((rule) => containsTerm(value, rule.terms));
  const category = matched?.category || 'OTHER';
  const system = matched?.system || 'UNKNOWN';
  let confidence = matched?.confidence ?? rules.fallbackConfidence;
  let impact = rules.fallbackImpact;
  let urgency = rules.fallbackUrgency;
  const collective = containsTerm(value, rules.collectiveTerms);
  if (collective) {
    impact = rules.impactOnIncident;
    urgency = rules.urgencyOnIncident;
    confidence = Math.min(rules.collectiveConfidenceMaximum, confidence + rules.collectiveConfidenceIncrease);
  } else if (matched && containsTerm(value, rules.fallbackUrgencyTerms)) urgency = rules.fallbackMatchedUrgency;
  const scopeProbability = matched ? rules.fallbackMatchedScopeProbability : rules.fallbackUnmatchedScopeProbability;
  const decision = {
    category, system, impact, urgency, isSupportRequest: Boolean(matched), scopeProbability,
    scopeConfidence: Math.max(scopeProbability, 1 - scopeProbability), possibleIncident: collective,
    humanRequired: Boolean(matched), outage: collective && containsTerm(value, rules.outageTerms),
    confidence, categoryConfidence: confidence, systemConfidence: matched ? confidence : 0.4,
    impactConfidence: confidence, urgencyConfidence: confidence, incidentConfidence: confidence,
    humanConfidence: confidence, outageConfidence: confidence, jevUsage: null,
  };
  return { decision, provider: 'local_rules', ...assessDecision(decision, thresholds) };
}

export const DEFAULT_LAYA_PAYLOAD_TEMPLATE = Object.freeze({
  model: '{{model}}',
  state: { support_request: '{{description}}' },
  questions: '{{questions}}',
});

export function evaluationRequest(description, model = 'multilingual', questions = decisionQuestions, template = DEFAULT_LAYA_PAYLOAD_TEMPLATE) {
  const values = { description, model, questions };
  const resolve = (value) => {
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
    if (typeof value !== 'string') return value;
    const exact = value.match(/^\{\{(description|model|questions)\}\}$/);
    if (exact) return values[exact[1]];
    return value.replace(/\{\{(description|model)\}\}/g, (_, key) => values[key]);
  };
  return resolve(template);
}
