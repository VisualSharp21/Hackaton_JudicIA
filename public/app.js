import { createTicketPages } from './pages/tickets.js';
import { createQualityPage } from './pages/quality.js';
import { createTriageSettingsPage } from './pages/triage-settings.js';
import { createPilotPage } from './pages/pilot.js';
import { createIntegrationPage } from './pages/integration.js';
import { createTicketDetailPage } from './pages/ticket-detail.js';
import { createUserManagementPage } from './pages/user-management.js';
import { createPrediagPage } from './pages/prediag.js';
import { createMonitoringPage } from './pages/monitoring.js';
import { createCopilotChat } from './pages/copilot-chat.js';
import { createMeetCheckPage } from './pages/meet-check.js';
import { createCopilotSettingsPage } from './pages/copilot-settings.js';
import { triageQuestionLabels } from './pages/triage-labels.js';

(() => {
  const $ = (s) => document.querySelector(s);

  // ---------------- carregamento ----------------
  // Toda chamada de API passa por aqui, então a barra de progresso cobre o app
  // inteiro (inclusive as páginas em módulos) com uma só mudança.
  let inFlight = 0;
  function setLoading(active) {
    const bar = $('#loading-bar');
    if (bar) bar.hidden = !active;
    document.body.dataset.loading = active ? 'true' : 'false';
  }
  const api = async (path, options) => {
    inFlight += 1;
    setLoading(true);
    try {
      return await window.pulsoApi(path, options);
    } finally {
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight === 0) setLoading(false);
    }
  };

  /**
   * Executa uma ação de escrita com o botão ocupado. Devolve antes de agir se já
   * estiver ocupado — é o que impede o duplo envio que gerava o 409
   * "Já existe um chamado para esta solicitação".
   */
  async function withBusy(el, busyLabel, fn) {
    if (!el) return fn();
    if (el.getAttribute('aria-busy') === 'true') return undefined;
    const label = el.querySelector('.button-label');
    const original = label ? label.textContent : el.textContent;
    el.setAttribute('aria-busy', 'true');
    el.disabled = true;
    if (busyLabel) {
      if (label) label.textContent = busyLabel;
      else el.textContent = busyLabel;
    }
    try {
      return await fn();
    } finally {
      el.removeAttribute('aria-busy');
      el.disabled = false;
      if (busyLabel) {
        if (label) label.textContent = original;
        else el.textContent = original;
      }
    }
  }

  /** Placeholder só na primeira carga de uma tela (refetch mantém o quadro). */
  function showViewLoading(viewId, text = 'Carregando…') {
    const view = $(viewId);
    if (view && !view.firstElementChild) {
      view.innerHTML = `<div class="view-loading">${text}</div>`;
    }
  }
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const categoryPt = {
    ACCESS: 'Acesso',
    SYSTEM: 'Sistemas',
    NETWORK: 'Rede',
    HARDWARE: 'Hardware',
    SOFTWARE: 'Software',
    PRINTING: 'Impressão',
    OTHER: 'Outros',
  };
  const systemPt = {
    PJE: 'PJe',
    SEI: 'SEI',
    EMAIL: 'E-mail',
    INTERNET: 'Internet',
    COMPUTER: 'Computador',
    PRINTER: 'Impressora',
    OTHER: 'Outro',
    UNKNOWN: 'Não identificado',
  };
  const levelPt = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta', CRITICAL: 'Crítica' };
  const ticketStatusPt = {
    NEW: 'Novo', OPEN: 'Aberto', ASSIGNED: 'Em atendimento', PLANNED: 'Planejado', WAITING: 'Pendente',
    SOLVED: 'Solucionado', CLOSED: 'Fechado', UNKNOWN: 'Indisponível',
  };
  const fmtTime = (x) =>
    new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(x));
  const fmtDate = (x) =>
    new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(x));
  const state = { cache: { tickets: [], incidents: [], events: [], articles: [] }, currentUser: null, currentRequest: null, currentTicket: null, health: null, triageCases: [], triageSettingsBase: null, triageSettingsRequiresKey: false, triageSettingsKey: '' };
  const roleViews = {
    solicitante: new Set(['inicio', 'tickets', 'prediag', 'meet-check', 'detail']),
    tic: new Set(['inicio', 'dashboard', 'monitoring', 'tickets', 'incidents', 'integration', 'copilot-settings', 'quality', 'pilot', 'triage-settings', 'prediag', 'meet-check', 'detail']),
    gestor: new Set(['dashboard', 'monitoring', 'tickets', 'incidents', 'pilot', 'users', 'prediag', 'meet-check', 'detail']),
  };
  const roleNames = { solicitante: 'Solicitante', tic: 'Equipe de TIC', gestor: 'Gestor' };
  /** Seções que podem viver no endereço (#secao) — as demais dependem de estado. */
  const DEEP_LINKABLE = new Set([
    'inicio', 'dashboard', 'monitoring', 'tickets', 'incidents',
    'quality', 'pilot', 'integration', 'copilot-settings', 'triage-settings', 'users', 'prediag', 'meet-check',
  ]);
  const sharedPageContext = {
    $, api, esc, categoryPt, systemPt, levelPt, ticketStatusPt, fmtTime, fmtDate,
    state, toast, navigate, selectOptions, triageQuestionLabels,
  };
  const settingsPage = createTriageSettingsPage(sharedPageContext);
  const ticketPages = createTicketPages(sharedPageContext);
  const pageContext = { ...sharedPageContext, triageSettingsAuthHeaders: settingsPage.triageSettingsAuthHeaders, renderTickets: ticketPages.renderTickets };
  const pages = {
    tickets: ticketPages,
    quality: createQualityPage(pageContext),
    settings: settingsPage,
    pilot: createPilotPage(pageContext),
    integration: createIntegrationPage(pageContext),
    detail: createTicketDetailPage(pageContext),
    users: createUserManagementPage({ $, api, esc, toast, getCurrentUserId: () => state.currentUser?.id }),
    prediag: createPrediagPage({ $, api, esc, toast, navigate, canOpenTicket: () => hasViewAccess('inicio'), openCopilot: (input) => pages.copilot.openWith(input) }),
    monitoring: createMonitoringPage(pageContext),
    copilot: createCopilotChat({
      $, api, esc, toast, navigate, levelPt, categoryPt, systemPt,
      showTicketDetail: (ticket) => pages.detail.showDetail(state.cache.tickets.find((t) => t.id === ticket.id) || ticket),
      reload: () => reload(),
    }),
    meetCheck: createMeetCheckPage({ $, esc, toast, state, canUseCopilot: () => hasViewAccess('inicio'), openCopilotWithReport: (report) => pages.copilot.sendMeetReport(report) }),
    copilotSettings: createCopilotSettingsPage({ $, api, esc, toast }),
  };
  const { renderDashboard, renderTickets, renderIncidents } = pages.tickets;
  const { renderQuality } = pages.quality;
  const { renderTriageSettings, saveTriageSettings, triageSettingsAuthHeaders, previewTriageDraft } = pages.settings;
  const { renderPilot, savePilotSettings, syncPilotStatuses, syncTicketStatuses } = pages.pilot;
  const { renderPrediag } = pages.prediag;
  const { renderMonitoring } = pages.monitoring;
  const { renderMeetCheck } = pages.meetCheck;
  const { renderCopilotSettings } = pages.copilotSettings;
  const { renderIntegration, saveIntegrationSettings } = pages.integration;
  const { showDetail, refreshTicketStatus } = pages.detail;
  const { renderUsers, createUser, saveUserRole, createLocality, toggleLocality } = pages.users;

  function hasViewAccess(view) {
    return Boolean(state.currentUser && roleViews[state.currentUser.role]?.has(view));
  }
  async function activateAuthenticatedApp(user, csrfToken) {
    state.currentUser = user;
    window.pulsoSetCsrfToken(csrfToken);
    $('#current-user-name').textContent = user.displayName;
    $('#current-user-role').textContent = roleNames[user.role] || user.role;
    $('#current-user-avatar').textContent = user.displayName.trim().slice(0, 1).toUpperCase();
    document.querySelectorAll('.nav-item[data-roles]').forEach((item) => {
      item.hidden = !item.dataset.roles.split(',').includes(user.role);
    });
    $('#auth-screen').hidden = true;
    $('.app-shell').hidden = false;
    await reload();
    if (hasViewAccess('inicio')) await pages.copilot.init();
    // Respeita a seção do endereço (refresh / aba aberta direto numa seção);
    // se não houver uma válida para o perfil, cai no padrão.
    const fromHash = window.location.hash.slice(1);
    if (DEEP_LINKABLE.has(fromHash) && hasViewAccess(fromHash)) openView(fromHash);
    else openView(user.role === 'gestor' ? 'dashboard' : 'inicio');
  }
  async function initializeAuthentication() {
    try {
      const { user } = await api('/api/auth/me');
      const { csrfToken } = await api('/api/auth/csrf');
      await activateAuthenticatedApp(user, csrfToken);
    } catch (error) {
      state.currentUser = null;
      window.pulsoSetCsrfToken('');
      $('.app-shell').hidden = true;
      $('#auth-screen').hidden = false;
      if (error.status !== 401) {
        $('#auth-error').textContent = error.message;
        $('#auth-error').hidden = false;
      }
    }
  }
  async function reload() {
    const [data, h] = await Promise.all([api('/api/bootstrap'), api('/api/health')]);
    state.cache = data;
    Object.assign(categoryPt, data.categoryLabels || {});
    Object.assign(systemPt, data.systemLabels || {});
    // A comarca do atendimento vem da estação selecionada no Copilot (unidade do inventário).
    state.health = h;
    updateCounts();
    if (hasViewAccess('dashboard')) void renderDashboard();
    if (hasViewAccess('tickets')) void renderTickets();
    if (hasViewAccess('incidents')) void renderIncidents();
    // O monitoramento tem cache próprio; sem isto ele seguia mostrando os
    // números anteriores depois de abrir chamados.
    if ($('#view-monitoring')?.classList.contains('active')) renderMonitoring();
    updateHealthTag();
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 3300);
  }
  function updateCounts() {
    $('#nav-ticket-count').textContent = state.cache.tickets.length;
    $('#nav-incident-count').textContent = state.cache.incidents.filter(
      (i) => i.status === 'INVESTIGATING',
    ).length;
  }
  function updateHealthTag() {
    const tag = $('.demo-tag');
    if (!tag || !state.health) return;
    const providerName =
      state.health.decisionProvider === 'laya'
        ? 'Laya local'
        : state.health.decisionProvider === 'openrouter'
          ? 'OpenRouter'
          : state.health.decisionProvider === 'typesafe'
            ? 'TypeSafe'
            : 'classificador local';
    tag.title = state.health.jevConfigured
      ? providerName + ' configurado; disponibilidade confirmada a cada análise.'
      : 'Classificação local demonstrativa; configure o provedor no servidor.';
    const pulseColor = state.health.database === 'ok' ? '#4aa986' : '#c34d50';
    tag.innerHTML =
      '<span class="pulse" style="background:' +
      pulseColor +
      '"></span> ' +
      (state.health.jevConfigured ? providerName.toUpperCase() + ' CONFIGURADO' : 'DEMONSTRAÇÃO LOCAL');
  }
  function navigate(view) {
    if (!hasViewAccess(view)) {
      toast('Seu perfil não tem acesso a este módulo.');
      return;
    }
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document
      .querySelectorAll('.nav-item')
      .forEach((n) => n.classList.toggle('active', n.dataset.view === view));
    const el = $(`#view-${view}`);
    if (el) el.classList.add('active');
    const names = {
      inicio: 'Atendimento · Copilot',
      'meet-check': 'Teste de audiência',
      'copilot-settings': 'Copilot (IA)',
      dashboard: 'Visão geral',
      monitoring: 'Monitoramento',
      tickets: 'Chamados',
      incidents: 'Incidentes',
      quality: 'Qualidade da triagem',
      pilot: 'Piloto e SLAs',
      integration: 'Integração GLPI',
      'triage-settings': 'Configuração da triagem',
      users: 'Acessos',
      prediag: 'Pré-diagnóstico',
      detail: 'Detalhe',
    };
    $('#page-crumb').textContent = names[view] || 'Atendimento';
    // Espelha a seção no endereço: cada aba passa a ter a própria URL, o
    // refresh mantém o lugar e dá para abrir uma seção direto em outra aba.
    // As telas do fluxo (análise, autoatendimento, protocolo, detalhe) ficam de
    // fora porque dependem de estado em memória e abririam vazias.
    if (DEEP_LINKABLE.has(view) && window.location.hash.slice(1) !== view) {
      // Atualizar o endereço é cosmético: se o navegador recusar (contexto sem
      // history, file://), a navegação precisa seguir funcionando.
      try {
        history.replaceState(null, '', `#${view}`);
      } catch {
        /* sem histórico disponível */
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * "+ Nova solicitação": abre o Copilot. Se o atendimento atual já terminou
   * (resolvido ou virou chamado), começa uma conversa nova; se ainda está em
   * andamento, mantém a conversa para o usuário não perder o contexto.
   */
  function goHome() {
    if (!hasViewAccess('inicio')) return navigate('inicio');
    if (pages.copilot.isClosed()) pages.copilot.newConversation();
    navigate('inicio');
    pages.copilot.render();
  }
  function selectOptions(labels, selected) {
    return Object.entries(labels)
      .map(
        ([value, label]) =>
          `<option value="${value}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`,
      )
      .join('');
  }
  async function saveEvaluationCase(requestId) {
    const text = $(`[data-evaluation-text="${requestId}"]`)?.value || '',
      confirmAnonymized = $(`[data-evaluation-confirm="${requestId}"]`)?.checked === true;
    try {
      await api('/api/quality/evaluation-cases', {
        method: 'POST',
        body: JSON.stringify({ requestId, text, confirmAnonymized }),
      });
      toast('Exemplo anonimizado salvo no conjunto de feedback.');
      void renderQuality();
    } catch (e) {
      toast(e.message);
    }
  }
  async function saveQualityCorrection(requestId) {
    const editor = $(`[data-quality-correction="${requestId}"]`);
    if (!editor) return;
    const field = (name) => editor.querySelector(`[data-quality-field="${name}"]`);
    const decision = {
      category: field('category').value,
      system: field('system').value,
      impact: field('impact').value,
      urgency: field('urgency').value,
      possibleIncident: field('possibleIncident').checked,
      humanRequired: field('humanRequired').checked,
      outage: field('outage').checked,
    };
    try {
      await api(`/api/requests/${encodeURIComponent(requestId)}/correction`, {
        method: 'POST',
        body: JSON.stringify({ decision, reason: field('reason').value }),
      });
      toast('Classificação corrigida. Se já havia um exemplo salvo, ele voltou para pendente de avaliação.');
      await renderQuality();
    } catch (error) {
      toast(error.message);
    }
  }
  async function logout() {
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
    } catch (error) {
      toast(error.message);
    } finally {
      state.currentUser = null;
      window.pulsoSetCsrfToken('');
      pages.copilot.reset();
      $('.app-shell').hidden = true;
      $('#auth-screen').hidden = false;
      $('#login-form').reset();
      $('#auth-error').hidden = true;
    }
  }
  async function runFeedbackEvaluation() {
    const button = $('[data-action="run-feedback-evaluation"]');
    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = 'Avaliando casos…';
    try {
      const report = await api('/api/quality/feedback-evaluation', {
        method: 'POST',
        headers: triageSettingsAuthHeaders(),
        body: '{}',
      });
      const message = report.status === 'completed'
        ? `Avaliação concluída: ${report.exactMatchCount}/${report.totalCases} casos conferem integralmente.`
        : `Avaliação ${report.status === 'partial' ? 'parcial' : 'com falhas'}: ${report.evaluatedCount}/${report.totalCases} casos avaliados.`;
      toast(message);
      await renderQuality();
    } catch (error) {
      toast(error.message);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = 'Avaliar casos';
      }
    }
  }
  async function downloadEvaluationCases() {
    try {
      const cases = await api('/api/quality/evaluation-cases');
      if (!cases.length) {
        toast('Ainda não há exemplos revisados para baixar.');
        return;
      }
      const link = document.createElement('a'),
        url = URL.createObjectURL(
          new Blob([JSON.stringify(cases, null, 2)], { type: 'application/json' }),
        );
      link.href = url;
      link.download = 'pulso-casos-feedback.json';
      link.click();
      URL.revokeObjectURL(url);
      toast(`${cases.length} casos revisados exportados.`);
    } catch (e) {
      toast(e.message);
    }
  }
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#login-button');
    const errorBox = $('#auth-error');
    button.disabled = true;
    button.textContent = 'Entrando…';
    errorBox.hidden = true;
    try {
      const result = await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ tenantSlug: $('#login-tenant').value, email: $('#login-email').value, password: $('#login-password').value }),
      });
      $('#login-form').reset();
      await activateAuthenticatedApp(result.user, result.csrfToken);
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = 'Entrar';
    }
  });
  window.addEventListener('pulso:unauthorized', () => {
    state.currentUser = null;
    window.pulsoSetCsrfToken('');
    $('.app-shell').hidden = true;
    $('#auth-screen').hidden = false;
    $('#auth-error').textContent = 'Sua sessão expirou. Entre novamente.';
    $('#auth-error').hidden = false;
  });
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
    openView(button.dataset.view);
  }));

  /**
   * Abre uma seção: carrega os dados dela e navega. É o ponto único usado pelo
   * menu, pelo endereço (#secao) e pela inicialização.
   */
  function openView(view) {
    if (!hasViewAccess(view)) return toast('Seu perfil não tem acesso a este módulo.');
    // A conversa do Copilot sobrevive à troca de seção; só "Novo atendimento" a encerra.
    if (view === 'inicio') pages.copilot.render();
    if (view === 'meet-check') renderMeetCheck();
    if (view === 'copilot-settings') void renderCopilotSettings();
    if (view === 'dashboard') { showViewLoading('#view-dashboard'); void renderDashboard(); }
    if (view === 'monitoring') renderMonitoring();
    if (view === 'tickets') { showViewLoading('#view-tickets'); void renderTickets(); }
    if (view === 'incidents') { showViewLoading('#view-incidents'); void renderIncidents(); }
    if (view === 'quality') void renderQuality();
    if (view === 'pilot') void renderPilot();
    if (view === 'integration') void renderIntegration();
    if (view === 'triage-settings') void renderTriageSettings();
    if (view === 'users') void renderUsers();
    if (view === 'prediag') renderPrediag();
    navigate(view);
  }
  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'logout') void logout();
    if (action === 'home') goHome();
    if (action === 'save-evaluation-case') void saveEvaluationCase(event.target.closest('[data-request]')?.dataset.request);
    if (action === 'save-quality-correction') void saveQualityCorrection(event.target.closest('[data-request]')?.dataset.request);
    if (action === 'run-feedback-evaluation') void runFeedbackEvaluation();
    if (action === 'download-evaluation-cases') void downloadEvaluationCases();
    if (action === 'refresh-integration') void renderIntegration();
    if (action === 'refresh-triage-settings') void renderTriageSettings();
    if (action === 'refresh-users') void renderUsers();
    if (action === 'save-user-role') void saveUserRole(event.target.closest('[data-user]')?.dataset.user);
    if (action === 'toggle-locality') void toggleLocality(event.target.closest('[data-locality]')?.dataset.locality, event.target.closest('[data-locality]')?.dataset.active === 'true');
    if (action === 'sync-pilot-status') void syncPilotStatuses();
    if (action === 'sync-tickets') void syncTicketStatuses();
    if (action === 'save-integration') void saveIntegrationSettings($('#integration-form'));
    if (action === 'refresh-ticket-status') void refreshTicketStatus();
    if (action === 'dashboard') { void renderDashboard(); navigate('dashboard'); }
    if (action === 'tickets') { void renderTickets(); navigate('tickets'); }
    if (action === 'incidents') { void renderIncidents(); navigate('incidents'); }
    const ticketRow = event.target.closest('[data-ticket]');
    if (ticketRow) void showDetail(state.cache.tickets.find((ticket) => ticket.id === ticketRow.dataset.ticket));
    if (event.target.closest('[data-incident]')) { void renderIncidents(); navigate('incidents'); }
  });
  // Voltar/avançar do navegador e edição manual do endereço.
  window.addEventListener('hashchange', () => {
    if (!state.currentUser) return;
    const view = window.location.hash.slice(1);
    const active = document.querySelector('.view.active')?.id.replace('view-', '');
    if (DEEP_LINKABLE.has(view) && view !== active && hasViewAccess(view)) openView(view);
  });
  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (form.id === 'integration-form') { event.preventDefault(); void saveIntegrationSettings(form); }
    if (form.id === 'triage-settings-form') { event.preventDefault(); void saveTriageSettings(form); }
    if (form.id === 'triage-preview-form') { event.preventDefault(); void previewTriageDraft(form); }
    if (form.id === 'pilot-settings-form') { event.preventDefault(); void savePilotSettings(form); }
    if (form.id === 'user-create-form') { event.preventDefault(); void createUser(form); }
    if (form.id === 'locality-create-form') { event.preventDefault(); void createLocality(form); }
  });
  // ---------------- tema claro/escuro ----------------
  // Sem data-theme, o CSS segue o sistema; o toggle grava uma preferência que vence.
  function applyTheme(dark) {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const button = $('#theme-toggle');
    button.setAttribute('aria-pressed', String(dark));
    button.textContent = dark ? '☀' : '☾';
    button.title = dark ? 'Usar tema claro' : 'Usar tema escuro';
    try { localStorage.setItem('pulso-theme', dark ? 'dark' : 'light'); } catch { /* storage bloqueado */ }
  }
  {
    let saved = null;
    try { saved = localStorage.getItem('pulso-theme'); } catch { /* storage bloqueado */ }
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
    applyTheme(saved ? saved === 'dark' : prefersDark);
    $('#theme-toggle').addEventListener('click', () =>
      applyTheme(document.documentElement.dataset.theme !== 'dark'),
    );
  }

  $('#reset-data').addEventListener('click', () => reload().then(() => toast('Dados atualizados do PostgreSQL.')).catch((error) => toast(error.message)));
  void initializeAuthentication();
})();
