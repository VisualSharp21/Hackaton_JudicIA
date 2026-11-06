/**
 * Teste pré-audiência (Google Meet) — página avulsa do módulo de teste de audiência.
 * Usa o mesmo motor do cartão run_meet_check do Copilot (public/js/meet-diagnostics.js).
 * O laudo pode ser levado ao Copilot, que analisa e, se preciso, abre o chamado.
 */
import { runMeetDiagnostics } from '../js/meet-diagnostics.js';

export function createMeetCheckPage({ $, esc, toast, state, openCopilotWithReport, canUseCopilot = () => true }) {
  let lastReport = null;
  let running = false;

  const STEPS = [
    ['sala', '1. Link do Meet', 'Formato do código da sala'],
    ['microfone', '2. Microfone', 'Captação de voz (3 s)'],
    ['camera', '3. Câmera', 'Imagem e resolução'],
    ['rede', '4. Rede', 'Latência até o servidor central'],
    ['zabbix', '5. Link da comarca', 'Telemetria Zabbix (simulada)'],
  ];
  const pillFor = { ok: ['ok', 'OK'], atencao: ['warn', 'ATENÇÃO'], falha: ['bad', 'FALHA'], executando: ['na', 'TESTANDO'], na: ['na', '—'] };

  function localities() {
    const names = (state.cache?.localities || []).map((l) => l.name);
    return names.length ? names : ['Belém', 'Ananindeua', 'Marabá', 'Santarém', 'Breves'];
  }

  function renderMeetCheck() {
    const container = $('#view-meet-check');
    if (!container) return;
    container.innerHTML = `
      <div class="page-header"><div>
        <div class="eyebrow">AUDIÊNCIAS VIRTUAIS · run_meet_check</div>
        <h1>Teste pré-audiência (Google Meet)</h1>
        <p class="page-subtitle">Verifique câmera, microfone, link da sala e rede antes da sessão. O mesmo teste roda dentro do Copilot quando você relata um problema de audiência.</p>
      </div></div>
      <section class="panel mc-params">
        <div class="panel-head"><div><h3>Parâmetros da audiência</h3><span>Link ou código da sala e comarca</span></div></div>
        <div class="mc-grid">
          <label>Link ou código do Google Meet<input id="mc-url" type="text" placeholder="https://meet.google.com/abc-defg-hij"></label>
          <label>Comarca<select id="mc-comarca">${localities().map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>
          <label>Telemetria Zabbix (simulação)<select id="mc-zabbix"><option value="auto">Automático (perfil da comarca)</option><option value="stable">Forçar link estável</option><option value="unstable">Forçar instabilidade</option><option value="critical">Forçar queda crítica</option></select></label>
          <button class="button button-primary" type="button" id="mc-run"><span class="button-label">▶ Iniciar teste da audiência</span></button>
        </div>
      </section>
      <div id="mc-verdict"></div>
      <section class="panel">
        <div class="panel-head"><div><h3>Indicadores</h3><span>Posto de trabalho e infraestrutura</span></div></div>
        <div class="mc-cards">${STEPS.map(([key, title, detail]) => `<div class="mc-card" data-step="${key}"><div class="mc-card-head"><small>${title}</small><span class="prediag-pill prediag-pill-na">Aguardando</span></div><p>${detail}</p></div>`).join('')}</div>
        <div class="mc-media" id="mc-media" hidden>
          <video id="mc-video" playsinline muted aria-label="Prévia da câmera"></video>
          <div><div class="cp-mic"><span>Nível do microfone — fale algo</span><span class="cp-meter is-live"><span id="mc-level" style="width:0%"></span></span></div></div>
        </div>
      </section>
      <details class="panel mc-json"><summary>Laudo técnico estruturado (JSON)</summary><pre id="mc-json">// Execute o teste para gerar o laudo.</pre></details>`;
    container.querySelector('#mc-run').addEventListener('click', run);
  }

  function setStep(key, status, detail) {
    const card = $(`#view-meet-check .mc-card[data-step="${key}"]`);
    if (!card) return;
    const [cls, label] = pillFor[status] || pillFor.na;
    card.querySelector('.prediag-pill').className = `prediag-pill prediag-pill-${cls}`;
    card.querySelector('.prediag-pill').textContent = label;
    if (detail) card.querySelector('p').textContent = detail;
  }

  async function run() {
    if (running) return;
    running = true;
    const button = $('#mc-run');
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    $('#mc-media').hidden = false;
    $('#mc-verdict').innerHTML = '';
    try {
      lastReport = await runMeetDiagnostics({
        meetUrl: $('#mc-url').value,
        comarca: $('#mc-comarca').value,
        zabbixMode: $('#mc-zabbix').value,
        videoEl: $('#mc-video'),
        onStep: setStep,
        onLevel: (pct) => { const bar = $('#mc-level'); if (bar) bar.style.width = `${pct}%`; },
      });
      $('#mc-json').textContent = JSON.stringify(lastReport, null, 2);
      const v = lastReport.veredito;
      const title = { PRONTA: 'Sala pronta para a audiência', ATENCAO: 'Atenção: risco de instabilidade durante a sessão', BLOQUEADA: 'Impedimento detectado para a audiência' }[v];
      const desc = { PRONTA: 'Câmera, microfone e rede aprovados.', ATENCAO: 'A sala pode iniciar, mas há captação fraca ou rede instável.', BLOQUEADA: 'Há falha de câmera, microfone, permissão do navegador ou rede.' }[v];
      $('#mc-verdict').innerHTML = `
        <div class="prediag-verdict ${v === 'PRONTA' ? 'prediag-verdict-ok' : 'prediag-verdict-open'}">
          <div class="prediag-verdict-head"><b>${esc(title)}</b><span>${esc($('#mc-comarca').value)} · ${new Date().toLocaleTimeString('pt-BR')}</span></div>
          <p>${esc(desc)}</p>
          ${canUseCopilot() ? `<div class="action-row"><button class="button ${v === 'PRONTA' ? 'button-secondary' : 'button-primary'}" type="button" id="mc-copilot">${v === 'PRONTA' ? 'Levar laudo ao Copilot mesmo assim' : 'Levar laudo ao Copilot (correção ou chamado)'} →</button></div>` : ''}
        </div>`;
      $('#mc-copilot')?.addEventListener('click', () => openCopilotWithReport?.(lastReport));
      toast(v === 'PRONTA' ? 'Teste concluído: sala pronta.' : 'Teste concluído com alertas.');
    } catch (error) {
      toast(`Falha no teste: ${error.message}`);
    } finally {
      running = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  }

  return { renderMeetCheck };
}
