import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function loadEnv() {
  const envFile = path.join(projectRoot, '.env');
  if (!fs.existsSync(envFile)) return;

  const contents = fs.readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '');
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

loadEnv();

function parseGlpiQueueCategories(value = '') {
  return Object.fromEntries(String(value).split(',').map((pair) => pair.trim().split(':'))
    .filter(([queue, id]) => /^SUPORTE_(PJE|REDE|HARDWARE|SISTEMAS|GERAL)$/.test(queue || '') && /^\d+$/.test(id || '')));
}

export const port = Number(process.env.PORT || 3000);
export const ticketingProvider = (process.env.TICKETING_PROVIDER || 'mock').trim().toLowerCase();
export const glpiConfig = Object.freeze({
  apiBaseUrl: process.env.GLPI_API_BASE_URL || '',
  clientId: process.env.GLPI_CLIENT_ID || '',
  clientSecret: process.env.GLPI_CLIENT_SECRET || '',
  username: process.env.GLPI_USERNAME || '',
  password: process.env.GLPI_PASSWORD || '',
  scope: process.env.GLPI_API_SCOPE || 'api',
  apiVersion: process.env.GLPI_API_VERSION || 'v2',
  knowledgeResource: process.env.GLPI_KNOWLEDGE_RESOURCE || 'Knowledgebase/Article',
  queueCategoryIds: parseGlpiQueueCategories(process.env.GLPI_QUEUE_CATEGORY_IDS),
});

const glpiEnvKeys = {
  provider: 'TICKETING_PROVIDER',
  apiBaseUrl: 'GLPI_API_BASE_URL',
  clientId: 'GLPI_CLIENT_ID',
  clientSecret: 'GLPI_CLIENT_SECRET',
  username: 'GLPI_USERNAME',
  password: 'GLPI_PASSWORD',
  scope: 'GLPI_API_SCOPE',
  apiVersion: 'GLPI_API_VERSION',
  knowledgeResource: 'GLPI_KNOWLEDGE_RESOURCE',
  queueCategoryIds: 'GLPI_QUEUE_CATEGORY_IDS',
};

export function getGlpiSettings() {
  return {
    provider: ticketingProvider,
    apiBaseUrl: glpiConfig.apiBaseUrl,
    clientId: glpiConfig.clientId,
    username: glpiConfig.username,
    scope: glpiConfig.scope,
    apiVersion: glpiConfig.apiVersion,
    knowledgeResource: glpiConfig.knowledgeResource,
    queueCategoryIds: glpiConfig.queueCategoryIds,
    hasClientSecret: Boolean(glpiConfig.clientSecret),
    hasPassword: Boolean(glpiConfig.password),
  };
}

export function saveGlpiSettings(input) {
  const values = {
    provider: String(input.provider || 'mock').trim().toLowerCase(),
    apiBaseUrl: String(input.apiBaseUrl || '').trim().replace(/\/+$/, ''),
    clientId: String(input.clientId || '').trim(),
    clientSecret: String(input.clientSecret || '').trim(),
    username: String(input.username || '').trim(),
    password: String(input.password || '').trim(),
    scope: String(input.scope || 'api').trim(),
    apiVersion: String(input.apiVersion || 'v2').trim(),
    knowledgeResource: String(input.knowledgeResource || 'Knowledgebase/Article').trim(),
    queueCategoryIds: Object.fromEntries(Object.entries(input.queueCategoryIds || {}).map(([queue, id]) => {
      const value = String(id || '').trim();
      if (!/^SUPORTE_(PJE|REDE|HARDWARE|SISTEMAS|GERAL)$/.test(queue) || (value && !/^\d+$/.test(value)))
        throw new Error('Informe IDs numéricos de categoria GLPI para as filas válidas.');
      return [queue, value];
    }).filter(([, id]) => id)),
  };
  if (!['mock', 'glpi'].includes(values.provider)) throw new Error('Provedor inválido.');
  if (values.apiBaseUrl && !/^https?:\/\//i.test(values.apiBaseUrl))
    throw new Error('A URL do GLPI deve começar com http:// ou https://.');
  if (values.provider === 'glpi') {
    const missing = ['apiBaseUrl', 'clientId', 'username'].filter((key) => !values[key]);
    if (missing.length || (!values.clientSecret && !glpiConfig.clientSecret) || (!values.password && !glpiConfig.password))
      throw new Error('Preencha URL, ID do cliente, usuário e as credenciais do GLPI.');
  }
  const envPath = path.join(projectRoot, '.env');
  let contents = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  for (const [key, envKey] of Object.entries(glpiEnvKeys)) {
    let value = values[key];
    if ((key === 'clientSecret' || key === 'password') && !value) value = process.env[envKey] || '';
    if (key === 'queueCategoryIds') value = Object.entries(value || {}).map(([queue, id]) => `${queue}:${id}`).join(',');
    const line = `${envKey}=${JSON.stringify(value)}`;
    const pattern = new RegExp(`^\\s*${envKey}\\s*=.*$`, 'm');
    if (pattern.test(contents)) contents = contents.replace(pattern, line);
    else contents += `${contents && !contents.endsWith('\n') ? '\n' : ''}${line}\n`;
  }
  fs.writeFileSync(envPath, contents, { encoding: 'utf8', mode: 0o600 });
  return { saved: true, restartRequired: true };
}
export const frontendOrigins = (
  process.env.FRONTEND_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const databaseConfig = Object.freeze({
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT || '3306',
  user: process.env.MYSQL_USER || 'judici_app',
  password: process.env.MYSQL_PASSWORD || '',
  registryDatabase: process.env.MYSQL_REGISTRY_DATABASE || 'judicia_registry',
});
