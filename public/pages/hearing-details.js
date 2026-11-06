const names = { station_tcp: 'Estação online', connectivity: 'Conectividade', dns: 'DNS', latency: 'Latência', packet_loss: 'Perda de pacotes', camera: 'Câmera detectada', microphone: 'Microfone detectado', camera_functional: 'Teste funcional da câmera', microphone_functional: 'Teste funcional do microfone', conference_access: 'Acesso à videoconferência', capture: 'Captura local', playback_configuration: 'Reprodução e configuração', monitoring: 'Monitoramento', audio: 'Áudio' };
const statuses = { PASS: 'PASSOU', FAIL: 'FALHOU', DETECTED: 'PASSOU · somente detecção', UNVERIFIABLE: 'NÃO VERIFICÁVEL' };
const actions = { CHECK_STARTED: 'Verificação preventiva iniciada automaticamente', CHECK_FINISHED: 'Verificação concluída', ESCALATION_QUEUED: 'Suporte acionado com evidências', SCHEDULED: 'Audiência agendada', BROWSER_REPORT: 'Teste local registrado', COPILOT_ASSISTED_GUIDANCE: 'Orientação do Copilot', AUTHORIZED_ACTION_REQUESTED: 'Correção autorizada solicitada', AGENT_ACTION_RESULT: 'Resultado da correção' };

import { contingencyMarkup, incidentsMarkup } from './prevention-operations.js';

export function detailsMarkup(data, esc, time, countdown, canAct = false) {
  const h = data.hearing;
  const checks = [...(h.lastChecks || [])];
  for (const name of Object.keys(names).slice(0, 10)) if (!checks.some((c) => c.name === name)) checks.push({ name, status: 'UNVERIFIABLE', mode: h.mode, evidence: name.endsWith('_functional') ? 'VALIDAÇÃO LOCAL PENDENTE' : 'Sem evidência específica coletada.', observedAt: null });
  const events = data.audit.map((a) => ({ at: a.at || a.createdAt, text: a.event === 'PRECEDENT_FOUND' ? 'Precedente encontrado na memória operacional' : actions[a.event || a.action] || a.event || a.action || a.type }));
  for (const j of data.jobs) {
    for (const run of j.history || []) for (const c of run.checks || []) events.push({ at: run.at, text: `${names[c.name] || c.name}: ${statuses[c.status] || c.status} — ${c.evidence}` });
    if (j.action) events.push({ at: j.history?.at(-1)?.at, text: `Procedimento ${j.action.name}: ${j.action.status} — ${j.action.evidence || ''}` });
  }
  events.sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
  return `<button class="button button-secondary" data-hearing-action="back">← Central de Audiências</button>
    <div class="hearing-header"><div><p class="eyebrow">${esc(h.mode)} · ${esc(h.type || 'Audiência')}</p><h1>${esc(h.label)}</h1><p>${esc(h.state.replaceAll('_', ' '))} · <span data-countdown="${esc(h.id)}">${esc(countdown(h))}</span></p></div></div>
    <dl class="hearing-facts">${[['Horário', time(h.startsAt, h.timezone)], ['Comarca', h.locality], ['Vara / setor', h.department || 'Não informado'], ['Sala', h.room], ['Estação', h.stationId], ['Responsável', h.responsible], ['Equipamentos', h.devices.join(', ')], ['Videoconferência', h.conferenceUrl || 'Não informada']].map(([k,v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <h2>Checklist de prontidão</h2><p>A prevenção é automática. Apenas as validações locais dependem de sua interação nesta estação.</p>
    <div class="hearing-checklist">${checks.map((c) => `<article data-result="${esc(c.status)}"><h3>${esc(names[c.name] || c.name)}</h3><strong>${esc(statuses[c.status] || c.status)}</strong><span class="hearing-mode">${esc(c.mode)}</span><p>${esc(c.evidence)}</p><small>${c.observedAt ? esc(time(c.observedAt)) : 'Ainda não verificado'}</small>${h.mode === 'REAL' && h.lifecycle === 'ATIVA' && c.name.endsWith('_functional') ? `<button class="button button-secondary" data-hearing-action="browser" data-component="${c.name}" data-id="${esc(h.id)}">Testar ${c.name.startsWith('camera') ? 'câmera' : 'microfone'}</button>` : ''}</article>`).join('')}</div>
    <h2>Memória operacional</h2>${data.precedents.map((p) => `<article class="hearing-precedent"><h3>Precedente encontrado · ${esc(p.mode)}</h3><p><b>Problema anterior:</b> ${esc(p.problem)}</p><p><b>Solução aplicada:</b> ${esc(p.solution)}</p><p><b>Resultado:</b> ${esc(p.successEvidence)}</p><p><b>Origem:</b> ${esc(p.source)} · ${esc(p.ticketId)}</p><p><b>Relevância por correspondência:</b> ${esc(p.relevance.explanation)} — não representa probabilidade de sucesso.</p></article>`).join('') || '<p>Nenhum precedente validado recuperado para as evidências disponíveis.</p>'}
    ${data.incident ? incidentsMarkup([data.incident], esc, canAct) : ''}
    ${contingencyMarkup(data, esc, canAct)}
    ${(data.localContacts || []).length ? `<h2>Apoio local</h2>${data.localContacts.map((r)=>`<p><b>${esc(r.label)}</b> · ${esc(r.contact)} · ${esc(r.skills)}</p>`).join('')}` : ''}
    <h2>Copilot da audiência</h2><button class="button button-primary" data-hearing-action="assist" data-id="${esc(h.id)}">Resolver com Copilot</button>${canAct && h.lifecycle === 'ATIVA' ? `<button class="button button-secondary" data-hearing-action="recheck" data-id="${esc(h.id)}" data-revision="${h.revision}">Solicitar nova verificação</button>` : ''}<div id="hearing-copilot-result" role="status"></div>
    <form id="hearing-assist-form" data-id="${esc(h.id)}"><label>Continuar orientação<input name="message" maxlength="2000" required placeholder="Informe o resultado do procedimento realizado"></label><button class="button button-secondary">Enviar ao Copilot</button></form>
    <h2>Timeline preventiva</h2><ol class="hearing-timeline">${events.map((e) => `<li><time>${e.at ? esc(time(e.at)) : ''}</time><p>${esc(e.text)}</p></li>`).join('')}</ol>
    <h2>Suporte</h2>${data.escalations.map((e) => `<p>${esc(e.mode)} · ${esc(e.status)} · Chamado ${esc(e.ticket?.id || 'aguardando confirmação')} · Evidências e intervenções anexadas à escalação.</p>`).join('') || '<p>Nenhuma escalação registrada.</p>'}`;
}
