/**
 * Monitoramento — painel de operação do Pulso TIC.
 *
 * Formas escolhidas pelo trabalho do dado (ver skill dataviz):
 *   · números-chave  -> stat tiles, um único hero por view
 *   · volume no tempo -> linha 2px + wash 10%, crosshair e tooltip
 *   · magnitude por unidade/categoria -> barras de uma só cor (sem legenda)
 *   · um todo repartido -> barra segmentada alta, com a paleta de STATUS
 *
 * Toda cor vem dos tokens de theme.css (paleta validada por script).
 * Rótulos vindos da API entram por textContent — nunca por concatenação de HTML.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

const PRIORITY_ORDER = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const PRIORITY_STATE = {
  CRITICAL: { token: 'var(--status-critical)', cls: 'state-critical', ico: '▲', onLight: false },
  HIGH: { token: 'var(--status-serious)', cls: 'state-serious', ico: '●', onLight: false },
  MEDIUM: { token: 'var(--status-warning)', cls: 'state-warning', ico: '!', onLight: true },
  LOW: { token: 'var(--status-good)', cls: 'state-good', ico: '✓', onLight: false },
};

export function createMonitoringPage(ctx) {
  const { $, api, toast, categoryPt, levelPt } = ctx;

  const filters = { days: 30, locality: 'ALL' };
  const store = { tickets: [], incidents: [] };

  const nf = new Intl.NumberFormat('pt-BR');
  const fmtInt = (n) => nf.format(n ?? 0);
  const dayLabel = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });
  const fullDay = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

  // ---------------------------------------------------------------- utils --
  function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else node.setAttribute(k, v);
    }
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function svg(tag, attrs = {}, text) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  /** Barra horizontal: ponta arredondada 4px no fim do dado, quadrada na linha de base. */
  function barPathRight(x, y, w, h, r = 4) {
    const rr = Math.max(0, Math.min(r, w, h / 2));
    if (w <= 0) return '';
    if (rr === 0) return `M${x},${y}h${w}v${h}h${-w}Z`;
    return `M${x},${y}h${w - rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${h - 2 * rr}a${rr},${rr} 0 0 1 ${-rr},${rr}h${-(w - rr)}Z`;
  }

  /** Ticks "limpos" para o eixo de valor. */
  function niceTicks(max, target = 4) {
    if (!max || max <= 0) return [0, 1];
    const raw = max / target;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
    const ticks = [];
    for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(Math.round(v * 1000) / 1000);
    return ticks;
  }

  function tooltipFor(plot) {
    const tip = el('div', { class: 'mon-tip', role: 'status' });
    tip.hidden = true;
    plot.appendChild(tip);
    return tip;
  }
  function showTip(plot, tip, x, y) {
    tip.hidden = false;
    const pw = plot.clientWidth || 1;
    const tw = tip.offsetWidth || 140;
    let left = x + 12;
    if (left + tw > pw) left = Math.max(0, x - tw - 12);
    tip.style.left = `${left}px`;
    tip.style.top = `${Math.max(0, y - 10)}px`;
  }
  /** Monta o conteúdo do tooltip: valor lidera, nome segue. */
  function fillTip(tip, head, rows) {
    tip.replaceChildren();
    tip.appendChild(el('div', { class: 'tip-head' }, head));
    for (const r of rows) {
      const row = el('div', { class: 'tip-row' });
      if (r.color) {
        const key = el('span', { class: 'tip-key' });
        key.style.background = r.color;
        row.appendChild(key);
      }
      row.appendChild(el('b', { class: 'tip-val' }, r.value));
      row.appendChild(el('span', { class: 'tip-name' }, r.name));
      tip.appendChild(row);
    }
  }

  /** Tabela de apoio — todo gráfico tem uma, para não depender do hover. */
  function tableView(cols, rows, summaryText = 'Ver dados em tabela') {
    const details = el('details', { class: 'mon-table-toggle' });
    details.appendChild(el('summary', {}, summaryText));
    const wrap = el('div', { class: 'mon-table-wrap' });
    const table = el('table');
    const thead = el('thead');
    const htr = el('tr');
    cols.forEach((c, i) => htr.appendChild(el('th', i ? { class: 'num' } : {}, c)));
    thead.appendChild(htr);
    const tbody = el('tbody');
    for (const r of rows) {
      const tr = el('tr');
      r.forEach((cell, i) => tr.appendChild(el('td', i ? { class: 'num' } : {}, cell)));
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    wrap.appendChild(table);
    details.appendChild(wrap);
    return details;
  }

  function card({ title, subtitle, wide = false }) {
    const card = el('section', { class: `mon-card${wide ? ' is-wide' : ''}` });
    const head = el('div', { class: 'mon-card-head' });
    head.appendChild(el('h2', {}, title));
    if (subtitle) head.appendChild(el('p', {}, subtitle));
    card.appendChild(head);
    return card;
  }
  const emptyNote = (msg) => el('p', { class: 'mon-empty' }, msg);

  // ------------------------------------------------------------- recortes --
  function sliced() {
    const since = Date.now() - filters.days * 86400000;
    const byUnit = (t) => filters.locality === 'ALL' || (t.locality || 'Não informada') === filters.locality;
    const tickets = store.tickets.filter((t) => {
      const ts = new Date(t.createdAt).getTime();
      return Number.isFinite(ts) && ts >= since && byUnit(t);
    });
    const incidents = store.incidents.filter((i) => {
      const ts = new Date(i.detectedAt).getTime();
      return Number.isFinite(ts) && ts >= since;
    });
    return { tickets, incidents };
  }

  const isOpen = (t) => t.status !== 'SOLVED' && t.status !== 'CLOSED';

  function countBy(list, keyFn) {
    const map = new Map();
    for (const item of list) {
      const k = keyFn(item);
      map.set(k, (map.get(k) || 0) + 1);
    }
    return [...map.entries()].map(([key, value]) => ({ key, value })).sort((a, b) => b.value - a.value);
  }

  // ------------------------------------------------------------ stat tiles --
  function statTile({ label, value, note, state, hero = false }) {
    const tile = el('div', { class: `stat-tile${hero ? ' is-hero' : ''}` });
    tile.appendChild(el('span', { class: 'stat-label' }, label));
    tile.appendChild(el('strong', { class: 'stat-value' }, value));
    if (state) {
      const s = el('span', { class: `stat-state ${state.cls}` });
      const dot = el('span', { class: 'dot' });
      dot.setAttribute('aria-hidden', 'true');
      s.append(dot, el('span', { class: 'ico', 'aria-hidden': 'true' }, state.ico), el('span', {}, state.text));
      tile.appendChild(s);
    }
    if (note) tile.appendChild(el('span', { class: 'stat-note' }, note));
    return tile;
  }

  // ------------------------------------------------- gráfico: linha diária --
  function dailySeries(tickets) {
    const buckets = new Map();
    for (let d = filters.days - 1; d >= 0; d--) {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - d);
      buckets.set(day.getTime(), 0);
    }
    for (const t of tickets) {
      const day = new Date(t.createdAt);
      if (Number.isNaN(day.getTime())) continue;
      day.setHours(0, 0, 0, 0);
      const k = day.getTime();
      if (buckets.has(k)) buckets.set(k, buckets.get(k) + 1);
    }
    return [...buckets.entries()].map(([ts, value]) => ({ ts, value }));
  }

  function lineChart(series) {
    const plot = el('div', { class: 'mon-plot' });
    if (!series.length) {
      plot.appendChild(emptyNote('Sem chamados no período selecionado.'));
      return plot;
    }
    const W = 760, H = 230;
    const pad = { t: 16, r: 46, b: 26, l: 40 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const max = Math.max(1, ...series.map((d) => d.value));
    const ticks = niceTicks(max);
    const top = ticks[ticks.length - 1] || 1;
    const xAt = (i) => pad.l + (series.length === 1 ? iw / 2 : (i / (series.length - 1)) * iw);
    const yAt = (v) => pad.t + ih - (v / top) * ih;

    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
    s.appendChild(svg('title', {}, 'Chamados abertos por dia no período selecionado'));

    // grade + eixo de valor
    for (const tv of ticks) {
      const y = yAt(tv);
      s.appendChild(svg('line', { class: 'grid-line', x1: pad.l, x2: pad.l + iw, y1: y, y2: y }));
      s.appendChild(svg('text', { class: 'tick-text', x: pad.l - 8, y: y + 3.5, 'text-anchor': 'end' }, fmtInt(tv)));
    }
    s.appendChild(svg('line', { class: 'axis-line', x1: pad.l, x2: pad.l + iw, y1: pad.t + ih, y2: pad.t + ih }));

    // rótulos de data: primeiro, meio, último (sem poluir)
    const marks = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];
    for (const i of marks) {
      s.appendChild(
        svg('text', { class: 'tick-text', x: xAt(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle' },
          dayLabel.format(new Date(series[i].ts))),
      );
    }

    // wash 10% + linha 2px
    const line = series.map((d, i) => `${i ? 'L' : 'M'}${xAt(i)},${yAt(d.value)}`).join('');
    const area = svg('path', {
      d: `${line}L${xAt(series.length - 1)},${pad.t + ih}L${xAt(0)},${pad.t + ih}Z`,
      fill: 'var(--series-1)', opacity: '0.1',
    });
    s.appendChild(area);
    s.appendChild(svg('path', { class: 'mark-line', d: line, stroke: 'var(--series-1)' }));

    // marcador final >= 8px com anel de 2px na cor da superfície + rótulo direto
    const last = series[series.length - 1];
    s.appendChild(svg('circle', { class: 'mark-dot', cx: xAt(series.length - 1), cy: yAt(last.value), r: 4.5, fill: 'var(--series-1)' }));
    s.appendChild(svg('text', { class: 'val-text', x: xAt(series.length - 1) + 9, y: yAt(last.value) + 4 }, fmtInt(last.value)));

    const cross = svg('line', { class: 'crosshair', y1: pad.t, y2: pad.t + ih, x1: 0, x2: 0, opacity: '0' });
    s.appendChild(cross);
    plot.appendChild(s);
    const tip = tooltipFor(plot);

    // crosshair encontra o X: o leitor aponta para uma data, não para a linha
    const onMove = (ev) => {
      const box = s.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * W;
      let idx = 0, best = Infinity;
      series.forEach((d, i) => {
        const dist = Math.abs(xAt(i) - px);
        if (dist < best) { best = dist; idx = i; }
      });
      const d = series[idx];
      cross.setAttribute('x1', xAt(idx));
      cross.setAttribute('x2', xAt(idx));
      cross.setAttribute('opacity', '1');
      fillTip(tip, fullDay.format(new Date(d.ts)), [
        { value: fmtInt(d.value), name: d.value === 1 ? 'chamado' : 'chamados', color: 'var(--series-1)' },
      ]);
      showTip(plot, tip, (xAt(idx) / W) * box.width, ((yAt(d.value) / H) * box.height));
    };
    s.addEventListener('pointermove', onMove);
    s.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('opacity', '0'); });
    return plot;
  }

  // ----------------------------------------------- gráfico: barras (mag.) --
  function barChart(rows, { unitLabel = 'chamados', colorVar = 'var(--series-1)' } = {}) {
    const plot = el('div', { class: 'mon-plot' });
    if (!rows.length) {
      plot.appendChild(emptyNote('Sem dados no período selecionado.'));
      return plot;
    }
    const data = rows.slice(0, 8);
    const BAND = 30, BAR = 20; // <= 24px, e a folga da banda vira ar (>= 2px entre barras)
    const W = 760;
    const pad = { t: 6, r: 56, b: 6, l: 188 };
    const H = pad.t + pad.b + data.length * BAND;
    const iw = W - pad.l - pad.r;
    const max = Math.max(1, ...data.map((d) => d.value));

    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
    s.appendChild(svg('title', {}, `Distribuição de ${unitLabel}`));
    s.appendChild(svg('line', { class: 'axis-line', x1: pad.l, x2: pad.l, y1: pad.t, y2: H - pad.b }));

    const tip = tooltipFor(plot);
    data.forEach((d, i) => {
      const y = pad.t + i * BAND;
      const bh = BAR;
      const by = y + (BAND - bh) / 2;
      const w = Math.max(0, (d.value / max) * iw);

      // nome da categoria (tinta de texto, nunca a cor do dado)
      const label = svg('text', { class: 'cat-text', x: pad.l - 10, y: by + bh / 2 + 4, 'text-anchor': 'end' });
      label.textContent = d.key;
      s.appendChild(label);

      const bar = svg('path', { class: 'bar', d: barPathRight(pad.l, by, w, bh), fill: colorVar });
      s.appendChild(bar);

      // valor na ponta, fora da barra
      s.appendChild(svg('text', { class: 'val-text', x: pad.l + w + 8, y: by + bh / 2 + 4 }, fmtInt(d.value)));

      // alvo de clique maior que a marca (banda inteira)
      const hit = svg('rect', { class: 'hit', x: pad.l, y, width: iw + pad.r, height: BAND, tabindex: '0' });
      hit.setAttribute('role', 'img');
      hit.setAttribute('aria-label', `${d.key}: ${fmtInt(d.value)} ${unitLabel}`);
      const show = () => {
        bar.style.filter = 'brightness(1.08)';
        fillTip(tip, d.key, [{ value: fmtInt(d.value), name: unitLabel, color: colorVar }]);
        const box = s.getBoundingClientRect();
        showTip(plot, tip, ((pad.l + w) / W) * box.width, ((by + bh / 2) / H) * box.height);
      };
      const hide = () => { bar.style.filter = ''; tip.hidden = true; };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
      s.appendChild(hit);
    });

    plot.appendChild(s);
    return plot;
  }

  // ------------------------------------ figura: barra segmentada (status) --
  function segmentedPriority(openTickets) {
    const wrap = el('div');
    const total = openTickets.length;
    if (!total) {
      wrap.appendChild(emptyNote('Nenhum chamado aberto no período selecionado.'));
      return wrap;
    }
    const counts = PRIORITY_ORDER.map((p) => ({
      key: p,
      name: levelPt[p] || p,
      value: openTickets.filter((t) => t.priority === p).length,
    })).filter((d) => d.value > 0);

    const bar = el('div', { class: 'mon-seg', role: 'img' });
    bar.setAttribute(
      'aria-label',
      `Fila aberta por prioridade: ${counts.map((c) => `${c.name} ${c.value} (${Math.round((c.value / total) * 100)}%)`).join(', ')}`,
    );
    const tipHost = el('div', { class: 'mon-plot' });
    tipHost.style.marginTop = '0';
    const tip = tooltipFor(tipHost);

    for (const c of counts) {
      const share = (c.value / total) * 100;
      const st = PRIORITY_STATE[c.key];
      const part = el('div', { class: `part${st.onLight ? ' on-light' : ''}`, tabindex: '0' });
      part.style.flex = `${c.value} 1 0`;
      part.style.background = st.token;
      // só imprime dentro se há largura confortável; senão o valor vive no tooltip/tabela
      if (share >= 12) part.textContent = `${Math.round(share)}%`;
      part.setAttribute('aria-label', `${c.name}: ${fmtInt(c.value)} chamados, ${Math.round(share)}%`);
      const show = () => {
        fillTip(tip, c.name, [{ value: `${fmtInt(c.value)} · ${Math.round(share)}%`, name: 'abertos', color: st.token }]);
        const hb = bar.getBoundingClientRect(), pb = part.getBoundingClientRect();
        showTip(tipHost, tip, pb.left - hb.left + pb.width / 2, 0);
      };
      part.addEventListener('pointerenter', show);
      part.addEventListener('focus', show);
      part.addEventListener('pointerleave', () => { tip.hidden = true; });
      part.addEventListener('blur', () => { tip.hidden = true; });
      bar.appendChild(part);
    }

    // legenda na ordem dos blocos, com ícone + rótulo (status nunca é só cor)
    const legend = el('div', { class: 'mon-legend' });
    for (const c of counts) {
      const st = PRIORITY_STATE[c.key];
      const item = el('span', { class: `item ${st.cls}` });
      const sw = el('span', { class: 'swatch' });
      sw.style.background = st.token;
      sw.setAttribute('aria-hidden', 'true');
      item.append(sw, el('span', { class: 'ico', 'aria-hidden': 'true' }, st.ico), el('span', {}, c.name));
      legend.appendChild(item);
    }

    wrap.append(bar, tipHost, legend);
    return wrap;
  }

  // ------------------------------------------------------------- render -----
  function buildShell() {
    const view = $('#view-monitoring');
    view.replaceChildren();

    const header = el('div', { class: 'page-header' });
    const left = el('div');
    const eyebrow = el('div', { class: 'eyebrow' });
    eyebrow.appendChild(el('span', { class: 'eyebrow-line' }));
    eyebrow.appendChild(document.createTextNode(' OPERAÇÃO E DISPONIBILIDADE'));
    left.append(eyebrow, el('h1', {}, 'Monitoramento'), el('p', { class: 'page-subtitle' }, 'Volume, prioridade e distribuição territorial dos chamados, no recorte selecionado.'));
    header.appendChild(left);
    view.appendChild(header);

    // filtros: uma linha, acima de tudo, período primeiro
    const bar = el('div', { class: 'mon-filters' });
    const perLabel = el('label', {}, 'Período');
    const per = el('select', { id: 'mon-days' });
    for (const [v, t] of [[7, 'Últimos 7 dias'], [30, 'Últimos 30 dias'], [90, 'Últimos 90 dias']]) {
      const o = el('option', { value: String(v) }, t);
      if (v === filters.days) o.selected = true;
      per.appendChild(o);
    }
    perLabel.appendChild(per);

    const uniLabel = el('label', {}, 'Unidade');
    const uni = el('select', { id: 'mon-locality' });
    const units = [...new Set(store.tickets.map((t) => t.locality || 'Não informada'))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    uni.appendChild(el('option', { value: 'ALL' }, 'Todas as unidades'));
    for (const u of units) {
      const o = el('option', { value: u });
      o.textContent = u;
      if (u === filters.locality) o.selected = true;
      uni.appendChild(o);
    }
    uniLabel.appendChild(uni);

    const refresh = el('button', { class: 'button button-secondary mon-spacer', type: 'button', id: 'mon-refresh' }, 'Atualizar');

    bar.append(perLabel, uniLabel, refresh);
    view.appendChild(bar);

    view.appendChild(el('div', { class: 'mon-kpis', id: 'mon-kpis' }));
    view.appendChild(el('div', { class: 'mon-grid', id: 'mon-grid' }));

    per.addEventListener('change', () => { filters.days = Number(per.value); paint(); });
    uni.addEventListener('change', () => { filters.locality = uni.value; paint(); });
    refresh.addEventListener('click', async () => {
      if (refresh.getAttribute('aria-busy') === 'true') return; // evita recargas empilhadas
      refresh.setAttribute('aria-busy', 'true');
      refresh.disabled = true;
      try {
        await load(true);
      } finally {
        refresh.removeAttribute('aria-busy');
        refresh.disabled = false;
      }
    });
  }

  function paint() {
    const { tickets, incidents } = sliced();
    const open = tickets.filter(isOpen);
    const high = open.filter((t) => t.priority === 'HIGH' || t.priority === 'CRITICAL');

    // ---- stat tiles (um único hero) ----
    const kpis = $('#mon-kpis');
    kpis.replaceChildren();
    kpis.appendChild(statTile({
      label: 'Chamados abertos', value: fmtInt(open.length), hero: true,
      note: `de ${fmtInt(tickets.length)} no período`,
    }));
    kpis.appendChild(statTile({
      label: 'Alta ou crítica', value: fmtInt(high.length),
      state: high.length
        ? { cls: 'state-critical', ico: '▲', text: 'exige atenção' }
        : { cls: 'state-good', ico: '✓', text: 'sem pendência' },
    }));
    kpis.appendChild(statTile({
      label: 'Possíveis incidentes', value: fmtInt(incidents.length),
      state: incidents.length
        ? { cls: 'state-serious', ico: '●', text: 'em investigação' }
        : { cls: 'state-good', ico: '✓', text: 'nenhum detectado' },
    }));
    const share = tickets.length ? Math.round((open.length / tickets.length) * 100) : 0;
    kpis.appendChild(statTile({
      label: 'Ainda em aberto', value: `${share}%`,
      note: filters.locality === 'ALL' ? 'Todas as unidades' : filters.locality,
    }));

    // ---- gráficos ----
    const grid = $('#mon-grid');
    grid.replaceChildren();

    // 1. volume diário (linha, série única -> sem legenda)
    const series = dailySeries(tickets);
    const c1 = card({ title: 'Chamados por dia', subtitle: `Volume diário nos últimos ${filters.days} dias`, wide: true });
    c1.appendChild(lineChart(series));
    c1.appendChild(tableView(['Dia', 'Chamados'], series.map((d) => [fullDay.format(new Date(d.ts)), fmtInt(d.value)])));
    grid.appendChild(c1);

    // 2. fila aberta por prioridade (um todo repartido -> status)
    const c2 = card({ title: 'Fila aberta por prioridade', subtitle: 'Participação de cada prioridade no que está aberto' });
    c2.appendChild(segmentedPriority(open));
    c2.appendChild(tableView(
      ['Prioridade', 'Abertos', '%'],
      PRIORITY_ORDER.map((p) => {
        const n = open.filter((t) => t.priority === p).length;
        return [levelPt[p] || p, fmtInt(n), open.length ? `${Math.round((n / open.length) * 100)}%` : '0%'];
      }),
    ));
    grid.appendChild(c2);

    // 3. por categoria (magnitude -> uma cor só)
    const byCat = countBy(tickets, (t) => categoryPt[t.category] || t.category || 'Outros');
    const c3 = card({ title: 'Chamados por categoria', subtitle: 'Onde a demanda se concentra' });
    c3.appendChild(barChart(byCat, { unitLabel: 'chamados', colorVar: 'var(--series-1)' }));
    c3.appendChild(tableView(['Categoria', 'Chamados'], byCat.map((d) => [d.key, fmtInt(d.value)])));
    grid.appendChild(c3);

    // 4. por unidade (magnitude -> uma cor só)
    const byUnit = countBy(tickets, (t) => t.locality || 'Não informada');
    const c4 = card({ title: 'Chamados por unidade', subtitle: 'Oito maiores volumes no período', wide: true });
    c4.appendChild(barChart(byUnit, { unitLabel: 'chamados', colorVar: 'var(--series-1)' }));
    c4.appendChild(tableView(['Unidade', 'Chamados'], byUnit.map((d) => [d.key, fmtInt(d.value)])));
    grid.appendChild(c4);
  }

  async function load(isRefresh = false) {
    const grid = $('#mon-grid');
    if (isRefresh && grid) grid.dataset.loading = 'true'; // mantém o quadro durante a recarga
    const view = $('#view-monitoring');
    // Placeholder só na primeira carga. Nas seguintes o quadro anterior fica no
    // lugar até os dados novos chegarem — sem skeleton piscando.
    if (!isRefresh && view && !view.firstElementChild) {
      view.innerHTML = '<div class="view-loading">Carregando monitoramento…</div>';
    }
    if (isRefresh && grid) grid.setAttribute('aria-busy', 'true');
    try {
      const [tickets, incidents] = await Promise.all([api('/api/tickets'), api('/api/incidents')]);
      store.tickets = Array.isArray(tickets) ? tickets : [];
      store.incidents = Array.isArray(incidents) ? incidents : [];
      if (isRefresh) {
        paint();
      } else {
        buildShell();
        paint();
      }
    } catch (e) {
      toast(e.message);
      if (!isRefresh) {
        buildShell();
        paint();
      }
    } finally {
      const g = $('#mon-grid');
      if (g) {
        delete g.dataset.loading;
        g.removeAttribute('aria-busy');
      }
    }
  }

  function renderMonitoring() {
    void load(false);
  }

  return { renderMonitoring };
}
