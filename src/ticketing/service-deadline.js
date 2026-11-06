export function serviceDeadline(ticket, targets, now = Date.now()) {
  const minutes = Number(targets?.resolution?.[ticket.priority]);
  const created = Date.parse(ticket.createdAt);
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(created)) return { status: 'UNCONFIGURED', dueAt: null, minutes: null, basis: 'Meta de resolução ainda não configurada.' };
  const due = created + minutes * 60000;
  const closed = ['RESOLVED', 'CLOSED', 'SOLVED'].includes(ticket.status);
  const end = closed ? Date.parse(ticket.firstResolvedAt) : now;
  return { dueAt: new Date(due).toISOString(), minutes, status: closed ? Number.isFinite(end) ? end > due ? 'CLOSED_LATE' : 'CLOSED_ON_TIME' : 'CLOSED_UNKNOWN' : now > due ? 'OVERDUE' : now >= created + minutes * 60000 * 0.75 ? 'AT_RISK' : 'ON_TIME',
    basis: 'Meta atual de resolução por prioridade; tempo corrido. Não substitui o calendário de SLA oficial do GLPI.' };
}
