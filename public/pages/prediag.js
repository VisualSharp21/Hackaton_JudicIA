export function createPrediagPage({ $, api, esc, toast, navigate, canOpenTicket = () => true, openCopilot = null }) {
  const JSON_START = '----PULSO-JSON-INICIO----';
  const JSON_END = '----PULSO-JSON-FIM----';
  let lastData = null;
  let pollToken = 0; // invalida polls anteriores

  function pill(value) {
    if (value === null || value === undefined) return '<span class="prediag-pill prediag-pill-na">—</span>';
    return value
      ? '<span class="prediag-pill prediag-pill-ok">OK</span>'
      : '<span class="prediag-pill prediag-pill-bad">FALHA</span>';
  }

  function parsePayload(text) {
    let raw = String(text || '').trim();
    if (!raw) throw new Error('Cole o bloco de dados gerado pelo pré-diagnóstico.');
    const i = raw.indexOf(JSON_START);
    const j = raw.indexOf(JSON_END);
    if (i !== -1 && j !== -1 && j > i) raw = raw.slice(i + JSON_START.length, j).trim();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error('Não foi possível ler os dados. Cole o bloco completo (incluindo as marcas) ou o JSON gerado pelo script.');
    }
    if (!data || data.schema !== 'pulso-prediag-1')
      throw new Error('Formato não reconhecido. Use o script pre-diagnostico.bat mais recente.');
    return data;
  }

  function evaluate(d) {
    const reasons = [];
    const infos = [];
    if (d.rede?.pingInternet === false) reasons.push('Sem conectividade com a internet (o ping falhou).');
    if (d.rede?.dns === false) reasons.push('Falha na resolução de DNS (os nomes de sites não resolvem).');
    if ((d.dispositivos?.problema || 0) > 0)
      reasons.push(`${d.dispositivos.problema} dispositivo(s) com problema de driver/hardware.`);
    if (d.teams?.instalado === false) reasons.push('O Microsoft Teams não está instalado neste computador.');

    if (typeof d.sistema?.ramLivreGB === 'number' && d.sistema.ramLivreGB <= 0.8)
      infos.push('Memória RAM livre muito baixa — pode causar lentidão. Feche aplicativos abertos.');
    if (d.rede?.pingGateway === false && d.rede?.pingInternet)
      infos.push('O ping ao gateway falhou, mas a internet responde — comum quando há VPN ou rede virtual ativa.');

    return { abrir: reasons.length > 0, reasons, infos };
  }

  function buildDescription(d) {
    const linhas = [];
    linhas.push('Pré-diagnóstico automático (Pulso TIC)');
    linhas.push(`Computador: ${d.computador || '-'} | Usuário: ${d.usuario || '-'}`);
    if (d.sistema) linhas.push(`SO: ${d.sistema.so || '-'} (build ${d.sistema.build || '-'}) | ${d.sistema.modelo || ''}`.trim());
    linhas.push(`Internet: ${d.rede?.pingInternet ? 'OK' : 'FALHA'} | DNS: ${d.rede?.dns ? 'OK' : 'FALHA'}`);
    linhas.push(`Teams: ${d.teams?.instalado ? 'Instalado' : 'NÃO instalado'}`);
    linhas.push(`Dispositivos com problema: ${d.dispositivos?.problema || 0}`);
    for (const item of (d.dispositivos?.lista || []).slice(0, 5))
      linhas.push(` - ${item.nome} [${item.descricao}]`);
    if (d.geradoEm) linhas.push(`Gerado em: ${d.geradoEm}`);
    let texto = linhas.join('\n');
    if (texto.length > 980) texto = texto.slice(0, 980) + '…';
    return texto;
  }

  function renderResult(d) {
    const verdict = evaluate(d);
    const s = d.sistema || {};
    const rede = d.rede || {};
    const teams = d.teams || {};
    const disp = d.dispositivos || {};

    const bannerClass = verdict.abrir ? 'prediag-verdict prediag-verdict-open' : 'prediag-verdict prediag-verdict-ok';
    const bannerTitle = verdict.abrir
      ? 'Recomendado abrir um chamado'
      : 'Provavelmente não é necessário abrir chamado';
    const reasonsHtml = verdict.reasons.length
      ? `<ul class="prediag-reasons">${verdict.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      : '<p>Nenhum problema técnico foi detectado automaticamente. Tente o autoatendimento antes de abrir um chamado.</p>';
    const infosHtml = verdict.infos.length
      ? `<div class="rule-note" style="margin-top:10px">${verdict.infos.map((i) => esc(i)).join('<br>')}</div>`
      : '';

    const canOpen = canOpenTicket();
    let actions;
    if (!canOpen) {
      actions = '<p class="rule-note">Seu perfil não abre chamados pelo atendimento. Use este diagnóstico para orientar a equipe ou o solicitante.</p>';
    } else if (verdict.abrir) {
      actions = '<button class="button button-primary" type="button" data-action="prediag-open-ticket">Continuar no Copilot com estes dados</button>';
    } else {
      actions = '<button class="button button-primary" type="button" data-action="prediag-goto-atendimento">Ir para o atendimento</button> <button class="button button-secondary" type="button" data-action="prediag-open-ticket">Levar ao Copilot mesmo assim</button>';
    }

    const adRows = (rede.adaptadores || []).length
      ? rede.adaptadores
          .map(
            (a) =>
              `<tr><td><b>${esc(a.nome)}</b></td><td>${esc(a.ipv4 || '—')}</td><td>${esc(a.gateway || '—')}</td><td>${esc(a.dns || '—')}</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4">Nenhum adaptador ativo.</td></tr>';

    const devRows = (disp.lista || []).length
      ? disp.lista
          .map((x) => `<tr><td><b>${esc(x.nome)}</b></td><td>${esc(x.descricao)} (código ${esc(x.codigo)})</td></tr>`)
          .join('')
      : '<tr><td colspan="2">Nenhum dispositivo com erro detectado.</td></tr>';

    return `
      <div class="${bannerClass}">
        <div class="prediag-verdict-head"><b>${esc(bannerTitle)}</b><span>${esc(d.computador || '')}${d.geradoEm ? ' · ' + esc(d.geradoEm) : ''}</span></div>
        ${reasonsHtml}
        ${infosHtml}
        <div class="action-row" style="margin-top:12px">${actions}</div>
      </div>

      <section class="panel"><div class="panel-head"><div><h3>Resumo</h3><span>Sinais principais</span></div></div>
        <div class="prediag-summary">
          <div><small>INTERNET</small>${pill(rede.pingInternet)}</div>
          <div><small>DNS</small>${pill(rede.dns)}</div>
          <div><small>GATEWAY</small>${pill(rede.pingGateway)}</div>
          <div><small>TEAMS</small><b>${teams.instalado ? 'Instalado' : 'Não'}</b></div>
          <div><small>DISPOSITIVOS COM PROBLEMA</small><b>${esc(disp.problema ?? 0)}</b></div>
        </div>
      </section>

      <section class="panel"><div class="panel-head"><div><h3>Sistema</h3></div></div>
        <div class="prediag-grid">
          <span><small>Computador</small>${esc(d.computador || '—')}</span>
          <span><small>Usuário</small>${esc(d.usuario || '—')}</span>
          <span><small>Sistema operacional</small>${esc(s.so || '—')} (build ${esc(s.build || '—')})</span>
          <span><small>Arquitetura</small>${esc(s.arquitetura || '—')}</span>
          <span><small>Fabricante / Modelo</small>${esc(s.modelo || '—')}</span>
          <span><small>Processador</small>${esc(s.cpu || '—')}</span>
          <span><small>Memória RAM</small>${esc(s.ramTotalGB ?? '—')} GB total / ${esc(s.ramLivreGB ?? '—')} GB livre</span>
          <span><small>Tempo ligado</small>${esc(s.uptime || '—')}</span>
        </div>
      </section>

      <section class="panel"><div class="panel-head"><div><h3>Rede</h3><span>Adaptadores ativos</span></div></div>
        <div class="table-wrap"><table><thead><tr><th>ADAPTADOR</th><th>IPV4</th><th>GATEWAY</th><th>DNS</th></tr></thead><tbody>${adRows}</tbody></table></div>
      </section>

      <section class="panel"><div class="panel-head"><div><h3>Microsoft Teams</h3></div></div>
        <div class="prediag-grid">
          <span><small>Status</small>${teams.instalado ? 'Instalado' : 'NÃO instalado'}</span>
          <span><small>Em execução</small>${teams.processo ? 'Sim' : 'Não'}</span>
          <span><small>Detalhes</small>${(teams.detalhes || []).map((t) => esc(t)).join('<br>') || '—'}</span>
        </div>
      </section>

      <section class="panel"><div class="panel-head"><div><h3>Drivers / Dispositivos</h3><span>${esc(disp.ok ?? 0)} OK · ${esc(disp.problema ?? 0)} com problema</span></div></div>
        <div class="table-wrap"><table><thead><tr><th>DISPOSITIVO</th><th>PROBLEMA</th></tr></thead><tbody>${devRows}</tbody></table></div>
      </section>`;
  }

  function renderData(data) {
    lastData = data;
    $('#prediag-result').innerHTML = renderResult(data);
  }

  function showError(message) {
    lastData = null;
    $('#prediag-result').innerHTML = `<div class="prediag-verdict prediag-verdict-open"><b>${esc(message)}</b></div>`;
  }

  function analyze() {
    try {
      renderData(parsePayload($('#prediag-input').value));
    } catch (error) {
      showError(error.message);
    }
  }

  function setStatus(html) {
    const el = $('#prediag-status');
    if (el) el.innerHTML = html;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function runNow() {
    const button = $('#prediag-run');
    const myToken = ++pollToken;
    if (button) button.disabled = true;
    setStatus('<span class="prediag-run-status">Preparando execução…</span>');
    try {
      const { token } = await api('/api/prediag/token', { method: 'POST' });
      const apiBase = window.pulsoApiBase || window.location.origin;
      const url = `pulsodiag://run?token=${encodeURIComponent(token)}&api=${encodeURIComponent(apiBase)}`;
      setStatus('<span class="prediag-run-status">Abrindo o diagnóstico no computador… confirme a janela do Windows, se aparecer. Aguardando o resultado…</span>');
      window.location.href = url;

      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        if (myToken !== pollToken) return; // cancelado por nova ação
        await wait(2000);
        if (myToken !== pollToken) return;
        let res;
        try {
          res = await api(`/api/prediag/result?token=${encodeURIComponent(token)}`);
        } catch {
          continue; // token ainda válido; tenta de novo
        }
        if (res?.status === 'ready' && res.data) {
          $('#prediag-input').value = JSON.stringify(res.data);
          renderData(res.data);
          setStatus('<span class="prediag-run-status prediag-run-ok">Resultado recebido automaticamente.</span>');
          toast('Diagnóstico recebido do computador.');
          if (button) button.disabled = false;
          return;
        }
      }
      setStatus('<span class="prediag-run-status prediag-run-bad">Não recebi o resultado a tempo. Verifique se o protocolo está instalado (instalar-protocolo.bat) ou cole o bloco manualmente abaixo.</span>');
    } catch (error) {
      setStatus(`<span class="prediag-run-status prediag-run-bad">${esc(error.message)}</span>`);
    } finally {
      if (button) button.disabled = false;
    }
  }

  /**
   * Leva o resultado ao Copilot: a estação é identificada pelo nome do computador
   * coletado pelo script e o relato chega preenchido para o solicitante revisar e enviar.
   */
  function openTicketFromDiag() {
    if (!lastData) return;
    const descricao = buildDescription(lastData);
    if (openCopilot) {
      void openCopilot({ text: descricao, hostname: lastData.computador || '' });
      toast('Relato preenchido com o pré-diagnóstico. Revise e envie ao Copilot.');
      return;
    }
    navigate('inicio');
  }

  function renderPrediag() {
    pollToken++; // cancela qualquer polling anterior ao reabrir a página
    const container = $('#view-prediag');
    container.innerHTML = `
      <div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> AUTOATENDIMENTO</div>
        <h1>Pré-diagnóstico</h1>
        <p class="page-subtitle">Rode o diagnóstico no computador e veja na hora se é preciso abrir um chamado.</p></div></div>

      <section class="panel"><div class="panel-head"><div><h3>Rodar diagnóstico</h3><span>Um clique</span></div></div>
        <p class="prediag-intro">Clique no botão abaixo: o diagnóstico roda no seu computador e o resultado aparece aqui automaticamente.</p>
        <div class="action-row">
          <button class="button button-primary" type="button" id="prediag-run">Rodar diagnóstico agora</button>
        </div>
        <div id="prediag-status"></div>
        <p class="rule-note" style="margin-top:12px">Primeira vez neste computador? É preciso instalar o atalho uma única vez executando <b>instalar-protocolo.bat</b> (fica na mesma pasta do script). Depois disso, o botão funciona sozinho.</p>
      </section>

      <details class="prediag-manual"><summary>Prefere o modo manual? (colar o resultado)</summary>
        <ol class="prediag-steps">
          <li>Execute o <b>pre-diagnostico.bat</b> no computador (dois cliques).</li>
          <li>Ao final, o bloco de dados é copiado automaticamente.</li>
          <li>Cole abaixo (Ctrl+V) e clique em <b>Analisar</b>.</li>
        </ol>
        <label class="prediag-label" for="prediag-input">Cole aqui o resultado do pré-diagnóstico</label>
        <textarea id="prediag-input" rows="6" placeholder="Cole o bloco entre ----PULSO-JSON-INICIO---- e ----PULSO-JSON-FIM---- (ou o JSON gerado)"></textarea>
        <div class="action-row" style="margin-top:12px">
          <button class="button button-primary" type="button" data-action="prediag-analyze">Analisar</button>
          <button class="button button-secondary" type="button" data-action="prediag-clear">Limpar</button>
        </div>
      </details>

      <div id="prediag-result"></div>`;

    $('#prediag-run').addEventListener('click', runNow);
    container.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'prediag-analyze') analyze();
      if (action === 'prediag-clear') {
        pollToken++;
        $('#prediag-input').value = '';
        $('#prediag-result').innerHTML = '';
        setStatus('');
        lastData = null;
      }
      if (action === 'prediag-open-ticket') openTicketFromDiag();
      if (action === 'prediag-goto-atendimento') navigate('inicio');
    });
  }

  return { renderPrediag };
}
