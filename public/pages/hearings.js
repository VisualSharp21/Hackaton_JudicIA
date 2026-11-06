import { detailsMarkup } from './hearing-details.js';
import { incidentsMarkup, noticesMarkup, executiveMarkup, downloadJson, submitOperation, supportRegistryMarkup } from './prevention-operations.js';
export function createHearingsPage({ $, api, esc, state, toast, demo = false, openExistingView }) {
  let snapshot = { hearings: [], stations: [], escalations: [] };
  let selectedId = null; let detailData = null; let detailBusy = false; let report = null; let tourStep = -1;
  let events; let clockTimer; let lastReceived = 0; let editing = null;
  const manage = () => ['tic', 'gestor'].includes(state.currentUser?.role);
  const tic = () => state.currentUser?.role === 'tic';
  const request = (path, method, body) => api(path, { method, body: JSON.stringify(body) });
  const root = () => $('#view-hearings');
  const layerLabel = { SERVER: 'Servidor', AGENT: 'Agente', BROWSER: 'Navegador' };
  const resultLabel = { PASS: 'Aprovado', FAIL: 'Falha', DETECTED: 'Detectado, sem teste funcional', UNVERIFIABLE: 'Não verificável' };
  const escalationLabel = { PENDING: 'Aguardando envio', SENT: 'Chamado confirmado', SENDING: 'Enviando', UNCERTAIN: 'Aguardando confirmação do GLPI', BLOCKED: 'Envio bloqueado', REVIEW_REQUIRED: 'Revisão necessária', CANCELLED: 'Cancelada' };
  function time(value, timezone = 'America/Sao_Paulo') { return new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
  function countdown(h) {
    const now = Date.parse(snapshot.serverTime || new Date().toISOString()) + (Date.now() - lastReceived) * (snapshot.clockSpeed || 1);
    const minutes = Math.ceil((Date.parse(h.startsAt) - now) / 60000);
    return h.lifecycle !== 'ATIVA' ? h.lifecycle : minutes > 0 ? `Em ${minutes} min` : `Iniciada há ${Math.abs(minutes)} min`;
  }
  function render() {
    const list = $('#hearing-list'); if (!list) return;
    $('#hearing-notices').innerHTML = noticesMarkup(snapshot, esc);
    // Preserve a technician's unfinished form while SSE updates the cards.
    if (!$('#hearing-operations')?.contains(document.activeElement)) $('#hearing-operations').innerHTML = incidentsMarkup(snapshot.incidents || [], esc, tic(), snapshot.hearings);
    if (selectedId) void refreshDetails();
    $('#hearing-count').textContent = snapshot.hearings.filter((h) => h.lifecycle === 'ATIVA').length;
    $('#hearing-ready').textContent = snapshot.hearings.filter((h) => h.state === 'PRONTA' && h.lifecycle === 'ATIVA').length;
    $('#hearing-critical').textContent = snapshot.hearings.filter((h) => h.state === 'CRÍTICA' && h.lifecycle === 'ATIVA').length;
    $('#hearing-clock').textContent = snapshot.serverTime ? `Relógio do scheduler: ${time(snapshot.serverTime)}${snapshot.clockSpeed ? ` · ${snapshot.clockSpeed}×` : ''}` : '';
    list.innerHTML = snapshot.hearings.length ? [...snapshot.hearings].sort((a,b) => (a.lifecycle !== 'ATIVA') - (b.lifecycle !== 'ATIVA') || Date.parse(a.startsAt) - Date.parse(b.startsAt) || (b.state === 'CRÍTICA') - (a.state === 'CRÍTICA')).map((h) => {
      const tickets = snapshot.escalations.filter((e) => e.hearingId === h.id).map((e) => e.status === 'LINKED' ? { ...e, ticket: snapshot.escalations.find((primary) => primary.id === e.linkedTo)?.ticket, status: 'LINKED' } : e);
      return `<article class="hearing-card" data-state="${esc(h.state)}">
        <div class="hearing-time"><strong>${esc(time(h.startsAt, h.timezone))}</strong><span data-countdown="${esc(h.id)}">${esc(countdown(h))}</span><small>${esc(h.timezone)}</small></div>
        <div class="hearing-body"><div class="hearing-heading"><h3><a href="/audiencias/${encodeURIComponent(h.id)}" data-hearing-action="details" data-id="${esc(h.id)}">${esc(h.label)}</a></h3><span class="hearing-mode">${esc(h.mode)}</span><span class="hearing-status">${esc(h.state)}</span></div>
          <p>${esc(h.locality)} · ${esc(h.room)} · <strong>${esc(h.stationId)}</strong></p>
          <p>Responsável: ${esc(h.responsible)} · Dispositivos: ${esc(h.devices.join(', ') || 'Não associados')}</p>
          <p>${esc(h.type || 'Audiência')} / Prontidão: <b>${esc(h.state.replaceAll('_', ' '))}</b></p>
          <p>${(h.lastChecks || []).filter(c => ['PASS', 'FAIL', 'DETECTED'].includes(c.status)).length}/${h.lastChecks?.length || 0} verificações concluídas / ${(h.lastChecks || []).filter(c => c.status === 'FAIL').length} falhas detectadas</p>
          ${h.lastChecks?.some(c => c.status === 'FAIL') ? `<p class="hearing-escalation">${esc(h.lastChecks.filter(c => c.status === 'FAIL').map(c => c.evidence).join(' / '))}</p>` : '<p class="hearing-muted">Acompanhamento automático pelo scheduler T−30.</p>'}
          ${tickets.map((e) => `<p class="hearing-escalation">Escalação ${e.priority === 'CRITICAL' ? 'crítica' : 'alta'}: <b>${esc(e.status === 'LINKED' ? 'Associada ao suporte coletivo' : escalationLabel[e.status] || e.status)}</b> · Chamado ${esc(e.ticket?.id || 'aguardando confirmação')} ${e.errorCode ? `· ${esc(e.errorCode)}` : ''}</p>`).join('')}
          <div class="action-row"><button class="button button-primary" data-hearing-action="details" data-id="${esc(h.id)}">Abrir audiência</button>
          ${manage() && h.lifecycle === 'ATIVA' ? `<button class="button button-secondary" data-hearing-action="edit" data-id="${esc(h.id)}">Reagendar</button><button class="button button-secondary" data-hearing-action="complete" data-id="${esc(h.id)}">Concluir</button><button class="button button-secondary" data-hearing-action="cancel" data-id="${esc(h.id)}">Cancelar</button>` : ''}</div>
        </div></article>`;
    }).join('') : '<p class="hearing-empty">Nenhuma audiência programada. A agenda aparecerá aqui quando houver sessões cadastradas.</p>';
    const select = $('#hearing-station');
    if (select) { const value = select.value; select.innerHTML = '<option value="">Selecione a estação</option>' + snapshot.stations.map((s) => `<option value="${esc(s.id)}">${esc(s.id)} · ${esc(s.locality)} · ${esc(s.mode)}</option>`).join(''); select.value = value; }
  }
  async function reload() { snapshot = await api('/api/hearings'); lastReceived = Date.now(); render(); }
  function disconnect() { events?.close(); events = null; clearInterval(clockTimer); }
  function connect() {
    disconnect();
    events = new EventSource(`${window.pulsoApiBase || ''}/api/hearings/events${window.pulsoTabSlot ? `?slot=${encodeURIComponent(window.pulsoTabSlot)}` : ''}`, { withCredentials: true });
    events.addEventListener('hearings', (event) => { snapshot = JSON.parse(event.data); lastReceived = Date.now(); render(); $('#hearing-live').textContent = 'Atualização automática conectada'; });
    events.onerror = () => { const el = $('#hearing-live'); if (el) el.textContent = 'Reconectando atualizações…'; };
    clockTimer = setInterval(() => { for (const el of document.querySelectorAll('[data-countdown]')) { const h = snapshot.hearings.find((x) => x.id === el.dataset.countdown); if (h) el.textContent = countdown(h); } }, 1000);
  }
  async function refreshDetails() {
    if (!selectedId || detailBusy) return;
    detailBusy = true; const id = selectedId;
    try {
      const data = await api(`/api/hearings/${encodeURIComponent(id)}/history`);
      if (id !== selectedId) return;
      const signature = JSON.stringify(data);
      if (signature !== detailData) {
        const reply = $('#hearing-copilot-result')?.textContent;
        const draft = $('#hearing-assist-form input')?.value;
        if ($('#hearing-details').contains(document.activeElement) && document.activeElement.closest('[data-operations-form]')) return;
        $('#hearing-details').innerHTML = detailsMarkup(data, esc, time, countdown, tic());
        if (reply) $('#hearing-copilot-result').textContent = reply;
        if (draft) $('#hearing-assist-form input').value = draft;
        detailData = signature;
      }
    } catch (error) { toast(error.message); } finally { detailBusy = false; }
  }
  async function showDetails(id, push = true) {
    selectedId = id; detailData = null;
    $('#hearing-overview').hidden = !!id; $('#hearing-details').hidden = !id;
    if (push) history.pushState({}, '', id ? `/audiencias/${encodeURIComponent(id)}` : '/audiencias/');
    if (id) await refreshDetails();
  }
  async function assist(id, message = '') {
    const target = $('#hearing-copilot-result'); target.textContent = 'Consultando diagnóstico e memória operacional…';
    try { const result = await request(`/api/hearings/${id}/assist`, 'POST', { message }); target.textContent = result.reply; }
    catch (error) { target.textContent = error.message; }
  }
  async function showExecutive() {
    report = await api(`/api/prevention/executive-report?mode=${$('#operations-report-mode').value}&days=${$('#operations-report-days').value}`);
    $('#operations-report-content').innerHTML = executiveMarkup(report, esc); $('#operations-report-dialog').showModal();
  }
  async function showRegistry() {
    const data = await api('/api/prevention/support-registry');
    $('#support-registry-content').innerHTML = supportRegistryMarkup(data, esc, tic());
    if (!$('#support-registry-dialog').open) $('#support-registry-dialog').showModal();
  }
  async function tour(next) {
    tourStep = next;
    const panel = $('#hearing-tour'); if (next < 0 || next > 5) { panel.hidden = true; return; }
    const texts = [
      ['Agenda preventiva', 'As audiências DEMO têm horários relativos. O scheduler age no backend, mesmo com esta tela fechada.'],
      ['Falha localizada', 'Abra o checklist: o diagnóstico distingue detecção de dispositivo e captura funcional. Cada evidência informa origem e horário.'],
      ['Memória operacional', 'O precedente identifica problema, solução e resultado anteriores. A origem DEMO é explícita; relevância não é probabilidade de sucesso.'],
      ['Copilot contextualizado', 'A orientação recebe audiência, tempo restante, diagnósticos, precedentes e tentativas já realizadas.'],
      ['Resposta coletiva', 'O cenário de rede DEMO envolve duas estações. Aguarde o scheduler: surge uma ocorrência, aviso e suporte correlacionado.'],
      ['Contingência e aprendizado', 'A equipe acompanha sala alternativa e equipamento reserva. Após normalização confirmada, revisa o relatório pós-incidente.'],
    ];
    panel.hidden = false;
    panel.innerHTML = `<b>DEMO · ${next+1}/6 · ${texts[next][0]}</b><p>${texts[next][1]}</p><div class="action-row"><button class="button button-secondary" data-hearing-action="tour-back">Anterior</button><button class="button button-primary" data-hearing-action="tour-next">${next === 5 ? 'Concluir' : 'Próximo'}</button><button class="button button-secondary" data-hearing-action="tour-close">Sair</button></div>`;
    if (next === 0 || next === 4) await showDetails(null);
    else {
      const h = next === 5 ? snapshot.hearings.find((h) => h.mode === 'DEMO' && h.collectiveIncidentId) : snapshot.hearings.find((h) => h.mode === 'DEMO' && h.lifecycle === 'ATIVA' && h.lastChecks?.some((c) => c.name === 'microphone' && c.status === 'FAIL'));
      if (h) { await showDetails(h.id); if (next === 3) await assist(h.id); }
    }
    const selector = next === 2 ? '.hearing-precedent' : next === 3 ? '#hearing-copilot-result' : next === 5 ? '.contingency-step' : next === 4 ? '#hearing-operations' : null;
    if (selector) $(selector)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  async function openHistory(id) {
    const data = await api(`/api/hearings/${encodeURIComponent(id)}/history`);
    $('#hearing-history-content').textContent = JSON.stringify(data, null, 2);
    $('#hearing-history').showModal();
  }
  async function browserCheck(id, component = 'camera_functional') {
    const h = snapshot.hearings.find((item) => item.id === id);
    if (!confirm(`Execute somente na estação ${h.stationId}, sala ${h.room}. Permitir acesso à câmera e ao microfone para testar a captura agora?`)) return;
    let stream; let audio; let status = 'UNVERIFIABLE'; let evidence; let speakerConfirmed = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: component === 'camera_functional', audio: component === 'microphone_functional' });
      const video = document.createElement('video'); video.muted = true; video.autoplay = true; video.srcObject = stream;
      $('#hearing-browser-preview').replaceChildren(video); $('#hearing-browser').showModal(); if (component === 'camera_functional') await video.play();
      audio = new AudioContext(); await audio.resume(); const analyser = audio.createAnalyser(); if (component === 'microphone_functional') audio.createMediaStreamSource(stream).connect(analyser);
      let peak = 0; const samples = new Float32Array(analyser.fftSize); const meter = document.createElement('meter'); meter.min = 0; meter.max = 1; meter.setAttribute('aria-label', 'Nível do microfone'); if (component === 'microphone_functional') $('#hearing-browser-preview').replaceChildren(meter);
      for (let n = 0; n < 40; n++) { analyser.getFloatTimeDomainData(samples); meter.value = Math.min(1, Math.sqrt(samples.reduce((sum,x) => sum + x*x, 0) / samples.length) * 10); peak = Math.max(peak, Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length)); await new Promise((resolve) => setTimeout(resolve, 100)); }
      const videoFrames = video.videoWidth > 0 && stream.getVideoTracks()[0]?.readyState === 'live';
      const tone = audio.createOscillator(); const gain = audio.createGain(); gain.gain.value = 0.04; tone.connect(gain); gain.connect(audio.destination); tone.start(); tone.stop(audio.currentTime + 0.25);
      await new Promise((resolve) => setTimeout(resolve, 350));
      speakerConfirmed = confirm('Você ouviu o sinal de teste e confirmou que os dispositivos selecionados na videoconferência são os mesmos desta estação?');
      status = (component === 'camera_functional' ? videoFrames : peak > 0.01) ? 'PASS' : 'UNVERIFIABLE';
      evidence = `Captura no navegador: frames=${videoFrames}; sinal de áudio RMS acima do limiar=${peak > 0.01}. Silêncio não comprova falha; qualidade e configuração do Meet exigem validação humana.`;
    } catch (error) { status = 'UNVERIFIABLE'; evidence = `Captura não concluída: ${error.name}.`; }
    finally { stream?.getTracks().forEach((track) => track.stop()); await audio?.close(); $('#hearing-browser').close(); }
    await request(`/api/hearings/${id}/browser-report`, 'POST', { status, evidence, speakerConfirmed, component, expectedRevision: h.revision }); toast('Resultado registrado para reavaliação automática.'); await reload();
  }
  async function renderKnowledge() {
    const { records } = await api('/api/operational-knowledge');
    $('#hearing-knowledge-list').innerHTML = records.map((r) => `<article><strong>${esc(r.id)} · ${esc(r.validation)} · ${esc(r.status)}</strong><p>${esc(r.solution || 'Extração não confirmada')}</p><small>${esc(r.successEvidence)}</small>${r.solution ? `<div class="action-row"><button class="button button-secondary" data-knowledge-id="${esc(r.id)}" data-approved="true">Validar e indexar</button><button class="button button-secondary" data-knowledge-id="${esc(r.id)}" data-approved="false">Rejeitar</button></div>` : ''}</article>`).join('') || '<p>Nenhuma solução extraída do GLPI.</p>';
  }
  async function mount() {
    if (!root()) return;
    root().innerHTML = `<div id="hearing-details" hidden></div><div id="hearing-overview"><div class="hearing-header"><div><div class="eyebrow">PREVENÇÃO · T−30 MINUTOS</div><h1>Central de Audiências</h1><p>Prontidão da sala, evidências técnicas e acompanhamento das intervenções.</p></div><span id="hearing-live">Conectando…</span></div>
      ${demo ? '<div class="hearing-demo">DEMO · Dados sintéticos · Relógio acelerado · Nenhuma estação ou GLPI real é acionado. <button class="button button-secondary" data-hearing-action="demo-cycle">Novo ciclo DEMO</button></div>' : '<p class="hearing-muted">REAL e DEMO são identificados em cada sessão. A verificação automática continua com esta tela fechada.</p>'}
      ${openExistingView ? '<div class="action-row"><button class="button button-secondary" data-hearing-action="existing-support">Atendimento N1</button></div>' : ''}
      <div class="hearing-summary"><div><strong id="hearing-count">0</strong><span>Programadas</span></div><div><strong id="hearing-ready">0</strong><span>Prontas</span></div><div><strong id="hearing-critical">0</strong><span>Críticas</span></div><small id="hearing-clock"></small></div>
      ${manage() ? `<div class="action-row"><button class="button button-primary" data-hearing-action="new">Agendar audiência</button><button class="button button-secondary" data-hearing-action="support-registry">Apoio local e radar preventivo</button>${tic() ? '<details><summary>Administração</summary><button class="button button-secondary" data-hearing-action="station">Cadastrar estação</button><button class="button button-secondary" data-hearing-action="knowledge">Memória operacional GLPI</button></details>' : ''}</div>` : ''}
      ${manage() ? `<div class="operations-report-controls"><label>Origem do relatório<select id="operations-report-mode"><option>REAL</option><option>DEMO</option></select></label><label>Período<select id="operations-report-days"><option value="30">30 dias</option><option value="7">7 dias</option><option value="90">90 dias</option></select></label><button class="button button-secondary" data-hearing-action="executive">Relatório executivo</button>${tic() ? '<button class="button button-secondary" data-hearing-action="tour-start">Apresentação DEMO guiada</button>' : ''}</div>` : ''}
      <div id="hearing-notices"></div><div id="hearing-list" aria-live="polite"></div><div id="hearing-operations"></div></div>
      <aside id="hearing-tour" class="hearing-tour" aria-live="polite" hidden></aside>
      <dialog id="support-registry-dialog"><div id="support-registry-content"></div><button class="button button-secondary" data-close-dialog>Fechar</button></dialog>
      <dialog id="operations-report-dialog"><div id="operations-report-content"></div><div class="action-row no-print"><button class="button button-primary" data-hearing-action="print-report">Imprimir / salvar PDF</button><button class="button button-secondary" data-hearing-action="download-report">Exportar dados</button><button class="button button-secondary" data-close-dialog>Fechar</button></div></dialog>
      <dialog id="hearing-form-dialog"><form id="hearing-form"><h2>Agenda de audiência</h2><p>Use apenas identificação técnica, sem nomes de partes ou dados processuais.</p>
      <label>Identificação técnica<input name="label" maxlength="120" required></label><label>Estação<select name="stationId" id="hearing-station" required></select></label><label>Sala<input name="room" required maxlength="160"></label>
      <label>Início com fuso<input name="startsAt" placeholder="2026-11-05T10:30:00-03:00" required></label><label>Fuso de exibição<input name="timezone" value="America/Sao_Paulo" required></label>
      <label>Duração (minutos)<input name="durationMinutes" type="number" min="5" max="720" value="60" required></label><label>Responsável (nome ou ID do usuário)<input name="responsible" maxlength="160" required></label><label>Dispositivos (separados por vírgula)<input name="devices" maxlength="1000"></label>
      <div class="action-row"><button class="button button-primary">Salvar agenda</button><button type="button" class="button button-secondary" data-close-dialog>Fechar</button></div></form></dialog>
      <dialog id="hearing-station-dialog"><form id="hearing-station-form"><h2>Estação autorizada</h2><label>Identificador<input name="id" pattern="[A-Za-z0-9_.-]+" maxlength="100" required></label><label>Comarca<input name="locality" maxlength="160" required></label>
      <label>Modo<select name="mode">${demo ? '' : '<option>REAL</option>'}<option>DEMO</option></select></label><label>IP do serviço TCP (opcional)<input name="host"></label><label>Porta TCP<input name="port" type="number" min="1" max="65535" value="443"></label>
      <label>Cenário DEMO<select name="demoScenario"><option value="ready">Pronta</option><option value="critical">Falha persistente</option><option value="recoverable">Correção permitida</option><option value="unknown">Não verificável</option></select></label>
      <label><input name="authorize" type="checkbox"> Autorizar reativação reversível de dispositivo de áudio desabilitado</label><label>IDs PnP autorizados (um por linha)<textarea name="deviceIds"></textarea></label><p>O agente também exige autorização local para executar esta ação.</p>
      <div class="action-row"><button class="button button-primary">Cadastrar / renovar autorização</button><button type="button" class="button button-secondary" data-close-dialog>Fechar</button></div><pre id="hearing-agent-token"></pre></form></dialog>
      <dialog id="hearing-history"><h2>Histórico de verificações e auditoria</h2><pre id="hearing-history-content"></pre><button class="button button-secondary" data-close-dialog>Fechar</button></dialog>
      <dialog id="hearing-browser"><h2>Fale durante quatro segundos</h2><p>Captura local; nenhum áudio ou vídeo será armazenado.</p><div id="hearing-browser-preview"></div></dialog>
      <dialog id="hearing-knowledge"><h2>Memória operacional GLPI</h2><p>Importe somente soluções confirmadas. A validação técnica é obrigatória antes da recuperação pelo copiloto.</p><form id="hearing-knowledge-form"><label>ID do chamado resolvido<input name="ticketId" required pattern="[0-9]+"></label><label>ID da solução já registrada no GLPI<input name="solutionId" required pattern="[0-9]+"></label><label>Evidência de sucesso confirmada<textarea name="successEvidence" required maxlength="2000"></textarea></label><label>Categoria<input name="category"></label><label>Sistema<input name="system"></label><button class="button button-primary">Extrair solução</button></form><div id="hearing-knowledge-list"></div><button class="button button-secondary" data-close-dialog>Fechar</button></dialog>`;
    root().onclick = async (event) => {
      const close = event.target.closest('[data-close-dialog]'); if (close) { close.closest('dialog').close(); return; }
      const button = event.target.closest('[data-hearing-action]');
      try {
        const operation = event.target.closest('[data-operations-action]');
        if (operation?.dataset.operationsAction === 'download-incident') {
          const incident = snapshot.incidents?.find((i) => i.id === operation.dataset.id);
          if (incident?.report) downloadJson(incident.report, 'judicia-pos-incidente.json');
        }
        if (event.target.dataset.knowledgeId) { await request(`/api/operational-knowledge/${encodeURIComponent(event.target.dataset.knowledgeId)}/validate`, 'POST', { approved: event.target.dataset.approved === 'true' }); await renderKnowledge(); }
        if (!button) return;
        const { hearingAction: action, id } = button.dataset;
        if (action === 'executive') await showExecutive();
        if (action === 'support-registry') await showRegistry();
        if (action === 'print-report') { document.body.classList.add('printing-operations'); window.print(); document.body.classList.remove('printing-operations'); }
        if (action === 'download-report' && report) downloadJson(report, 'judicia-relatorio-executivo.json');
        if (action === 'recheck') { await request(`/api/hearings/${id}/recheck`, 'POST', { expectedRevision: Number(button.dataset.revision) }); toast('Nova verificação enfileirada no backend.'); }
        if (action === 'tour-start') {
          button.disabled = true;
          try { await request('/api/prevention/demo/collective', 'POST', {}); await reload(); await tour(0); }
          finally { button.disabled = false; }
        }
        if (action === 'tour-next') await tour(tourStep+1);
        if (action === 'tour-back') await tour(Math.max(0,tourStep-1));
        if (action === 'tour-close') await tour(-1);
        if (action === 'details') { event.preventDefault(); await showDetails(id); }
        if (action === 'back') await showDetails(null);
        if (action === 'existing-test') openExistingView?.('meet-check');
        if (action === 'existing-support') openExistingView?.('inicio');
        if (action === 'demo-cycle') { await request('/api/demo/new-cycle', 'POST', {}); await reload(); }
        if (action === 'history') await openHistory(id);
        if (action === 'assist') await assist(id);
        if (action === 'browser') await browserCheck(id, button.dataset.component);
        if (action === 'station') { $('#hearing-agent-token').textContent = ''; $('#hearing-station-dialog').showModal(); }
        if (action === 'knowledge') { await renderKnowledge(); $('#hearing-knowledge').showModal(); }
        if (['cancel', 'complete'].includes(action)) { await request(`/api/hearings/${id}/${action}`, 'POST', {}); await reload(); }
        if (['new', 'edit'].includes(action)) {
          editing = id ? snapshot.hearings.find((h) => h.id === id) : null;
          const form = $('#hearing-form'); form.reset();
          if (editing) for (const key of ['label', 'stationId', 'room', 'startsAt', 'timezone', 'durationMinutes', 'responsible']) form.elements[key].value = editing[key];
          form.elements.devices.value = editing?.devices.join(', ') || ''; $('#hearing-form-dialog').showModal();
        }
      } catch (error) { toast(error.message); }
    };
    root().onsubmit = async (event) => {
      event.preventDefault(); const form = event.target; const input = Object.fromEntries(new FormData(form)); const submit = form.querySelector('button[type="submit"],button:not([type])'); if (submit) submit.disabled = true;
      try {
        if (form.dataset.operationsForm) { await submitOperation(form, api); document.activeElement?.blur(); await reload(); toast('Registro operacional atualizado.'); }
        if (form.id === 'support-registry-form') { await request('/api/prevention/support-registry', 'POST', input); await showRegistry(); toast('Registro técnico salvo.'); }
        if (form.id === 'hearing-assist-form') { await assist(form.dataset.id, input.message); form.reset(); }
        if (form.id === 'hearing-form') {
          const station = snapshot.stations.find((s) => s.id === input.stationId);
          if (!station) throw new Error('Selecione uma estação cadastrada.');
          await request(editing ? `/api/hearings/${editing.id}` : '/api/hearings', editing ? 'PUT' : 'POST', { ...editing, ...input, mode: station.mode, locality: station.locality, expectedRevision: editing?.revision, durationMinutes: Number(input.durationMinutes), devices: input.devices.split(',').map((s) => s.trim()).filter(Boolean) });
          $('#hearing-form-dialog').close(); await reload();
        }
        if (form.id === 'hearing-station-form') {
          const result = await request('/api/prevention/stations', 'POST', { ...input, target: input.host ? { host: input.host, port: Number(input.port) } : null, authorizedActions: input.authorize ? ['enable_audio_device'] : [], authorizedDeviceIds: input.deviceIds.split('\n').map((s) => s.trim()).filter(Boolean) });
          $('#hearing-agent-token').textContent = input.mode === 'REAL' ? `Token de provisionamento (exibido uma vez; guarde em arquivo protegido na estação):\n${result.agentToken}` : 'Estação DEMO cadastrada.'; await reload();
        }
        if (form.id === 'hearing-knowledge-form') { await request('/api/operational-knowledge', 'POST', input); form.reset(); await renderKnowledge(); }
      } catch (error) { toast(error.message); }
      finally { if (submit) submit.disabled = false; }
    };
    $('#hearing-import')?.addEventListener('change', async (event) => { try { const file = event.target.files[0]; if (file.size > 200000) throw new Error('Arquivo excede 200 KB.'); const data = JSON.parse(await file.text()); await request('/api/hearings/import', 'POST', { hearings: Array.isArray(data) ? data : data.hearings }); await reload(); toast('Agenda importada.'); } catch (error) { toast(error.message); } finally { event.target.value = ''; } });
    await reload(); connect();
    const route = () => { const match = location.pathname.match(/^\/audiencias\/([^/]+)\/?$/); void showDetails(match ? decodeURIComponent(match[1]) : null, false); };
    window.onpopstate = route; route();
  }
  return { mount, disconnect, reload, overview: () => showDetails(null) };
}
