import '../src/config.js';
import { createRegistryDatabase, queryRegistry } from '../src/database.js';
import { applyRegistryMigrations } from '../src/prisma-migrations.js';
import { initializeTenantDatabase } from '../src/repository.js';
import { DEFAULT_TENANT_ID } from '../src/tenant-context.js';

createRegistryDatabase();
applyRegistryMigrations();
queryRegistry(`INSERT IGNORE INTO tenants(id,slug,name) VALUES('${DEFAULT_TENANT_ID}','default','Organizacao padrao')`);
const tenantIds = queryRegistry('SELECT id FROM tenants ORDER BY slug').split(/\r?\n/).filter(Boolean);
for (const tenantId of new Set([...tenantIds, DEFAULT_TENANT_ID])) {
  initializeTenantDatabase(tenantId);
  process.stdout.write(`Migrations aplicadas: judicia_t_${tenantId.replaceAll('-', '')}\n`);
}
