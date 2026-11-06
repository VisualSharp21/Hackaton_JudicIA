import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { databaseConfig, projectRoot } from './config.js';
import { query, queryRegistry, tenantDatabaseName } from './database.js';
import { tenantTables } from './tenant-tables.js';

const registryTables = ['tenants', 'tenant_sessions'];
const tenantInitialMigration = '20261020000000_initial_tenant_schema';
const registryInitialMigration = '20261020000000_initial_registry_schema';
const prismaCli = path.join(projectRoot, 'node_modules', 'prisma', 'build', 'index.js');

function runPrisma(args, databaseName) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, PRISMA_DATABASE_NAME: databaseName },
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Nao foi possivel iniciar Prisma Migrate: ${result.error.message}`);
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`Falha ao aplicar migrations Prisma em ${databaseName}: ${details || `codigo ${result.status}`}`);
  }
}

function showTables(queryFn) {
  const output = queryFn('SHOW TABLES');
  return new Set(output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
}

function applyMigrations({ configFile, databaseName, tables, queryFn, initialMigration }) {
  const existingTables = showTables(queryFn);
  const existingApplicationTables = tables.filter((table) => existingTables.has(table));
  if (existingTables.has('_prisma_migrations')) {
    runPrisma(['migrate', 'deploy', '--config', path.join(projectRoot, configFile)], databaseName);
    return;
  }
  if (existingApplicationTables.length === 0) {
    runPrisma(['migrate', 'deploy', '--config', path.join(projectRoot, configFile)], databaseName);
    return;
  }
  if (existingApplicationTables.length !== tables.length) {
    const missing = tables.filter((table) => !existingTables.has(table));
    throw new Error(`Banco ${databaseName} tem schema parcial sem historico Prisma. Tabelas ausentes: ${missing.join(', ')}.`);
  }

  // Previous MariaDB bootstrap created the tables without Prisma migration metadata.
  runPrisma(['migrate', 'resolve', '--applied', initialMigration, '--config', path.join(projectRoot, configFile)], databaseName);
  runPrisma(['migrate', 'deploy', '--config', path.join(projectRoot, configFile)], databaseName);
}

export function applyRegistryMigrations() {
  applyMigrations({
    configFile: 'prisma.registry.config.ts',
    databaseName: databaseConfig.registryDatabase,
    tables: registryTables,
    queryFn: queryRegistry,
    initialMigration: registryInitialMigration,
  });
}

export function applyTenantMigrations(tenantId) {
  const databaseName = tenantDatabaseName(tenantId);
  applyMigrations({
    configFile: 'prisma.config.ts',
    databaseName,
    tables: tenantTables,
    queryFn: query,
    initialMigration: tenantInitialMigration,
  });
}
