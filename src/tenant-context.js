import { AsyncLocalStorage } from 'node:async_hooks';

export const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';
const tenantStorage = new AsyncLocalStorage();

export function setTenantContext(tenantId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(tenantId || ''))) throw new Error('Tenant ID invalido.');
  tenantStorage.enterWith(String(tenantId));
}

export function currentTenantId() {
  return tenantStorage.getStore() || null;
}

export function runWithTenantContext(callback) {
  return tenantStorage.run(null, callback);
}
