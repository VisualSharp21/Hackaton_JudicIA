const REQUIRED_METHODS = [
  'checkConnection',
  'searchKnowledge',
  'createTicket',
  'getTicket',
  'getTicketStatus',
];

export function validateTicketingAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('O adaptador de chamados precisa ser um objeto.');
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') {
      throw new TypeError(`O adaptador de chamados precisa implementar ${method}().`);
    }
  }

  if (!adapter.info?.provider || !adapter.info?.mode) {
    throw new TypeError('O adaptador precisa informar provider e mode em info.');
  }

  return Object.freeze(adapter);
}
