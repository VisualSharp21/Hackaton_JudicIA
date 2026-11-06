import { triageQuestionLabels, criterionLabels } from './triage-labels.js';
const SYSTEM_CODES = ['PJE','SEI','EMAIL','INTERNET','COMPUTER','PRINTER','OTHER','UNKNOWN'];
const CATEGORY_CODES = ['ACCESS','SYSTEM','NETWORK','HARDWARE','SOFTWARE','PRINTING','OTHER'];
const SCORE_CODES = ['LOW','MEDIUM','HIGH','CRITICAL'];
function normalizeOptionCode(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}
function choiceOptionMarkup(kind, code, description, esc) {
  const isSystem = kind === 'system';
  const codes = isSystem ? SYSTEM_CODES : CATEGORY_CODES;
  const custom = !codes.includes(code);

  if (custom) return `<article class="triage-custom-option" data-option-row data-option-kind="${kind}"><div class="triage-custom-option-head"><b>Nova opção</b><button class="button button-quiet" type="button" data-remove-option="${kind}">Remover</button></div><div class="triage-custom-option-fields"><label><span>Código usado no resultado</span><input data-option-key maxlength="40" value="${esc(code)}" placeholder="Ex.: ERP_INTERNO" required></label><label><span>Descrição que orienta o Laya</span><input data-criterion-key="${kind}" data-criterion="${esc(code)}" maxlength="240" value="${esc(description)}" placeholder="Descreva quando esta opção deve ser escolhida" required></label><small class="triage-custom-note">O código será usado diretamente como ${isSystem ? 'sistema ou equipamento' : 'categoria'}.</small></div></article>`;
  return `<label class="triage-criterion"><span>${esc(criterionLabels[code] || code)}</span><input data-criterion-key="${kind}" data-criterion="${esc(code)}" maxlength="240" value="${esc(description)}" required></label>`;
}
function scoreOptionMarkup(key, index, description, esc, baseLength) {
  const label = SCORE_CODES[index] || `Nível adicional ${index - baseLength + 1}`;
  return `<div class="triage-score-option" data-score-row><label><span>${esc(label)} · descrição do critério</span><input data-criterion-key="${key}" data-criterion="${index}" maxlength="240" value="${esc(description)}" placeholder="Descreva o que caracteriza este nível" required></label>${index >= baseLength ? '<button class="button button-quiet" type="button" data-remove-score>Remover nível</button>' : ''}</div>`;
}
export function createTriageSettingsPage(ctx) {
  const { $, api, esc, toast, state, categoryPt, systemPt } = ctx;
  async function renderTriageSettings() {
    const container = $('#view-triage-settings');
    container.innerHTML = '<div class="integration-loading">Carregando instruções da triagem…</div>';
    try {
      const [settingsResponse, cases] = await Promise.all([
        api('/api/triage/settings'),
        api('/api/triage/benchmark-cases'),
      ]);
      const settings = settingsResponse.questions;
      state.triageThresholdsBase = settingsResponse.thresholds || { outOfScope: 0.35, inScope: 0.7, answerConfidence: 0.7 };
      state.triageCases = cases;
      state.triageSettingsBase = settings;
      const supportProfile = settingsResponse.supportProfile || {};
      const profileFields = `<section class="triage-profile"><h3>Perfil do suporte</h3><p>Identifique a organiza\u00e7\u00e3o e descreva, em linguagem simples, o que este servi\u00e7o atende. Essa descri\u00e7\u00e3o orienta a decis\u00e3o de escopo do Laya.</p><div class="triage-profile-grid"><label>Organiza\u00e7\u00e3o<input data-profile-key="organizationName" maxlength="100" value="${esc(supportProfile.organizationName || '')}" required></label><label>Servi\u00e7o de suporte<input data-profile-key="serviceName" maxlength="100" value="${esc(supportProfile.serviceName || '')}" required></label><label>Nome da solicita\u00e7\u00e3o<input data-profile-key="requestLabel" maxlength="60" value="${esc(supportProfile.requestLabel || '')}" required></label><label class="wide">O que esse suporte atende?<textarea data-profile-key="scopeDescription" maxlength="600" rows="3" required>${esc(supportProfile.scopeDescription || '')}</textarea></label></div></section>`;
      const fields = Object.entries(triageQuestionLabels).map(([key, [defaultLabel, help]]) => {
        const label = key === 'is_it_support' ? `Escopo de ${supportProfile.serviceName || 'suporte'}` : defaultLabel;
        const question = settings[key] || {};
        const criteria = Array.isArray(question.criteria)
          ? question.criteria.map((text, index) => [index, text])
          : Object.entries(question.criteria || {});
        const criterionFields = criteria.map(([criterion, text]) => {
          const name = criterionLabels[criterion] || `Nível ${Number(criterion) + 1}`;
          if (key === 'system' || key === 'category') return choiceOptionMarkup(key, criterion, text, esc);
          if (Array.isArray(question.criteria)) return scoreOptionMarkup(key, Number(criterion), text, esc, 4);
          return `<label class="triage-criterion"><span>${esc(name)}</span><input data-criterion-key="${esc(key)}" data-criterion="${esc(criterion)}" maxlength="240" value="${esc(text)}" required></label>`;
        }).join('');
        const optionAdd = key === 'system' || key === 'category' ? `<div class="triage-option-footer"><span><b data-option-count="${key}">${criteria.length}</b> de 100 opções</span><button class="button button-secondary" type="button" data-add-option="${key}">Adicionar opção</button></div>` : '';
        const scoreAdd = ['impact','urgency'].includes(key) ? `<div class="triage-option-footer"><span><b data-score-count="${key}">${criteria.length}</b> de 32 níveis</span><button class="button button-secondary" type="button" data-add-score="${key}">Adicionar nível</button></div>` : '';
        return `<section class="triage-question"><label class="triage-prompt-field"><span><b>${esc(label)}</b><small>${esc(key === 'is_it_support' ? 'Este crit\u00e9rio \u00e9 montado automaticamente a partir do perfil acima.' : help)}</small></span><textarea data-question-key="${esc(key)}" rows="2" maxlength="800" ${key === 'is_it_support' ? 'disabled aria-describedby="profile-scope-help"' : 'required'}>${esc(question.instructions || '')}</textarea></label>${criterionFields ? `<div class="triage-criteria"><h4>Critérios e descrições das opções</h4><div data-question-options="${key}">${criterionFields}</div>${optionAdd}${scoreAdd}</div>` : ''}</section>`;
      }).join('');
      const caseOptions = state.triageCases.map((item, index) => `<option value="${index}">${esc(item.id)}</option>`).join('');
      const thresholds = state.triageThresholdsBase;
      const thresholdFields = [["outOfScope", "Fora do escopo", "Abaixo deste percentual, a mensagem fica fora do escopo configurado."], ["inScope", "Dentro do escopo", "Abaixo deste percentual, a solicita\u00e7\u00e3o exige revis\u00e3o humana."], ["answerConfidence", "Confian\u00e7a m\u00ednima", "Abaixo deste percentual de confian\u00e7a, a solicita\u00e7\u00e3o exige revis\u00e3o humana."]].map(([key, label, help]) => `<label class="triage-threshold-field"><span><b>${label}</b><small>${help}</small></span><span><input data-threshold-key="${key}" type="number" min="0" max="100" step="1" value="${Math.round(thresholds[key] * 100)}" required><b>%</b></span></label>`).join("");
      const routingFields = [["pje", "Fila especializada 1"], ["network", "Fila especializada 2"], ["hardware", "Fila especializada 3"], ["systems", "Fila especializada 4"], ["general", "Fila geral"]].map(([key, label]) => `<label class="triage-routing-field"><span>${label}</span><input data-routing-key="${key}" maxlength="64" value="${esc(settingsResponse.routing[key])}" required></label>`).join("");
      const calibrationRules = esc(JSON.stringify(settingsResponse.calibrationRules, null, 2));
      const payloadTemplate = esc(JSON.stringify(settingsResponse.payloadTemplate, null, 2));
      const priorityMatrix = esc(JSON.stringify(settingsResponse.priorityMatrix, null, 2));
      const routingRules = esc(JSON.stringify(settingsResponse.routingRules, null, 2));
      const automationApproved = settingsResponse.automationApproved === true;
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> MODELO DE DECISÃO</div><h1>Configuração da triagem</h1><p class="page-subtitle">Ajuste os critérios, limites, regras, prioridades e filas usados no processamento das solicitações.</p></div></div><div class="quality-banner"><b>Configure e compare antes de salvar</b><span>Isso não treina o modelo. Os limites, instruções e critérios definidos aqui serão aplicados às próximas solicitações.</span></div><form id="triage-settings-form"><div class="panel triage-settings-panel"><section class="triage-thresholds"><h3>Regras para encaminhamento e revisão</h3><p>Defina os limites percentuais usados para classificar o escopo e a confiança.</p>${thresholdFields}</section>${profileFields}<div class="triage-prompt-list">${fields}</div><section class="triage-routing"><h3>Destinos das filas</h3><p>Informe o código de fila usado pelo conector de chamados.</p>${routingFields}</section><details class="triage-calibration"><summary>Regras de roteamento</summary><p>Edite a ordem e as condições de encaminhamento por categoria ou sistema. A primeira regra compatível determina o destino.</p><textarea id="triage-routing-rules" rows="16" spellcheck="false" required>${routingRules}</textarea></details><details class="triage-calibration"><summary>Matriz de prioridade</summary><p>Defina a prioridade resultante para cada combinação de impacto e urgência.</p><textarea id="triage-priority-matrix" rows="12" spellcheck="false" required>${priorityMatrix}</textarea></details><details class="triage-calibration"><summary>Regras automáticas e classificador local</summary><p>Edite o JSON para ajustar termos técnicos, termos fora do escopo, palavras-chave, categorias e confiança. As regras são aplicadas na ordem apresentada.</p><textarea id="triage-calibration-rules" rows="24" spellcheck="false" required>${calibrationRules}</textarea></details><details class="triage-calibration"><summary>Payload enviado ao Laya</summary><p>Edite a estrutura JSON enviada ao classificador. Use {{description}}, {{model}} e {{questions}} para inserir os valores da solicitação e os critérios configurados acima.</p><textarea id="triage-payload-template" rows="12" spellcheck="false" required>${payloadTemplate}</textarea></details><label class="triage-automation"><input id="triage-automation-approved" type="checkbox" ${automationApproved ? "checked" : ""}><span><b>Permitir automação sem revisão humana</b><small>Quando desativada, toda análise pronta fica pendente de revisão antes da abertura do chamado.</small></span></label><div class="integration-form-footer"><p>Use critérios observáveis e evite dados pessoais.</p><button class="button button-primary" type="submit">Salvar configuração</button></div></div></form><section class="panel triage-preview-panel"><div class="panel-head"><div><h3>Prévia com o benchmark</h3><span>O rascunho atual, incluindo os limites percentuais, será usado nesta simulação.</span></div></div><form id="triage-preview-form"><div class="triage-preview-controls"><label>Exemplo do benchmark<select id="triage-benchmark-select"><option value="">Escolha um caso</option>${caseOptions}</select></label><button class="button button-secondary" type="submit">Analisar rascunho</button></div><label class="triage-example-label" for="triage-preview-text">Texto da solicitação</label><textarea id="triage-preview-text" maxlength="1000" placeholder="Selecione um exemplo ou escreva um texto de teste (mínimo 8 caracteres)." required></textarea></form><div id="triage-preview-result" aria-live="polite"></div></section>`;
      container.addEventListener('click', (event) => {
        const addChoice = event.target.closest('[data-add-option]');
        if (addChoice) {
          const key = addChoice.dataset.addOption;
          const holder = container.querySelector(`[data-question-options="${key}"]`);
          const count = holder.querySelectorAll('[data-criterion-key]').length;
          if (count >= 100) return toast('O Laya local aceita até 100 opções por pergunta.');
          const prefix = key === 'system' ? 'CUSTOM_SYSTEM_' : 'CUSTOM_CATEGORY_';
          let index = 1; let code;
          do { code = `${prefix}${index++}`; } while ([...holder.querySelectorAll('[data-option-key]')].some((field) => normalizeOptionCode(field.value) === code));
          holder.insertAdjacentHTML('beforeend', choiceOptionMarkup(key, code, '', esc));
          container.querySelector(`[data-option-count="${key}"]`).textContent = String(count + 1);
        }
        const addScore = event.target.closest('[data-add-score]');
        if (addScore) {
          const key = addScore.dataset.addScore;
          const holder = container.querySelector(`[data-question-options="${key}"]`);
          const count = holder.querySelectorAll('[data-criterion-key]').length;
          if (count >= 32) return toast('O Laya local aceita até 32 níveis por pergunta de escala.');
          holder.insertAdjacentHTML('beforeend', scoreOptionMarkup(key, count, '', esc, 4));
          container.querySelector(`[data-score-count="${key}"]`).textContent = String(count + 1);
        }
        const removeOption = event.target.closest('[data-remove-option]');
        if (removeOption) {
          const key = removeOption.dataset.removeOption;
          const holder = removeOption.closest('[data-question-options]');
          removeOption.closest('[data-option-row]').remove();
          container.querySelector(`[data-option-count="${key}"]`).textContent = String(holder.querySelectorAll('[data-criterion-key]').length);
        }
        const removeScore = event.target.closest('[data-remove-score]');
        if (removeScore) {
          const holder = removeScore.closest('[data-question-options]');
          removeScore.closest('[data-score-row]').remove();
          [...holder.querySelectorAll('[data-criterion-key]')].forEach((field, index) => {
            field.dataset.criterion = String(index);
            field.closest('[data-score-row]').querySelector('span').textContent = SCORE_CODES[index] || `Nível ${index + 1}`;
            const remove = field.closest('[data-score-row]').querySelector('[data-remove-score]');
            if (index < 4 && remove) remove.remove();
          });
          const key = holder.dataset.questionOptions;
          container.querySelector(`[data-score-count="${key}"]`).textContent = String(holder.querySelectorAll('[data-criterion-key]').length);
        }
      });
      $('#triage-benchmark-select').addEventListener('change', (event) => {
        const item = event.target.value === '' ? null : state.triageCases[Number(event.target.value)];
        $('#triage-preview-text').value = item?.text || '';
        $('#triage-preview-result').innerHTML = '';
      });
    } catch (error) {
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> MODELO DE DECISÃO</div><h1>Configuração da triagem</h1><p class="page-subtitle">Não foi possível carregar as instruções: ${esc(error.message)}</p></div><button class="button button-secondary" data-action="refresh-triage-settings">Tentar novamente</button></div>`;
    }
  }

  async function saveTriageSettings(form) {
    try {
      const payload = readTriageDraft();
      await api('/api/triage/settings', { method: 'PUT', body: JSON.stringify(payload), headers: triageSettingsAuthHeaders() });
      if (state.cache) state.cache.supportProfile = payload.supportProfile;
      for (const code of Object.keys(categoryPt)) if (!CATEGORY_CODES.includes(code)) delete categoryPt[code];
      for (const code of Object.keys(payload.questions.category.criteria)) if (!CATEGORY_CODES.includes(code)) categoryPt[code] = code.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
      for (const code of Object.keys(systemPt)) if (!SYSTEM_CODES.includes(code)) delete systemPt[code];
      for (const code of Object.keys(payload.questions.system.criteria)) if (!SYSTEM_CODES.includes(code)) systemPt[code] = code.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
      if (state.cache) {
        state.cache.categoryLabels = Object.fromEntries(Object.entries(categoryPt).filter(([code]) => !CATEGORY_CODES.includes(code)));
        state.cache.systemLabels = Object.fromEntries(Object.entries(systemPt).filter(([code]) => !SYSTEM_CODES.includes(code)));
      }
      toast('Configuração da triagem salva. As próximas análises já usarão os novos parâmetros.');
      void renderTriageSettings();
    } catch (error) {
      toast(error.message);
    }
  }

  function readTriageDraft() {
    const supportProfile = Object.fromEntries([...document.querySelectorAll('[data-profile-key]')].map((field) => [field.dataset.profileKey, field.value.trim()]));
    const questions = {};
    for (const key of Object.keys(triageQuestionLabels)) {
      const original = state.triageSettingsBase[key] || {};
      questions[key] = { ...original, instructions: $(`[data-question-key="${key}"]`)?.value || '' };
      const fields = [...document.querySelectorAll(`[data-criterion-key="${key}"]`)];
      if (Array.isArray(original.criteria)) {
        questions[key].criteria = fields.map((field) => field.value);
      } else if (original.criteria) {
        questions[key].criteria = Object.fromEntries(fields.map((field) => {
          const row = field.closest('[data-option-row]');
          const code = row?.querySelector('[data-option-key]') ? normalizeOptionCode(row.querySelector('[data-option-key]').value) : field.dataset.criterion;
          return [code, field.value];
        }));
      }
    }
    const systemOptionMappings = {};
    const categoryOptionMappings = {};
    for (const key of ['category', 'system']) {
      const codes = [...document.querySelectorAll(`[data-criterion-key="${key}"]`)].map((field) => field.closest('[data-option-row]')?.querySelector('[data-option-key]') ? normalizeOptionCode(field.closest('[data-option-row]').querySelector('[data-option-key]').value) : field.dataset.criterion);
      if (new Set(codes).size !== codes.length) throw new Error(`Existem códigos repetidos nas opções de ${key === 'category' ? 'categoria' : 'sistema'}.`);
      if (codes.some((code) => !/^[A-Z][A-Z0-9_]{1,39}$/.test(code))) throw new Error('Use códigos com pelo menos 2 caracteres: letras, números e sublinhado.');
    }
    const thresholds = Object.fromEntries([...document.querySelectorAll('[data-threshold-key]')].map((field) => [field.dataset.thresholdKey, Number(field.value) / 100]));
    const routing = Object.fromEntries([...document.querySelectorAll('[data-routing-key]')].map((field) => [field.dataset.routingKey, field.value.trim()]));
    let calibrationRules;
    try { calibrationRules = JSON.parse($('#triage-calibration-rules').value); }
    catch { throw new Error('O JSON das regras automáticas está inválido. Corrija a sintaxe antes de salvar.'); }
    let routingRules;
    try { routingRules = JSON.parse($('#triage-routing-rules').value); }
    catch { throw new Error('O JSON das regras de roteamento está inválido. Corrija a sintaxe antes de salvar.'); }
    let priorityMatrix;
    try { priorityMatrix = JSON.parse($('#triage-priority-matrix').value); }
    catch { throw new Error('O JSON da matriz de prioridade está inválido. Corrija a sintaxe antes de salvar.'); }
    let payloadTemplate;
    try { payloadTemplate = JSON.parse($('#triage-payload-template').value); }
    catch { throw new Error('O JSON do payload do Laya está inválido. Corrija a sintaxe antes de salvar.'); }
    return { supportProfile, questions, systemOptionMappings, categoryOptionMappings, thresholds, routing, routingRules, priorityMatrix, automationApproved: $('#triage-automation-approved').checked, calibrationRules, payloadTemplate };
  }
  function triageSettingsAuthHeaders() {
    const key = $('#pilot-settings-key')?.value || $('#quality-settings-key')?.value || state.triageSettingsKey;
    if (key) state.triageSettingsKey = key;
    return key ? { Authorization: `Bearer ${key}` } : {};
  }

  async function previewTriageDraft(form) {
    const button = form.querySelector('button[type="submit"]');
    const result = $('#triage-preview-result');
    const caseIndex = $('#triage-benchmark-select').value;
    const selectedCase = caseIndex === '' ? null : state.triageCases[Number(caseIndex)];
    button.disabled = true;
    button.textContent = 'Analisando…';
    result.innerHTML = '<p class="triage-preview-loading">Consultando o modelo com as alterações do rascunho…</p>';
    try {
      const data = await api('/api/triage/preview', {
        method: 'POST',
        body: JSON.stringify({
          description: $('#triage-preview-text').value,
          ...readTriageDraft(),
          expected: selectedCase?.text === $('#triage-preview-text').value ? selectedCase.expected : null,
        }),
        headers: triageSettingsAuthHeaders(),
      });
      const comparison = data.comparison
        ? Object.entries(data.comparison).map(([field, row]) => `<div class="triage-preview-row"><span>${esc(field)}</span><b>${esc(String(row.actual))}</b><small class="${row.matches ? 'match' : 'mismatch'}">${row.matches ? 'Confere' : `Esperado: ${esc(String(row.expected))}`}</small></div>`).join('')
        : '';
      const isLocalFallback = data.provider === 'local_rules';
      const providerLabel = isLocalFallback ? 'Classificador local' : String(data.provider).startsWith('laya:') ? `Laya · ${data.provider.slice(5)}` : data.provider;
      const fallbackNotice = isLocalFallback ? '<div class="triage-provider-warning"><b>O rascunho não foi aplicado ao modelo.</b> O Laya não está configurado ou não foi selecionado; o classificador local não usa estas instruções nem critérios.</div>' : '';
      const modelDifferences = data.modelChoices ? [['Categoria', data.modelChoices.category, data.decision.category], ['Sistema', data.modelChoices.system, data.decision.system]].filter(([, original, finalValue]) => original && original !== finalValue) : [];
      const modelSelection = modelDifferences.length
        ? `<p class="triage-preview-mapping"><b>O Laya sugeriu:</b> ${modelDifferences.map(([label, original, finalValue]) => `${esc(label)} ${esc(original)} → ${esc(finalValue)}`).join(' · ')}. Uma regra da triagem ajustou o resultado.</p>`
        : '';
      result.innerHTML = `<div class="triage-preview-output"><div class="triage-preview-head"><b>Resultado da prévia</b><span>${esc(providerLabel)} · ${Math.round((data.decision.confidence || 0) * 100)}% de confiança</span></div>${fallbackNotice}${modelSelection}<div class="triage-preview-grid"><div><small>CATEGORIA</small><b>${esc(data.decision.category)}</b></div><div><small>SISTEMA</small><b>${esc(data.decision.system)}</b></div><div><small>IMPACTO / URGÊNCIA</small><b>${esc(data.decision.impact)} / ${esc(data.decision.urgency)}</b></div><div><small>STATUS</small><b>${esc(data.triageStatus)}</b></div><div><small>PRIORIDADE / FILA</small><b>${esc(data.priority)} / ${esc(data.queue)}</b></div></div>${comparison ? `<h4>Comparação com o rótulo do benchmark</h4><div class="triage-preview-comparison">${comparison}</div>` : ''}</div>`;
    } catch (error) {
      result.innerHTML = `<p class="triage-preview-error">${esc(error.message)}</p>`;
    } finally {
      button.disabled = false;
      button.textContent = 'Analisar rascunho';
    }
  }
  return { renderTriageSettings, saveTriageSettings, readTriageDraft, triageSettingsAuthHeaders, previewTriageDraft };
}
