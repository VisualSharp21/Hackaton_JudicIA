import fs from 'node:fs';
import { serviceDeadline } from './ticketing/service-deadline.js';
import path from 'node:path';
import { projectRoot, ticketingProvider, glpiConfig } from './config.js';
import { currentTenantId, setTenantContext, DEFAULT_TENANT_ID } from './tenant-context.js';
import { randomUUID } from 'node:crypto';
import { encryptTenantSecret, decryptTenantSecret } from './tenant-secrets.js';
import { query, queryJson, queryRegistry, queryRegistryJson, sqlValue, createTenantDatabase, createRegistryDatabase } from './database.js';
import { applyRegistryMigrations, applyTenantMigrations } from './prisma-migrations.js';
import { decisionQuestions, DEFAULT_LAYA_PAYLOAD_TEMPLATE, TRIAGE_THRESHOLDS, TRIAGE_ROUTING, TRIAGE_ROUTING_RULES, TRIAGE_CALIBRATION_RULES, TRIAGE_PRIORITY_MATRIX, CATEGORIES, SYSTEMS, LEVELS } from './triage.js';

const seedArticles = [
  {
    id: 'KB-001',
    title: 'Problemas de acesso ao PJe',
    category: 'SYSTEM',
    system: 'PJE',
    problem: 'Usuário não consegue acessar o sistema',
    solution: 'Confira a conexão e valide os dados de autenticação antes de tentar novamente.',
    steps: [
      'Verifique se a conexão com a internet está ativa.',
      'Confirme se está usando o endereço correto do PJe.',
      'Feche e abra o navegador e tente acessar novamente.',
      'Se a mensagem persistir, anote o texto do erro e abra um chamado.',
    ],
  },
  {
    id: 'KB-002',
    title: 'Impressora não está imprimindo',
    category: 'HARDWARE',
    system: 'PRINTER',
    problem: 'Documentos enviados não são impressos',
    solution: 'Verifique energia, papel, conexão e fila de impressão.',
    steps: [
      'Confirme se a impressora está ligada e sem alertas.',
      'Verifique papel e toner.',
      'Confira se a impressora correta está selecionada.',
      'Limpe trabalhos parados na fila e tente imprimir uma página de teste.',
    ],
  },
  {
    id: 'KB-003',
    title: 'Conexão de rede instável',
    category: 'NETWORK',
    system: 'INTERNET',
    problem: 'Acesso à internet oscila ou fica indisponível',
    solution: 'Verifique a conexão local e identifique se outras pessoas estão afetadas.',
    steps: [
      'Confira se o cabo de rede está conectado ou reconecte ao Wi-Fi.',
      'Teste outro site ou serviço institucional.',
      'Pergunte se colegas da unidade enfrentam o mesmo problema.',
      'Se várias pessoas forem afetadas, abra um chamado para a equipe de rede.',
    ],
  },
  {
    id: 'KB-004',
    title: 'Computador não liga',
    category: 'HARDWARE',
    system: 'COMPUTER',
    problem: 'Estação de trabalho não inicia',
    solution: 'Confira energia e conexões antes de solicitar suporte.',
    steps: [
      'Verifique se o cabo de energia está conectado.',
      'Confira a tomada e o filtro de linha.',
      'Pressione o botão de energia por alguns segundos.',
      'Se não iniciar, abra um chamado e informe o patrimônio do equipamento.',
    ],
  },
  {
    id: 'KB-005',
    title: 'Falha de autenticação ou senha',
    category: 'ACCESS',
    system: 'OTHER',
    problem: 'Senha não funciona ao entrar em um serviço',
    solution: 'Confirme o usuário e procure sinais de bloqueio ou expiração.',
    steps: [
      'Confira se o teclado está no idioma correto e Caps Lock está desligado.',
      'Digite novamente o usuário e a senha com atenção.',
      'Se a senha expirou ou a conta foi bloqueada, solicite redefinição pelo canal de suporte.',
    ],
  },
  {
    id: 'KB-006',
    title: 'E-mail indisponível',
    category: 'SYSTEM',
    system: 'EMAIL',
    problem: 'Não é possível enviar ou receber mensagens',
    solution: 'Verifique conexão, espaço da caixa e configurações básicas.',
    steps: [
      'Teste o acesso a outro serviço para confirmar a conexão.',
      'Atualize a página ou reinicie o aplicativo de e-mail.',
      'Confira se a caixa de entrada não atingiu o limite.',
      'Registre a mensagem de erro ao solicitar suporte.',
    ],
  },
  {
    id: 'KB-007',
    title: 'Sistema lento',
    category: 'SOFTWARE',
    system: 'OTHER',
    problem: 'Aplicativo demora para responder',
    solution: 'Feche sessões sem uso e teste novamente.',
    steps: [
      'Salve seu trabalho.',
      'Feche abas e aplicativos que não estão em uso.',
      'Reinicie o navegador e teste novamente.',
      'Informe quais telas ou ações ficam lentas ao abrir um chamado.',
    ],
  },
];
export function initializeTenantDatabase(tenantId) {
  setTenantContext(tenantId);
  createTenantDatabase(tenantId);
  applyTenantMigrations(tenantId);
  for (const article of seedArticles)
    query(`INSERT IGNORE INTO knowledge_articles(id,title,category,system,problem,solution,steps) VALUES(${sqlValue(article.id)},${sqlValue(article.title)},${sqlValue(article.category)},${sqlValue(article.system)},${sqlValue(article.problem)},${sqlValue(article.solution)},${sqlValue(JSON.stringify(article.steps))})`);
}

export function init() {
  createRegistryDatabase();
  applyRegistryMigrations();
  queryRegistry(`INSERT IGNORE INTO tenants(id,slug,name) VALUES('${DEFAULT_TENANT_ID}','default','Organizacao padrao')`);
  const tenantIds = queryRegistry('SELECT id FROM tenants ORDER BY slug').split(/\r?\n/).filter(Boolean);
  for (const tenantId of new Set([...tenantIds, DEFAULT_TENANT_ID])) initializeTenantDatabase(tenantId);
  setTenantContext(DEFAULT_TENANT_ID);
  seedTickets();
  query("UPDATE requests SET synthetic=true WHERE id LIKE 'REQ-DEMO-%'; UPDATE tickets SET synthetic=true WHERE id LIKE 'TCK-DEMO-%';");
  query("UPDATE tickets SET impact='MEDIUM',urgency='MEDIUM',priority='MEDIUM' WHERE id='TCK-DEMO-02';");
  query("UPDATE incidents SET status='DISMISSED' WHERE status='INVESTIGATING' AND code IN (SELECT DISTINCT it.incident_code FROM incident_tickets it JOIN tickets t ON t.id=it.ticket_id WHERE t.synthetic);");
}

const EMPTY_TICKETING_SETTINGS = Object.freeze({
  provider: 'mock', apiBaseUrl: '', clientId: '', clientSecret: '', username: '', password: '',
  scope: 'api', apiVersion: 'v2', knowledgeResource: 'Knowledgebase/Article', queueCategoryIds: {},
});

export function getTenantTicketingConfiguration() {
  const tenantId = currentTenantId() || DEFAULT_TENANT_ID;
  const saved = queryJson(`SELECT value FROM app_settings WHERE key='ticketing_integration' LIMIT 1`, null);
  if (saved) return { ...saved, clientSecret: decryptTenantSecret(saved.clientSecret), password: decryptTenantSecret(saved.password) };
  if (tenantId === DEFAULT_TENANT_ID) return {
    provider: ticketingProvider, apiBaseUrl: glpiConfig.apiBaseUrl, clientId: glpiConfig.clientId,
    clientSecret: glpiConfig.clientSecret, username: glpiConfig.username, password: glpiConfig.password,
    scope: glpiConfig.scope, apiVersion: glpiConfig.apiVersion,
    knowledgeResource: glpiConfig.knowledgeResource, queueCategoryIds: glpiConfig.queueCategoryIds,
  };
  return { ...EMPTY_TICKETING_SETTINGS, queueCategoryIds: {} };
}

export function getTenantTicketingSettings() {
  const config = getTenantTicketingConfiguration();
  return {
    provider: config.provider, apiBaseUrl: config.apiBaseUrl, clientId: config.clientId,
    username: config.username, scope: config.scope, apiVersion: config.apiVersion,
    knowledgeResource: config.knowledgeResource, queueCategoryIds: config.queueCategoryIds,
    hasClientSecret: Boolean(config.clientSecret), hasPassword: Boolean(config.password),
  };
}

export function saveTenantTicketingSettings(input = {}) {
  const current = getTenantTicketingConfiguration();
  const values = {
    provider: String(input.provider || 'mock').trim().toLowerCase(),
    apiBaseUrl: String(input.apiBaseUrl || '').trim().replace(/\/+$/, ''),
    clientId: String(input.clientId || '').trim(),
    clientSecret: String(input.clientSecret || '').trim() || (String(input.provider || 'mock').trim().toLowerCase() === current.provider ? current.clientSecret : ''),
    username: String(input.username || '').trim(), password: String(input.password || '').trim() || (String(input.provider || 'mock').trim().toLowerCase() === current.provider ? current.password : ''),
    scope: String(input.scope || 'api').trim(), apiVersion: String(input.apiVersion || 'v2').trim(),
    knowledgeResource: String(input.knowledgeResource || 'Knowledgebase/Article').trim(),
    queueCategoryIds: Object.fromEntries(Object.entries(input.queueCategoryIds || {}).map(([queue, id]) => {
      const value = String(id || '').trim();
      if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(queue) || (value && !/^\d+$/.test(value))) throw new Error('Revise os c\u00f3digos das filas e os IDs num\u00e9ricos do GLPI.');
      return [queue, value];
    }).filter(([, id]) => id)),
  };
  if (!['mock','glpi'].includes(values.provider)) throw new Error('Provedor de chamados inv\u00e1lido.');
  if (values.apiBaseUrl && !/^https?:\/\//i.test(values.apiBaseUrl)) throw new Error('A URL do GLPI deve come\u00e7ar com http:// ou https://.');
  if (values.provider === 'glpi') {
    if (!values.apiBaseUrl || !values.clientId || !values.clientSecret || !values.username || !values.password) throw new Error('Preencha URL, ID do cliente, segredos e usu\u00e1rio do GLPI.');
    encryptTenantSecret(values.clientSecret);
    encryptTenantSecret(values.password);
  }
  const stored = { ...values, clientSecret: encryptTenantSecret(values.clientSecret), password: encryptTenantSecret(values.password) };
  query(`INSERT INTO app_settings(tenant_id,key,value) VALUES(COALESCE(NULLIF(current_setting('app.tenant_id',true),'')::uuid,'${DEFAULT_TENANT_ID}'::uuid),'ticketing_integration',${sqlValue(JSON.stringify(stored))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`);
  return getTenantTicketingSettings();
}

export function tenantBySlug(slug) {
  const normalized = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(normalized)) return null;
  return queryRegistryJson(`SELECT JSON_OBJECT('id',id,'slug',slug,'name',name) FROM tenants WHERE slug=${sqlValue(normalized)} AND active=true LIMIT 1`, null);
}

export function createTenant(input = {}) {
  const name = String(input.name || '').trim();
  const slug = String(input.slug || '').trim().toLowerCase();
  if (name.length < 2 || name.length > 120) throw new Error('O nome da organizacao deve ter de 2 a 120 caracteres.');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(slug)) throw new Error('O identificador deve ter de 3 a 63 caracteres, com letras, numeros e hifens.');
  const id = randomUUID();
  try {
    queryRegistry(`INSERT INTO tenants(id,slug,name) VALUES(${sqlValue(id)},${sqlValue(slug)},${sqlValue(name)})`);
    initializeTenantDatabase(id);
    return { id, slug, name };
  } catch (error) {
    if (/unique|duplicate/i.test(error.message)) throw new Error('Ja existe uma organizacao com esse identificador.');
    throw error;
  }
}
export function getTriageQuestionSettings() {
  const saved = queryJson(
    `SELECT value FROM app_settings WHERE key='triage_questions' LIMIT 1`,
    null,
  );
  return saved || decisionQuestions;
}

const DEFAULT_SUPPORT_PROFILE = Object.freeze({
  organizationName: 'Tribunal',
  serviceName: 'Suporte de TIC',
  requestLabel: 'solicita\\u00e7\\u00e3o de suporte',
  scopeDescription: 'problemas de tecnologia da informa\\u00e7\\u00e3o, incluindo sistemas, equipamentos, redes e aplicativos utilizados no Tribunal.',
});

export function normalizeSupportProfile(input = {}) {
  const profile = {};
  for (const [key, label, max] of [
    ['organizationName', 'O nome da organiza\\u00e7\\u00e3o', 100],
    ['serviceName', 'O nome do servi\\u00e7o de suporte', 100],
    ['requestLabel', 'O nome da solicita\\u00e7\\u00e3o', 60],
    ['scopeDescription', 'A descri\\u00e7\\u00e3o do escopo do suporte', 600],
  ]) {
    const value = String(input[key] ?? DEFAULT_SUPPORT_PROFILE[key]).trim();
    if (value.length < 2 || value.length > max) throw new Error(`${label} deve ter entre 2 e ${max} caracteres.`);
    profile[key] = value;
  }
  return profile;
}

function questionsForProfile(questions, profile) {
  return {
    ...questions,
    is_it_support: {
      ...questions.is_it_support,
      instructions: `A mensagem descreve a demanda "${profile.requestLabel}" atendida pelo servi\\u00e7o ${profile.serviceName} da organiza\\u00e7\\u00e3o ${profile.organizationName}? Escopo: ${profile.scopeDescription} Responda n\\u00e3o para assuntos que n\\u00e3o pertencem a esse servi\\u00e7o.`,
    },
  };
}

export function normalizeTriageQuestionSettings(input = {}) {
  const updated = {};
  for (const [key, original] of Object.entries(decisionQuestions)) {
    const instructions = String(input[key]?.instructions ?? '').trim();
    if (instructions.length < 12 || instructions.length > 800)
      throw new Error(`A instrução de ${key} deve ter entre 12 e 800 caracteres.`);
    const question = { ...original, instructions };
    if (original.criteria && !Array.isArray(original.criteria)) {
      const sourceCriteria = input[key]?.criteria || original.criteria;
      if (!sourceCriteria || typeof sourceCriteria !== 'object' || Array.isArray(sourceCriteria)) throw new Error(`As opções de ${key} devem ser um objeto.`);
      const optionKeys = Object.keys(sourceCriteria);
      const maxOptions = ['system','category'].includes(key) ? 100 : Object.keys(original.criteria).length;
      if (optionKeys.length > maxOptions) throw new Error(`A pergunta ${key} aceita até ${maxOptions} opções no Laya local.`);
      for (const option of Object.keys(original.criteria)) if (!Object.hasOwn(sourceCriteria, option)) throw new Error(`A opção padrão ${option} não pode ser removida de ${key}.`);
      question.criteria = {};
      for (const option of optionKeys) {
        if (!/^[A-Z][A-Z0-9_]{1,39}$/.test(option)) throw new Error(`O código da opção ${option} deve usar letras maiúsculas, números ou sublinhado.`);
        const text = String(sourceCriteria[option] ?? '').trim();
        if (text.length < 2 || text.length > 240) throw new Error(`Invalid criterion ${option} for ${key}.`);
        question.criteria[option] = text;
      }
    } else if (Array.isArray(original.criteria)) {
      const sourceCriteria = Array.isArray(input[key]?.criteria) ? input[key].criteria : original.criteria;
      const maxLevels = 32;
      if (sourceCriteria.length > maxLevels) throw new Error(`A escala ${key} aceita até ${maxLevels} níveis no Laya local.`);
      if (sourceCriteria.length < original.criteria.length) throw new Error(`A escala ${key} precisa manter pelo menos os quatro níveis padrão.`);
      question.criteria = sourceCriteria.map((_, index) => {
        const text = String(sourceCriteria[index] ?? '').trim();
        if (text.length < 2 || text.length > 240) throw new Error(`Invalid level ${index + 1} for ${key}.`);
        return text;
      });
    }
    updated[key] = question;
  }
  return updated;
}

export function normalizeCategoryOptionMappings(input = {}, criteria = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Os vínculos das categorias devem ser um objeto.');
  const mappings = {};
  for (const code of Object.keys(criteria)) {
    if (CATEGORIES.includes(code)) continue;
    const target = String(input[code] || code).toUpperCase();
    if (!Object.hasOwn(criteria, target)) throw new Error(`A opção personalizada ${code} deve ser associada a uma categoria configurada.`);
    mappings[code] = target;
  }
  return mappings;
}

export function normalizeSystemOptionMappings(input = {}, criteria = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Os vínculos das opções de sistema devem ser um objeto.');
  const mappings = {};
  for (const code of Object.keys(criteria)) {
    if (SYSTEMS.includes(code)) continue;
    const requestedTarget = String(input[code] || 'OTHER').toUpperCase();
    mappings[code] = SYSTEMS.includes(requestedTarget) ? requestedTarget : 'OTHER';
  }
  return mappings;
}

export function saveTriageQuestionSettings(input = {}) {
  const updated = normalizeTriageQuestionSettings(input);
  query(
    `INSERT INTO app_settings(key,value) VALUES('triage_questions',${sqlValue(JSON.stringify(updated))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
  );
  return updated;
}
export function getTriageThresholdSettings() {
  const saved = queryJson(`SELECT value FROM app_settings WHERE key='triage_thresholds' LIMIT 1`, null);
  return normalizeTriageThresholdSettings(saved || TRIAGE_THRESHOLDS);
}

export function normalizeTriageThresholdSettings(input = {}) {
  const normalized = {};
  for (const key of Object.keys(TRIAGE_THRESHOLDS)) {
    const value = Number(input[key] ?? TRIAGE_THRESHOLDS[key]);
    if (!Number.isFinite(value) || value < 0 || value > 1)
      throw new Error(`O limite ${key} deve estar entre 0% e 100%.`);
    normalized[key] = Math.round(value * 100) / 100;
  }
  if (normalized.outOfScope >= normalized.inScope)
    throw new Error('O limite de fora do escopo deve ser menor que o limite de dentro do escopo.');
  return normalized;
}

export function getTriageConfiguration() {
  const setting = (key, fallback) => queryJson(`SELECT value FROM app_settings WHERE key=${sqlValue(key)} LIMIT 1`, fallback);
  const tenantDefault = queryRegistryJson(`SELECT JSON_OBJECT('organizationName',name) FROM tenants WHERE id=${sqlValue(currentTenantId() || DEFAULT_TENANT_ID)} LIMIT 1`, DEFAULT_SUPPORT_PROFILE);
  const tenantId = currentTenantId() || DEFAULT_TENANT_ID;
  const tenantProfileDefaults = tenantId === DEFAULT_TENANT_ID ? { ...DEFAULT_SUPPORT_PROFILE, ...tenantDefault } : { ...DEFAULT_SUPPORT_PROFILE, ...tenantDefault, serviceName: 'Suporte', scopeDescription: 'Demandas atendidas pelo servi\u00e7o de suporte definido para esta organiza\u00e7\u00e3o.' };
  const supportProfile = normalizeSupportProfile(setting('triage_support_profile', tenantProfileDefaults));
  const questions = questionsForProfile(getTriageQuestionSettings(), supportProfile);
  return {
    supportProfile,
    questions,
    systemOptionMappings: normalizeSystemOptionMappings(setting('triage_system_option_mappings', {}), questions.system?.criteria || {}),
    categoryOptionMappings: normalizeCategoryOptionMappings(setting('triage_category_option_mappings', {}), questions.category?.criteria || {}),
    thresholds: getTriageThresholdSettings(),
    routing: normalizeTriageRouting(setting('triage_routing', TRIAGE_ROUTING)),
    routingRules: normalizeTriageRoutingRules(setting('triage_routing_rules', TRIAGE_ROUTING_RULES), Object.keys(questions.category?.criteria || {}), Object.keys(questions.system?.criteria || {})),
    priorityMatrix: normalizeTriagePriorityMatrix(setting('triage_priority_matrix', TRIAGE_PRIORITY_MATRIX)),
    automationApproved: Boolean(setting('triage_automation', process.env.TRIAGE_AUTOMATION_APPROVED === 'true')),
    calibrationRules: normalizeTriageCalibrationRules(setting('triage_calibration', TRIAGE_CALIBRATION_RULES), Object.keys(questions.category?.criteria || {}), Object.keys(questions.system?.criteria || {})),
    payloadTemplate: normalizeTriagePayloadTemplate(setting('triage_payload', DEFAULT_LAYA_PAYLOAD_TEMPLATE)),
  };
}

export function normalizeTriagePayloadTemplate(input = DEFAULT_LAYA_PAYLOAD_TEMPLATE) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || JSON.stringify(input).length > 20000)
    throw new Error('O payload do Laya deve ser um objeto JSON com até 20 KB.');
  if (typeof input.model !== 'string' || !input.model.trim() || input.model.length > 120)
    throw new Error('Informe o modelo do Laya ou use {{model}}.');
  if (!input.state || typeof input.state !== 'object' || Array.isArray(input.state) || input.state.support_request !== '{{description}}')
    throw new Error('O payload precisa conter state.support_request com o marcador {{description}}.');
  if (input.questions !== '{{questions}}')
    throw new Error('O payload precisa conter questions com o marcador {{questions}} para enviar os critérios configurados.');
  const allowed = new Set(['description','model','questions']);
  const inspect = (value) => {
    if (Array.isArray(value)) return value.forEach(inspect);
    if (value && typeof value === 'object') return Object.values(value).forEach(inspect);
    if (typeof value === 'string') for (const match of value.matchAll(/\{\{([^{}]+)\}\}/g)) {
      if (!allowed.has(match[1])) throw new Error('Marcador desconhecido no payload: {{' + match[1] + '}}.');
    }
  };
  inspect(input);
  return JSON.parse(JSON.stringify(input));
}

export function normalizeTriageRouting(input = {}) {
  const routing = {};
  for (const key of Object.keys(TRIAGE_ROUTING)) {
    const value = String(input[key] ?? TRIAGE_ROUTING[key]).trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_-]{1,63}$/.test(value)) throw new Error(`A fila de destino para ${key} deve usar letras, números, hífens ou sublinhados.`);
    routing[key] = value;
  }
  return routing;
}

export function normalizeTriageRoutingRules(input = [], categories = CATEGORIES, systems = SYSTEMS) {
  if (!Array.isArray(input) || input.length > 80) throw new Error('Configure até 80 regras de roteamento.');
  return input.map((rule) => {
    if (!rule || !Array.isArray(rule.when) || !rule.when.length || rule.when.length > 40) throw new Error('Cada regra de roteamento precisa conter de 1 a 40 condições.');
    const when = rule.when.map(({ field, value }) => {
      const normalizedField = String(field || '').toLowerCase(); const normalizedValue = String(value || '').toUpperCase();
      if (normalizedField === 'category' && categories.includes(normalizedValue)) return { field: normalizedField, value: normalizedValue };
      if (normalizedField === 'system' && systems.includes(normalizedValue)) return { field: normalizedField, value: normalizedValue };
      throw new Error('Condição inválida na regra de roteamento. Use categoria ou sistema existentes.');
    });
    const target = String(rule.target || '').toLowerCase();
    if (!Object.hasOwn(TRIAGE_ROUTING, target)) throw new Error('Destino inválido na regra de roteamento.');
    return { when, target };
  });
}

export function normalizeTriagePriorityMatrix(input = {}) {
  const matrix = {};
  for (const impact of LEVELS) {
    matrix[impact] = {};
    for (const urgency of LEVELS) {
      const value = String(input?.[impact]?.[urgency] ?? TRIAGE_PRIORITY_MATRIX[impact][urgency]).toUpperCase();
      if (!LEVELS.includes(value)) throw new Error(`A prioridade para impacto ${impact} e urgência ${urgency} deve ser LOW, MEDIUM, HIGH ou CRITICAL.`);
      matrix[impact][urgency] = value;
    }
  }
  return matrix;
}

export function normalizeTriageCalibrationRules(input = {}, categories = CATEGORIES, systems = SYSTEMS) {
  const defaults = TRIAGE_CALIBRATION_RULES;
  const list = (key) => {
    const value = input[key] ?? defaults[key];
    if (!Array.isArray(value) || value.length > 80) throw new Error(`A lista ${key} deve conter no máximo 80 termos.`);
    return value.map((item) => {
      const term = String(item).trim();
      if (!term || term.length > 100) throw new Error(`Cada termo de ${key} deve ter entre 1 e 100 caracteres.`);
      return term;
    });
  };
  const rules = { ...defaults };
  for (const key of ['technicalTerms','outOfScopeTerms','collectiveTerms','outageTerms','individualOnlyTerms','vagueTerms','technicalDetailTerms','fallbackUrgencyTerms']) rules[key] = list(key);
  if (!Array.isArray(input.categoryRules ?? defaults.categoryRules) || (input.categoryRules ?? defaults.categoryRules).length > 40) throw new Error('Configure até 40 regras de categoria.');
  rules.categoryRules = (input.categoryRules ?? defaults.categoryRules).map((rule) => {
    if (!rule || !Array.isArray(rule.groups) || rule.groups.length < 1 || rule.groups.length > 5) throw new Error('Cada regra de categoria precisa ter de 1 a 5 grupos de termos.');
    const groups = rule.groups.map((group) => {
      if (!Array.isArray(group) || group.length < 1 || group.length > 30) throw new Error('Cada grupo deve conter de 1 a 30 termos.');
      return group.map((term) => { const text = String(term).trim(); if (!text || text.length > 100) throw new Error('Cada termo deve ter entre 1 e 100 caracteres.'); return text; });
    });
    const category = String(rule.category || '').toUpperCase();
    if (!categories.includes(category)) throw new Error(`Categoria inválida na regra: ${category}.`);
    const system = rule.system == null ? null : String(rule.system).toUpperCase();
    if (system && !systems.includes(system)) throw new Error(`Sistema inválido na regra: ${system}.`);
    if (!system && rule.systemFromText !== true) throw new Error('Cada regra de categoria precisa definir um sistema ou usar systemFromText.');
    return { groups, category, system, systemFromText: rule.systemFromText === true };
  });
  const fallback = input.fallbackRules ?? defaults.fallbackRules;
  if (!Array.isArray(fallback) || fallback.length > 40) throw new Error('Configure até 40 regras de classificação local.');
  rules.fallbackRules = fallback.map((rule) => {
    const terms = Array.isArray(rule.terms) ? rule.terms.map((x) => String(x).trim()) : [];
    const category = String(rule.category || '').toUpperCase(); const system = String(rule.system || '').toUpperCase(); const confidence = Number(rule.confidence);
    if (!terms.length || terms.length > 40 || terms.some((x) => !x || x.length > 100)) throw new Error('Cada regra local precisa ter de 1 a 40 termos válidos.');
    if (!categories.includes(category) || !systems.includes(system) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('Revise categoria, sistema e confiança das regras locais.');
    return { terms, category, system, confidence };
  });
  rules.systemTerms = {};
  const systemTerms = input.systemTerms ?? defaults.systemTerms;
  if (!systemTerms || typeof systemTerms !== 'object' || Array.isArray(systemTerms)) throw new Error('Configure os termos de identificação dos sistemas.');
  for (const [system, terms] of Object.entries(systemTerms)) { if (!systems.includes(system)) throw new Error(`Sistema inválido nos termos: ${system}.`); rules.systemTerms[system] = Array.isArray(terms) ? terms.map((term) => String(term).trim()).filter(Boolean) : []; if (!rules.systemTerms[system].length || rules.systemTerms[system].some((term) => term.length > 100)) throw new Error(`Informe termos válidos para o sistema ${system}.`); }
  rules.outOfScopeCategory = String(input.outOfScopeCategory ?? defaults.outOfScopeCategory).toUpperCase();
  if (!categories.includes(rules.outOfScopeCategory)) throw new Error('A categoria fora do escopo precisa ser válida.');
  rules.fallbackUnknownSystem = String(input.fallbackUnknownSystem ?? defaults.fallbackUnknownSystem).toUpperCase();
  if (!systems.includes(rules.fallbackUnknownSystem)) throw new Error('O sistema padrão precisa ser válido.');
  rules.impactOnIncident = String(input.impactOnIncident ?? defaults.impactOnIncident).toUpperCase();
  if (!['LOW','MEDIUM','HIGH','CRITICAL'].includes(rules.impactOnIncident)) throw new Error('O impacto para incidentes deve ser LOW, MEDIUM, HIGH ou CRITICAL.');
  for (const key of ['supportScopeProbability','outOfScopeProbability','fallbackMatchedScopeProbability','fallbackUnmatchedScopeProbability','fallbackConfidence','yesNoThreshold','incidentConfidenceBoost','outageConfidenceBoost','collectiveConfidenceIncrease','collectiveConfidenceMaximum']) { const value = Number(input[key] ?? defaults[key]); if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${key} deve estar entre 0% e 100%.`); rules[key] = value; }
  rules.confidenceAggregation = String(input.confidenceAggregation ?? defaults.confidenceAggregation).toLowerCase();
  if (!['minimum','average'].includes(rules.confidenceAggregation)) throw new Error('Agregação de confiança deve ser minimum ou average.');
  for (const key of ['urgencyOnIncident','defaultScoreLevel','fallbackImpact','fallbackUrgency','fallbackMatchedUrgency']) { const value = String(input[key] ?? defaults[key]).toUpperCase(); if (!LEVELS.includes(value)) throw new Error(`${key} deve ser LOW, MEDIUM, HIGH ou CRITICAL.`); rules[key] = value; }
  return rules;
}

export function saveTriageConfiguration(input = {}) {
  const current = getTriageConfiguration();
  const supportProfile = normalizeSupportProfile(input.supportProfile || current.supportProfile);
  const questions = questionsForProfile(normalizeTriageQuestionSettings(input.questions || input), supportProfile);
  const systemOptionMappings = normalizeSystemOptionMappings(input.systemOptionMappings || current.systemOptionMappings, questions.system.criteria);
  const categoryOptionMappings = normalizeCategoryOptionMappings(input.categoryOptionMappings || current.categoryOptionMappings, questions.category.criteria);
  const thresholds = normalizeTriageThresholdSettings(input.thresholds || current.thresholds);
  const routing = normalizeTriageRouting(input.routing || current.routing);
  const categories = Object.keys(questions.category.criteria);
  const systems = Object.keys(questions.system.criteria);
  const routingRules = normalizeTriageRoutingRules(input.routingRules || current.routingRules, categories, systems);
  const priorityMatrix = normalizeTriagePriorityMatrix(input.priorityMatrix || current.priorityMatrix);
  const automationApproved = input.automationApproved == null ? current.automationApproved : input.automationApproved === true;
  if (input.automationApproved != null && typeof input.automationApproved !== 'boolean') throw new Error('A liberação de automação deve ser verdadeiro ou falso.');
  const calibrationRules = normalizeTriageCalibrationRules(input.calibrationRules || current.calibrationRules, categories, systems);
  const payloadTemplate = normalizeTriagePayloadTemplate(input.payloadTemplate || current.payloadTemplate);
  query(`BEGIN; INSERT INTO app_settings(key,value) VALUES('triage_support_profile',${sqlValue(JSON.stringify(supportProfile))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(); INSERT INTO app_settings(key,value) VALUES('triage_questions',${sqlValue(JSON.stringify(questions))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(); INSERT INTO app_settings(key,value) VALUES('triage_system_option_mappings',${sqlValue(JSON.stringify(systemOptionMappings))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(); INSERT INTO app_settings(key,value) VALUES('triage_category_option_mappings',${sqlValue(JSON.stringify(categoryOptionMappings))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(); INSERT INTO app_settings(key,value) VALUES('triage_thresholds',${sqlValue(JSON.stringify(thresholds))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(); INSERT INTO app_settings(key,value) VALUES('triage_routing',${sqlValue(JSON.stringify(routing))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(); INSERT INTO app_settings(key,value) VALUES('triage_routing_rules',${sqlValue(JSON.stringify(routingRules))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(); INSERT INTO app_settings(key,value) VALUES('triage_priority_matrix',${sqlValue(JSON.stringify(priorityMatrix))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(); INSERT INTO app_settings(key,value) VALUES('triage_automation',${sqlValue(JSON.stringify(automationApproved))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(); INSERT INTO app_settings(key,value) VALUES('triage_calibration',${sqlValue(JSON.stringify(calibrationRules))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(); INSERT INTO app_settings(key,value) VALUES('triage_payload',${sqlValue(JSON.stringify(payloadTemplate))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now(); COMMIT;`);
  return { supportProfile, questions, systemOptionMappings, categoryOptionMappings, thresholds, routing, routingRules, priorityMatrix, automationApproved, calibrationRules, payloadTemplate };
}
export function triageBenchmarkCases() {
  const cases = JSON.parse(fs.readFileSync(path.join(projectRoot, 'evaluation', 'cases.json'), 'utf8'));
  return cases.map(({ id, text, expected }) => ({ id, text, expected }));
}
function seedTickets() {
  const count = Number(query('SELECT count(*) FROM tickets'));
  if (count > 0) return;
  const demos = [
    [
      'JUD-000101',
      'PJe não abre desde o início da manhã. A unidade está sem conseguir consultar os processos.',
      'SYSTEM',
      'PJE',
      'HIGH',
      'HIGH',
      'HIGH',
      'SUPORTE_PJE',
      0.95,
      11,
    ],
    [
      'JUD-000102',
      'Não consigo entrar no PJe, aparece erro ao acessar.',
      'SYSTEM',
      'PJE',
      'HIGH',
      'HIGH',
      'HIGH',
      'SUPORTE_PJE',
      0.92,
      8,
    ],
    [
      'JUD-000103',
      'PJe está indisponível para várias pessoas da unidade.',
      'SYSTEM',
      'PJE',
      'HIGH',
      'HIGH',
      'HIGH',
      'SUPORTE_PJE',
      0.94,
      5,
    ],
    [
      'JUD-000104',
      'A internet está instável na minha estação.',
      'NETWORK',
      'INTERNET',
      'MEDIUM',
      'MEDIUM',
      'MEDIUM',
      'SUPORTE_REDE',
      0.91,
      2,
    ],
    [
      'JUD-000105',
      'Impressora do setor não está imprimindo.',
      'HARDWARE',
      'PRINTER',
      'MEDIUM',
      'MEDIUM',
      'MEDIUM',
      'SUPORTE_HARDWARE',
      0.9,
      1,
    ],
  ];
  for (let n = 0; n < demos.length; n++) {
    const d = demos[n],
      rid = `REQ-DEMO-0${n + 1}`,
      id = `TCK-DEMO-0${n + 1}`,
      decision = {
        category: d[2],
        system: d[3],
        impact: d[4],
        urgency: d[5],
        possibleIncident: d[3] === 'PJE',
        humanRequired: true,
        confidence: d[8],
        categoryConfidence: d[8],
        impactConfidence: d[8],
        urgencyConfidence: d[8],
        incidentConfidence: d[8],
        humanConfidence: d[8],
      };
    query(
      `INSERT INTO requests(id,description,decision,priority,queue,confidence,article_id,provider,created_at) VALUES(${sqlValue(rid)},${sqlValue(d[1])},${sqlValue(JSON.stringify(decision))}::jsonb,${sqlValue(d[6])},${sqlValue(d[7])},${d[8]},${sqlValue(d[3] === 'PJE' ? 'KB-001' : null)},'synthetic_seed',now()-interval '${d[9]} minutes') ON CONFLICT DO NOTHING`,
    );
    query(
      `INSERT INTO tickets(id,protocol,request_id,description,category,system,impact,urgency,priority,assigned_queue,confidence,created_at) VALUES(${sqlValue(id)},${sqlValue(d[0])},${sqlValue(rid)},${sqlValue(d[1])},${sqlValue(d[2])},${sqlValue(d[3])},${sqlValue(d[4])},${sqlValue(d[5])},${sqlValue(d[6])},${sqlValue(d[7])},${d[8]},now()-interval '${d[9]} minutes') ON CONFLICT DO NOTHING`,
    );
  }
}

export function articlesFor(category, system) {
  return queryJson(`SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id',id,'title',title,'category',category,'system',system,'problem',problem,'solution',solution,'steps',JSON_EXTRACT(steps,'$')) ORDER BY CASE WHEN system=${sqlValue(system)} THEN 0 ELSE 1 END,id LIMIT 5),'[]') FROM knowledge_articles WHERE active AND (system=${sqlValue(system)} OR category=${sqlValue(category)})`);
}
export function listTickets(ownerId = null) {
  const targets = getPilotConfiguration().targets;
  const ownerFilter = ownerId ? `WHERE r.created_by=${sqlValue(ownerId)}` : '';
  return queryJson(`SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT(
    'id',t.id,'protocol',t.protocol,'requestId',t.request_id,'description',t.description,'category',t.category,'system',t.system,'impact',t.impact,'urgency',t.urgency,'priority',t.priority,'status',t.status,'queue',t.assigned_queue,'queueRouting',t.queue_routing,'glpiCategoryId',t.glpi_category_id,'confidence',t.confidence,'incidentId',t.incident_code,'createdAt',t.created_at,'locality',r.locality,
    'firstResolvedAt',t.first_resolved_at,'firstAssignedAt',t.first_assigned_at,
    'integration',JSON_OBJECT('provider',CASE WHEN t.id LIKE 'GLPI-%' THEN 'glpi' ELSE 'mock' END,'mode',CASE WHEN t.id LIKE 'GLPI-%' THEN 'external' ELSE 'simulated' END,'displayName',CASE WHEN t.id LIKE 'GLPI-%' THEN 'GLPI 11' ELSE 'Conector simulado' END),
    'provider',CASE WHEN r.corrected_decision IS NOT NULL THEN 'human_correction' ELSE r.provider END,'articleId',COALESCE(JSON_UNQUOTE(JSON_EXTRACT(r.article_snapshot,'$.id')),r.article_id),'article',JSON_EXTRACT(r.article_snapshot,'$'),'decision',JSON_EXTRACT(COALESCE(r.corrected_decision,r.decision),'$'),'humanCorrected',r.corrected_decision IS NOT NULL,'synthetic',t.synthetic
  ) ORDER BY t.created_at DESC),'[]') FROM tickets t JOIN requests r ON r.id=t.request_id ${ownerFilter}`).map(
    (ticket) => ({ ...ticket, confidence: Number(ticket.confidence), serviceDeadline: serviceDeadline(ticket, targets) }),
  );
}
export function requestOwnedBy(requestId, userId) {
  return query(
    `SELECT 1 FROM requests WHERE id=${sqlValue(requestId)} AND created_by=${sqlValue(userId)}::uuid LIMIT 1`,
  ) === '1';
}
export function ticketOwnedBy(ticketId, userId) {
  return query(
    `SELECT 1 FROM tickets t JOIN requests r ON r.id=t.request_id WHERE t.id=${sqlValue(ticketId)} AND r.created_by=${sqlValue(userId)}::uuid LIMIT 1`,
  ) === '1';
}
export function recordTicketStatus(ticketId, status) {
  const knownStatuses = new Set(['NEW', 'ASSIGNED', 'PLANNED', 'WAITING', 'SOLVED', 'CLOSED', 'OPEN', 'UNKNOWN']);
  if (!knownStatuses.has(status)) throw new Error('Status de chamado invÃ¡lido.');
  const current = queryJson(
    `SELECT json_build_object('status',status,'firstAssignedAt',first_assigned_at,'firstResolvedAt',first_resolved_at) FROM tickets WHERE id=${sqlValue(ticketId)} LIMIT 1`,
    null,
  );
  if (!current) return null;
  const assigned = ['ASSIGNED', 'PLANNED', 'WAITING', 'SOLVED', 'CLOSED'].includes(status);
  const resolved = ['SOLVED', 'CLOSED'].includes(status);
  query(
    `UPDATE tickets SET status=${sqlValue(status)},first_assigned_at=CASE WHEN ${assigned} AND first_assigned_at IS NULL THEN now() ELSE first_assigned_at END,first_resolved_at=CASE WHEN ${resolved} AND first_resolved_at IS NULL THEN now() ELSE first_resolved_at END,status_synced_at=now() WHERE id=${sqlValue(ticketId)}`,
  );
  if (current.status !== status)
    query(
      `INSERT INTO ticket_status_history(ticket_id,previous_status,status) VALUES(${sqlValue(ticketId)},${sqlValue(current.status)},${sqlValue(status)})`,
    );
  return { previousStatus: current.status, status, changed: current.status !== status };
}

export function saveRequestFeedback(requestId, rating, comment = '') {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new Error('A avaliaÃ§Ã£o deve ser de 1 a 5.');
  const request = queryJson(
    `SELECT json_build_object('id',id,'status',status,'synthetic',synthetic) FROM requests WHERE id=${sqlValue(requestId)} LIMIT 1`,
    null,
  );
  if (!request || request.synthetic) throw new Error('SolicitaÃ§Ã£o nÃ£o encontrada para avaliaÃ§Ã£o.');
  if (request.status !== 'SELF_SERVICE_RESOLVED')
    throw new Error('A avaliaÃ§Ã£o sÃ³ pode ser registrada apÃ³s uma resoluÃ§Ã£o por autoatendimento.');
  const note = String(comment).trim().slice(0, 500) || null;
  query(
    `INSERT INTO request_feedback(request_id,rating,comment) VALUES(${sqlValue(requestId)},${rating},${sqlValue(note)}) ON CONFLICT(request_id) DO UPDATE SET rating=EXCLUDED.rating,comment=EXCLUDED.comment,created_at=now()`,
  );
  return { saved: true };
}

export function pilotMetrics() {
  const metricForWindow = (start, end) => {
    if (!start || !end) return null;
    const from = `${sqlValue(start)}::timestamptz`;
    const to = `${sqlValue(end)}::date + interval '1 day'`;
    const targetValues = queryJson(`SELECT value FROM app_settings WHERE key='pilot_sla_targets' LIMIT 1`, null) || {};
    const targetJson = JSON.stringify(targetValues);
    const targetsSql = `${sqlValue(targetJson)}::jsonb`;
    return queryJson(`WITH targets AS (SELECT
      (${targetsSql}->'response'->>'CRITICAL')::numeric AS response_critical,
      (${targetsSql}->'response'->>'HIGH')::numeric AS response_high,
      (${targetsSql}->'response'->>'MEDIUM')::numeric AS response_medium,
      (${targetsSql}->'response'->>'LOW')::numeric AS response_low,
      (${targetsSql}->'resolution'->>'CRITICAL')::numeric AS resolution_critical,
      (${targetsSql}->'resolution'->>'HIGH')::numeric AS resolution_high,
      (${targetsSql}->'resolution'->>'MEDIUM')::numeric AS resolution_medium,
      (${targetsSql}->'resolution'->>'LOW')::numeric AS resolution_low
    ), requests_window AS (
      SELECT r.* FROM requests r WHERE r.synthetic=false AND r.created_at >= ${from} AND r.created_at < ${to}
    ), tickets_window AS (
      SELECT t.*,r.locality FROM tickets t JOIN requests_window r ON r.id=t.request_id WHERE t.synthetic=false
    )
    SELECT json_build_object(
      'requests',(SELECT count(*) FROM requests_window),
      'tickets',(SELECT count(*) FROM tickets_window),
      'selfServiceResolved',(SELECT count(*) FROM service_events e JOIN requests_window r ON r.id=e.request_id WHERE e.type='SELF_SERVICE_RESOLVED'),
      'avgMinutesToAssignment',(SELECT round(avg(TIMESTAMPDIFF(MICROSECOND,created_at,first_assigned_at)/60000000)::numeric,1) FROM tickets_window WHERE first_assigned_at IS NOT NULL),
      'avgMinutesToResolution',(SELECT round(avg(TIMESTAMPDIFF(MICROSECOND,created_at,first_resolved_at)/60000000)::numeric,1) FROM tickets_window WHERE first_resolved_at IS NOT NULL),
      'responseSla',(SELECT CASE WHEN COUNT(*)=0 THEN NULL ELSE ROUND(100.0*SUM(CASE WHEN TIMESTAMPDIFF(SECOND,created_at,first_assigned_at) <= (CASE priority WHEN 'CRITICAL' THEN targets.response_critical WHEN 'HIGH' THEN targets.response_high WHEN 'MEDIUM' THEN targets.response_medium WHEN 'LOW' THEN targets.response_low END)*60 THEN 1 ELSE 0 END)/COUNT(*),1) END FROM tickets_window CROSS JOIN targets WHERE first_assigned_at IS NOT NULL AND (CASE priority WHEN 'CRITICAL' THEN targets.response_critical WHEN 'HIGH' THEN targets.response_high WHEN 'MEDIUM' THEN targets.response_medium WHEN 'LOW' THEN targets.response_low END) IS NOT NULL),
      'resolutionSla',(SELECT CASE WHEN COUNT(*)=0 THEN NULL ELSE ROUND(100.0*SUM(CASE WHEN TIMESTAMPDIFF(SECOND,created_at,first_resolved_at) <= (CASE priority WHEN 'CRITICAL' THEN targets.resolution_critical WHEN 'HIGH' THEN targets.resolution_high WHEN 'MEDIUM' THEN targets.resolution_medium WHEN 'LOW' THEN targets.resolution_low END)*60 THEN 1 ELSE 0 END)/COUNT(*),1) END FROM tickets_window CROSS JOIN targets WHERE first_resolved_at IS NOT NULL AND (CASE priority WHEN 'CRITICAL' THEN targets.resolution_critical WHEN 'HIGH' THEN targets.resolution_high WHEN 'MEDIUM' THEN targets.resolution_medium WHEN 'LOW' THEN targets.resolution_low END) IS NOT NULL),
      'avgSatisfaction',(SELECT round(avg(f.rating)::numeric,2) FROM request_feedback f JOIN requests_window r ON r.id=f.request_id),
      'satisfactionResponses',(SELECT count(*) FROM request_feedback f JOIN requests_window r ON r.id=f.request_id)
    )`);
  };
  const settings = queryJson(
    `SELECT value FROM app_settings WHERE key='pilot_windows' LIMIT 1`,
    null,
  ) || {};
  const baseline = metricForWindow(settings.baselineStart, settings.baselineEnd);
  const pilot = metricForWindow(settings.pilotStart, settings.pilotEnd);
  const locality = settings.pilotStart && settings.pilotEnd
    ? queryJson(`SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('locality',locality,'tickets',tickets,'avg_minutes_to_assignment',avg_minutes_to_assignment,'avg_minutes_to_resolution',avg_minutes_to_resolution) ORDER BY tickets DESC,locality),'[]') FROM (
      SELECT coalesce(r.locality,'N?o informada') AS locality,count(*) AS tickets,
      round(avg(TIMESTAMPDIFF(MICROSECOND,t.created_at,t.first_assigned_at)/60000000),1) AS avg_minutes_to_assignment,
      round(avg(TIMESTAMPDIFF(MICROSECOND,t.created_at,t.first_resolved_at)/60000000),1) AS avg_minutes_to_resolution
      FROM tickets t JOIN requests r ON r.id=t.request_id
      WHERE t.synthetic=false AND r.synthetic=false AND r.created_at>=${sqlValue(settings.pilotStart)} AND r.created_at<DATE_ADD(${sqlValue(settings.pilotEnd)}, INTERVAL 1 DAY)
      GROUP BY r.locality) locality_metrics`)
    : [];
  return { windows: settings, baseline, pilot, locality };
}
export function getPilotConfiguration() {
  return {
    windows: queryJson(`SELECT value FROM app_settings WHERE key='pilot_windows' LIMIT 1`, null) || {
      baselineStart: '', baselineEnd: '', pilotStart: '', pilotEnd: '',
    },
    targets: queryJson(`SELECT value FROM app_settings WHERE key='pilot_sla_targets' LIMIT 1`, null) || {
      response: { CRITICAL: '', HIGH: '', MEDIUM: '', LOW: '' },
      resolution: { CRITICAL: '', HIGH: '', MEDIUM: '', LOW: '' },
    },
  };
}
export function savePilotConfiguration(input = {}) {
  const dateValue = (value, label) => {
    const date = String(value || '').trim();
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date)
      throw new Error(`Informe uma data vÃ¡lida para ${label}.`);
    return date;
  };
  const windows = {
    baselineStart: dateValue(input.windows?.baselineStart, 'inÃ­cio da linha de base'),
    baselineEnd: dateValue(input.windows?.baselineEnd, 'fim da linha de base'),
    pilotStart: dateValue(input.windows?.pilotStart, 'inÃ­cio do piloto'),
    pilotEnd: dateValue(input.windows?.pilotEnd, 'fim do piloto'),
  };
  if (windows.baselineStart >= windows.baselineEnd || windows.pilotStart >= windows.pilotEnd)
    throw new Error('A data final de cada perÃ­odo deve ser posterior Ã  data inicial.');
  if (windows.baselineEnd > windows.pilotStart)
    throw new Error('A linha de base deve terminar antes ou no inÃ­cio do piloto.');
  const targets = { response: {}, resolution: {} };
  for (const kind of ['response', 'resolution']) {
    for (const level of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
      const value = Number(input.targets?.[kind]?.[level]);
      if (!Number.isInteger(value) || value < 1 || value > 100000)
        throw new Error(`Informe a meta de ${kind === 'response' ? 'resposta' : 'resoluÃ§Ã£o'} para ${level}.`);
      targets[kind][level] = value;
    }
  }
  query(`INSERT INTO app_settings(key,value) VALUES('pilot_windows',${sqlValue(JSON.stringify(windows))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`);
  query(`INSERT INTO app_settings(key,value) VALUES('pilot_sla_targets',${sqlValue(JSON.stringify(targets))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`);
  return { windows, targets };
}
export function listIncidents() {
  return queryJson(`SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id',i.code,'code',i.code,'title',i.title,'system',i.system,'category',i.category,'severity',i.severity,'status',i.status,'detectedAt',i.detected_at,'ticketIds',COALESCE((SELECT JSON_ARRAYAGG(it.ticket_id) FROM incident_tickets it WHERE it.incident_code=i.code),'[]')) ORDER BY i.detected_at DESC),'[]') FROM incidents i`);
}
export function listServiceLocalities(includeInactive = false) {
  return queryJson(`SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id',id,'name',name,'active',active,'createdAt',created_at) ORDER BY LOWER(name)),'[]') FROM service_localities ${includeInactive ? '' : 'WHERE active'}`);
}
export function serviceLocalityIsActive(name) {
  return query(`SELECT 1 FROM service_localities WHERE active AND lower(name)=lower(${sqlValue(String(name || '').trim())}) LIMIT 1`) === '1';
}
export function createServiceLocality(input) {
  const name = String(input || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 120) throw new Error('Informe um município ou comarca entre 2 e 120 caracteres.');
  const inserted = queryJson(`INSERT INTO service_localities(name) VALUES(${sqlValue(name)}) RETURNING json_build_object('id',id,'name',name,'active',active,'createdAt',created_at)`, null);
  return inserted;
}
export function setServiceLocalityActive(id, active) {
  if (!/^\d+$/.test(String(id))) throw new Error('Município ou comarca inválido.');
  query(`UPDATE service_localities SET active=${active ? 'true' : 'false'},updated_at=now() WHERE id=${Number(id)}`);
  const updated = queryJson(`SELECT JSON_OBJECT('id',id,'name',name,'active',active) FROM service_localities WHERE id=${Number(id)} LIMIT 1`, null);
  return updated;
}
export function bootstrap(user = null) {
  const requester = user?.role === 'solicitante';
  const tickets = requester ? listTickets(user.id) : listTickets(),
    incidents = requester ? [] : listIncidents(),
    events = queryJson(
      `SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('type',type,'requestId',request_id,'articleId',knowledge_article_id,'createdAt',created_at) ORDER BY created_at DESC),'[]') FROM service_events ${requester ? `WHERE request_id IN (SELECT id FROM requests WHERE created_by=${sqlValue(user.id)}::uuid)` : ''}`,
    ),
    articles = queryJson(
      `SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id',id,'title',title,'category',category,'system',system,'problem',problem,'solution',solution,'steps',JSON_EXTRACT(steps,'$')) ORDER BY id),'[]') FROM knowledge_articles WHERE active`,
    );
  const triageQuestions = getTriageQuestionSettings();
  const displayLabel = (code) => code.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
  const categoryLabels = Object.fromEntries(Object.keys(triageQuestions.category?.criteria || {}).filter((code) => !CATEGORIES.includes(code)).map((code) => [code, displayLabel(code)]));
  const systemLabels = Object.fromEntries(Object.keys(triageQuestions.system?.criteria || {}).filter((code) => !SYSTEMS.includes(code)).map((code) => [code, displayLabel(code)]));
  return { tickets, incidents, events, articles, categoryLabels, systemLabels, supportProfile: getTriageConfiguration().supportProfile, localities: listServiceLocalities() };
}
export function createIncidentFor(ticket) {
  const related = queryJson(
    `SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id',id) ORDER BY created_at),'[]') FROM tickets WHERE synthetic=false AND system=${sqlValue(ticket.system)} AND category=${sqlValue(ticket.category)} AND created_at>=now()-interval '15 minutes'`,
  );
  if (related.length < 3) return null;
  let code = query(
    `SELECT i.code FROM incidents i WHERE i.system=${sqlValue(ticket.system)} AND i.status='INVESTIGATING' AND i.detected_at>=now()-interval '15 minutes' ORDER BY detected_at DESC LIMIT 1`,
  );
  if (!code) {
    code = `INC-${query("SELECT lpad((coalesce(max(substring(code from 5)::int),0)+1)::text,4,'0') FROM incidents")}`;
    query(
      `INSERT INTO incidents(code,title,system,category,severity) VALUES(${sqlValue(code)},${sqlValue(`Possível indisponibilidade do ${ticket.system}`)},${sqlValue(ticket.system)},${sqlValue(ticket.category)},${sqlValue(['HIGH', 'CRITICAL'].includes(ticket.priority) ? 'HIGH' : 'MEDIUM')})`,
    );
  }
  for (const x of related)
    query(
      `INSERT INTO incident_tickets(incident_code,ticket_id) VALUES(${sqlValue(code)},${sqlValue(x.id)}) ON CONFLICT DO NOTHING`,
    );
  query(
    `UPDATE tickets SET incident_code=${sqlValue(code)} WHERE id IN (${related.map((x) => sqlValue(x.id)).join(',')})`,
  );
  return code;
}
export function dashboard() {
  const counts = queryJson(
    `SELECT json_build_object('open',(SELECT count(*) FROM tickets WHERE status='OPEN'),'high',(SELECT count(*) FROM tickets WHERE status='OPEN' AND priority IN ('HIGH','CRITICAL')),'incidents',(SELECT count(*) FROM incidents WHERE status='INVESTIGATING'),'resolved',(SELECT count(*) FROM service_events WHERE type='SELF_SERVICE_RESOLVED'),'total',(SELECT count(*) FROM requests))`,
  );
  const recent = listTickets()
    .filter((t) => t.status === 'OPEN')
    .slice(0, 8);
  const locality = queryJson(`SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('locality',locality,'tickets',tickets) ORDER BY tickets DESC,locality),'[]') FROM (SELECT r.locality,count(*) AS tickets FROM tickets t JOIN requests r ON r.id=t.request_id WHERE t.synthetic=false GROUP BY r.locality) locality_counts`);
  return { ...counts, recent, incidentList: listIncidents(), locality };
}
export function qualitySummary() {
  const summary = queryJson(`SELECT json_build_object(
  'sampleCount',(SELECT count(*) FROM evaluation_cases),
  'analyzedCount',(SELECT count(*) FROM requests WHERE synthetic=false),
  'pendingReview',(SELECT count(*) FROM requests WHERE synthetic=false AND triage_status<>'READY' AND corrected_decision IS NULL),
  'correctionCount',(SELECT count(*) FROM requests WHERE synthetic=false AND corrected_decision IS NOT NULL),
  'approvedCaseCount',(SELECT count(*) FROM evaluation_cases),
  'agreements',(SELECT json_build_object(
    'category',json_build_object('agree',SUM(CASE WHEN decision->>'category'=corrected_decision->>'category' THEN 1 ELSE 0 END),'total',count(*)),
    'system',json_build_object('agree',SUM(CASE WHEN decision->>'system'=corrected_decision->>'system' THEN 1 ELSE 0 END),'total',count(*)),
    'impact',json_build_object('agree',SUM(CASE WHEN decision->>'impact'=corrected_decision->>'impact' THEN 1 ELSE 0 END),'total',count(*)),
    'urgency',json_build_object('agree',SUM(CASE WHEN decision->>'urgency'=corrected_decision->>'urgency' THEN 1 ELSE 0 END),'total',count(*)),
    'incident',json_build_object('agree',SUM(CASE WHEN decision->>'possibleIncident'=corrected_decision->>'possibleIncident' THEN 1 ELSE 0 END),'total',count(*))
  ) FROM requests WHERE synthetic=false AND corrected_decision IS NOT NULL),
  'corrections',(SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id',c.id,'description',c.description,'original',JSON_EXTRACT(c.original,'$'),'corrected',JSON_EXTRACT(c.corrected,'$'),'correctedAt',c.correctedAt,'reason',c.reason,'evaluationCaseApproved',c.evaluationCaseApproved) ORDER BY c.correctedAt DESC),'[]') FROM (SELECT r.id,r.description,r.decision AS original,r.corrected_decision AS corrected,r.corrected_at AS correctedAt,r.correction_reason AS reason,(e.id IS NOT NULL) AS evaluationCaseApproved FROM requests r LEFT JOIN evaluation_cases e ON e.source_request_id=r.id WHERE r.synthetic=false AND r.corrected_decision IS NOT NULL ORDER BY r.corrected_at DESC LIMIT 30) c)
)`);
  summary.benchmarkCaseCount = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'evaluation', 'cases.json'), 'utf8'),
  ).length;
  return summary;
}
export function evaluationCases() {
  return queryJson(
    `SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id',id,'sourceRequestId',source_request_id,'text',text,'expected',JSON_EXTRACT(expected,'$')) ORDER BY id),'[]') FROM evaluation_cases`,
  );
}
export function getFeedbackEvaluationReport() {
  return queryJson(
    `SELECT value FROM app_settings WHERE key='feedback_evaluation_latest' LIMIT 1`,
    null,
  );
}
export function saveFeedbackEvaluationReport(report) {
  query(
    `INSERT INTO app_settings(key,value) VALUES('feedback_evaluation_latest',${sqlValue(JSON.stringify(report))}::jsonb) ON CONFLICT(tenant_id,key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
  );
  return report;
}
export function redactEvaluationText(text) {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]')
    .replace(/\b\(?\d{2}\)?\s?9?\d{4}-?\d{4}\b/g, '[TELEFONE]')
    .trim();
}
