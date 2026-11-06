import mysql from 'mysql2/promise';
import { stdin, stdout, stderr } from 'node:process';

const database = process.argv[2];
const sql = await new Promise((resolve, reject) => {
  let input = '';
  stdin.setEncoding('utf8');
  stdin.on('data', (chunk) => { input += chunk; });
  stdin.on('end', () => resolve(input));
  stdin.on('error', reject);
});

let connection;
try {
  connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'judici_app',
    password: process.env.MYSQL_PASSWORD || '',
    database: database || undefined,
    multipleStatements: true,
    charset: 'utf8mb4',
    timezone: 'Z',
  });
  const [results] = await connection.query(sql);
  const sets = Array.isArray(results) && results.some(Array.isArray) ? results : [results];
  const rows = [];
  for (const result of sets) {
    if (!Array.isArray(result)) continue;
    for (const row of result) {
      rows.push(Object.values(row).map((value) => {
        if (value === null || value === undefined) return '';
        if (Buffer.isBuffer(value)) return value.toString('utf8');
        if (value instanceof Date) return value.toISOString();
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
      }).join('\t'));
    }
  }
  stdout.write(rows.join('\n'));
} catch (error) {
  stderr.write(error.message || String(error));
  process.exitCode = 1;
} finally {
  await connection?.end();
}
