import { query, queryRaw, sqlValue } from '../database.js';
import { listTickets, recordTicketStatus } from '../repository.js';
import { createGlpiV2Client } from './glpi-v2-client.js';

const info = Object.freeze({ provider: 'glpi', mode: 'external', displayName: 'GLPI 11' });
const statusNames = {
  1: 'NEW',
  2: 'ASSIGNED',
  3: 'PLANNED',
  4: 'WAITING',
  5: 'SOLVED',
  6: 'CLOSED',
};

function plainText(value = '') {
  return String(value)
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim();
}

function relevance(article, description) {
  const ignored = new Set([
    'nao', 'sim', 'com', 'sem', 'para', 'por', 'uma', 'uns', 'das', 'dos', 'que', 'quando',
    'como', 'esta', 'esse', 'isso', 'meu', 'minha', 'estou', 'desde', 'consigo', 'problema',
    'erro', 'aparece', 'acessar', 'entrar', 'abrir', 'sistema', 'servico', 'servicos',
  ]);
  const words = plainText(description)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g)?.filter((word) => !ignored.has(word)) || [];
  if (!words.length) return 0;
  const title = plainText(article.name || article.title)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const body = plainText(article.content || article.description)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return [...new Set(words)].reduce(
    (score, word) => score + (title.includes(word) ? 4 : 0) + (body.includes(word) ? 1 : 0),
    0,
  );
}

export function createGlpiV2Adapter(glpiConfig) {
  const client = createGlpiV2Client(glpiConfig);

  return {
    info,
    async checkConnection() {
      return { ...info, status: 'ok', ...(await client.checkConnection()) };
    },
    async searchKnowledge({ category, system, description = '' }) {
      const doc = await client.getOpenApiDocument();
      const path = '/' + glpiConfig.knowledgeResource.split('/').filter(Boolean).join('/');
      if (!doc.paths?.[path]?.get) return [];
      const search = new URLSearchParams({ start: '0', limit: '100', language: 'pt_BR' });
      const response = await client.api(`${path}?${search}`);
      const rows = Array.isArray(response) ? response : response?.data || response?.items || [];
      return rows
        .map((item) => ({ item, score: relevance(item, description) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(({ item }) => {
          const content = String(item.content || item.answer || item.description || '');
          const intro = content.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1];
          const steps = [...content.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
            .map((match) => plainText(match[1]))
            .filter(Boolean);
          return {
            id: `GLPI-KB-${item.id}`,
            externalId: String(item.id),
            title: item.name || item.title || 'Artigo do GLPI',
            category,
            system,
            problem: item.name || item.title || '',
            solution: plainText(intro || content),
            steps,
            sourceProvider: 'glpi',
          };
        });
    },
    async createTicket({ request, decision, priority, queue, title = null, content = null, contentHtml = null }) {
      const doc = await client.getOpenApiDocument();
      const ticketCollection = '/Assistance/Ticket';
      if (!doc.paths?.[ticketCollection]?.post)
        throw new Error(
          `A instância GLPI não documenta POST ${ticketCollection} em /api.php/doc.json.`,
        );
      const level = { LOW: 2, MEDIUM: 3, HIGH: 4, CRITICAL: 5 };
      const body = {
        name: title || `[Pulso TIC ${request.id}] ${decision.category} - ${decision.system}`,
        content: contentHtml || content || `Comarca / município: ${request.locality || 'Não informado'}\n\n${request.description}`,
        urgency: level[decision.urgency] || 3,
        impact: level[decision.impact] || 3,
        type: 1,
      };
      let schema = doc.paths[ticketCollection].post.requestBody?.content?.['application/json']?.schema;
      while (schema?.$ref) {
        const schemaName = schema.$ref.split('/').pop();
        schema = doc.components?.schemas?.[schemaName];
      }
      // A prioridade calculada pelo Pulso só vai quando a instância documenta o campo.
      if (priority && schema?.properties?.priority) body.priority = level[priority] || 3;
      const queueCategoryId = glpiConfig.queueCategoryIds?.[queue];
      if (queueCategoryId) {
        if (!schema?.properties?.category)
          throw new Error('A API desta instância não documenta category no POST Assistance/Ticket; o chamado não foi enviado.');
        body.category = { id: Number(queueCategoryId) };
      }
      const result = await client.api(ticketCollection, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const item = result?.data || result;
      if (!item?.id) throw new Error('O GLPI não retornou o identificador do chamado criado.');
      const localId = `GLPI-${item.id}`;
      const localDescription = content || request.description;
      queryRaw(
        `INSERT INTO tickets(id,protocol,request_id,description,category,system,impact,urgency,priority,assigned_queue,confidence,synthetic,glpi_category_id,queue_routing) VALUES(${sqlValue(localId)},${sqlValue(String(item.id))},${sqlValue(request.id)},${sqlValue(localDescription)},${sqlValue(decision.category)},${sqlValue(decision.system)},${sqlValue(decision.impact)},${sqlValue(decision.urgency)},${sqlValue(priority)},${sqlValue(queue)},${Number(request.confidence) || 0},false,${queueCategoryId ? Number(queueCategoryId) : 'NULL'},${sqlValue(queueCategoryId ? 'GLPI_CATEGORY_SENT' : 'SUGGESTED_ONLY')})`,
      );
      query(
        `UPDATE requests SET status='TICKET_CREATED',priority=${sqlValue(priority)},queue=${sqlValue(queue)} WHERE id=${sqlValue(request.id)}`,
      );
      query(
        `INSERT INTO service_events(type,request_id) VALUES('TICKET_CREATED',${sqlValue(request.id)})`,
      );
      recordTicketStatus(localId, statusNames[item.status?.id || item.status] || 'NEW');
      return {
        id: localId,
        protocol: String(item.id),
        title: body.name,
        requestId: request.id,
        locality: request.locality,
        description: localDescription,
        category: decision.category,
        system: decision.system,
        impact: decision.impact,
        urgency: decision.urgency,
        priority,
        status: statusNames[item.status?.id || item.status] || item.status?.name || 'NEW',
        queue,
        queueRouting: queueCategoryId ? 'GLPI_CATEGORY_SENT' : 'SUGGESTED_ONLY',
        createdAt: item.date_creation || item.date || new Date().toISOString(),
        integration: info,
      };
    },
    async getTicket(reference) {
      const externalId = String(reference).replace(/^GLPI-/, '');
      if (!/^\d+$/.test(externalId)) return null;
      const result = await client.api(`/Assistance/Ticket/${encodeURIComponent(externalId)}`);
      const item = result?.data || result;
      if (!item?.id) return null;
      return {
        id: `GLPI-${item.id}`,
        protocol: String(item.id),
        description: item.content || '',
        status: statusNames[item.status?.id || item.status] || item.status?.name || 'UNKNOWN',
        createdAt: item.date_creation || item.date || null,
        integration: info,
      };
    },
    async getTicketStatus(reference) {
      const ticket = await this.getTicket(reference);
      if (ticket) recordTicketStatus(ticket.id, ticket.status);
      return ticket
        ? { id: ticket.id, protocol: ticket.protocol, status: ticket.status, integration: info }
        : null;
    },
    async syncStatuses() {
      const candidates = listTickets()
        .filter((ticket) => ticket.id.startsWith('GLPI-') && !['SOLVED', 'CLOSED'].includes(ticket.status))
        .slice(0, 50);
      let synchronized = 0;
      const errors = [];
      for (const ticket of candidates) {
        try {
          if (await this.getTicketStatus(ticket.id)) synchronized++;
        } catch (error) {
          errors.push({ id: ticket.id, error: error.message });
        }
      }
      return { synchronized, errors };
    },
  };
}
