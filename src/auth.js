import { promisify } from 'node:util';
import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { query, queryJson, queryRegistry, queryRegistryJson, sqlValue } from './database.js';
import { setTenantContext, currentTenantId, DEFAULT_TENANT_ID } from './tenant-context.js';

const scrypt = promisify(scryptCallback);
const passwordKeyLength = 64;
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const validRoles = new Set(['solicitante', 'tic', 'gestor']);
const dummySalt = 'pulso-login-timing-salt-v1';



function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function safeEqualHex(expectedHex, actualHex) {
  if (!/^[a-f0-9]+$/i.test(expectedHex) || !/^[a-f0-9]+$/i.test(actualHex)) return false;
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = Buffer.from(actualHex, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function derivePassword(password, salt) {
  return (await scrypt(password, salt, passwordKeyLength, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  })).toString('hex');
}

export async function createUser({ email, displayName, role, password, tenantId = null }) {
  const normalizedEmail = normalizeEmail(email);
  const name = String(displayName || '').trim();
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))
    throw new Error('Informe um endereco de e-mail valido.');
  if (!name || name.length > 100) throw new Error('O nome deve ter entre 1 e 100 caracteres.');
  if (!validRoles.has(normalizedRole)) throw new Error('Perfil invalido. Use solicitante, tic ou gestor.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128)
    throw new Error('A senha deve ter entre 12 e 128 caracteres.');
  const id = randomUUID();
  const salt = randomBytes(16).toString('hex');
  const passwordHash = await derivePassword(password, salt);
  try {
    return queryJson(`INSERT INTO app_users(id,tenant_id,email,display_name,role,password_salt,password_hash) VALUES(${sqlValue(id)},${sqlValue(tenantId || currentTenantId() || DEFAULT_TENANT_ID)},${sqlValue(normalizedEmail)},${sqlValue(name)},${sqlValue(normalizedRole)},${sqlValue(salt)},${sqlValue(passwordHash)}) RETURNING JSON_OBJECT('id',id,'email',email,'displayName',display_name,'role',role,'tenantId',tenant_id)`, null);
  } catch (error) {
    if (/unique|duplicate/i.test(error.message)) throw new Error('Ja existe uma conta com esse e-mail.');
    throw error;
  }
}

export async function resetUserPassword(email, password) {
  const normalizedEmail = normalizeEmail(email);
  if (typeof password !== 'string' || password.length < 12 || password.length > 128)
    throw new Error('A senha deve ter entre 12 e 128 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const passwordHash = await derivePassword(password, salt);
  const exists = query(`SELECT id FROM app_users WHERE email=${sqlValue(normalizedEmail)} AND active=true LIMIT 1`);
  if (!exists) throw new Error('Conta ativa nao encontrada.');
  query(`UPDATE app_users SET password_salt=${sqlValue(salt)},password_hash=${sqlValue(passwordHash)} WHERE email=${sqlValue(normalizedEmail)} AND active=true`);
  query(`DELETE FROM app_sessions WHERE user_id=${sqlValue(exists)}`);
}

export function updateUserRole(email, role) {
  const normalizedEmail = normalizeEmail(email);
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!validRoles.has(normalizedRole)) throw new Error('Perfil invalido. Use solicitante, tic ou gestor.');
  const userId = query(`SELECT id FROM app_users WHERE email=${sqlValue(normalizedEmail)} AND active=true LIMIT 1`);
  if (!userId) throw new Error('Conta ativa nao encontrada.');
  query(`UPDATE app_users SET role=${sqlValue(normalizedRole)} WHERE id=${sqlValue(userId)} AND active=true`);
  query(`DELETE FROM app_sessions WHERE user_id=${sqlValue(userId)}`);
}

export function listUsers() {
  return queryJson(`SELECT COALESCE(JSON_ARRAYAGG(JSON_OBJECT('id',id,'email',email,'displayName',display_name,'role',role,'active',active,'createdAt',created_at) ORDER BY display_name),'[]') FROM app_users`);
}

export function updateManagedUserRole(userId, role, actorId) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  if (!validRoles.has(normalizedRole))
    throw new Error('Perfil inválido. Use solicitante, tic ou gestor.');
  const currentRole = query(
    `SELECT role FROM app_users WHERE id=${sqlValue(userId)}::uuid AND active=true LIMIT 1`,
  );
  if (!currentRole) throw new Error('Conta ativa não encontrada.');
  if (userId === actorId) throw new Error('Por segurança, não altere o próprio perfil.');
  if (currentRole === 'gestor' && normalizedRole !== 'gestor') {
    const otherManagers = Number(query(
      `SELECT count(*) FROM app_users WHERE active=true AND role='gestor' AND id<>${sqlValue(userId)}::uuid`,
    ));
    if (otherManagers < 1) throw new Error('O sistema precisa manter ao menos um gestor ativo.');
  }
  query(
    `UPDATE app_users SET role=${sqlValue(normalizedRole)} WHERE id=${sqlValue(userId)}::uuid AND active=true`,
  );
  query(`DELETE FROM app_sessions WHERE user_id=${sqlValue(userId)}::uuid`);
  return { id: userId, role: normalizedRole };
}

export async function verifyUserCredentials(email, password, tenantSlug) {
  const normalizedEmail = normalizeEmail(email);
  const slug = String(tenantSlug || '').trim().toLowerCase();
  const tenant = queryRegistryJson(`SELECT JSON_OBJECT('id',id,'slug',slug,'name',name) FROM tenants WHERE slug=${sqlValue(slug)} AND active=true LIMIT 1`, null);
  if (tenant) setTenantContext(tenant.id);
  const user = tenant ? queryJson(`SELECT JSON_OBJECT('id',id,'email',email,'displayName',display_name,'role',role,'tenantId',tenant_id,'tenantSlug',${sqlValue(tenant.slug)},'tenantName',${sqlValue(tenant.name)},'salt',password_salt,'passwordHash',password_hash) FROM app_users WHERE tenant_id=${sqlValue(tenant.id)} AND email=${sqlValue(normalizedEmail)} AND active=true LIMIT 1`, null) : null;
  const passwordIsValid = typeof password === 'string' && password.length >= 12 && password.length <= 128;
  const safePassword = passwordIsValid ? password : '';
  if (!user) { await derivePassword(safePassword, dummySalt); return null; }
  const candidate = await derivePassword(safePassword, user.salt);
  if (!passwordIsValid || !safeEqualHex(user.passwordHash, candidate)) return null;
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role, tenantId: user.tenantId, tenantSlug: user.tenantSlug, tenantName: user.tenantName };
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId, tenantId) {
  const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
  const sessionToken = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const tokenHash = hashToken(sessionToken);
  query(`DELETE FROM app_sessions WHERE expires_at <= NOW() AND tenant_id=${sqlValue(tenantId)}`);
  query(`INSERT INTO app_sessions(token_hash,user_id,tenant_id,csrf_hash,expires_at) VALUES(${sqlValue(tokenHash)},${sqlValue(userId)},${sqlValue(tenantId)},${sqlValue(hashToken(csrfToken))},${sqlValue(expiresAt)})`);
  queryRegistry(`INSERT INTO tenant_sessions(token_hash,tenant_id,expires_at) VALUES(${sqlValue(tokenHash)},${sqlValue(tenantId)},${sqlValue(expiresAt)})`);
  return { sessionToken, csrfToken, tokenHash, expiresAt };
}

function requestCookie(req, name) {
  const cookieHeader = String(req.headers.cookie || '');
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return '';
      }
    }
  }
  return '';
}

/**
 * Slot de sessão da aba. Cookies são compartilhados por todas as abas do
 * navegador, então uma conta por aba exige um cookie por aba: cada aba manda
 * `X-Pulso-Slot` (guardado no sessionStorage, que já é por aba) e lê/escreve
 * `pulso_session_<slot>`. Os tokens continuam HttpOnly — nada é exposto ao JS.
 * Sem o header, cai no nome legado e o comportamento antigo continua valendo.
 */
function requestSlot(req) {
  const raw = String(req.headers['x-pulso-slot'] || '').trim();
  return /^[a-z0-9]{1,12}$/.test(raw) ? raw : '';
}

export function sessionCookieName(req) {
  const slot = requestSlot(req);
  return slot ? `pulso_session_${slot}` : 'pulso_session';
}

export function csrfCookieName(req) {
  const slot = requestSlot(req);
  return slot ? `pulso_csrf_${slot}` : 'pulso_csrf';
}

export function getSession(req) {
  const token = requestCookie(req, sessionCookieName(req)) || requestCookie(req, 'pulso_session');
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) return null;
  const tokenHash = hashToken(token);
  const sessionTenant = queryRegistryJson(`SELECT JSON_OBJECT('tenantId',ts.tenant_id,'tenantSlug',t.slug,'tenantName',t.name) FROM tenant_sessions ts JOIN tenants t ON t.id=ts.tenant_id WHERE ts.token_hash=${sqlValue(tokenHash)} AND ts.expires_at>NOW() AND t.active=true LIMIT 1`, null);
  if (!sessionTenant?.tenantId) return null;
  setTenantContext(sessionTenant.tenantId);
  return queryJson(`SELECT JSON_OBJECT('tokenHash',s.token_hash,'csrfHash',s.csrf_hash,'user',JSON_OBJECT('id',u.id,'email',u.email,'displayName',u.display_name,'role',u.role,'tenantId',u.tenant_id,'tenantSlug',${sqlValue(sessionTenant.tenantSlug)},'tenantName',${sqlValue(sessionTenant.tenantName)})) FROM app_sessions s JOIN app_users u ON u.id=s.user_id AND u.tenant_id=s.tenant_id WHERE s.token_hash=${sqlValue(tokenHash)} AND s.expires_at>NOW() AND u.active=true LIMIT 1`, null);
}

export function rotateCsrfToken(session) {
  const token = randomBytes(32).toString('base64url');
  query(
    `UPDATE app_sessions SET csrf_hash=${sqlValue(hashToken(token))} WHERE token_hash=${sqlValue(session.tokenHash)} AND expires_at>now()`,
  );
  return token;
}

export function csrfTokenForRequest(req, session) {
  const existing = requestCookie(req, csrfCookieName(req)) || requestCookie(req, 'pulso_csrf');
  if (existing && verifyCsrfToken(session, existing)) return existing;
  return rotateCsrfToken(session);
}

export function verifyCsrfToken(session, suppliedToken) {
  if (typeof suppliedToken !== 'string' || suppliedToken.length > 100) return false;
  return safeEqualHex(session.csrfHash, hashToken(suppliedToken));
}

export function revokeSession(session) {
  if (session?.tokenHash) {
    query(`DELETE FROM app_sessions WHERE token_hash=${sqlValue(session.tokenHash)}`);
    queryRegistry(`DELETE FROM tenant_sessions WHERE token_hash=${sqlValue(session.tokenHash)}`);
  }
}

export function sessionCookie(token, req) {
  const secure = req.socket?.encrypted || process.env.SESSION_COOKIE_SECURE === 'true';
  return `${sessionCookieName(req)}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}${secure ? '; Secure' : ''}`;
}

export function csrfCookie(token, req) {
  const secure = req.socket?.encrypted || process.env.SESSION_COOKIE_SECURE === 'true';
  return `${csrfCookieName(req)}=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}${secure ? '; Secure' : ''}`;
}

export function expiredSessionCookie(req) {
  const secure = req.socket?.encrypted || process.env.SESSION_COOKIE_SECURE === 'true';
  // Limpa o slot desta aba; o nome legado também, para não deixar sessão órfã
  // de antes da mudança.
  const names = new Set([sessionCookieName(req), 'pulso_session']);
  const csrfNames = new Set([csrfCookieName(req), 'pulso_csrf']);
  return [
    ...[...names].map((n) => `${n}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`),
    ...[...csrfNames].map((n) => `${n}=; Path=/; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`),
  ];
}

export const allowedAuthRoles = [...validRoles];
