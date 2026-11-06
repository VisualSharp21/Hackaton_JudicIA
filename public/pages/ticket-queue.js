const normalize = (v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
export function liveDeadline(ticket, now = Date.now()) {
  const d = ticket.serviceDeadline || { status: 'UNCONFIGURED' };
  if (d.status.startsWith('CLOSED') || d.status === 'UNCONFIGURED') return d;
  const due = Date.parse(d.dueAt);
  return { ...d, status: now > due ? 'OVERDUE' : now >= due - d.minutes * 15000 ? 'AT_RISK' : 'ON_TIME' };
}
export function filterTicketQueue(tickets, filters = {}, now = Date.now()) {
  const q = normalize(filters.q);
  const list = tickets.filter((t) => (!q || normalize([t.protocol,t.description,t.locality,t.system,t.category,t.queue].join(' ')).includes(q))
    && (!filters.status || t.status === filters.status) && (!filters.priority || t.priority === filters.priority)
    && (!filters.locality || t.locality === filters.locality) && (!filters.sla || liveDeadline(t, now).status === filters.sla));
  return list.sort((a,b) => filters.sort === 'deadline' ? (Date.parse(a.serviceDeadline?.dueAt) || Infinity) - (Date.parse(b.serviceDeadline?.dueAt) || Infinity)
    : filters.sort === 'newest' ? Date.parse(b.createdAt)-Date.parse(a.createdAt) : (rank[b.priority] || 0)-(rank[a.priority] || 0) || Date.parse(a.createdAt)-Date.parse(b.createdAt));
}
export const deadlineLabel = { UNCONFIGURED: 'Sem meta', OVERDUE: 'Prazo excedido', AT_RISK: 'Próximo de vencer', ON_TIME: 'Dentro da meta', CLOSED_LATE: 'Resolvido após a meta', CLOSED_ON_TIME: 'Resolvido dentro da meta', CLOSED_UNKNOWN: 'Encerrado sem marco observado' };
