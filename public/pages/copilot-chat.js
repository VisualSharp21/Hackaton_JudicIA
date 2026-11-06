/**
 * Central de Atendimento — Copilot Nível 1 (chat do solicitante).
 *
 *  PASSO 1  chip "Estação atual" + ficha da máquina (inventário GLPI), detecção pela rede
 *  PASSO 2  conversa; cada resposta traz a triagem do Laya em tempo real
 *  PASSO 3  cartão de Solução Recomendada (já no SO da estação)
 *  PASSO 4  cartão da ferramenta run_meet_check (teste de microfone, câmera e rede inline)
 *  PASSO 5  [✅ Consegui resolver!] / [🎫 Ainda preciso de ajuda / Abrir Chamado]
 *  PASSO 6  protocolo do GLPI em tempo real
 */
import { renderInline, renderMarkdown } from '../js/markdown.js';
import { runMeetDiagnostics } from '../js/meet-diagnostics.js';

const STATION_KEY = 'pulso-copilot-station';
const SESSION_KEY = 'pulso-copilot-session';
const EXAMPLES = [
  ['PJe / assinador', "Não consigo assinar no PJe: aparece 'Não foi possível conectar ao PJeOffice'."],
  ['Impressora', 'A impressora do setor parou e tem vários documentos presos na fila.'],
  ['Rede', 'A internet está caindo toda hora e ninguém do setor consegue acessar o PJe.'],
  ['Senha', 'Minha senha expirou e agora a conta bloqueou por excesso de tentativas.'],
  ['Audiência', 'Temos audiência agora pelo Google Meet (https://meet.google.com/abc-defg-hij) e ninguém nos ouve.'],
  ['Lentidão', 'O computador está muito lento para abrir os autos no PJe.'],
];
const PRIORITY_CLASS = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'critical' };

function storage(kind) {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function createCopilotChat(ctx) {
  const { $, api, esc, toast, navigate, levelPt, categoryPt, systemPt, showTicketDetail, reload } = ctx;
  // Motor, modelo e provedor de triagem só aparecem para quem é técnico (TIC).
  // Para os demais perfis o Copilot é só "o Copilot".
  const technical = () => Boolean(ctx.isTechnical?.());
  const S = {
    ready: false,
    machines: [],
    machineId: null,
    detection: 'seletor',
    detected: null,
    engine: null,
    session: null,
    entries: [],
    busy: false,
    menuOpen: false,
    specsOpen: false,
    filter: '',
    meetRunning: false,
  };

  const root = () => $('#copilot-root');
  const machine = () => S.machines.find((m) => m.id === S.machineId) || null;
  const sessionActive = () => !S.session || S.session.status === 'EM_ANDAMENTO';
  const fmtNum = (n) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(n);
  const fmtHour = (iso) => (iso ? new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '');

  // ------------------------------------------------------------ dados --

  async function init() {
    if (!root()) return;
    renderShell();
    try {
      const data = await api('/api/copilot/machines');
      S.machines = data.machines || [];
      S.engine = data.engine || null;
      S.detected = data.detected || null;
      const stored = storage('local')?.getItem(STATION_KEY);
      if (S.detected && S.machines.some((m) => m.id === S.detected.machineId)) {
        S.machineId = S.detected.machineId;
        S.detection = S.detected.metodo;
      } else if (stored && S.machines.some((m) => m.id === stored)) {
        S.machineId = stored;
        S.detection = 'seletor';
      }
      S.ready = true;
      await restoreSession();
    } catch (error) {
      toast(error.message);
    }
    render();
  }

  async function restoreSession() {
    const id = storage('session')?.getItem(SESSION_KEY);
    if (!id) return;
    try {
      const { session } = await api(`/api/copilot/sessions/${encodeURIComponent(id)}`);
      applySession(session, { rebuild: true });
    } catch {
      storage('session')?.removeItem(SESSION_KEY);
    }
  }

  function applySession(session, { rebuild = false } = {}) {
    S.session = session;
    storage('session')?.setItem(SESSION_KEY, session.id);
    if (session.machineId && S.machines.some((m) => m.id === session.machineId)) {
      S.machineId = session.machineId;
      if (session.machineDetection) S.detection = session.machineDetection;
    }
    if (!rebuild) return;
    S.entries = [];
    for (const message of session.messages || []) {
      if (message.role === 'assistant') S.entries.push({ kind: 'assistant', turn: message.turn, at: message.at });
      else if (message.system) S.entries.push({ kind: 'system', text: message.text, at: message.at });
      else S.entries.push({ kind: 'user', text: message.text, laudo: message.laudo, at: message.at });
    }
    if (session.escalation) S.entries.push({ kind: 'protocol', escalation: session.escalation });
    if (session.status === 'RESOLVIDO_AUTOATENDIMENTO') S.entries.push({ kind: session.resolution?.nota ? 'thanks' : 'rating', rating: session.resolution?.nota });
  }

  function newConversation() {
    S.session = null;
    S.entries = [];
    storage('session')?.removeItem(SESSION_KEY);
    render();
    root()?.querySelector('#copilot-input')?.focus();
  }

  /** Vindo do pré-diagnóstico: seleciona a estação pelo nome do computador e preenche o relato. */
  async function openWith({ text = '', hostname = '' } = {}) {
    navigate('inicio');
    if (S.session && S.session.status !== 'EM_ANDAMENTO') newConversation();
    if (hostname) {
      try {
        const data = await api(`/api/copilot/machines?hostname=${encodeURIComponent(hostname)}`);
        if (data.detected?.machineId) {
          S.machineId = data.detected.machineId;
          S.detection = data.detected.metodo;
          toast(`Estação ${data.detected.machineId} identificada pelo pré-diagnóstico.`);
        }
      } catch {
        /* segue com a estação atual */
      }
    }
    render();
    const input = root()?.querySelector('#copilot-input');
    if (input && text) {
      input.value = text.slice(0, 2000);
      updateCounter();
      input.focus();
    }
  }

  /** Resumo em linguagem natural do laudo (vira o relato da solicitação para o Laya). */
  function describeReport(report) {
    const problems = [];
    const mic = report.microfone?.status;
    const cam = report.camera?.status;
    if (mic === 'negado') problems.push('o navegador bloqueou a permissão do microfone');
    if (mic === 'mudo') problems.push('o microfone não capta a voz');
    if (mic === 'ausente') problems.push('nenhum microfone foi encontrado');
    if (mic === 'ocupado' || mic === 'falha') problems.push('o microfone não abre');
    if (cam === 'negado') problems.push('o navegador bloqueou a permissão da câmera');
    if (cam === 'ocupado') problems.push('a câmera está em uso por outro aplicativo');
    if (cam === 'ausente') problems.push('nenhuma câmera foi encontrada');
    if (cam === 'falha') problems.push('a câmera fica com tela preta');
    if (report.rede?.status !== 'ok' || report.zabbix?.status !== 'OPTIMAL') problems.push('a conexão de rede está instável');
    const sala = report.sala?.url ? ` (${report.sala.url})` : '';
    const verdict = { BLOQUEADA: 'apontou impedimento', ATENCAO: 'deu alerta' }[report.veredito] || 'terminou';
    return problems.length
      ? `Fiz o teste pré-audiência do Google Meet${sala} e ele ${verdict}: ${problems.join(', ')}.`
      : `Fiz o teste pré-audiência do Google Meet${sala}: câmera, microfone e rede aprovados.`;
  }

  /** Laudo vindo da página "Teste de audiência": abre o chat e envia o laudo ao Copilot. */
  async function sendMeetReport(report) {
    navigate('inicio');
    if (S.session && S.session.status !== 'EM_ANDAMENTO') newConversation();
    render();
    if (!machine()) {
      toast('Selecione sua estação de trabalho para o Copilot analisar o laudo.');
      S.menuOpen = true;
      renderStation();
      return;
    }
    const text = describeReport(report);
    await chat({ meetReport: report, message: text }, { userEntry: { kind: 'user', text, at: new Date().toISOString() } });
  }

  function reset() {
    S.session = null;
    S.entries = [];
    S.ready = false;
    storage('session')?.removeItem(SESSION_KEY);
    if (root()) root().innerHTML = '';
  }

  // -------------------------------------------------------- renderização --

  let listenersBound = false;

  /** Monta o esqueleto (de novo após um logout) e liga os eventos uma única vez. */
  function renderShell() {
    const el = root();
    if (!el) return;
    if (!el.querySelector('#cp-log')) el.innerHTML = `
      <div class="cp-head">
        <div>
          <div class="eyebrow">CENTRAL DE ATENDIMENTO · COPILOT NÍVEL 1</div>
          <h1>Como podemos ajudar?</h1>
          <p class="lead">Converse com o Copilot: ele já conhece a sua estação, consulta chamados anteriores do Tribunal e, se precisar, abre o chamado no GLPI com tudo o que já foi testado.</p>
        </div>
        <div class="cp-engine" id="cp-engine" role="status"></div>
      </div>
      <div class="cp-shell">
        <div class="cp-station" id="cp-station"></div>
        <div class="cp-log" id="cp-log" role="log" aria-live="polite" aria-relevant="additions"></div>
        <div class="cp-outcome" id="cp-outcome"></div>
        <form class="cp-composer" id="cp-composer" autocomplete="off">
          <label class="sr-only" for="copilot-input">Mensagem para o Copilot</label>
          <textarea id="copilot-input" rows="2" maxlength="2000" placeholder="Descreva o problema: o que aparece na tela, qual sistema ou equipamento e desde quando…"></textarea>
          <div class="cp-composer-foot">
            <span id="cp-counter">0 / 2000</span>
            <span class="cp-hint">Enter envia · Shift+Enter quebra a linha</span>
            <button class="button button-primary" type="submit" id="cp-send"><span class="button-label">Enviar</span> <span class="button-arrow">→</span></button>
          </div>
        </form>
      </div>`;
    if (listenersBound) return;
    listenersBound = true;
    el.addEventListener('click', onClick);
    el.addEventListener('submit', onSubmit);
    el.addEventListener('input', (event) => {
      if (event.target.id === 'copilot-input') updateCounter();
      if (event.target.id === 'cp-station-filter') {
        S.filter = event.target.value;
        renderStationMenu();
      }
    });
    el.addEventListener('keydown', (event) => {
      if (event.target.id === 'copilot-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void send();
      }
      if (event.key === 'Escape' && S.menuOpen) {
        S.menuOpen = false;
        renderStation();
        el.querySelector('#cp-station-chip')?.focus();
      }
    });
    document.addEventListener('click', (event) => {
      // composedPath é calculado no disparo: continua válido mesmo que o re-render
      // tenha tirado o botão clicado do DOM (senão o menu fecharia ao abrir).
      if (S.menuOpen && !event.composedPath().some((node) => node.id === 'cp-station')) {
        S.menuOpen = false;
        renderStation();
      }
    });
  }

  function render() {
    const el = root();
    if (!el) return;
    renderShell();
    renderEngine();
    renderStation();
    renderLog();
    renderOutcome();
    renderComposerState();
  }

  function renderEngine() {
    const el = root()?.querySelector('#cp-engine');
    if (!el) return;
    const engine = S.engine;
    if (!engine) {
      el.innerHTML = '<span class="cp-dot"></span> Conectando ao Copilot…';
      return;
    }
    if (!technical()) {
      el.className = `cp-engine ${engine.mode === 'indisponivel' ? 'is-down' : 'is-llm'}`;
      el.title = '';
      el.innerHTML = `<span class="cp-dot"></span><span><b>${engine.mode === 'indisponivel' ? 'Copilot indisponível' : 'Copilot online'}</b></span>`;
      return;
    }
    const llm = engine.mode === 'llm';
    el.className = `cp-engine ${llm ? 'is-llm' : engine.mode === 'indisponivel' ? 'is-down' : 'is-rules'}`;
    el.title = llm
      ? `LLM plugável no servidor central: ${engine.providerLabel} (${engine.host || ''}), modelo ${engine.model}. Ferramentas: ${engine.toolMode}. Fallback de regras: ${engine.fallbackRules ? 'ativo' : 'desligado'}.`
      : `Sem LLM configurada no servidor (${engine.reason || 'COPILOT_LLM_*'}). O Copilot responde com o motor de regras local: memória Hermes, base procedural e RAG de precedentes.`;
    el.innerHTML = `<span class="cp-dot"></span><span><b>${llm ? esc(engine.providerLabel) : 'Motor de regras local'}</b><small>${llm ? esc(engine.model) : 'memória Hermes + RAG · sem LLM'}</small></span>`;
  }

  function stationSpecs(m) {
    const inv = m.inventarioGlpi || {};
    const disk = m.disco || {};
    const diskBar = disk.livrePct !== null && disk.livrePct !== undefined
      ? `<span class="cp-meter ${disk.alerta ? 'is-alert' : ''}" role="img" aria-label="${disk.livrePct}% livre"><span style="width:${Math.max(3, 100 - disk.livrePct)}%"></span></span>`
      : '';
    const field = (label, value, extra = '') => `<div class="cp-spec"><small>${label}</small><b>${value}</b>${extra}</div>`;
    return `
      <div class="cp-specs" id="cp-specs">
        ${field('Sistema operacional', esc(`${m.so.nome}${m.so.nome.includes(m.so.versao) ? '' : ` ${m.so.versao}`}`), `<span>${esc(m.so.arquitetura)} · família ${m.so.familia === 'linux' ? 'Linux' : 'Windows'}</span>`)}
        ${field('Processador', esc(m.processador), `<span>${esc(m.nucleos)} núcleos · ${esc(m.frequenciaMhz)} MHz</span>`)}
        ${field('Memória RAM', `${esc(m.memoriaGib)} GB`, m.memoriaGib <= 8 ? '<span class="cp-warn">capacidade baixa para muitos autos abertos</span>' : '')}
        ${field('Disco livre', `${fmtNum(disk.livreGib)} de ${esc(disk.totalGib)} GB (${esc(disk.livrePct)}%)`, `${diskBar}${disk.alerta ? '<span class="cp-warn">⚠ pouco espaço</span>' : ''}`)}
        ${field('Setor', esc(m.setor), `<span>${esc(m.unidade)} · ${esc(m.responsavel)}</span>`)}
        ${field('Rede', esc(m.rede.ip), `<span>${esc(m.rede.descricao || m.rede.tipo || '')} · ${esc(m.rede.mac)}</span>`)}
        ${field('Patrimônio / Serial', esc(m.patrimonio), `<span>${esc(m.serial)}</span>`)}
        ${field('Equipamento', esc(`${m.fabricante} ${m.modelo}`), `<span>${esc(m.tipo)}</span>`)}
        <div class="cp-spec is-wide"><small>Periféricos típicos do setor</small><span>${m.perifericos.map((p) => `<span class="cp-tag">${esc(p)}</span>`).join('') || '—'}</span></div>
        <div class="cp-spec is-wide"><small>Softwares (inventário GLPI)</small><span>${(inv.softwares || m.softwares || []).map((s) => `<span class="cp-tag">${esc(s)}</span>`).join('') || '—'}</span></div>
        <div class="cp-spec is-wide"><small>Inventário GLPI Agent</small><span>${esc(inv.deviceid || '—')} · ${esc(inv.agente || '')} · ${esc(inv.sistemaOperacional?.fqdn || m.rede.fqdn || '')}${m.perfil?.prioridadePadrao ? ` · prioridade padrão do setor: ${esc(m.perfil.prioridadePadrao.split('(')[0].trim())}` : ''}</span></div>
      </div>`;
  }

  function renderStation() {
    const el = root()?.querySelector('#cp-station');
    if (!el) return;
    const m = machine();
    const detectionLabel = { ip: 'identificada pelo IP da rede interna', hostname: 'identificada pelo nome do computador', prediagnostico: 'identificada pelo pré-diagnóstico', seletor: 'selecionada manualmente' }[S.detection] || '';
    el.innerHTML = `
      <div class="cp-station-row">
        <span class="cp-station-label">Estação atual:</span>
        <button type="button" class="cp-chip" id="cp-station-chip" data-cp="station-toggle" aria-haspopup="listbox" aria-expanded="${S.menuOpen}" ${!S.ready ? 'disabled' : ''}>
          <span class="cp-chip-icon" aria-hidden="true">${m?.tipo === 'Notebook' ? '💻' : '🖥'}</span>
          <span class="cp-chip-text">${m ? esc(m.chip) : S.ready ? 'Selecione sua estação de trabalho' : 'Carregando estações…'}</span>
          <span class="cp-chip-caret" aria-hidden="true">▾</span>
        </button>
        ${m ? `<span class="cp-detect ${S.detection !== 'seletor' ? 'is-auto' : ''}">${esc(detectionLabel)}</span><button type="button" class="cp-link" data-cp="specs-toggle" aria-expanded="${S.specsOpen}" aria-controls="cp-specs">${S.specsOpen ? 'Ocultar ficha' : 'Ver ficha da máquina'}</button>` : ''}
        ${m?.disco?.alerta ? '<span class="cp-badge is-warn" title="Inventário GLPI">⚠ disco quase cheio</span>' : ''}
      </div>
      ${S.menuOpen ? '<div class="cp-menu" id="cp-menu"></div>' : ''}
      ${m && S.specsOpen ? stationSpecs(m) : ''}`;
    if (S.menuOpen) renderStationMenu();
  }

  function renderStationMenu() {
    const menu = root()?.querySelector('#cp-menu');
    if (!menu) return;
    const q = S.filter.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const list = S.machines.filter((m) => !q || `${m.chip} ${m.processador} ${m.unidade}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q));
    const groups = new Map();
    for (const m of list) groups.set(m.setor, [...(groups.get(m.setor) || []), m]);
    const hadFocus = document.activeElement?.id === 'cp-station-filter';
    menu.innerHTML = `
      <input id="cp-station-filter" type="search" placeholder="Buscar por estação, setor, modelo ou sistema…" value="${esc(S.filter)}" aria-label="Filtrar estações">
      <div class="cp-menu-list" role="listbox" aria-label="Estações de trabalho">
        ${[...groups].map(([setor, items]) => `
          <div class="cp-menu-group" role="group" aria-label="${esc(setor)}"><div class="cp-menu-title">${esc(setor)}</div>
            ${items.map((m) => `<button type="button" role="option" aria-selected="${m.id === S.machineId}" class="cp-option ${m.id === S.machineId ? 'is-selected' : ''}" data-cp="station-pick" data-id="${esc(m.id)}">
              <b>${esc(m.id)}</b><span>${esc(m.fabricante)} ${esc(m.modelo)} · ${esc(m.so.curto)} · ${esc(m.unidade)}</span>${m.disco.alerta ? '<em title="Pouco espaço em disco">⚠</em>' : ''}</button>`).join('')}
          </div>`).join('') || '<p class="cp-empty">Nenhuma estação encontrada.</p>'}
      </div>`;
    if (hadFocus || S.menuOpen) {
      const input = menu.querySelector('#cp-station-filter');
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    }
  }

  function welcome() {
    const m = machine();
    return `
      <div class="cp-welcome">
        <div class="cp-avatar" aria-hidden="true">✦</div>
        <div class="cp-welcome-body">
          <p><b>Olá! Sou o Copilot de TIC do Tribunal.</b> ${m ? `Já carreguei a ficha da estação <b>${esc(m.id)}</b> (${esc(m.fabricante)} ${esc(m.modelo)} · ${esc(m.so.curto)} · ${esc(m.setor)}).` : 'Para começar, selecione acima a sua estação de trabalho.'}</p>
          <p>Conte o que está acontecendo. Eu classifico o chamado, procuro casos parecidos já resolvidos e te passo o passo a passo para o seu sistema. Se não resolver, abro o chamado no GLPI com tudo o que foi testado.</p>
          <ol class="cp-flow" aria-label="Como o atendimento funciona">
            <li><b>Estação</b><span>hardware e inventário</span></li>
            <li><b>Conversa</b><span>relato em linguagem natural</span></li>
            <li><b>Triagem</b><span>categoria, urgência e fila</span></li>
            <li><b>Solução</b><span>passo a passo no seu SO</span></li>
            <li><b>Ferramentas</b><span>teste de audiência</span></li>
            <li><b>GLPI</b><span>chamado enriquecido</span></li>
          </ol>
          <div class="cp-examples"><span>Exemplos:</span>${EXAMPLES.map(([label, text]) => `<button type="button" class="cp-example" data-cp="example" data-text="${esc(text)}">${esc(label)}</button>`).join('')}</div>
        </div>
      </div>`;
  }

  const triageKey = (t) => (t ? [t.categoria, t.sistema, t.impacto, t.urgencia, t.prioridade, t.fila, t.incidenteColetivo, (t.regrasAplicadas || []).length].join('|') : '');

  function triageStrip(t, { compact = false } = {}) {
    if (!t) return '';
    if (compact)
      return `<div class="cp-triage is-compact" aria-label="Classificação do chamado"><span class="cp-triage-title">Triagem</span><span>mantida · prioridade <span class="priority ${PRIORITY_CLASS[t.prioridade] || ''}">${esc(levelPt[t.prioridade] || t.prioridade)}</span> · fila ${esc(t.fila)}</span></div>`;
    const chip = (label, value, cls = '') => `<span class="cp-tchip ${cls}"><small>${label}</small>${value}</span>`;
    const rules = (t.regrasAplicadas || []).map((r) => `<li><b>${esc(r.efeito)}</b> — ${esc(r.descricao)}</li>`).join('');
    const status = t.statusTriagem === 'READY' ? 'pronta' : t.statusTriagem === 'NEEDS_REVIEW' ? 'a confirmar pela TIC' : 'fora do escopo';
    return `
      <div class="cp-triage" aria-label="Classificação do chamado">
        <div class="cp-triage-head"><span class="cp-triage-title">${technical() ? 'Triagem do Laya' : 'Triagem'}</span><span class="cp-triage-meta"${technical() ? ' title="Provedor de decisão"' : ''}>${technical() ? `${esc(t.provedor)}${t.layaIndisponivel ? ' (Laya indisponível: classificador local)' : ''} · ` : ''}${esc(status)}${t.confianca !== null ? ` · confiança ${t.confianca}%` : ''}</span></div>
        <div class="cp-triage-chips">
          ${chip('Categoria', esc(categoryPt[t.categoria] || t.categoria))}
          ${chip('Sistema', esc(systemPt[t.sistema] || t.sistema))}
          ${chip('Impacto', esc(levelPt[t.impacto] || t.impacto))}
          ${chip('Urgência', esc(levelPt[t.urgencia] || t.urgencia))}
          ${chip('Prioridade', `<span class="priority ${PRIORITY_CLASS[t.prioridade] || ''}">${esc(levelPt[t.prioridade] || t.prioridade)}</span>`)}
          ${chip('Fila GLPI', `${esc(t.fila)}${t.filaGlpiId ? ` <i>#${esc(t.filaGlpiId)}</i>` : ''}`)}
          ${t.incidenteColetivo ? chip('Incidente', '⚑ coletivo', 'is-alert') : ''}
        </div>
        ${rules ? `<ul class="cp-rules">${rules}</ul>` : ''}
      </div>`;
  }

  function solutionCard(s) {
    if (!s) return '';
    const origin = technical()
      ? { base: 'Base procedural Hermes', llm: 'Resposta da LLM', laudo: 'Laudo do teste', roteiro: 'Roteiro geral' }[s.origem] || 'Copilot'
      : { base: 'Base de procedimentos', llm: 'Copilot', laudo: 'Laudo do teste', roteiro: 'Roteiro geral' }[s.origem] || 'Copilot';
    return `
      <section class="cp-card cp-solution" aria-label="Solução recomendada">
        <header><span class="cp-card-icon" aria-hidden="true">🛠</span><div><small>SOLUÇÃO RECOMENDADA · ${esc(origin)}</small><h3>${esc(s.titulo)}</h3></div><span class="cp-os" title="Passos adaptados ao sistema operacional da estação">${s.familiaSo === 'linux' ? '🐧' : '⊞'} ${esc(s.so)}</span></header>
        ${s.diagnostico ? `<p class="cp-diag"><b>Diagnóstico:</b> ${renderInline(s.diagnostico)}</p>` : ''}
        <ol class="cp-steps">${s.passos.map((p) => `<li><span>${renderInline(p.texto)}</span>${p.codigo ? `<div class="cp-code"><pre><code>${esc(p.codigo.conteudo)}</code></pre><button type="button" class="cp-copy" data-cp="copy" data-code="${esc(p.codigo.conteudo)}" aria-label="Copiar comando">Copiar</button></div>` : ''}</li>`).join('')}</ol>
        ${s.escalarDireto ? '<p class="cp-note is-warn">Falha física: se não resolver com estes passos, abra o chamado — a equipe de hardware recebe patrimônio e modelo.</p>' : ''}
        <footer>Fonte: ${esc(s.fonte || '—')}</footer>
      </section>`;
  }

  function precedentBlock(p, main = false) {
    const res = p.resolucao;
    const resolution = res?.tipo === 'comprovada'
      ? `<div class="cp-resolution"><b>Resolução comprovada</b> <span>(${esc(res.fonte)})</span><ol>${res.passos.map((x) => `<li>${renderInline(x)}</li>`).join('')}</ol>${res.taxaAutoatendimento ? `<span class="cp-rate">Taxa de resolução em autoatendimento: ${esc(res.taxaAutoatendimento)}</span>` : ''}${res.causaRaiz ? `<p><b>Causa raiz:</b> ${renderInline(res.causaRaiz)}</p>` : ''}</div>`
      : res?.tipo === 'procedimento'
        ? `<div class="cp-resolution is-soft">Procedimento da base para o sintoma: <b>${esc(res.titulo)}</b></div>`
        : '';
    return `
      <div class="cp-prec ${main ? 'is-main' : ''}">
        <div class="cp-prec-head"><b>${esc(p.id)}</b><span class="cp-sim" title="Similaridade TF-IDF com o seu relato">${esc(p.similaridade)}% similar</span></div>
        <p class="cp-prec-title">“${esc(p.titulo)}”</p>
        <p class="cp-prec-meta">${esc(p.estacao.nome)} · ${esc(p.estacao.setor)} · ${esc(p.estacao.so)} · ${esc(p.estacao.unidade)}</p>
        ${resolution}
      </div>`;
  }

  function precedentCard(list) {
    if (!list?.length) return '';
    const [first, ...rest] = list;
    return `
      <section class="cp-card cp-precedents" aria-label="Precedentes">
        <header><span class="cp-card-icon" aria-hidden="true">📚</span><div><small>PRECEDENTES · CHAMADOS RESOLVIDOS DO TJPA</small><h3>Casos semelhantes</h3></div></header>
        ${precedentBlock(first, true)}
        ${rest.length ? `<details><summary>Ver mais ${rest.length} caso(s) semelhante(s)</summary>${rest.map((p) => precedentBlock(p)).join('')}</details>` : ''}
      </section>`;
  }

  const MEET_STEPS = [
    ['sala', 'Link da sala'],
    ['microfone', 'Microfone'],
    ['camera', 'Câmera'],
    ['rede', 'Latência até o servidor central'],
    ['zabbix', 'Telemetria da comarca (Zabbix · simulada)'],
  ];

  function meetReportSummary(laudo) {
    const label = { PRONTA: 'Sala pronta', ATENCAO: 'Atenção', BLOQUEADA: 'Impedimento' }[laudo.veredito] || laudo.veredito;
    const row = (k, v, ok) => `<li class="${ok ? 'is-ok' : 'is-bad'}"><span>${ok ? '✓' : '✗'}</span><b>${k}</b><em>${v}</em></li>`;
    const mic = laudo.microfone || {};
    const cam = laudo.camera || {};
    const net = laudo.rede || {};
    const zbx = laudo.zabbix || {};
    return `
      <div class="cp-verdict is-${String(laudo.veredito).toLowerCase()}"><b>${esc(label)}</b><span>${esc(laudo.resumo || '')}</span></div>
      <ul class="cp-checks">
        ${row('Microfone', esc(`${mic.status}${mic.dispositivo ? ` · ${mic.dispositivo}` : ''}${mic.picoPct !== null && mic.picoPct !== undefined ? ` · pico ${mic.picoPct}%` : ''}`), mic.status === 'ok')}
        ${row('Câmera', esc(`${cam.status}${cam.dispositivo ? ` · ${cam.dispositivo}` : ''}${cam.resolucao ? ` · ${cam.resolucao}` : ''}`), cam.status === 'ok')}
        ${row('Rede (servidor central)', esc(`${net.latenciaMs ?? '—'} ms · perda ${net.perdaPct ?? '—'}%`), net.status === 'ok')}
        ${zbx.comarca ? row(`Zabbix ${zbx.comarca} (simulado)`, esc(`${zbx.latenciaMs} ms · perda ${zbx.perdaPct}%`), zbx.status === 'OPTIMAL') : ''}
      </ul>`;
  }

  function meetCard(tool) {
    if (tool.reaproveitado) return '';
    const done = tool.status === 'concluido';
    return `
      <section class="cp-card cp-tool" data-run="${esc(tool.runId || '')}" aria-label="Diagnóstico de audiência virtual">
        <header><span class="cp-card-icon" aria-hidden="true">📹</span><div><small>${technical() ? `FERRAMENTA · run_meet_check${tool.origem === 'llm' ? ' · acionada pela LLM' : ''}` : 'TESTE DE AUDIÊNCIA'}</small><h3>Diagnóstico de Audiência Virtual</h3></div></header>
        <p class="cp-tool-link">${tool.meetUrl ? `Link identificado: <a href="${esc(tool.meetUrl)}" target="_blank" rel="noopener noreferrer">${esc(tool.meetUrl)}</a>${tool.codigoPadrao === false ? ' <span class="cp-warn">código fora do padrão xxx-yyyy-zzz</span>' : ''}` : 'Nenhum link do Meet informado — o teste verifica câmera, microfone e rede desta estação.'}</p>
        ${done ? meetReportSummary(tool.laudo || {}) : `
          <div class="cp-tool-actions"><button type="button" class="button button-primary" data-cp="meet-run" data-run="${esc(tool.runId || '')}" data-url="${esc(tool.meetUrl || '')}"><span class="button-label">Executar Teste Rápido de Microfone &amp; Câmera</span></button>
          <span class="cp-hint">O navegador vai pedir permissão para usar câmera e microfone.</span></div>
          <div class="cp-meet-live" hidden>
            <video playsinline muted aria-label="Prévia da câmera"></video>
            <div class="cp-meet-side">
              <div class="cp-mic"><span>Nível do microfone</span><span class="cp-meter is-live"><span class="cp-mic-level" style="width:0%"></span></span></div>
              <ul class="cp-meet-steps">${MEET_STEPS.map(([key, label]) => `<li data-step="${key}" class="is-wait"><span class="cp-step-dot" aria-hidden="true"></span><b>${label}</b><em>aguardando</em></li>`).join('')}</ul>
            </div>
          </div>`}
      </section>`;
  }

  function proposalCard(p) {
    if (!p) return '';
    return `
      <section class="cp-card cp-proposal">
        <header><span class="cp-card-icon" aria-hidden="true">🎫</span><div><small>FERRAMENTA · escalate_glpi_ticket · aguardando sua confirmação</small><h3>${esc(p.titulo || 'Abrir chamado no GLPI')}</h3></div></header>
        ${p.resumoTecnico ? `<p>${renderInline(p.resumoTecnico)}</p>` : ''}
        <div class="cp-tool-actions"><button type="button" class="button button-primary" data-cp="escalate"><span class="button-label">Confirmar e abrir o chamado</span></button></div>
      </section>`;
  }

  function engineNote(engine) {
    if (!engine || !technical()) return '';
    if (engine.mode === 'llm')
      return `<p class="cp-engine-note">Respondido por ${esc(engine.providerLabel || engine.provider)} · ${esc(engine.model)}${engine.ferramentas?.length ? ` · ferramentas: ${engine.ferramentas.map(esc).join(', ')}` : ''}${engine.toolMode ? ` · tool calling ${esc(engine.toolMode)}` : ''}</p>`;
    return `<p class="cp-engine-note">Motor de regras local${engine.fallback ? ` · fallback: ${esc(engine.motivo || 'LLM indisponível')}` : ''}</p>`;
  }

  function assistantEntry(turn, at, { compactTriage = false } = {}) {
    const tools = (turn.tools || []).map((t) => (t.tool === 'run_meet_check' ? meetCard(t) : '')).join('');
    const hints = (turn.hints || []).length && turn.engine?.mode === 'llm' ? `<ul class="cp-hints">${turn.hints.map((h) => `<li>💡 ${renderInline(h.texto)}</li>`).join('')}</ul>` : '';
    return `
      <div class="cp-msg is-bot">
        <div class="cp-avatar" aria-hidden="true">✦</div>
        <div class="cp-msg-body">
          <div class="cp-bubble">${renderMarkdown(turn.reply || '')}${hints}<span class="cp-time">${fmtHour(at || turn.createdAt)}</span></div>
          ${triageStrip(turn.triage, { compact: compactTriage })}
          ${tools}
          ${solutionCard(turn.solution)}
          ${precedentCard(turn.precedents)}
          ${proposalCard(turn.escalationProposal)}
          ${engineNote(turn.engine)}
        </div>
      </div>`;
  }

  function protocolEntry(e) {
    const esc2 = e.escalation || {};
    const simulated = esc2.provider !== 'glpi';
    return `
      <section class="cp-card cp-protocol" aria-label="Chamado aberto">
        <span class="result-check" aria-hidden="true">✓</span>
        <div class="eyebrow">${simulated ? 'CHAMADO REGISTRADO · CONECTOR SIMULADO' : 'CHAMADO ABERTO NO GLPI 11'}</div>
        <div class="protocol">${esc(esc2.protocol || '—')}</div>
        <p class="cp-protocol-title">${esc(esc2.title || '')}</p>
        <p>Fila <b>${esc(esc2.queue || '—')}</b>${esc2.queueCategoryId ? ` (categoria GLPI #${esc(esc2.queueCategoryId)})` : ''} · Prioridade <span class="priority ${PRIORITY_CLASS[esc2.priority] || ''}">${esc(levelPt[esc2.priority] || esc2.priority || '—')}</span></p>
        ${simulated ? '<p class="cp-note">Ambiente de demonstração: o protocolo foi salvo no banco local; nenhum GLPI real recebeu este chamado. Configure o GLPI em Integração GLPI.</p>' : '<p class="cp-note">Guarde o protocolo para acompanhar o atendimento.</p>'}
        <div class="action-row"><button type="button" class="button button-primary" data-cp="ticket-detail" data-ticket="${esc(esc2.ticketId || '')}">Ver chamado</button><button type="button" class="button button-secondary" data-cp="download-log">Baixar registro do atendimento</button><button type="button" class="button button-secondary" data-cp="new">Novo atendimento</button></div>
      </section>`;
  }

  function ratingEntry() {
    return `
      <form class="cp-card cp-rating" id="cp-rating">
        <h3>Que bom que resolveu! Como foi este atendimento?</h3>
        <p>O autoatendimento foi registrado. Sua nota ajuda a TIC a melhorar as orientações.</p>
        <div class="cp-stars" role="radiogroup" aria-label="Nota de 1 a 5">${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="rating" value="${n}" required><span aria-hidden="true">★</span><span class="sr-only">${n}</span></label>`).join('')}</div>
        <label class="cp-rating-comment">Comentário (opcional)<textarea name="comment" maxlength="500" rows="2" placeholder="O que ajudou ou faltou?"></textarea></label>
        <div class="action-row"><button class="button button-primary" type="submit"><span class="button-label">Enviar avaliação</span></button><button class="button button-secondary" type="button" data-cp="new">Agora não</button></div>
      </form>`;
  }

  function entryHtml(e, options = {}) {
    if (e.kind === 'user')
      return `<div class="cp-msg is-user"><div class="cp-bubble">${e.laudo ? '📎 <b>Laudo do teste de audiência anexado</b>' : esc(e.text).replace(/\n/g, '<br>')}<span class="cp-time">${fmtHour(e.at)}</span></div></div>`;
    if (e.kind === 'system') return `<div class="cp-system">${esc(e.text)}</div>`;
    if (e.kind === 'assistant') return assistantEntry(e.turn, e.at, options);
    if (e.kind === 'typing')
      return `<div class="cp-msg is-bot is-typing"><div class="cp-avatar" aria-hidden="true">✦</div><div class="cp-bubble"><span class="cp-dots" aria-hidden="true"><i></i><i></i><i></i></span> ${esc(e.text)}</div></div>`;
    if (e.kind === 'protocol') return protocolEntry(e);
    if (e.kind === 'rating') return ratingEntry();
    if (e.kind === 'thanks')
      return `<div class="cp-card cp-thanks"><b>Atendimento encerrado como autoatendimento${e.rating ? ` · nota ${esc(e.rating)}/5` : ''}.</b><div class="action-row"><button type="button" class="button button-secondary" data-cp="download-log">Baixar registro do atendimento</button><button type="button" class="button button-primary" data-cp="new">Novo atendimento</button></div></div>`;
    if (e.kind === 'error') return `<div class="cp-system is-error">${esc(e.text)}</div>`;
    return '';
  }

  function renderLog({ scroll = true } = {}) {
    const el = root()?.querySelector('#cp-log');
    if (!el) return;
    // A triagem aparece completa quando muda; repetida, vira uma linha compacta.
    let lastKey = null;
    el.innerHTML = S.entries.length
      ? S.entries.map((e) => {
          if (e.kind !== 'assistant' || !e.turn?.triage) return entryHtml(e);
          const key = triageKey(e.turn.triage);
          const html = entryHtml(e, { compactTriage: key === lastKey });
          lastKey = key;
          return html;
        }).join('')
      : welcome();
    if (scroll) requestAnimationFrame(() => el.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  function lastTurn() {
    return [...S.entries].reverse().find((e) => e.kind === 'assistant')?.turn || null;
  }

  function renderOutcome() {
    const el = root()?.querySelector('#cp-outcome');
    if (!el) return;
    const hasTurn = S.entries.some((e) => e.kind === 'assistant');
    if (!S.session || !hasTurn || S.session.status !== 'EM_ANDAMENTO') {
      el.innerHTML = '';
      return;
    }
    const suggest = lastTurn()?.sugerirEscalacao;
    el.innerHTML = `
      <span class="cp-outcome-label">Como ficou?</span>
      <button type="button" class="button button-secondary cp-resolved" data-cp="resolve"><span class="button-label">✅ Consegui resolver!</span></button>
      <button type="button" class="button ${suggest ? 'button-primary' : 'button-secondary'} cp-escalate" data-cp="escalate"><span class="button-label">🎫 Ainda preciso de ajuda / Abrir Chamado</span></button>
      <button type="button" class="cp-link" data-cp="new">Novo atendimento</button>`;
  }

  function renderComposerState() {
    const input = root()?.querySelector('#copilot-input');
    const button = root()?.querySelector('#cp-send');
    if (!input || !button) return;
    const closed = S.session && S.session.status !== 'EM_ANDAMENTO';
    const disabled = !S.ready || !machine() || closed;
    input.disabled = disabled;
    button.disabled = disabled || S.busy;
    input.placeholder = !machine()
      ? 'Selecione sua estação de trabalho acima para começar.'
      : closed
        ? 'Atendimento encerrado. Clique em "Novo atendimento" para outro problema.'
        : 'Descreva o problema: o que aparece na tela, qual sistema ou equipamento e desde quando…';
  }

  function updateCounter() {
    const input = root()?.querySelector('#copilot-input');
    const counter = root()?.querySelector('#cp-counter');
    if (input && counter) counter.textContent = `${input.value.length} / 2000`;
  }

  // ------------------------------------------------------------- ações --

  async function withButton(button, label, fn) {
    if (button?.getAttribute('aria-busy') === 'true') return undefined;
    const span = button?.querySelector('.button-label');
    const original = span?.textContent;
    if (button) {
      button.setAttribute('aria-busy', 'true');
      button.disabled = true;
      if (span && label) span.textContent = label;
    }
    try {
      return await fn();
    } finally {
      if (button?.isConnected) {
        button.removeAttribute('aria-busy');
        button.disabled = false;
        if (span && original) span.textContent = original;
      }
    }
  }

  async function chat(body, { userEntry }) {
    if (S.busy) return;
    S.busy = true;
    if (userEntry) S.entries.push(userEntry);
    const m = machine();
    S.entries.push({ kind: 'typing', text: `Analisando a estação ${m?.id || ''}, ${technical() ? 'classificando com o Laya' : 'classificando o problema'} e consultando os precedentes…` });
    renderLog();
    renderComposerState();
    try {
      const payload = { ...body, machineId: S.machineId, detection: S.detection };
      if (S.session?.id) payload.sessionId = S.session.id;
      const data = await api('/api/copilot/chat', { method: 'POST', body: JSON.stringify(payload) });
      S.entries = S.entries.filter((e) => e.kind !== 'typing');
      applySession(data.session);
      S.entries.push({ kind: 'assistant', turn: data.turn, at: data.turn.createdAt });
      if (data.turn.engine?.mode === 'llm' && S.engine?.mode !== 'llm') S.engine = { ...S.engine, mode: 'llm' };
    } catch (error) {
      S.entries = S.entries.filter((e) => e.kind !== 'typing');
      S.entries.push({ kind: 'error', text: error.message });
      if (error.status === 409) toast(error.message);
    } finally {
      S.busy = false;
      renderLog();
      renderOutcome();
      renderComposerState();
    }
  }

  async function send() {
    const input = root()?.querySelector('#copilot-input');
    const text = input?.value.trim() || '';
    if (S.meetRunning) {
      toast('Aguarde o teste de audiência terminar; o laudo será enviado ao Copilot.');
      return;
    }
    if (!machine()) {
      toast('Selecione sua estação de trabalho primeiro.');
      S.menuOpen = true;
      renderStation();
      return;
    }
    if (!text) {
      input?.focus();
      return;
    }
    if (S.busy) return;
    input.value = '';
    updateCounter();
    await chat({ message: text }, { userEntry: { kind: 'user', text, at: new Date().toISOString() } });
    root()?.querySelector('#copilot-input')?.focus();
  }

  async function runMeet(button) {
    if (S.meetRunning) return;
    const card = button.closest('.cp-tool');
    const live = card?.querySelector('.cp-meet-live');
    if (!card || !live) return;
    S.meetRunning = true;
    live.hidden = false;
    const video = live.querySelector('video');
    const level = live.querySelector('.cp-mic-level');
    const setStep = (key, state, detail) => {
      const li = live.querySelector(`[data-step="${key}"]`);
      if (!li) return;
      li.className = `is-${state === 'executando' ? 'run' : state}`;
      li.querySelector('em').textContent = detail || state;
    };
    try {
      const m = machine();
      const report = await withButton(button, 'Testando…', () => runMeetDiagnostics({
        meetUrl: button.dataset.url || '',
        runId: button.dataset.run || null,
        comarca: m?.unidade || 'Belém',
        videoEl: video,
        onStep: setStep,
        onLevel: (pct) => { if (level) level.style.width = `${pct}%`; },
      }));
      if (report) await chat({ meetReport: report }, { userEntry: { kind: 'user', laudo: true, at: new Date().toISOString() } });
    } catch (error) {
      toast(`Não foi possível executar o teste: ${error.message}`);
    } finally {
      S.meetRunning = false;
    }
  }

  async function resolve(button) {
    if (!S.session) return;
    await withButton(button, 'Registrando…', async () => {
      try {
        const data = await api('/api/copilot/resolve', { method: 'POST', body: JSON.stringify({ sessionId: S.session.id }) });
        applySession(data.session);
        S.entries.push({ kind: 'rating' });
        toast('Autoatendimento registrado. Nenhum chamado foi aberto.');
        void reload?.();
      } catch (error) {
        toast(error.message);
      }
    });
    renderLog();
    renderOutcome();
    renderComposerState();
  }

  async function escalate(button) {
    if (!S.session) return;
    await withButton(button, 'Abrindo chamado…', async () => {
      try {
        const data = await api('/api/copilot/escalate', { method: 'POST', body: JSON.stringify({ sessionId: S.session.id }) });
        applySession(data.session);
        if (!S.entries.some((e) => e.kind === 'protocol')) S.entries.push({ kind: 'protocol', escalation: data.session.escalation || { protocol: data.ticket?.protocol, ticketId: data.ticket?.id, title: data.title } });
        toast(`Chamado ${data.ticket?.protocol || ''} aberto.`);
        // Atualiza a lista local antes de liberar "Ver chamado" (o detalhe usa o cache).
        await reload?.().catch(() => {});
      } catch (error) {
        toast(error.message);
      }
    });
    renderLog();
    renderOutcome();
    renderComposerState();
  }

  async function downloadLog() {
    if (!S.session) return;
    try {
      const response = await fetch(`${window.pulsoApiBase || ''}/api/copilot/sessions/${encodeURIComponent(S.session.id)}/log`, {
        credentials: 'include',
        headers: window.pulsoTabSlot ? { 'X-Pulso-Slot': window.pulsoTabSlot } : {},
      });
      if (!response.ok) throw new Error(`Falha ao baixar o registro (${response.status}).`);
      const url = URL.createObjectURL(new Blob([await response.text()], { type: 'text/markdown' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${S.session.id}.md`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast(error.message);
    }
  }

  function onClick(event) {
    const target = event.target.closest('[data-cp]');
    if (!target) return;
    const action = target.dataset.cp;
    if (action === 'station-toggle') {
      S.menuOpen = !S.menuOpen;
      S.filter = '';
      renderStation();
    }
    if (action === 'station-pick') {
      const changed = target.dataset.id !== S.machineId;
      S.machineId = target.dataset.id;
      S.detection = 'seletor';
      S.menuOpen = false;
      storage('local')?.setItem(STATION_KEY, S.machineId);
      if (changed && S.session?.status === 'EM_ANDAMENTO' && S.entries.length) toast('A próxima mensagem já considera a nova estação.');
      render();
      root()?.querySelector('#copilot-input')?.focus();
    }
    if (action === 'specs-toggle') {
      S.specsOpen = !S.specsOpen;
      renderStation();
    }
    if (action === 'example') {
      const input = root()?.querySelector('#copilot-input');
      if (input && !input.disabled) {
        input.value = target.dataset.text;
        updateCounter();
        input.focus();
      } else if (!machine()) toast('Selecione sua estação de trabalho primeiro.');
    }
    if (action === 'meet-run') void runMeet(target);
    if (action === 'resolve') void resolve(target);
    if (action === 'escalate') void escalate(target);
    if (action === 'new') newConversation();
    if (action === 'download-log') void downloadLog();
    if (action === 'ticket-detail' && target.dataset.ticket) void showTicketDetail?.({ id: target.dataset.ticket });
    if (action === 'copy') {
      navigator.clipboard?.writeText(target.dataset.code || '').then(
        () => toast('Comando copiado.'),
        () => toast('Não foi possível copiar; selecione o texto manualmente.'),
      );
    }
  }

  async function onSubmit(event) {
    if (event.target.id === 'cp-composer') {
      event.preventDefault();
      await send();
    }
    if (event.target.id === 'cp-rating') {
      event.preventDefault();
      const form = event.target;
      const values = Object.fromEntries(new FormData(form).entries());
      await withButton(form.querySelector('button[type=submit]'), 'Enviando…', async () => {
        try {
          await api('/api/copilot/feedback', { method: 'POST', body: JSON.stringify({ sessionId: S.session.id, rating: Number(values.rating), comment: values.comment || '' }) });
          S.entries = S.entries.filter((e) => e.kind !== 'rating');
          S.entries.push({ kind: 'thanks', rating: Number(values.rating) });
          if (S.session) S.session.resolution = { ...(S.session.resolution || {}), nota: Number(values.rating) };
          toast('Obrigado pela avaliação.');
        } catch (error) {
          toast(error.message);
        }
      });
      renderLog();
    }
  }

  return { init, render, newConversation, openWith, sendMeetReport, reset, isClosed: () => Boolean(S.session && S.session.status !== 'EM_ANDAMENTO') };
}
