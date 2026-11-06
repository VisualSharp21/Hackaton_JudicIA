const apiBase =
  window.PULSO_API_BASE ??
  (window.location.port === '5173'
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : '');
window.pulsoApiBase = apiBase || window.location.origin;
let csrfToken = '';

/**
 * Slot da aba. O sessionStorage é isolado por aba, então cada aba recebe um
 * slot próprio e o backend lê/escreve `pulso_session_<slot>` — o que permite
 * contas diferentes em abas diferentes. O token em si continua no cookie
 * HttpOnly; o slot é só um nome, sem valor de autenticação.
 *
 * Uma aba duplicada herda o sessionStorage (e portanto o slot) da original:
 * é o comportamento esperado, as duas continuam na mesma conta até que uma
 * delas entre com outra.
 */
const tabSlot = (() => {
  try {
    let slot = window.sessionStorage.getItem('pulso-slot');
    if (!/^[a-z0-9]{1,12}$/.test(slot || '')) {
      slot = Math.random().toString(36).slice(2, 10);
      window.sessionStorage.setItem('pulso-slot', slot);
    }
    return slot;
  } catch {
    return ''; // sessionStorage bloqueado: cai no cookie legado, compartilhado
  }
})();
window.pulsoTabSlot = tabSlot;

window.pulsoSetCsrfToken = (token) => {
  csrfToken = typeof token === 'string' ? token : '';
};

async function api(path, options = {}) {
  let response;
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(tabSlot ? { 'X-Pulso-Slot': tabSlot } : {}),
    ...options.headers,
  };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken)
    headers['X-CSRF-Token'] = csrfToken;

  try {
    response = await fetch(`${apiBase}${path}`, {
      ...options,
      credentials: 'include',
      headers,
    });
  } catch {
    throw new Error('Não foi possível conectar à API. Verifique se o backend está ativo.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Falha na API (${response.status})`);
    error.status = response.status;
    if (response.status === 401 && !['/api/auth/login', '/api/auth/me'].includes(path))
      window.dispatchEvent(new Event('pulso:unauthorized'));
    throw error;
  }

  return data;
}

window.pulsoApi = api;
