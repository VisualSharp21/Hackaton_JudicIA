import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function getKey() {
  const key = Buffer.from(process.env.TENANT_SECRETS_KEY || '', 'base64');
  if (key.length !== 32) throw new Error('Defina TENANT_SECRETS_KEY com uma chave Base64 de 32 bytes para salvar credenciais por organiza\u00e7\u00e3o.');
  return key;
}

export function encryptTenantSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptTenantSecret(value) {
  if (!value) return '';
  const parts = String(value).split(':');
  if (parts[0] !== 'enc' || parts[1] !== 'v1' || parts.length !== 5) return String(value);
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(parts[2], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[3], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[4], 'base64')), decipher.final()]).toString('utf8');
}
