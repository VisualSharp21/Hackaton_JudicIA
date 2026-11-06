// Durable standalone DEMO and test driver. Production always uses MariaDB.
import { DatabaseSync } from 'node:sqlite';
import { PreventionStore } from './store.js';

export function sqliteStore(filename = ':memory:') {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS prevention_records(kind TEXT NOT NULL,id TEXT NOT NULL,hearing_id TEXT,status TEXT,due_at INTEGER,payload TEXT NOT NULL,PRIMARY KEY(kind,id));
    CREATE INDEX IF NOT EXISTS prevention_due ON prevention_records(kind,status,due_at);
    CREATE TABLE IF NOT EXISTS prevention_audit(id TEXT PRIMARY KEY,hearing_id TEXT NOT NULL,created_at INTEGER NOT NULL,payload TEXT NOT NULL);`);
  const query = async (sql, args = []) => {
    const stmt = db.prepare(sql);
    return /^SELECT/i.test(sql) ? stmt.all(...args) : stmt.run(...args);
  };
  // Serialize asynchronous callbacks on a single SQLite connection.
  let tail = Promise.resolve();
  return new PreventionStore({ dialect: 'sqlite', query,
    transaction(fn) {
      const result = tail.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try { const value = await fn({ query }); db.exec('COMMIT'); return value; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      });
      tail = result.catch(() => {});
      return result;
    },
    async close() { await tail; db.close(); },
  });
}
