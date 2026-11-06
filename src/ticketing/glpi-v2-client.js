import { glpiConfig as defaultGlpiConfig } from '../config.js';

const REQUEST_TIMEOUT_MS = 12_000;

function requiredConfig(glpiConfig) {
  const missing = Object.entries({
    GLPI_API_BASE_URL: glpiConfig.apiBaseUrl,
    GLPI_CLIENT_ID: glpiConfig.clientId,
    GLPI_CLIENT_SECRET: glpiConfig.clientSecret,
    GLPI_USERNAME: glpiConfig.username,
    GLPI_PASSWORD: glpiConfig.password,
  })
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length) throw new Error(`Configuração GLPI incompleta: ${missing.join(', ')}.`);
}

export function createGlpiV2Client(glpiConfig = defaultGlpiConfig) {
  let accessToken;
  let tokenExpiresAt = 0;
  let openApiDocument;
  const baseUrl = glpiConfig.apiBaseUrl.replace(/\/+$/, '');
  const apiRoot = `${baseUrl}/${glpiConfig.apiVersion}`;

  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let data;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (!response.ok) {
        const message = typeof data === 'object' && data ? data.message || data.error : '';
        throw new Error(`GLPI respondeu HTTP ${response.status}${message ? `: ${message}` : ''}.`);
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Tempo limite excedido ao acessar o GLPI.');
      if (error instanceof TypeError) throw new Error('Não foi possível conectar à API do GLPI.');
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function token() {
    requiredConfig(glpiConfig);
    if (accessToken && Date.now() < tokenExpiresAt - 30_000) return accessToken;
    const body = new URLSearchParams({
      grant_type: 'password',
      client_id: glpiConfig.clientId,
      client_secret: glpiConfig.clientSecret,
      username: glpiConfig.username,
      password: glpiConfig.password,
      scope: glpiConfig.scope,
    });
    const result = await request(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
    });
    if (!result?.access_token) throw new Error('GLPI não retornou token de acesso.');
    accessToken = result.access_token;
    tokenExpiresAt = Date.now() + Number(result.expires_in || 300) * 1000;
    return accessToken;
  }

  async function api(path, options = {}) {
    const bearer = await token();
    return request(`${apiRoot}/${path.replace(/^\/+/, '')}`, {
      ...options,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${bearer}`,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...options.headers,
      },
    });
  }

  return {
    api,
    async getOpenApiDocument() {
      if (!openApiDocument) {
        const bearer = await token();
        openApiDocument = await request(`${baseUrl}/doc.json`, {
          headers: { accept: 'application/json', authorization: `Bearer ${bearer}` },
        });
      }
      return openApiDocument;
    },
    async checkConnection() {
      await token();
      const doc = await this.getOpenApiDocument();
      return {
        authenticated: true,
        apiVersion: glpiConfig.apiVersion,
        openApi: Boolean(doc?.paths),
      };
    },
  };
}
