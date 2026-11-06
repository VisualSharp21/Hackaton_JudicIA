import { check } from './diagnostics.js';

// Deployment-side mapping prevents a tenant from using shared credentials to
// query another tenant's items. No token, endpoint or arbitrary item ID comes from a browser.
export function zabbixMonitor({ url, token, tenantId, mappings = {}, fetchImpl = fetch }) {
  return async (station, now) => {
    const mapping = mappings[tenantId]?.[station.id];
    const unavailable = (reason) => [check('monitoring', 'SERVER', 'UNVERIFIABLE', reason, 'REAL', now)];
    if (!url || !token || !mapping) return unavailable('Zabbix não configurado para este tenant e estação.');
    const definitions = ['availability', 'latency', 'loss', 'service'].filter((key) => mapping[key]).map((key) => ({ key, ...mapping[key] }));
    if (!definitions.length || definitions.some((d) => !/^\d+$/.test(String(d.id)))) return unavailable('Mapeamento Zabbix inválido.');
    try {
      const response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json-rpc', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'item.get', id: 1, params: { itemids: definitions.map((d) => String(d.id)), output: ['itemid', 'lastclock', 'lastvalue', 'units', 'state', 'status'] } }), signal: AbortSignal.timeout(5000) });
      if (!response.ok) return unavailable(`Zabbix indisponível (HTTP ${response.status}).`);
      const data = await response.json(); if (data.error || !Array.isArray(data.result)) return unavailable('Zabbix não confirmou as métricas solicitadas.');
      return definitions.map((definition) => {
        const item = data.result.find((i) => String(i.itemid) === String(definition.id));
        const timestamp = Number(item?.lastclock) * 1000; const value = Number(item?.lastvalue);
        if (!item || !Number.isFinite(value) || timestamp > now + 10000 || now - timestamp > 120000 || String(item.state) !== '0' || String(item.status) !== '0') return check('zabbix_' + definition.key, 'SERVER', 'UNVERIFIABLE', 'Item ausente, desabilitado, não suportado ou amostra com mais de 2 minutos.', 'REAL', now);
        let metric = {}; let ok;
        if (definition.key === 'latency') {
          if (!['s', 'ms'].includes(item.units)) return check('zabbix_latency', 'SERVER', 'UNVERIFIABLE', 'Unidade de latência não reconhecida.', 'REAL', timestamp);
          metric.latencyMs = value * (item.units === 's' ? 1000 : 1); ok = metric.latencyMs >= 0 && metric.latencyMs <= Number(definition.threshold ?? 150);
        } else if (definition.key === 'loss') {
          if (item.units !== '%' || value < 0 || value > 100) return check('zabbix_loss', 'SERVER', 'UNVERIFIABLE', 'Unidade ou valor de perda inválido.', 'REAL', timestamp);
          metric.packetLossPct = value; ok = value <= Number(definition.threshold ?? 5);
        } else { metric.value = value; ok = value === Number(definition.healthyValue ?? 1); }
        return check('zabbix_' + definition.key, 'SERVER', ok ? 'PASS' : 'FAIL', `Zabbix item ${item.itemid}; valor ${value} ${item.units || ''}; amostra ${new Date(timestamp).toISOString()}.`, 'REAL', timestamp, metric);
      });
    } catch { return unavailable('Zabbix não acessível; nenhuma métrica estimada foi utilizada.'); }
  };
}
