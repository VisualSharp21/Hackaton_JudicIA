import { currentTenantId } from '../tenant-context.js';
import { getTenantTicketingConfiguration } from '../repository.js';
import { validateTicketingAdapter } from './contract.js';
import { createMockTicketingAdapter } from './mock-adapter.js';
import { createGlpiV2Adapter } from './glpi-v2-adapter.js';

const adapterFactories = new Map([
  ['mock', createMockTicketingAdapter],
  ['glpi', createGlpiV2Adapter],
]);
const adapterCache = new Map();
const defaultTenantId = '00000000-0000-4000-8000-000000000001';

function tenantAdapter() {
  const tenantId = currentTenantId() || defaultTenantId;
  const configuration = getTenantTicketingConfiguration();
  const signature = JSON.stringify(configuration);
  const existing = adapterCache.get(tenantId);
  if (existing?.signature === signature) return existing.adapter;
  const factory = adapterFactories.get(configuration.provider);
  if (!factory) throw new Error(`Provedor de chamados "${configuration.provider}" nao implementado.`);
  const adapter = validateTicketingAdapter(factory(configuration));
  adapterCache.set(tenantId, { signature, adapter });
  return adapter;
}

export const ticketingAdapter = new Proxy({}, {
  get(_target, property) {
    const adapter = tenantAdapter();
    const value = adapter[property];
    return typeof value === 'function' ? value.bind(adapter) : value;
  },
});
