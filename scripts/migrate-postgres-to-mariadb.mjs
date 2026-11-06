import pg from 'pg';
import mysql from 'mysql2/promise';
import '../src/config.js';
import { initializeTenantDatabase } from '../src/repository.js';
import { createRegistryDatabase, queryRegistry, sqlValue } from '../src/database.js';
import { applyRegistryMigrations } from '../src/prisma-migrations.js';
import { setTenantContext, DEFAULT_TENANT_ID } from '../src/tenant-context.js';
import { tenantDatabaseName } from '../src/database.js';
import { tenantTables } from '../src/tenant-tables.js';

const { Client } = pg;
const source = new Client({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'judicia_a',
});

function targetConnection(database) {
  return mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'judici_app',
    password: process.env.MYSQL_PASSWORD || '',
    database,
    charset: 'utf8mb4',
    timezone: 'Z',
  });
}

function jsonValue(value) {
  return value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)
    ? JSON.stringify(value)
    : value;
}

async function main() {
  createRegistryDatabase();
  applyRegistryMigrations();
  queryRegistry(`INSERT IGNORE INTO tenants(id,slug,name) VALUES('${DEFAULT_TENANT_ID}','default','Organizacao padrao')`);
  await source.connect();
  let tenants;
  try {
    const found = await source.query('SELECT id::text,slug,name,active,created_at FROM tenants ORDER BY slug');
    tenants = found.rows;
  } catch (error) {
    if (!/does not exist|undefined table/i.test(error.message)) throw error;
    tenants = [{ id: DEFAULT_TENANT_ID, slug: 'default', name: 'Organizacao padrao', active: true }];
  }
  if (!tenants.some((tenant) => tenant.slug === 'default'))
    tenants.unshift({ id: DEFAULT_TENANT_ID, slug: 'default', name: 'Organizacao padrao', active: true });

  for (const tenant of tenants) {
    const tenantId = String(tenant.id);
    setTenantContext(tenantId);
    initializeTenantDatabase(tenantId);
    const tenantCreatedAt = tenant.created_at instanceof Date ? tenant.created_at.toISOString() : tenant.created_at;
    queryRegistry(`INSERT INTO tenants(id,slug,name,active,created_at) VALUES(${sqlValue(tenantId)},${sqlValue(tenant.slug)},${sqlValue(tenant.name)},${tenant.active ? 'TRUE' : 'FALSE'},${tenantCreatedAt ? sqlValue(tenantCreatedAt) : 'CURRENT_TIMESTAMP(3)'}) ON DUPLICATE KEY UPDATE slug=VALUES(slug),name=VALUES(name),active=VALUES(active)`);
    await source.query("SELECT set_config('app.tenant_id',$1,false)", [tenantId]);
    const target = await targetConnection(tenantDatabaseName(tenantId));
    try {
      const targetColumns = new Map();
      for (const table of tenantTables) {
        const [columnRows] = await target.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]);
        targetColumns.set(table, new Set(columnRows.map((row) => row.COLUMN_NAME)));
      }
      const migratedSessions = [];
      for (const table of tenantTables) {
        const exists = await source.query('SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=$1) AS present', [table]);
        if (!exists.rows[0]?.present) continue;
        const result = await source.query(`SELECT * FROM ${table} ORDER BY 1`);
        const columnsAvailable = targetColumns.get(table);
        let copied = 0;
        for (const row of result.rows) {
          const mapped = { ...row };
          if (table === 'app_sessions') migratedSessions.push({ token_hash: mapped.token_hash, expires_at: mapped.expires_at });
          if (table === 'app_settings' && Object.hasOwn(mapped, 'key')) {
            mapped.setting_key = mapped.key;
            delete mapped.key;
          }
          if (columnsAvailable.has('tenant_id') && !mapped.tenant_id) mapped.tenant_id = tenantId;
          const columns = Object.keys(mapped).filter((column) => columnsAvailable.has(column));
          if (!columns.length) continue;
          const values = columns.map((column) => jsonValue(mapped[column]));
          const placeholders = columns.map(() => '?').join(',');
          const updates = columns.filter((column) => !['id','code','request_id','token_hash','incident_code','ticket_id','tenant_id','setting_key','protocol'].includes(column));
          const duplicateUpdates = updates.length ? updates : columns.slice(0, 1);
          const onDuplicate = ` ON DUPLICATE KEY UPDATE ${duplicateUpdates.map((column) => `\`${column}\`=VALUES(\`${column}\`)`).join(',')}`;
          await target.execute(`INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(',')}) VALUES (${placeholders})${onDuplicate}`, values);
          copied += 1;
        }
        if (copied !== result.rows.length) throw new Error(`${tenant.slug}/${table}: esperados ${result.rows.length} registros, copiados ${copied}.`);
        process.stdout.write(`${tenant.slug}: ${table} ${copied} registros copiados\n`);
      }
      for (const session of migratedSessions)
        queryRegistry(`INSERT INTO tenant_sessions(token_hash,tenant_id,expires_at) VALUES(${sqlValue(session.token_hash)},${sqlValue(tenantId)},${sqlValue(session.expires_at instanceof Date ? session.expires_at.toISOString() : session.expires_at)}) ON DUPLICATE KEY UPDATE tenant_id=VALUES(tenant_id),expires_at=VALUES(expires_at)`);
      const lastProtocolResult = await source.query("SELECT last_value FROM ticket_protocol_seq");
      const lastProtocol = lastProtocolResult.rows[0];
      if (lastProtocol?.last_value) {
        const next = Number(lastProtocol.last_value) + 1;
        await target.query(`ALTER TABLE ticket_protocol_seq AUTO_INCREMENT=${Math.max(106, next)}`);
      }
    } finally {
      await target.end();
    }
  }
  await source.end();
  process.stdout.write('Migracao concluida. O PostgreSQL foi mantido sem alteracoes.\n');
}

main().catch(async (error) => {
  await source.end().catch(() => {});
  process.stderr.write(`Falha na migracao: ${error.message}\n`);
  process.exitCode = 1;
});
