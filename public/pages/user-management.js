export function createUserManagementPage({ $, api, esc, toast, getCurrentUserId }) {
  const roleLabels = {
    solicitante: 'Solicitante',
    tic: 'Equipe de TIC',
    gestor: 'Gestor',
  };

  async function renderUsers() {
    const container = $('#view-users');
    container.innerHTML = '<p class="integration-loading">Carregando acessos…</p>';
    try {
      const [users, localities] = await Promise.all([api('/api/admin/users'), api('/api/admin/localities')]);
      const rows = users.length
        ? users.map((user) => {
            const createdAt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(user.createdAt));
            const roleOptions = Object.entries(roleLabels)
              .map(([role, label]) => `<option value="${role}" ${user.role === role ? 'selected' : ''}>${label}</option>`)
              .join('');
            const isCurrentUser = user.id === getCurrentUserId();
            return `<tr><td><b>${esc(user.displayName)}</b></td><td>${esc(user.email)}</td><td><select data-user-role="${esc(user.id)}" aria-label="Perfil de ${esc(user.displayName)}" ${isCurrentUser ? 'disabled title="Não é possível alterar o próprio perfil"' : ''}>${roleOptions}</select></td><td>${createdAt}</td><td><button class="button button-secondary" type="button" data-action="save-user-role" data-user="${esc(user.id)}" ${isCurrentUser ? 'disabled' : ''}>Salvar perfil</button></td></tr>`;
          }).join('')
        : '<tr><td colspan="5"><div class="empty-state"><b>Nenhum acesso cadastrado</b><p>Cadastre as pessoas que usarão o sistema.</p></div></td></tr>';

      const localityRows = localities.length
        ? localities.map((locality) => `<tr><td><b>${esc(locality.name)}</b></td><td>${locality.active ? 'Ativo' : 'Inativo'}</td><td><button class="button button-secondary" type="button" data-action="toggle-locality" data-locality="${locality.id}" data-active="${!locality.active}">${locality.active ? 'Desativar' : 'Reativar'}</button></td></tr>`).join('')
        : '<tr><td colspan="3"><div class="empty-state"><b>Nenhuma opção cadastrada</b><p>Cadastre os municípios e comarcas que aparecerão no atendimento.</p></div></td></tr>';
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> ADMINISTRAÇÃO</div><h1>Acessos</h1><p class="page-subtitle">Crie contas e atribua um perfil de acesso aos módulos do sistema.</p></div></div>
        <div class="user-role-guide"><span><b>Solicitante</b>Atendimento e próprios chamados</span><span><b>Equipe de TIC</b>Atendimento e módulos operacionais</span><span><b>Gestor</b>Painéis, chamados, piloto e acessos</span></div>
        <section class="panel user-create-panel"><div class="panel-head"><div><h3>Criar acesso</h3><span>Cadastre a pessoa e escolha o perfil inicial.</span></div></div>
          <form id="user-create-form" class="user-create-form">
            <label>Nome<input name="displayName" maxlength="100" autocomplete="name" required></label>
            <label>E-mail<input name="email" type="email" maxlength="254" autocomplete="email" required></label>
            <label>Perfil<select name="role" required>${Object.entries(roleLabels).map(([role,label]) => `<option value="${role}">${label}</option>`).join('')}</select></label>
            <label>Senha inicial<input name="password" type="password" minlength="12" maxlength="128" autocomplete="new-password" required><small>Use pelo menos 12 caracteres e compartilhe por um canal autorizado.</small></label>
            <div class="user-create-actions"><button class="button button-primary" type="submit">Criar acesso</button></div>
          </form>
        </section>
        <section class="panel locality-admin-panel"><div class="panel-head"><div><h3>Municípios e comarcas</h3><span>As opções ativas aparecem no formulário de atendimento.</span></div></div><form id="locality-create-form" class="locality-create-form"><label for="locality-name">Nome do município ou comarca</label><div class="locality-create-row"><input id="locality-name" name="name" maxlength="120" minlength="2" required placeholder="Ex.: Belém ou Comarca de Abaetetuba"><button class="button button-primary" type="submit">Adicionar</button></div></form><div class="table-wrap"><table><thead><tr><th>MUNICÍPIO / COMARCA</th><th>STATUS</th><th>AÇÃO</th></tr></thead><tbody>${localityRows}</tbody></table></div></section>
        <section class="panel user-list-panel"><div class="panel-head"><div><h3>Contas cadastradas</h3><span>${users.length} pessoa${users.length === 1 ? '' : 's'}</span></div><button class="button button-secondary" type="button" data-action="refresh-users">Atualizar</button></div><div class="table-wrap"><table><thead><tr><th>NOME</th><th>E-MAIL</th><th>PERFIL</th><th>CRIADO EM</th><th>AÇÃO</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
    } catch (error) {
      container.innerHTML = `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> ADMINISTRAÇÃO</div><h1>Acessos</h1><p class="page-subtitle">Não foi possível carregar as contas: ${esc(error.message)}</p></div><button class="button button-secondary" data-action="refresh-users">Tentar novamente</button></div>`;
    }
  }

  async function createUser(form) {
    const submit = form.querySelector('[type="submit"]');
    const data = Object.fromEntries(new FormData(form).entries());
    submit.disabled = true;
    try {
      const created = await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      form.reset();
      toast(`Acesso criado para ${created.displayName}.`);
      await renderUsers();
    } catch (error) {
      toast(error.message);
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  }

  async function saveUserRole(userId) {
    const select = $(`[data-user-role="${CSS.escape(userId)}"]`);
    if (!select) return;
    const button = $(`[data-action="save-user-role"][data-user="${CSS.escape(userId)}"]`);
    if (button) button.disabled = true;
    try {
      await api(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role: select.value }),
      });
      toast('Perfil atualizado. A sessão dessa pessoa foi encerrada.');
      await renderUsers();
    } catch (error) {
      toast(error.message);
      if (button?.isConnected) button.disabled = false;
    }
  }

  async function createLocality(form) {
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const name = new FormData(form).get('name');
      await api('/api/admin/localities', { method: 'POST', body: JSON.stringify({ name }) });
      form.reset();
      toast('Município ou comarca adicionado ao atendimento.');
      await renderUsers();
    } catch (error) {
      toast(error.message);
    } finally {
      if (submit.isConnected) submit.disabled = false;
    }
  }

  async function toggleLocality(id, active) {
    try {
      await api(`/api/admin/localities/${encodeURIComponent(id)}/status`, {
        method: 'PUT', body: JSON.stringify({ active }),
      });
      toast(active ? 'Opção reativada no atendimento.' : 'Opção desativada no atendimento.');
      await renderUsers();
    } catch (error) {
      toast(error.message);
    }
  }

  return { renderUsers, createUser, saveUserRole, createLocality, toggleLocality };
}
