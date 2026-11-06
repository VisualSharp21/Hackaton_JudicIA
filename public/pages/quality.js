export function createQualityPage(ctx) {
  const { $, api, esc, fmtDate, categoryPt, systemPt, levelPt, selectOptions, state } = ctx;
  async function renderQuality() {
    try {
      const [q, latestReport, savedCases, triageSettings] = await Promise.all([
        api('/api/quality'),
        api('/api/quality/feedback-evaluation'),
        api('/api/quality/evaluation-cases'),
        api('/api/triage/settings'),
      ]);
      state.triageSettingsRequiresKey = triageSettings.requiresKey === true;
      const priorResults = new Map(
        (latestReport?.cases || [])
          .filter((item) => item.evaluationCaseId)
          .map((item) => [String(item.evaluationCaseId), item]),
      );
      const pendingCount = savedCases.filter((item) => {
        const previous = priorResults.get(String(item.id));
        const fingerprint = JSON.stringify([item.text, item.expected || {}]);
        return previous?.status !== 'evaluated' || previous.fingerprint !== fingerprint;
      }).length;
      const labels = {
        supportRequest: 'É suporte de TIC?',
        category: 'Categoria',
        system: 'Sistema ou equipamento',
        impact: 'Impacto',
        urgency: 'Urgência',
        possibleIncident: 'Possível incidente',
        outage: 'Indisponibilidade',
        status: 'Status',
      };
      const correctionEditor = (requestId, decision = {}) => `<details class="quality-inline-correction"><summary>Corrigir classificação</summary><div class="quality-inline-fields" data-quality-correction="${esc(requestId)}"><label>Categoria<select data-quality-field="category">${selectOptions(categoryPt, decision.category || 'OTHER')}</select></label><label>Sistema ou equipamento<select data-quality-field="system">${selectOptions(systemPt, decision.system || 'UNKNOWN')}</select></label><label>Impacto<select data-quality-field="impact">${selectOptions(levelPt, decision.impact || 'MEDIUM')}</select></label><label>Urgência<select data-quality-field="urgency">${selectOptions(levelPt, decision.urgency || 'MEDIUM')}</select></label><label class="quality-inline-check"><input type="checkbox" data-quality-field="possibleIncident" ${decision.possibleIncident ? 'checked' : ''}> Incidente coletivo</label><label class="quality-inline-check"><input type="checkbox" data-quality-field="humanRequired" ${decision.humanRequired !== false ? 'checked' : ''}> Precisa de atendimento humano</label><label class="quality-inline-check"><input type="checkbox" data-quality-field="outage" ${decision.outage ? 'checked' : ''}> Há indisponibilidade</label><label class="quality-inline-reason">Observação da revisão<textarea data-quality-field="reason" maxlength="500" rows="2">${esc(decision.reason || '')}</textarea></label><button type="button" class="button button-primary" data-action="save-quality-correction" data-request="${esc(requestId)}">Salvar classificação correta</button></div></details>`;
      const pendingCorrections = q.corrections.filter((c) => !c.evaluationCaseApproved);
      const correctionCards = pendingCorrections.length
        ? pendingCorrections.map((c) => {
            const model = c.original || {};
            const human = c.corrected || {};
            return `<article class="quality-correction"><div class="quality-row-head"><b>${esc(c.id)}</b><small>${fmtDate(c.correctedAt)} · Ainda não é um exemplo de feedback</small></div><p>${esc(c.description)}</p><div class="quality-diff"><span>Classificação automática: ${esc(model.category || '—')} / ${esc(model.system || '—')}</span><b>Correção humana: ${esc(human.category || '—')} / ${esc(human.system || '—')}</b></div>${c.reason ? `<small class="quality-reason">Observação: ${esc(c.reason)}</small>` : ''}${correctionEditor(c.id, { ...human, reason: c.reason })}<label class="review-field">Texto do exemplo (remova dados pessoais)<textarea data-evaluation-text="${esc(c.id)}" maxlength="1000">${esc(c.description)}</textarea></label><label class="quality-confirm"><input type="checkbox" data-evaluation-confirm="${esc(c.id)}"> Revisei e removi nomes, números de processo e outros dados pessoais</label><button class="button button-secondary" data-action="save-evaluation-case" data-request="${esc(c.id)}">Salvar como exemplo de feedback</button></article>`;
          }).join('')
        : '<div class="quality-empty"><b>Nenhuma correção aguardando revisão</b><p>Quando a equipe corrigir uma triagem, o chamado aparecerá aqui para ser revisado e salvo como exemplo.</p></div>';
      const savedFeedbackCards = savedCases.length
        ? savedCases.map((item) => {
            const source = q.corrections.find((c) => c.id === item.sourceRequestId);
            const result = priorResults.get(String(item.id));
            const fingerprint = JSON.stringify([item.text, item.expected || {}]);
            const evaluated = result?.status === 'evaluated' && result.fingerprint === fingerprint;
            const state = evaluated ? 'Avaliado' : result?.status === 'error' ? 'Falha · pode tentar novamente' : 'Aguardando avaliação';
            const decision = { ...(source?.corrected || {}), ...item.expected, reason: source?.reason };
            return `<article class="quality-saved-card"><div><b>${esc(item.sourceRequestId || `Exemplo ${item.id}`)}</b><span class="quality-saved-status ${evaluated ? 'is-done' : ''}">${state}</span></div><p>${esc(item.text)}</p><small>Rótulos revisados: ${esc(item.expected?.category || 'categoria não informada')} · ${esc(item.expected?.system || 'sistema não informado')}</small>${source?.reason ? `<small>Observação da equipe: ${esc(source.reason)}</small>` : ''}${source ? correctionEditor(source.id, decision) : '<small>Chamado de origem não está no histórico recente.</small>'}</article>`;
          }).join('')
        : '<div class="quality-empty"><b>Nenhum exemplo salvo</b><p>Revise uma correção acima e salve o texto anonimizado para criar o primeiro exemplo.</p></div>';
      const keyBlock = state.triageSettingsRequiresKey
        ? `<label class="triage-key-field quality-key-field">Chave de configuração<input id="quality-settings-key" type="password" autocomplete="off" value="${esc(state.triageSettingsKey)}" placeholder="Informe TRIAGE_SETTINGS_KEY"></label>`
        : '';
      const resultPanel = latestReport
        ? `<div class="quality-result-summary"><b>${latestReport.exactMatchCount} de ${latestReport.totalCases}</b><span>casos conferiram em todos os rótulos comparados</span><small>Última avaliação: ${fmtDate(latestReport.evaluatedAt)} · ${latestReport.evaluatedCount} avaliados${latestReport.failedCount ? ` · ${latestReport.failedCount} com falha` : ''}</small></div><div class="quality-result-metrics">${Object.entries(latestReport.fields || {}).filter(([, value]) => value.total).map(([field, value]) => `<div class="quality-metric"><span>${labels[field] || esc(field)}</span><b>${value.accuracy}%</b><small>${value.correct}/${value.total} corretos</small></div>`).join('')}</div><details class="quality-result-details"><summary>Ver resultado de cada exemplo (${latestReport.totalCases})</summary><div class="quality-evaluation-cases">${(latestReport.cases || []).map((item) => { const source = savedCases.find((saved) => String(saved.id) === String(item.evaluationCaseId)); const differences = (item.mismatches || []).map((field) => `<li><b>${labels[field] || esc(field)}:</b> esperado ${esc(item.expected?.[field])}, classificado ${esc(item.actual?.[field])}</li>`).join(''); return `<article><b>Exemplo ${item.caseNumber}</b>${source?.text ? `<p>${esc(source.text)}</p>` : ''}${item.status === 'error' ? `<small class="quality-evaluation-error">Não avaliado: ${esc(item.error)}</small>` : differences ? `<ul>${differences}</ul>` : '<small class="quality-evaluation-match">Rótulos conferidos.</small>'}</article>`; }).join('')}</div></details>`
        : '<div class="quality-empty"><b>A avaliação ainda não foi executada</b><p>Os exemplos de feedback serão comparados ao classificador quando você iniciar a avaliação.</p></div>';

      $('#view-quality').innerHTML = `<div class="quality-screen">
        <header class="quality-page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> REVISÃO E APRENDIZADO</div><h1>Qualidade da triagem</h1><p>Revise as correções da equipe e avalie exemplos de feedback sem misturá-los ao benchmark.</p></div></header>
        <section class="quality-explainer"><article><span class="quality-step">SATISFAÇÃO DO SOLICITANTE</span><h2>A orientação ajudou?</h2><p>A nota positiva ou negativa mede a experiência de quem pediu suporte. Ela não confirma se a classificação automática está correta.</p></article><article><span class="quality-step">VALIDAÇÃO DA TRIAGEM</span><h2>Os rótulos estão certos?</h2><p>A equipe de TIC precisa revisar e corrigir categoria, sistema, impacto e urgência. Só então o exemplo pode ser avaliado como feedback técnico.</p></article></section>
        <section class="quality-benchmark"><div><b>Benchmark-base</b><span>${q.benchmarkCaseCount}/50 casos · avaliação de referência</span></div><div><b>Feedback humano</b><span>${q.approvedCaseCount} exemplos salvos · conjunto separado</span></div><p>Os resultados de feedback não são adicionados ao benchmark-base nem alteram o modelo.</p></section>
        <section class="quality-section"><div class="quality-section-heading"><span class="quality-step">1 · REVISÃO HUMANA</span><h2>Correções aguardando revisão</h2><p>Confira a classificação automática e os rótulos corrigidos. Revise o texto, remova dados pessoais e salve para incluir o caso na lista de feedback.</p></div><div class="quality-corrections">${correctionCards}</div></section>
        <section class="quality-section"><div class="quality-section-heading"><span class="quality-step">LISTA DE FEEDBACK</span><h2>Exemplos salvos (${savedCases.length})</h2><p>Ao salvar, o exemplo sai da fila de revisão e aparece aqui. A avaliação não o remove desta lista.</p></div><div class="quality-saved-list">${savedFeedbackCards}</div></section>
        <section class="quality-section quality-evaluate-section"><div class="quality-section-heading"><span class="quality-step">2 · AVALIAÇÃO SEPARADA</span><h2>Comparar exemplos com o classificador</h2><p>Uma avaliação mede se o classificador reproduz os rótulos revisados pela equipe. Casos já avaliados com sucesso não serão executados novamente.</p></div><div class="quality-evaluate-actions">${keyBlock}<button class="button button-primary" data-action="run-feedback-evaluation" ${pendingCount ? '' : 'disabled'}>Avaliar ${pendingCount} pendente(s)</button><button class="button button-secondary" data-action="download-evaluation-cases" ${savedCases.length ? '' : 'disabled'}>Exportar exemplos</button></div>${pendingCount ? `<p class="quality-pending-note">${pendingCount} exemplo(s) aguardando avaliação. Falhas e versões alteradas também podem ser tentadas novamente.</p>` : '<p class="quality-pending-note quality-all-done">Todos os exemplos salvos já foram avaliados.</p>'}</section>
        <section class="quality-section"><div class="quality-section-heading"><span class="quality-step">3 · RESULTADO</span><h2>Resultado da avaliação de feedback</h2><p>Confira a concordância por rótulo e abra os detalhes para ver divergências por exemplo.</p></div><div class="quality-results">${resultPanel}</div></section>
        <footer class="quality-privacy-note">Antes de salvar um exemplo, remova nomes, números de processo, e-mails e demais identificadores. O texto original do chamado permanece preservado.</footer>
      </div>`;
      $('#quality-settings-key')?.addEventListener('input', (event) => { state.triageSettingsKey = event.target.value; });
    } catch (e) {
      toast(e.message);
    }
  }
  return { renderQuality };
}
