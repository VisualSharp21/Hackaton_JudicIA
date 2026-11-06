export function createTicketDetailPage(ctx) {
  const { $, api, esc, fmtDate, systemPt, categoryPt, levelPt, ticketStatusPt, toast, navigate, state } = ctx;
  async function showDetail(t) {
    if (!t) return;
    try {
      const liveTicket = await api(`/api/tickets/${encodeURIComponent(t.id)}`);
      state.currentTicket = { ...t, ...liveTicket, locality: t.locality || liveTicket.locality };
      const ticket = state.currentTicket,
        inc = ticket.incidentId && state.cache.incidents.find((i) => i.id === ticket.incidentId),
        article = ticket.article || state.cache.articles.find((a) => a.id === ticket.articleId),
        d = ticket.decision || {};
      $('#view-detail').innerHTML =
        `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> ATENDIMENTO / ${esc(ticket.protocol)}</div><h1>Detalhe do chamado</h1><p class="page-subtitle">Criado em ${fmtDate(ticket.createdAt)} · ${esc(ticket.id)}</p></div><button class="button button-secondary" data-action="tickets">← Voltar aos chamados</button></div><div class="ticket-detail-grid"><div><div class="panel detail-content"><h2>${esc(systemPt[ticket.system])} · ${esc(categoryPt[ticket.category])}</h2><p class="detail-description">${esc(ticket.description)}</p>${inc ? `<div class="rule-note"><b>Vínculo com incidente:</b> ${esc(inc.code)} · ${esc(inc.title)}. Chamado relacionado a um possível padrão coletivo.</div>` : ''}<div class="eyebrow" style="margin:20px 0 12px">TRILHA DA DECISÃO</div><div class="timeline"><div class="timeline-item"><span class="timeline-dot"></span><div><b>Solicitação analisada</b><small>${fmtDate(ticket.createdAt)} · Origem ${esc(ticket.provider)} · Categoria ${categoryPt[ticket.category]}, sistema ${systemPt[ticket.system]}</small></div></div>${article ? `<div class="timeline-item"><span class="timeline-dot"></span><div><b>Base de conhecimento consultada</b><small>${article.id} · ${esc(article.title)} · Autoatendimento oferecido</small></div></div>` : ''}<div class="timeline-item"><span class="timeline-dot"></span><div><b>Chamado criado pelo usuário</b><small>Protocolo ${ticket.protocol} · prioridade ${levelPt[ticket.priority]}</small></div></div><div class="timeline-item"><span class="timeline-dot"></span><div><b>Roteamento aplicado</b><small>${ticket.integration?.provider === 'glpi' ? `Fila sugerida pelo Pulso TIC: ${esc(ticket.queue)}. A atribuição no GLPI ainda depende de configuração.` : `Regra de fila encaminhou para ${esc(ticket.queue)}`}</small></div></div>${inc ? `<div class="timeline-item"><span class="timeline-dot"></span><div><b>Padrão de incidente detectado</b><small>${inc.code} · ${inc.ticketIds.length} chamados relacionados em até 15 minutos</small></div></div>` : ''}</div><div class="rule-note" style="margin:0"><b>Confiança por decisão:</b> categoria ${Math.round((d.categoryConfidence || ticket.confidence) * 100)}% · sistema ${Math.round((d.systemConfidence || ticket.confidence) * 100)}% · impacto ${Math.round((d.impactConfidence || ticket.confidence) * 100)}% · urgência ${Math.round((d.urgencyConfidence || ticket.confidence) * 100)}%. Prioridade e fila foram calculadas pelo código.</div></div></div><aside class="panel detail-aside"><h3>Dados do chamado</h3><div class="aside-field"><small>PROTOCOLO</small><b>${ticket.protocol}</b></div><div class="aside-field"><small>STATUS</small><b class="status">Aberto</b></div><div class="aside-field"><small>PRIORIDADE</small><b><span class="priority ${ticket.priority.toLowerCase()}">${levelPt[ticket.priority]}</span></b></div><div class="aside-field"><small>${ticket.integration?.provider === 'glpi' ? 'FILA SUGERIDA' : 'FILA RESPONSÁVEL'}</small><b>${esc(ticket.queue)}</b></div><div class="aside-field"><small>IMPACTO / URGÊNCIA</small><b>${levelPt[ticket.impact]} / ${levelPt[ticket.urgency]}</b></div><div class="aside-field"><small>CONFIANÇA DA CLASSIFICAÇÃO</small><b>${Math.round(ticket.confidence * 100)}%</b></div><div class="aside-field" style="border:0"><small>SISTEMA</small><b>${systemPt[ticket.system]}</b></div></aside></div>`;
      const aside = $('#view-detail .detail-aside');
      const liveStatus = aside?.querySelector('.aside-field .status');
      if (liveStatus) liveStatus.textContent = ticketStatusPt[ticket.status] || ticket.status || 'Indisponível';
      if (ticket.locality)
        aside?.insertAdjacentHTML('beforeend', `<div class="aside-field"><small>COMARCA / MUNICÍPIO</small><b>${esc(ticket.locality)}</b></div>`);
      if (ticket.integration?.provider === 'glpi')
        aside?.insertAdjacentHTML('beforeend', '<button class="button button-secondary" data-action="refresh-ticket-status">Atualizar status no GLPI</button>');
      navigate('detail');
    } catch (e) {
      toast(e.message);
    }
  }

  async function refreshTicketStatus() {
    if (!state.currentTicket) return;
    try {
      const result = await api(`/api/tickets/${encodeURIComponent(state.currentTicket.id)}/status`);
      state.currentTicket.status = result.status;
      const status = $('#view-detail .detail-aside .status');
      if (status) status.textContent = ticketStatusPt[result.status] || result.status || 'Indisponível';
      toast('Status atualizado diretamente do GLPI.');
    } catch (error) {
      toast(`Não foi possível atualizar o status: ${error.message}`);
    }
  }
  return { showDetail, refreshTicketStatus };
}
