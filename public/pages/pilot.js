export function createPilotPage(ctx) {
  const { $, api, esc, toast, triageSettingsAuthHeaders, renderTickets, state } = ctx;
  async function renderPilot() {
    const container = $('#view-pilot');
    container.innerHTML = '<div class="integration-loading">Carregando indicadores do piloto…</div>';
    try {
      const [configuration, report] = await Promise.all([
        api('/api/pilot/settings'),
        api('/api/pilot/metrics'),
      ]);
      const levels = [['CRITICAL', 'Crítica'], ['HIGH', 'Alta'], ['MEDIUM', 'Média'], ['LOW', 'Baixa']];
      const targetRows = levels.map(([key, label]) => `<tr><td>${label}</td><td><input type="number" min="1" max="100000" name="response.${key}" value="${esc(configuration.targets.response[key])}" required></td><td><input type="number" min="1" max="100000" name="resolution.${key}" value="${esc(configuration.targets.resolution[key])}" required></td></tr>`).join('');
      const period = (title, metric) => `<section class="pilot-period"><h3>${title}</h3><div class="pilot-metrics-grid"><div><small>Solicitações</small><b>${metric?.requests ?? '—'}</b></div><div><small>Chamados</small><b>${metric?.tickets ?? '—'}</b></div><div><small>Resolvidas no autoatendimento</small><b>${metric?.selfServiceResolved ?? '—'}</b></div><div><small>1ª atribuição observada</small><b>${metric?.avgMinutesToAssignment == null ? 'Sem dados' : `${metric.avgMinutesToAssignment} min`}</b></div><div><small>Resolução observada</small><b>${metric?.avgMinutesToResolution == null ? 'Sem dados' : `${metric.avgMinutesToResolution} min`}</b></div><div><small>SLA resposta / resolução</small><b>${metric?.responseSla == null ? 'Sem dados' : `${metric.responseSla}%`} / ${metric?.resolutionSla == null ? 'Sem dados' : `${metric.resolutionSla}%`}</b></div><div><small>Satisfação média</small><b>${metric?.avgSatisfaction == null ? 'Sem dados' : `${metric.avgSatisfaction} / 5`}</b><small>${metric?.satisfactionResponses ?? 0} respostas</small></div></div></section>`;
      const locations = report.locality.length
        ? `<div class="table-wrap"><table><thead><tr><th>COMARCA / MUNICÍPIO</th><th>CHAMADOS</th><th>1ª ATRIBUIÇÃO OBSERVADA</th><th>RESOLUÇÃO OBSERVADA</th></tr></thead><tbody>${report.locality.map((row) => `<tr><td>${esc(row.locality || 'Não informada')}</td><td>${row.tickets}</td><td>${row.avg_minutes_to_assignment == null ? 'Sem dados' : `${row.avg_minutes_to_assignment} min`}</td><td>${row.avg_minutes_to_resolution == null ? 'Sem dados' : `${row.avg_minutes_to_resolution} min`}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="empty-state"><b>Sem chamados reais neste período</b><p>Registros sintéticos são excluídos dos indicadores do piloto.</p></div>';
      const keyBlock = state.triageSettingsRequiresKey
        ? `<label class="triage-key-field">Chave de configuração<input id="pilot-settings-key" type="password" autocomplete="off" value="${esc(state.triageSettingsKey)}" placeholder="Informe TRIAGE_SETTINGS_KEY"></label>`
        : '<div class="quality-banner triage-security-warning"><b>Configuração sem chave de proteção</b><span>Defina TRIAGE_SETTINGS_KEY no .env antes de disponibilizar a API fora de ambiente local controlado.</span></div>';
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> MEDIÇÃO OPERACIONAL</div><h1>Piloto e SLAs</h1><p class="page-subtitle">Compare períodos equivalentes e acompanhe os resultados reais por prioridade e localidade.</p></div><button class="button button-secondary" data-action="sync-pilot-status">Sincronizar status do GLPI</button></div><div class="quality-banner"><b>Indicadores observados, sem dados sintéticos</b><span>Tempos começam a ser registrados a partir desta versão e da primeira sincronização. A atribuição observada é uma aproximação de primeira resposta; confirme os marcos com a equipe antes de usar como SLA oficial. Os percentuais de SLA consideram somente chamados com marco observado; chamados ainda abertos não entram no cálculo.</span></div>${keyBlock}<form id="pilot-settings-form"><section class="panel pilot-config-panel"><div class="panel-head"><div><h3>Períodos de comparação</h3><span>Use janelas de duração semelhante e não sobrepostas.</span></div></div><div class="pilot-date-grid"><label>Linha de base · início<input type="date" name="baselineStart" value="${esc(configuration.windows.baselineStart)}" required></label><label>Linha de base · fim<input type="date" name="baselineEnd" value="${esc(configuration.windows.baselineEnd)}" required></label><label>Piloto · início<input type="date" name="pilotStart" value="${esc(configuration.windows.pilotStart)}" required></label><label>Piloto · fim<input type="date" name="pilotEnd" value="${esc(configuration.windows.pilotEnd)}" required></label></div><h3 class="pilot-subheading">Metas de tempo (minutos)</h3><p class="pilot-help">Defina metas aprovadas pela gestão de TIC; estes valores não são preenchidos automaticamente.</p><div class="table-wrap"><table><thead><tr><th>PRIORIDADE</th><th>1ª RESPOSTA</th><th>RESOLUÇÃO</th></tr></thead><tbody>${targetRows}</tbody></table></div><div class="integration-form-footer"><p>O piloto mede somente solicitações e chamados reais registrados no Pulso TIC.</p><button class="button button-primary" type="submit">Salvar plano do piloto</button></div></section></form><div class="pilot-comparison">${period('Linha de base', report.baseline)}${period('Piloto', report.pilot)}</div><section class="panel pilot-locality-panel"><div class="panel-head"><div><h3>Equidade por comarca / município</h3><span>Compare volumes e tempos dentro da janela do piloto.</span></div></div>${locations}</section>`;
      $('#pilot-settings-key')?.addEventListener('input', (event) => { state.triageSettingsKey = event.target.value; });
    } catch (error) {
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> MEDIÇÃO OPERACIONAL</div><h1>Piloto e SLAs</h1><p class="page-subtitle">Não foi possível carregar os indicadores: ${esc(error.message)}</p></div></div>`;
    }
  }

  async function savePilotSettings(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const targets = { response: {}, resolution: {} };
    for (const [key, value] of Object.entries(values)) {
      const [kind, level] = key.split('.');
      if (level) targets[kind][level] = Number(value);
    }
    try {
      await api('/api/pilot/settings', {
        method: 'PUT', headers: triageSettingsAuthHeaders(),
        body: JSON.stringify({
          windows: Object.fromEntries(Object.entries(values).filter(([key]) => !key.includes('.'))),
          targets,
        }),
      });
      toast('Plano e metas do piloto salvos.');
      void renderPilot();
    } catch (error) {
      toast(error.message);
    }
  }

  async function syncPilotStatuses() {
    try {
      const result = await api('/api/tickets/sync', { method: 'POST', body: '{}' });
      toast(`${result.synchronized} status sincronizados${result.errors?.length ? `; ${result.errors.length} falhas` : ''}.`);
      void renderPilot();
    } catch (error) {
      toast(error.message);
    }
  }

  async function syncTicketStatuses() {
    try {
      const result = await api('/api/tickets/sync', { method: 'POST', body: '{}' });
      toast(`${result.synchronized} status sincronizados${result.errors?.length ? `; ${result.errors.length} falhas` : ''}.`);
      void renderTickets();
    } catch (error) {
      toast(error.message);
    }
  }
  return { renderPilot, savePilotSettings, syncPilotStatuses, syncTicketStatuses };
}
