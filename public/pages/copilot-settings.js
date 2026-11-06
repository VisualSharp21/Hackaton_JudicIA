/**
 * Copilot (IA) — Settings do servidor central (perfil TIC).
 * Escolhe o endpoint OpenAI-compatível da LLM conversacional (OpenAI, OpenRouter, Groq,
 * Ollama, Hermes Agent), o modelo e o formato de tool calling. A chave é gravada
 * criptografada no servidor e nunca volta para a tela. Também lista o Tool Registry.
 */
export function createCopilotSettingsPage({ $, api, esc, toast }) {
  const PRESETS = {
    openai_compatible: { label: 'OpenAI-compatível (genérico)', baseUrl: '', model: '' },
    openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'nousresearch/hermes-3-llama-3.1-8b' },
    openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
    ollama: { label: 'Ollama (servidor central)', baseUrl: 'http://localhost:11434/v1', model: 'hermes3' },
    hermes: { label: 'Hermes Agent (tags <tool_call>)', baseUrl: 'http://localhost:8000/v1', model: 'NousResearch/Hermes-3-Llama-3.1-8B' },
    rules: { label: 'Sem LLM (somente motor de regras)', baseUrl: '', model: '' },
  };

  function engineBlock(engine) {
    const llm = engine.mode === 'llm';
    return `<section class="panel integration-status ${llm ? 'connected' : 'mock'}"><span class="integration-indicator" aria-hidden="true"></span><div><span class="integration-overline">MOTOR EM USO</span><h2>${llm ? esc(engine.label) : 'Motor de regras local'}</h2><p>${llm ? `Endpoint ${esc(engine.host || '')} · tool calling ${esc(engine.toolMode)} · fallback de regras ${engine.fallbackRules ? 'ativo' : 'desligado'}.` : `Sem LLM: ${esc((engine.reason || 'não configurada').replace(/\.$/, ''))}. O Copilot responde com a memória Hermes, a base procedural e o RAG de precedentes.`}</p></div><span class="integration-provider">${engine.hasApiKey ? 'Chave configurada' : 'Sem chave'}</span></section>`;
  }

  async function renderCopilotSettings() {
    const container = $('#view-copilot-settings');
    container.innerHTML = '<div class="view-loading">Consultando o Copilot…</div>';
    try {
      const [settings, toolsData] = await Promise.all([api('/api/copilot/settings'), api('/api/copilot/tools')]);
      const options = Object.entries(PRESETS).map(([value, p]) => `<option value="${value}" ${settings.provider === value ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
      container.innerHTML = `
        <div class="page-header"><div><div class="eyebrow">SERVIDOR CENTRAL · LLM PLUGÁVEL</div><h1>Copilot (IA)</h1><p class="page-subtitle">A LLM conversacional e as chaves ficam só no servidor central; o navegador do solicitante nunca recebe a chave. Sem LLM, o Copilot usa o motor de regras local.</p></div><button class="button button-secondary" type="button" id="cps-test">Testar conexão</button></div>
        ${engineBlock(settings.engine)}
        <form id="cps-form" class="panel integration-panel">
          <div class="panel-head"><div><h3>Endpoint da LLM (OpenAI Chat Completions)</h3><span>Origem atual: ${settings.origem === 'tenant' ? 'Settings desta organização' : 'arquivo .env do servidor'}</span></div></div>
          <div class="integration-content"><div class="integration-fields">
            <label>Provedor<select name="provider" id="cps-provider">${options}</select></label>
            <label>URL base<input name="baseUrl" id="cps-base" type="url" placeholder="https://openrouter.ai/api/v1" value="${esc(settings.baseUrl || '')}"></label>
            <label>Modelo<input name="model" id="cps-model" placeholder="nousresearch/hermes-3-llama-3.1-8b" value="${esc(settings.model || '')}"></label>
            <label>Chave de API<input name="apiKey" type="password" autocomplete="new-password" placeholder="${settings.hasApiKey ? 'Configurada · deixe vazia para manter' : 'Opcional para Ollama/vLLM na rede interna'}"></label>
            <label>Chamadas de ferramenta<select name="toolMode"><option value="auto" ${settings.toolMode === 'auto' ? 'selected' : ''}>Automático (nativo, com leitura de &lt;tool_call&gt;)</option><option value="native" ${settings.toolMode === 'native' ? 'selected' : ''}>Nativo (tools / tool_calls)</option><option value="hermes" ${settings.toolMode === 'hermes' ? 'selected' : ''}>Hermes (&lt;tools&gt; no prompt e &lt;tool_call&gt;)</option></select></label>
            <label class="cps-check"><input type="checkbox" name="fallbackRules" ${settings.fallbackRules ? 'checked' : ''}> Usar o motor de regras se a LLM falhar</label>
            ${settings.hasApiKey ? '<label class="cps-check"><input type="checkbox" name="clearApiKey"> Remover a chave salva</label>' : ''}
          </div>
          <div class="integration-form-footer"><p>A chave é criptografada com TENANT_SECRETS_KEY (AES-256-GCM).</p><div class="action-row">${settings.origem === 'tenant' ? '<button class="button button-secondary" type="button" id="cps-env">Voltar ao .env</button>' : ''}<button class="button button-primary" type="submit">Salvar</button></div></div></div>
        </form>
        <section class="panel">
          <div class="panel-head"><div><h3>Tool Registry</h3><span>Ferramentas do agente (ativas são oferecidas à LLM; planejadas aguardam implementação)</span></div></div>
          <div class="table-wrap"><table><thead><tr><th>FERRAMENTA</th><th>STATUS</th><th>EXECUTA EM</th><th>DESCRIÇÃO</th></tr></thead><tbody>
            ${toolsData.tools.map((t) => `<tr><td><code>${esc(t.name)}</code></td><td><span class="prediag-pill ${t.status === 'ativa' ? 'prediag-pill-ok' : 'prediag-pill-na'}">${esc(t.status)}</span></td><td>${esc(t.execution)}</td><td>${esc(t.description)}</td></tr>`).join('')}
          </tbody></table></div>
        </section>
        <div id="cps-result"></div>`;
      container.querySelector('#cps-provider').addEventListener('change', (event) => {
        const preset = PRESETS[event.target.value];
        if (!preset) return;
        if (preset.baseUrl) container.querySelector('#cps-base').value = preset.baseUrl;
        if (preset.model) container.querySelector('#cps-model').value = preset.model;
      });
      container.querySelector('#cps-form').addEventListener('submit', save);
      container.querySelector('#cps-test').addEventListener('click', test);
      container.querySelector('#cps-env')?.addEventListener('click', async () => {
        try {
          await api('/api/copilot/settings', { method: 'PUT', body: JSON.stringify({ useEnv: true }) });
          toast('Copilot voltou a usar a configuração do .env.');
          void renderCopilotSettings();
        } catch (error) {
          toast(error.message);
        }
      });
    } catch (error) {
      container.innerHTML = `<div class="page-header"><div><h1>Copilot (IA)</h1></div></div><section class="panel integration-status disconnected"><span class="integration-indicator"></span><div><h2>Não foi possível consultar</h2><p>${esc(error.message)}</p></div></section>`;
    }
  }

  async function save(event) {
    event.preventDefault();
    const form = event.target;
    const values = Object.fromEntries(new FormData(form).entries());
    const body = { provider: values.provider, baseUrl: values.baseUrl, model: values.model, apiKey: values.apiKey, toolMode: values.toolMode, fallbackRules: form.fallbackRules.checked, clearApiKey: Boolean(form.clearApiKey?.checked) };
    try {
      await api('/api/copilot/settings', { method: 'PUT', body: JSON.stringify(body) });
      toast('Configuração do Copilot salva no servidor central.');
      void renderCopilotSettings();
    } catch (error) {
      toast(error.message);
    }
  }

  async function test() {
    const button = $('#cps-test');
    button.disabled = true;
    button.textContent = 'Testando…';
    try {
      const result = await api('/api/copilot/settings/test', { method: 'POST', body: '{}' });
      $('#cps-result').innerHTML = `<div class="prediag-verdict ${result.ok ? 'prediag-verdict-ok' : 'prediag-verdict-open'}"><div class="prediag-verdict-head"><b>${result.ok ? 'LLM respondeu' : 'Falha na conexão'}</b><span>${result.latenciaMs ? `${esc(result.latenciaMs)} ms` : ''}</span></div><p>${result.ok ? `Modelo ${esc(result.modelo)} respondeu "${esc(result.resposta)}".` : esc(result.erro || 'Erro desconhecido')}</p></div>`;
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Testar conexão';
    }
  }

  return { renderCopilotSettings };
}
