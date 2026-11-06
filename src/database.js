import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { databaseConfig } from './config.js';
import { currentTenantId, DEFAULT_TENANT_ID } from './tenant-context.js';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function tenantDatabaseName(tenantId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(tenantId || '')))
    throw new Error('Tenant ID invalido para selecionar o banco de dados.');
  return `judicia_t_${tenantId.replaceAll('-', '')}`;
}

function execute(sql, database) {
  const result = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'mysql-query.mjs'), database], {
    input: sql,
    encoding: 'utf8',
    env: { ...process.env, MYSQL_PWD: databaseConfig.password },
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Nao foi possivel iniciar o cliente MariaDB: ${result.error.message}`);
  if (result.status !== 0) throw new Error((result.stderr || 'Falha na consulta MariaDB.').trim());
  return result.stdout.trim();
}

export function sqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  let text = String(value);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text)) text = text.replace('T', ' ').replace('Z', '');
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

export function translateSql(sql, tenantId = DEFAULT_TENANT_ID) {
  let translated = String(sql)
    .replace(/current_setting\('app\.tenant_id',\s*true\)/gi, '@judicia_tenant_id')
    .replace(/::(?:uuid|jsonb?|text|numeric|int|float|date|timestamptz)/gi, '')
    .replace(/\bjson_build_object\s*\(/gi, 'JSON_OBJECT(')
    .replace(/\brow_to_json\(r\)/gi, () => "JSON_OBJECT('id',r.id,'description',r.description,'decision',JSON_EXTRACT(r.decision,'$'),'priority',r.priority,'queue',r.queue,'confidence',r.confidence,'article_id',r.article_id,'article_snapshot',JSON_EXTRACT(r.article_snapshot,'$'),'corrected_decision',JSON_EXTRACT(r.corrected_decision,'$'),'corrected_at',r.corrected_at,'correction_reason',r.correction_reason,'triage_status',r.triage_status,'locality',r.locality,'synthetic',r.synthetic,'created_by',r.created_by,'status',r.status,'provider',r.provider,'created_at',r.created_at)")
    .replace(/\bjson_agg\s*\(/gi, 'JSON_ARRAYAGG(')
    .replace(/jsonb_set\s*\(/gi, 'JSON_SET(')
    .replace(/('(?:[^']|'')*')\s*->\s*'([A-Za-z0-9_]+)'\s*->>\s*'([A-Za-z0-9_]+)'/g,
      (_, value, firstKey, secondKey) => `JSON_UNQUOTE(JSON_EXTRACT(JSON_EXTRACT(${value}, '$.${firstKey}'), '$.${secondKey}'))`)
    .replace(/\b([A-Za-z_][A-Za-z0-9_.]*)\s*->>\s*'([A-Za-z0-9_]+)'/g,
      (_, value, key) => `JSON_UNQUOTE(JSON_EXTRACT(${value}, '$.${key}'))`)
    .replace(/\b([A-Za-z_][A-Za-z0-9_.]*)\s*->\s*'([A-Za-z0-9_]+)'/g,
      (_, value, key) => `JSON_EXTRACT(${value}, '$.${key}')`)
    .replace(/\bEXCLUDED\.([A-Za-z0-9_]+)/gi, 'VALUES($1)')
    .replace(/ON CONFLICT\s*\([^)]*\)\s*DO UPDATE SET/gi, 'ON DUPLICATE KEY UPDATE')
    .replace(/ON CONFLICT(?:\s*\([^)]*\))?\s*DO NOTHING/gi, '')
    .replace(/interval\s*'([0-9]+)\s+minutes?'/gi, 'INTERVAL $1 MINUTE')
    .replace(/interval\s*'([0-9]+)\s+days?'/gi, 'INTERVAL $1 DAY')
    .replace(/\bsubstring\(([^,]+)\s+from\s+([^)]+)\)/gi, 'SUBSTRING($1,$2)')
    .replace(/app_settings\(tenant_id,key,value\)/gi, 'app_settings(tenant_id,setting_key,value)')
    .replace(/app_settings\(key,value\)\s+VALUES\(/gi, `app_settings(tenant_id,setting_key,value) VALUES('${tenantId}',`)
    .replace(/(FROM app_settings\s+WHERE\s+)key/gi, '$1setting_key');
  if (/ON CONFLICT(?:\s*\([^)]*\))?\s*DO NOTHING/i.test(sql))
    translated = translated.replace(/\bINSERT\s+INTO\b/i, 'INSERT IGNORE INTO');
  return translated;
}
export function query(sql) {
  const tenantId = currentTenantId() || DEFAULT_TENANT_ID;
  return execute(`SET @judicia_tenant_id = '${tenantId}';\n${translateSql(sql, tenantId)}\n`, tenantDatabaseName(tenantId));
}

/**
 * SQL nativo do MariaDB, sem translateSql: use quando os valores trazem texto livre
 * (ex.: mensagens do chat), que as regex de tradução alterariam dentro dos literais.
 */
export function queryRaw(sql) {
  const tenantId = currentTenantId() || DEFAULT_TENANT_ID;
  return execute(`SET @judicia_tenant_id = '${tenantId}';\n${sql}\n`, tenantDatabaseName(tenantId));
}

export function queryRawJson(sql, fallback = null) {
  const output = queryRaw(sql);
  if (!output) return fallback;
  try { return JSON.parse(output); }
  catch { throw new Error(`Resposta invalida do MariaDB: ${output.slice(0, 250)}`); }
}

export function createRegistryDatabase() {
  const name = databaseConfig.registryDatabase;
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new Error('MYSQL_REGISTRY_DATABASE deve conter apenas letras, numeros e sublinhados.');
  execute(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`, '');
}

export function queryRegistry(sql) {
  return execute(translateSql(sql), databaseConfig.registryDatabase);
}

export function createTenantDatabase(tenantId) {
  const name = tenantDatabaseName(tenantId);
  execute(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`, databaseConfig.registryDatabase);
}

export function queryJson(sql, fallback = []) {
  const output = query(sql);
  if (!output) return fallback;
  try { return JSON.parse(output); }
  catch { throw new Error(`Resposta invalida do MariaDB: ${output.slice(0, 250)}`); }
}

export function queryRegistryJson(sql, fallback = null) {
  const output = queryRegistry(sql);
  if (!output) return fallback;
  try { return JSON.parse(output); }
  catch { throw new Error('Resposta invalida do MariaDB: ' + output.slice(0, 250)); }
}
