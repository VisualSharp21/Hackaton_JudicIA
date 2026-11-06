import { filterTicketQueue, liveDeadline, deadlineLabel } from './ticket-queue.js';
import { incidentsMarkup, submitOperation, downloadJson } from './prevention-operations.js';

export function createTicketPages(ctx) {
  const { $, api, esc, fmtTime, fmtDate, toast, systemPt, categoryPt, levelPt, ticketStatusPt, state } = ctx;
  let queueTimer;
  function ticketRows(list) {
    if (!list.length)
      return `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">▤</div><b>Nenhum chamado encontrado</b><p>As solicitações encaminhadas aparecerão aqui.</p></div></td></tr>`;
    return list
      .map(
        (t) => {
          const d = liveDeadline(t);
          return `<tr data-ticket="${esc(t.id)}" data-sla="${esc(d.status)}"><td><strong>${esc(t.protocol)}</strong>${t.synthetic ? '<small> DEMO</small>' : ''}</td><td>${esc(t.locality || 'Não informada')}</td><td>${esc(systemPt[t.system] || t.system)}</td><td>${esc(categoryPt[t.category] || t.category)}</td><td><span class="priority ${t.priority.toLowerCase()}" title="${esc(`Impacto: ${levelPt[t.impact] || t.impact}; urgência: ${levelPt[t.urgency] || t.urgency}. Matriz configurada de triagem.`)}">${levelPt[t.priority]}</span></td><td><span class="queue-tag">${esc(t.queue)}</span></td><td>${esc(ticketStatusPt[t.status] || t.status || '—')}</td><td>${fmtTime(t.createdAt)}</td><td title="${esc(d.basis)}"><b>${esc(deadlineLabel[d.status] || d.status)}</b>${d.dueAt ? `<small> ${esc(fmtDate(d.dueAt))}</small>` : ''}</td></tr>`;
        },
      )
      .join('');
  }

  function renderTable(list) {
    return `<div class="panel"><div class="panel-head"><h3>Chamados</h3><span>${list.length} registros</span></div><div class="table-wrap"><table><thead><tr><th>PROTOCOLO</th><th>COMARCA / MUNICÍPIO</th><th>SISTEMA</th><th>CATEGORIA</th><th>PRIORIDADE</th><th>FILA SUGERIDA</th><th>STATUS</th><th>HORÁRIO</th><th>META DE RESOLUÇÃO</th></tr></thead><tbody>${ticketRows(list)}</tbody></table></div></div>`;
  }

  async function renderDashboard() {
    try {
      const d = await api('/api/dashboard'),
        ratio = d.total ? Math.round((d.resolved / d.total) * 100) : 0;
      $('#view-dashboard').innerHTML =
        `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> OPERAÇÃO DE SUPORTE</div><h1>Visão geral</h1><p class="page-subtitle">Acompanhe chamados, autoatendimento e possíveis incidentes.</p></div><button class="button button-primary" data-action="home">+ Nova solicitação</button></div><div class="stats-grid"><div class="stat-card"><span class="stat-icon">▤</span><div class="stat-label">Chamados abertos</div><div class="stat-value">${d.open}</div><div class="stat-foot">No ambiente demonstrativo</div></div><div class="stat-card alert"><span class="stat-icon">⚑</span><div class="stat-label">Prioridade alta</div><div class="stat-value">${d.high}</div><div class="stat-foot">Alta ou crítica</div></div><div class="stat-card critical"><span class="stat-icon">◉</span><div class="stat-label">Possíveis incidentes</div><div class="stat-value">${d.incidents}</div><div class="stat-foot">Aguardando investigação</div></div><div class="stat-card"><span class="stat-icon">✓</span><div class="stat-label">Resolvidos no autoatendimento</div><div class="stat-value">${d.resolved}</div><div class="stat-foot">Sem intervenção humana</div></div></div><div class="dashboard-grid"><div class="panel"><div class="panel-head"><h3>Possíveis incidentes</h3><button class="button button-secondary" data-action="incidents" style="height:27px;padding:0 9px;font-size:9px">Ver todos →</button></div><div class="incident-list">${
          d.incidentList.length
            ? d.incidentList
                .slice(0, 4)
                .map(
                  (i) =>
                    `<div class="incident-row" data-incident="${esc(i.id)}"><span class="severity-dot ${i.severity === 'HIGH' ? 'high' : ''}"></span><div><b>${esc(i.title)}</b><small>${esc(i.code)} · Detectado às ${fmtTime(i.detectedAt)} · ${i.ticketIds.length} chamados</small></div><span class="incident-count">${i.ticketIds.length} chamados</span></div>`,
                )
                .join('')
            : `<div class="empty-state"><div class="empty-icon">◉</div><b>Nenhum incidente detectado</b><p>Solicitações relacionadas serão agrupadas automaticamente.</p></div>`
        }</div></div><div class="panel"><div class="panel-head"><h3>Resolutividade digital</h3><span>IRD · demonstração</span></div><div class="resolution-card"><div style="display:flex;align-items:baseline;gap:7px"><b style="font:700 26px Manrope;color:#287e70">${ratio}%</b><span style="font-size:10px;color:#9aa6ad">${d.resolved} de ${d.total} solicitações</span></div><div class="resolution-bar"><div class="resolution-fill" style="width:${ratio}%"></div></div><div class="resolution-meta"><span>Resolvidas sem intervenção humana</span><span>${d.total} total</span></div><div class="rule-note" style="margin:16px 0 0">Indicadores calculados com dados sintéticos inseridos nesta demonstração.</div></div></div></div>${renderTable(d.recent)}`;
      if (d.locality?.length) {
        const entries = d.locality
          .map((row) => `<div class="resolution-meta"><span>${esc(row.locality)}</span><b>${row.tickets} chamados</b></div>`)
          .join('');
        $('#view-dashboard').insertAdjacentHTML(
          'beforeend',
          `<section class="panel" style="margin-top:14px"><div class="panel-head"><h3>Chamados por comarca ou município</h3><span>Base para acompanhar cobertura territorial</span></div><div class="resolution-card">${entries}<div class="rule-note" style="margin-top:12px">Contagens não medem equidade por si só; compare com volume de usuários, prazo e prioridade por unidade.</div></div></section>`,
        );
      }
    } catch (e) {
      toast(e.message);
    }
  }

  async function renderTickets() {
    try {
      const list = await api('/api/tickets');
      state.cache.tickets = list;
      $('#view-tickets').innerHTML =
        `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> FILA DE ATENDIMENTO</div><h1>Chamados</h1><p class="page-subtitle">Prioridade pela matriz de impacto e urgência. Metas configuradas em Piloto e SLAs, em tempo corrido.</p></div><div class="action-row"><button class="button button-secondary" data-action="sync-tickets">Sincronizar status</button><button class="button button-primary" data-action="home">+ Nova solicitação</button></div></div><form class="ticket-filters" id="ticket-queue-filters"><input name="q" placeholder="Buscar protocolo, descrição, sistema…" aria-label="Buscar chamados"><select name="priority" aria-label="Prioridade"><option value="">Todas as prioridades</option>${Object.entries(levelPt).map(([v,t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</select><select name="status" aria-label="Situação"><option value="">Todas as situações</option>${[...new Set(list.map((t) => t.status))].map((v) => `<option value="${esc(v)}">${esc(ticketStatusPt[v] || v)}</option>`).join('')}</select><select name="locality" aria-label="Comarca"><option value="">Todas as comarcas</option>${[...new Set(list.map((t) => t.locality).filter(Boolean))].map((v) => `<option>${esc(v)}</option>`).join('')}</select><select name="sla" aria-label="Prazo"><option value="">Todos os prazos</option><option value="AT_RISK">Próximos de vencer</option><option value="OVERDUE">Prazo excedido</option><option value="UNCONFIGURED">Sem meta</option></select><select name="sort" aria-label="Ordenação"><option value="priority">Prioridade</option><option value="deadline">Prazo</option><option value="newest">Mais recentes</option></select></form><div id="ticket-queue-table"></div>`;
      const filters = $('#ticket-queue-filters');
      const update = () => { $('#ticket-queue-table').innerHTML = renderTable(filterTicketQueue(list, Object.fromEntries(new FormData(filters)))); };
      filters.oninput = update; filters.onchange = update; filters.onsubmit = (event) => event.preventDefault(); update();
      clearInterval(queueTimer);
      queueTimer = setInterval(() => { if (!filters.isConnected) clearInterval(queueTimer); else if ($('#view-tickets').classList.contains('active')) update(); }, 30000);
    } catch (e) {
      toast(e.message);
    }
  }

  async function renderIncidents() {
    try {
      const [list, operations] = await Promise.all([api('/api/incidents'), api('/api/prevention/operations')]);
      state.cache.incidents = list;
      $('#view-incidents').innerHTML =
        `<div class="page-header"><div><div class="eyebrow"><span class="eyebrow-line"></span> AGRUPAMENTO AUTOMÁTICO</div><h1>Possíveis incidentes</h1><p class="page-subtitle">Padrão experimental: três chamados do mesmo sistema e categoria em 15 minutos.</p></div></div>${
          list.length
            ? list
                .map(
                  (i) =>
                    `<div class="panel incident-detail" style="margin-bottom:13px"><div class="incident-hero"><span class="severity-dot ${i.severity === 'HIGH' ? 'high' : ''}" style="width:10px;height:10px"></span><div style="flex:1"><span class="tag-demo">REGRA EXPERIMENTAL DO PROTÓTIPO</span><h2 style="margin-top:8px">${esc(i.title)}</h2><p>${esc(i.code)} · ${systemPt[i.system]} · Detectado ${fmtDate(i.detectedAt)}</p></div><span class="priority ${i.severity.toLowerCase()}">${levelPt[i.severity]}</span></div><div class="panel-head" style="padding:14px 2px;border:0"><h3>Chamados relacionados</h3><span>${i.ticketIds.length} solicitações · mesma categoria e sistema</span></div><div class="table-wrap"><table><thead><tr><th>PROTOCOLO</th><th>DESCRIÇÃO</th><th>PRIORIDADE</th><th>HORÁRIO</th></tr></thead><tbody>${i.ticketIds
                      .map((id) => {
                        const t = state.cache.tickets.find((x) => x.id === id);
                        return t
                          ? `<tr data-ticket="${esc(t.id)}"><td><strong>${esc(t.protocol)}</strong></td><td>${esc(t.description.slice(0, 75))}${t.description.length > 75 ? '…' : ''}</td><td><span class="priority ${t.priority.toLowerCase()}">${levelPt[t.priority]}</span></td><td>${fmtTime(t.createdAt)}</td></tr>`
                          : '';
                      })
                      .join('')}</tbody></table></div></div>`,
                )
                .join('')
            : `<div class="panel empty-state"><div class="empty-icon">◉</div><b>Nenhum padrão agrupado ainda</b><p>Quando houver pelo menos três chamados relacionados em 15 minutos, um possível incidente será criado.</p></div>`
        }`;
      const host = document.createElement('div'); host.innerHTML = incidentsMarkup(operations.incidents || [], esc, state.currentUser?.role === 'tic');
      $('#view-incidents').prepend(host);
      host.onsubmit = async (event) => { if (!event.target.dataset.operationsForm) return; event.preventDefault(); try { await submitOperation(event.target, api); await renderIncidents(); } catch (error) { toast(error.message); } };
      host.onclick = (event) => { const b = event.target.closest('[data-operations-action]'); if (b?.dataset.operationsAction === 'download-incident') downloadJson(operations.incidents.find((i) => i.id === b.dataset.id).report, 'judicia-pos-incidente.json'); };
    } catch (e) {
      toast(e.message);
    }
  }
  return { ticketRows, renderTable, renderDashboard, renderTickets, renderIncidents };
}
