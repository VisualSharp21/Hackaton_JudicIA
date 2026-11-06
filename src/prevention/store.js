import { randomUUID } from 'node:crypto';

// All mutations are short transactions. Network calls must happen outside them.
// A per-tenant database mutex serializes claims across server processes.
export class PreventionStore {
  constructor(driver) { this.driver = driver; }
  async transaction(fn) {
    return this.driver.transaction(async (connection) => fn(new RecordSession(connection, this.driver.dialect)));
  }
  async get(kind, id) { return new RecordSession(this.driver, this.driver.dialect).get(kind, id); }
  async list(kind) { return new RecordSession(this.driver, this.driver.dialect).list(kind); }
  async due(now, limit = 100) {
    const rows = await this.driver.query('SELECT payload FROM prevention_records WHERE kind=? AND status IN (?,?) AND due_at<=? ORDER BY due_at LIMIT ' + Math.min(100, limit), ['job', 'PENDING', 'RUNNING', now]);
    return rows.map(decode);
  }
  async auditLog(hearingId) {
    const rows = await this.driver.query('SELECT payload FROM prevention_audit WHERE hearing_id=? ORDER BY created_at,id', [hearingId]);
    return rows.map(decode);
  }
  async close() { await this.driver.close(); }
}

const decode = (row) => typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
class RecordSession {
  constructor(connection, dialect) { this.connection = connection; this.dialect = dialect; }
  async get(kind, id) {
    const rows = await this.connection.query('SELECT payload FROM prevention_records WHERE kind=? AND id=?', [kind, id]);
    return rows[0] ? decode(rows[0]) : null;
  }
  async list(kind) {
    return (await this.connection.query('SELECT payload FROM prevention_records WHERE kind=? ORDER BY id', [kind])).map(decode);
  }
  async activeHearings(now) {
    return (await this.connection.query('SELECT payload FROM prevention_records WHERE kind=? AND status=? AND due_at<=? ORDER BY due_at', ['hearing', 'ATIVA', now])).map(decode);
  }
  async put(kind, value) {
    const values = [kind, value.id, value.hearingId || null, value.status || value.lifecycle || null, value.nextAt ?? (kind === 'hearing' ? Date.parse(value.startsAt) - 1800000 : null), JSON.stringify(value)];
    const update = this.dialect === 'sqlite'
      ? 'ON CONFLICT(kind,id) DO UPDATE SET hearing_id=excluded.hearing_id,status=excluded.status,due_at=excluded.due_at,payload=excluded.payload'
      : 'ON DUPLICATE KEY UPDATE hearing_id=VALUES(hearing_id),status=VALUES(status),due_at=VALUES(due_at),payload=VALUES(payload)';
    await this.connection.query(`INSERT INTO prevention_records(kind,id,hearing_id,status,due_at,payload) VALUES(?,?,?,?,?,?) ${update}`, values);
    return value;
  }
  async audit(hearingId, event, actor, details = {}, now = Date.now()) {
    const item = { id: randomUUID(), hearingId, event, actor, details, at: new Date(now).toISOString() };
    await this.connection.query('INSERT INTO prevention_audit(id,hearing_id,created_at,payload) VALUES(?,?,?,?)', [item.id, hearingId || '', now, JSON.stringify(item)]);
  }
}
