import { createGlpiV2Client } from '../ticketing/glpi-v2-client.js';
import { invalid } from './agenda.js';

const rowsOf = (result) => Array.isArray(result) ? result : result?.data || result?.items || [];
const marker = (key) => `[JUDICIA-PREVENTION:${key}]`;
export function preventionGlpi(config, client = createGlpiV2Client(config)) {
  async function documented(path, method) {
    const doc = await client.getOpenApiDocument();
    if (!doc.paths?.[path]?.[method]) throw invalid(`A instância GLPI não documenta ${method.toUpperCase()} ${path}.`, 502);
    return doc;
  }
  return {
    async find(key) {
      await documented('/Assistance/Ticket', 'get');
      // Inspect paginated results, matching the full unique title marker, never fuzzy text.
      for (let start = 0; start < 10000; start += 100) {
        const rows = rowsOf(await client.api(`/Assistance/Ticket?start=${start}&limit=100`));
        const found = rows.find((r) => String(r.name || '').includes(marker(key)));
        if (found) return { id: String(found.id), source: 'GLPI', name: found.name };
        if (rows.length < 100) return null;
      }
      throw invalid('Limite de reconciliação GLPI atingido; revisão necessária.', 502);
    },
    async create(item, content) {
      await documented('/Assistance/Ticket', 'post');
      const result = await client.api('/Assistance/Ticket', { method: 'POST', body: JSON.stringify({
        name: `${marker(item.id)} Audiência ${item.room} / ${item.stationId}`.slice(0, 250),
        content, type: 1, urgency: item.priority === 'CRITICAL' ? 5 : 4, impact: 4,
      }) });
      const ticket = result?.data || result;
      if (!ticket?.id) throw invalid('GLPI não confirmou o ID do chamado.', 502);
      return { id: String(ticket.id), source: 'GLPI' };
    },
    async resolvedTicket(ticketId) {
      if (!/^\d+$/.test(String(ticketId))) throw invalid('ID GLPI inválido.');
      const data = await client.api(`/Assistance/Ticket/${ticketId}`);
      const ticket = data?.data || data;
      const status = ticket?.status?.id ?? ticket?.status;
      if (![5, 6, '5', '6', 'SOLVED', 'CLOSED'].includes(status)) throw invalid('O GLPI ainda não confirma chamado solucionado/fechado.');
      return { id: String(ticket.id), title: String(ticket.name || ''), problem: String(ticket.content || ''), status, observedAt: new Date().toISOString() };
    },
    async registerSolution(ticketId, solution, evidence) {
      // Verify the published request schema; installations may expose different solution resources.
      const path = '/Assistance/ITILSolution';
      const doc = await documented(path, 'post');
      let schema = doc.paths[path].post.requestBody?.content?.['application/json']?.schema;
      const seen = new Set();
      while (schema?.$ref && !seen.has(schema.$ref)) { seen.add(schema.$ref); schema = doc.components?.schemas?.[schema.$ref.split('/').pop()]; }
      if (!['itemtype', 'items_id', 'content'].every((key) => schema?.properties?.[key])) throw invalid('Schema de solução GLPI incompatível. Registre a solução no GLPI e importe pelo identificador.', 502);
      const result = await client.api(path, { method: 'POST', body: JSON.stringify({ itemtype: 'Ticket', items_id: Number(ticketId), content: `${solution}\n\nEvidência confirmada: ${evidence}` }) });
      if (!(result?.data || result)?.id) throw invalid('GLPI não confirmou o registro da solução.', 502);
      return String((result?.data || result).id);
    },
    async readSolution(ticketId, solutionId) {
      if (!/^\d+$/.test(String(solutionId))) throw invalid('ID de solução inválido.');
      const data = await client.api(`/Assistance/ITILSolution/${solutionId}`);
      const s = data?.data || data;
      if (String(s?.items_id ?? s?.item?.id) !== String(ticketId) || (s.itemtype && s.itemtype !== 'Ticket') || !s.content) throw invalid('Solução GLPI não pertence ao chamado informado.');
      return { id: String(s.id), content: String(s.content).replace(/<[^>]*>/g, ' ').trim() };
    },
  };
}
