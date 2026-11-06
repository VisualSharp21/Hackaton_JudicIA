/**
 * Settings da LLM do Copilot por tenant (perfil TIC), sobrepostas ao .env do servidor central.
 * A chave de API é gravada criptografada (TENANT_SECRETS_KEY, AES-256-GCM) e nunca volta ao
 * navegador: a tela mostra apenas se há chave configurada.
 */
import { queryRaw, queryRawJson, sqlValue } from '../database.js';
import { currentTenantId, DEFAULT_TENANT_ID } from '../tenant-context.js';
import { decryptTenantSecret, encryptTenantSecret } from '../tenant-secrets.js';
import { chatCompletion, describeEngine, LLM_PROVIDERS, resolveLlmConfig } from './llm-client.js';

const KEY = 'copilot_llm';
const tenant = () => currentTenantId() || DEFAULT_TENANT_ID;

function readStored() {
  const raw = queryRawJson(`SELECT value FROM app_settings WHERE tenant_id=${sqlValue(tenant())} AND setting_key='${KEY}' LIMIT 1`, null);
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

/** Overrides do tenant já com a chave descriptografada (uso interno do servidor). */
export function copilotLlmOverrides() {
  const stored = readStored();
  if (!stored) return {};
  let apiKey = '';
  try {
    apiKey = stored.apiKey ? decryptTenantSecret(stored.apiKey) : '';
  } catch {
    apiKey = '';
  }
  return { ...stored, apiKey };
}

export function effectiveLlmConfig() {
  return resolveLlmConfig(copilotLlmOverrides());
}

export function copilotSettingsView() {
  const stored = readStored();
  const env = resolveLlmConfig({});
  const effective = effectiveLlmConfig();
  return {
    origem: stored ? 'tenant' : 'env',
    provider: stored?.provider || env.provider,
    baseUrl: stored?.baseUrl ?? (process.env.COPILOT_LLM_BASE_URL || ''),
    model: stored?.model || env.model,
    toolMode: stored?.toolMode || env.toolMode,
    fallbackRules: stored?.fallbackRules ?? env.fallbackRules,
    hasApiKey: Boolean(stored ? stored.apiKey : env.apiKey),
    providers: [...LLM_PROVIDERS, 'rules'],
    engine: describeEngine(effective),
  };
}

export function saveCopilotSettings(input = {}) {
  if (input.useEnv === true) {
    queryRaw(`DELETE FROM app_settings WHERE tenant_id=${sqlValue(tenant())} AND setting_key='${KEY}'`);
    return copilotSettingsView();
  }
  const current = readStored() || {};
  const provider = String(input.provider || '').trim().toLowerCase();
  if (![...LLM_PROVIDERS, 'rules'].includes(provider)) throw new Error(`Provedor inválido. Use: ${[...LLM_PROVIDERS, 'rules'].join(', ')}.`);
  const baseUrl = String(input.baseUrl || '').trim().replace(/\/+$/, '');
  if (baseUrl && !/^https?:\/\/[^\s/]+/i.test(baseUrl)) throw new Error('A URL base deve começar com http:// ou https://.');
  const model = String(input.model || '').trim();
  if (model.length > 120) throw new Error('O nome do modelo deve ter até 120 caracteres.');
  const toolMode = String(input.toolMode || 'auto').trim().toLowerCase();
  if (!['auto', 'native', 'hermes'].includes(toolMode)) throw new Error('Modo de ferramentas inválido (auto, native ou hermes).');
  const fallbackRules = input.fallbackRules !== false;
  let apiKey = current.apiKey || '';
  const suppliedKey = String(input.apiKey || '').trim();
  if (input.clearApiKey === true) apiKey = '';
  else if (suppliedKey) {
    if (suppliedKey.length > 400) throw new Error('A chave de API é longa demais.');
    apiKey = encryptTenantSecret(suppliedKey);
  }
  const value = { provider, baseUrl, model, toolMode, fallbackRules, apiKey };
  queryRaw(`INSERT INTO app_settings(tenant_id,setting_key,value) VALUES(${sqlValue(tenant())},'${KEY}',${sqlValue(JSON.stringify(value))}) ON DUPLICATE KEY UPDATE value=VALUES(value),updated_at=CURRENT_TIMESTAMP(3)`);
  return copilotSettingsView();
}

/** Teste rápido de conexão com a LLM configurada (sem dados de atendimento). */
export async function testCopilotLlm() {
  const config = effectiveLlmConfig();
  if (!config.configured) return { ok: false, engine: describeEngine(config), erro: config.reason };
  const started = Date.now();
  try {
    const result = await chatCompletion(config, {
      messages: [
        { role: 'system', content: 'Você é um verificador de conexão. Responda somente com a palavra: ok' },
        { role: 'user', content: 'Teste de conexão do Copilot Nível 1.' },
      ],
      maxTokens: 10,
      temperature: 0,
    });
    return { ok: true, engine: describeEngine(config), modelo: result.model, latenciaMs: Date.now() - started, resposta: result.text.slice(0, 60) };
  } catch (error) {
    return { ok: false, engine: describeEngine(config), erro: error.message, latenciaMs: Date.now() - started };
  }
}
