export function createIntegrationPage(ctx) {
  const { $, api, esc, toast } = ctx;
  async function renderIntegration() {
    const container = $('#view-integration');
    container.innerHTML = '<div class="integration-loading">Consultando o conector de chamados…</div>';
    try {
      const [healthInfo, settings] = await Promise.all([api('/api/health'), api('/api/ticketing/settings')]);
      const configured = healthInfo.ticketing?.provider === 'glpi';
      const result = await api('/api/ticketing/health').catch((error) => ({ status: 'unavailable', error: error.message }));
      const connected = result.status === 'ok' && result.authenticated;
      const state = connected ? 'connected' : configured ? 'disconnected' : 'mock';
      const title = connected ? 'Conectado' : configured ? 'Sem conexão' : 'Modo demonstração';
      const description = connected ? 'Autenticação confirmada e documentação da API acessível.' : configured ? result.error || 'Não foi possível autenticar no GLPI. Confira as variáveis no servidor.' : 'O sistema está usando o adaptador simulado. Nenhum chamado é enviado ao GLPI.';
      const mappedCategories = Object.values(settings.queueCategoryIds || {}).filter(Boolean).length;
      const features = [['Autenticação e documentação', connected ? 'Disponível' : configured ? 'Indisponível' : 'Não configurado'], ['Abertura de chamados', configured ? 'Ativa após triagem' : 'Simulada localmente'], ['Base de conhecimento', configured ? 'GLPI' : 'Dados demonstrativos'], ['Categorias de fila mapeadas', `${mappedCategories}/5`]];
      const queueNames = { SUPORTE_PJE: 'PJe', SUPORTE_REDE: 'Rede', SUPORTE_HARDWARE: 'Hardware', SUPORTE_SISTEMAS: 'Sistemas', SUPORTE_GERAL: 'Geral' };
      const queueMapping = Object.entries(queueNames).map(([queue, label]) => `<label>ID da categoria GLPI · ${label}<input name="queueCategory_${queue}" inputmode="numeric" pattern="[0-9]*" value="${esc(settings.queueCategoryIds?.[queue] || '')}" placeholder="Opcional"></label>`).join('');
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> CONECTORES</div><h1>Integração GLPI</h1><p class="page-subtitle">Edite as credenciais e acompanhe o estado do conector de chamados.</p></div><button class="button button-secondary" data-action="refresh-integration">Verificar conexão</button></div><section class="panel integration-status ${state}"><span class="integration-indicator" aria-hidden="true"></span><div><span class="integration-overline">STATUS EM EXECUÇÃO</span><h2>${esc(title)}</h2><p>${esc(description)}</p></div><span class="integration-provider">${configured ? 'GLPI 11 · API v2' : 'Adaptador mock'}</span></section><div class="integration-grid">${features.map(([label, value]) => `<section class="panel integration-feature"><span>${esc(label)}</span><b>${esc(value)}</b></section>`).join('')}</div><form id="integration-form" class="panel integration-panel"><div class="panel-head"><div><h3>Configurações da integração</h3><span>Segredos são protegidos e nunca aparecem preenchidos na tela.</span></div></div><div class="integration-content"><div class="integration-fields"><label>Provedor<select name="provider"><option value="mock" ${settings.provider === 'mock' ? 'selected' : ''}>Demonstração (mock)</option><option value="glpi" ${settings.provider === 'glpi' ? 'selected' : ''}>GLPI 11</option></select></label><label>URL base da API<input name="apiBaseUrl" type="url" placeholder="https://seu-glpi/api.php" value="${esc(settings.apiBaseUrl)}"></label><label>ID do cliente<input name="clientId" autocomplete="off" value="${esc(settings.clientId)}"></label><label>Segredo do cliente<input name="clientSecret" type="password" autocomplete="new-password" placeholder="${settings.hasClientSecret ? 'Configurado · deixe vazio para manter' : 'Informe o segredo'}"></label><label>Usuário GLPI<input name="username" autocomplete="username" value="${esc(settings.username)}"></label><label>Senha GLPI<input name="password" type="password" autocomplete="new-password" placeholder="${settings.hasPassword ? 'Configurada · deixe vazia para manter' : 'Informe a senha'}"></label><label>Escopo<input name="scope" value="${esc(settings.scope)}"></label><label>Versão da API<input name="apiVersion" value="${esc(settings.apiVersion)}"></label><label>Recurso da base de conhecimento<input name="knowledgeResource" value="${esc(settings.knowledgeResource)}"></label></div><div class="queue-category-mapping"><h4>Roteamento por categoria GLPI</h4><p>Configure IDs de categorias com regras de atribuição de grupo no GLPI. Sem regra de grupo na instância, a fila continua sendo apenas sugestão.</p><div class="integration-fields">${queueMapping}</div></div><div class="integration-form-footer"><p>As credenciais ficam isoladas nesta organização e são armazenadas criptografadas.</p><button class="button button-primary" type="submit">Salvar configurações</button></div></div></form>`;
    } catch (error) {
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> CONECTORES</div><h1>Integração GLPI</h1><p class="page-subtitle">Acompanhe a conexão do sistema de chamados.</p></div><button class="button button-secondary" data-action="refresh-integration">Tentar novamente</button></div><section class="panel integration-status disconnected"><span class="integration-indicator"></span><div><span class="integration-overline">STATUS DO CONECTOR</span><h2>Não foi possível consultar</h2><p>${esc(error.message)}</p></div></section>`;
    }
  }

  async function saveIntegrationSettings(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    values.queueCategoryIds = Object.fromEntries(
      Object.entries(values)
        .filter(([key]) => key.startsWith('queueCategory_'))
        .map(([key, value]) => [key.slice('queueCategory_'.length), value]),
    );
    for (const key of Object.keys(values)) if (key.startsWith('queueCategory_')) delete values[key];
    try {
      await api('/api/ticketing/settings', { method: 'PUT', body: JSON.stringify(values) });
      toast('Configurações desta organização salvas.');
      void renderIntegration();
    } catch (error) {
      toast(error.message);
    }
  }
  return { renderIntegration, saveIntegrationSettings };
}
