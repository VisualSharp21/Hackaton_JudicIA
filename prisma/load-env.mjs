import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(projectRoot, '.env');
if (fs.existsSync(envPath)) {
  const contents = fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '');
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]])
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

export function mysqlUrl(databaseName) {
  const host = process.env.MYSQL_HOST || 'localhost';
  const port = process.env.MYSQL_PORT || '3306';
  const user = encodeURIComponent(process.env.MYSQL_USER || 'judici_app');
  const password = encodeURIComponent(process.env.MYSQL_PASSWORD || '');
  return `mysql://${user}:${password}@${host}:${port}/${encodeURIComponent(databaseName)}`;
}
