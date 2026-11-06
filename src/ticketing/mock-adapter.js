import { randomUUID } from 'node:crypto';
import { query, queryRaw, sqlValue } from '../database.js';
import { articlesFor, createIncidentFor, listTickets } from '../repository.js';

const adapterInfo = Object.freeze({
  provider: 'mock',
  mode: 'simulated',
  displayName: 'Conector simulado',
});

function withIntegrationInfo(ticket) {
  return ticket ? { ...ticket, integration: adapterInfo } : null;
}

export function createMockTicketingAdapter() {
  return {
    info: adapterInfo,

    async checkConnection() {
      return { ...adapterInfo, status: 'ok' };
    },

    async searchKnowledge({ category, system }) {
      return articlesFor(category, system);
    },

    async createTicket({ request, decision, priority, queue, title = null, content = null }) {
      const id = `TCK-${randomUUID().slice(0, 8).toUpperCase()}`;
      const protocol = `JUD-${query("INSERT INTO ticket_protocol_seq() VALUES(); SELECT LPAD(LAST_INSERT_ID(),6,'0')")}`;
      // Sem GLPI real, o corpo enriquecido (título + laudo) fica salvo como descrição do chamado.
      const description = content ? `${title ? `${title}\n\n` : ''}${content}` : request.description;

      queryRaw(
        `INSERT INTO tickets(id,protocol,request_id,description,category,system,impact,urgency,priority,assigned_queue,confidence,synthetic) VALUES(${sqlValue(id)},${sqlValue(protocol)},${sqlValue(request.id)},${sqlValue(description)},${sqlValue(decision.category)},${sqlValue(decision.system)},${sqlValue(decision.impact)},${sqlValue(decision.urgency)},${sqlValue(priority)},${sqlValue(queue)},${Number(request.confidence) || 0},false)`,
      );
      query(
        `UPDATE requests SET status='TICKET_CREATED',priority=${sqlValue(priority)},queue=${sqlValue(queue)} WHERE id=${sqlValue(request.id)}`,
      );
      query(
        `INSERT INTO service_events(type,request_id) VALUES('TICKET_CREATED',${sqlValue(request.id)})`,
      );

      const ticket = {
        id,
        protocol,
        title,
        requestId: request.id,
        locality: request.locality,
        description,
        category: decision.category,
        system: decision.system,
        impact: decision.impact,
        urgency: decision.urgency,
        priority,
        status: 'OPEN',
        queue,
        confidence: Number(request.confidence),
        createdAt: new Date().toISOString(),
      };

      ticket.incidentId = createIncidentFor(ticket);
      if (ticket.incidentId) {
        query(
          `INSERT INTO service_events(type,request_id) VALUES('INCIDENT_DETECTED',${sqlValue(request.id)})`,
        );
      }

      return withIntegrationInfo(ticket);
    },

    async getTicket(reference) {
      const ticket = listTickets().find(
        (item) => item.id === reference || item.protocol === reference,
      );
      return withIntegrationInfo(ticket);
    },

    async getTicketStatus(reference) {
      const ticket = await this.getTicket(reference);
      return ticket
        ? {
            id: ticket.id,
            protocol: ticket.protocol,
            status: ticket.status,
            integration: adapterInfo,
          }
        : null;
    },
  };
}
