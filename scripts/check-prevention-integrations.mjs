import { getTenantTicketingConfiguration } from '../src/repository.js';
import { createGlpiV2Client } from '../src/ticketing/glpi-v2-client.js';
import { resolveLlmConfig } from '../src/copilot/llm-client.js';
try { process.loadEnvFile(); } catch {}
const llm = resolveLlmConfig({});
console.log('LLM deployment:', llm.configured ? 'configurada; chamada generativa não executada nesta verificação' : 'não configurada');
try {
  const config = getTenantTicketingConfiguration();
  if (config.provider !== 'glpi') console.log('GLPI: modo simulado; integração real não exercitada.');
  else {
    const client = createGlpiV2Client(config); const health = await client.checkConnection(); const doc = await client.getOpenApiDocument();
    console.log('GLPI read-only:', JSON.stringify(health));
    console.log('Recursos de solução publicados:', Object.keys(doc.paths || {}).filter((p) => /solution/i.test(p)).join(', ') || 'nenhum');
  }
} catch (error) { console.log('GLPI read-only: indisponível ou sem configuração acessível.'); }
console.log('Zabbix deployment:', process.env.ZABBIX_API_URL && process.env.ZABBIX_API_TOKEN ? 'configurado; verificar itens mapeados por tenant' : 'não configurado');
console.log('Embeddings deployment:', process.env.EMBEDDING_BASE_URL && process.env.EMBEDDING_MODEL ? 'configurado' : 'não configurado; recuperação lexical + metadados');
