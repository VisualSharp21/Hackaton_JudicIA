import mysql from 'mysql2/promise';
import { databaseConfig } from '../config.js';
import { tenantDatabaseName } from '../database.js';
import { PreventionStore } from './store.js';

const pools = new Map();
function pool(database) {
  const { registryDatabase, ...connection } = databaseConfig;
  if (!pools.has(database)) pools.set(database, mysql.createPool({ ...connection, database, port: Number(databaseConfig.port), connectionLimit: 5, timezone: 'Z', charset: 'utf8mb4', connectTimeout: 5000 }));
  return pools.get(database);
}
export async function activeTenants() {
  const [rows] = await pool(databaseConfig.registryDatabase).execute('SELECT id FROM tenants WHERE active=true');
  return rows.map((r) => r.id);
}
export function tenantStore(tenantId) {
  const db = pool(tenantDatabaseName(tenantId));
  return new PreventionStore({
    dialect: 'mysql',
    async query(sql, args = []) { return (await db.execute(sql, args))[0]; },
    async transaction(fn) {
      const c = await db.getConnection();
      try {
        await c.beginTransaction();
        await c.query('SELECT id FROM prevention_mutex WHERE id=1 FOR UPDATE');
        const result = await fn({ query: async (sql, args = []) => (await c.execute(sql, args))[0] });
        await c.commit();
        return result;
      } catch (error) { await c.rollback(); throw error; }
      finally { c.release(); }
    },
    async close() {},
  });
}
export async function closePreventionPools() { await Promise.all([...pools.values()].map((p) => p.end())); pools.clear(); }
