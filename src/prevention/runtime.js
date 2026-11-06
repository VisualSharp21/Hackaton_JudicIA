import { tenantStore, activeTenants } from './mysql-store.js';
import { runWithTenantContext, setTenantContext } from '../tenant-context.js';
import { getTenantTicketingConfiguration } from '../repository.js';
import { Agenda } from './agenda.js';
import { OperationalKnowledge, embeddingProvider } from './knowledge.js';
import { preventionGlpi } from './glpi.js';
import { EscalationOutbox } from './escalation.js';
import { HearingScheduler } from './scheduler.js';
import { diagnose } from './diagnostics.js';
import { zabbixMonitor } from './monitoring.js';
import { ensureDemoAgenda } from './demo.js';
import { PreventiveOperations } from './operations.js';

export function servicesForTenant(tenantId) {
  const store = tenantStore(tenantId);
  let config = { provider: 'mock' };
  try { config = getTenantTicketingConfiguration(); } catch { console.error('[prevention] GLPI_CONFIG_UNAVAILABLE', tenantId); }
  const glpi = config.provider === 'glpi' ? preventionGlpi(config) : null;
  // Embedding credentials are deployment-side only. Text stays within the selected tenant.
  const embedder = embeddingProvider({ baseUrl: process.env.EMBEDDING_BASE_URL, model: process.env.EMBEDDING_MODEL, apiKey: process.env.EMBEDDING_API_KEY });
  let mappings = {}; try { mappings = JSON.parse(process.env.ZABBIX_TENANT_ITEMS || '{}'); } catch {}
  const monitor = zabbixMonitor({ url: process.env.ZABBIX_API_URL, token: process.env.ZABBIX_API_TOKEN, tenantId, mappings });
  return createServices(store, { glpi, embedder, monitor });
}
export function createServices(store, { glpi = null, embedder = null, monitor, clock = () => Date.now() } = {}) {
  const agenda = new Agenda(store, clock);
  const knowledge = new OperationalKnowledge({ store, glpi, embedder, clock });
  const escalation = new EscalationOutbox({ store, transport: glpi, clock });
  const operations = new PreventiveOperations(store, clock);
  const scheduler = new HearingScheduler({ store, clock, escalation, operations, diagnostics: (ctx) => diagnose({ ...ctx, monitor }), lookup: (q, m) => knowledge.search(q, m) });
  return { store, agenda, knowledge, escalation, operations, scheduler, clock };
}
export function startPreventionRuntime() {
  // Demo bootstrap runs with the worker, never in a browser request.
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const tenants = await activeTenants();
      for (let offset = 0; offset < tenants.length; offset += 4) await Promise.all(tenants.slice(offset, offset + 4).map((tenantId) => runWithTenantContext(async () => {
        setTenantContext(tenantId);
        try { const services = servicesForTenant(tenantId); await ensureDemoAgenda(services, process.env.DEMO_MODE === 'true'); await services.scheduler.tick(); }
        catch (error) { console.error('[prevention] tenant tick failed', tenantId, error.code || error.name); }
      })));
    } catch (error) { console.error('[prevention] registry unavailable', error.code || error.name); }
    finally { busy = false; }
  };
  const interval = setInterval(() => void tick(), 5000); interval.unref(); void tick();
  return () => clearInterval(interval);
}
