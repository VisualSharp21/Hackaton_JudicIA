/**
 * Diagnóstico de audiência virtual (ferramenta run_meet_check) — roda no navegador.
 *
 * Verifica: link da sala do Google Meet, permissões do navegador, microfone (nível de voz
 * captado em 3 s), câmera (abre o vídeo e lê a resolução), latência real até o servidor
 * central (ida e volta HTTP) e a telemetria Zabbix do link da comarca — esta última
 * SIMULADA neste ambiente de demonstração (não há Zabbix integrado) e marcada como tal no laudo.
 *
 * Gera o laudo `pulso-meet-check-1`, que o servidor valida e recalcula.
 */

export const MEET_REPORT_SCHEMA = 'pulso-meet-check-1';
const MEET_URL = /https?:\/\/meet\.google\.com\/(?:lookup\/)?([a-z0-9][a-z0-9-]{2,60})/i;
const MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
const SATELLITE_LINKS = ['breves', 'soure', 'afua', 'portel', 'melgaco', 'chaves', 'curralinho', 'anajas', 'jacareacanga'];

export function parseMeetLink(input = '') {
  const text = String(input || '').trim();
  const match = text.match(MEET_URL);
  if (match) {
    const code = match[1].toLowerCase();
    return { url: `https://meet.google.com/${code}`, codigo: code, codigoPadrao: MEET_CODE.test(code) };
  }
  const bare = text.match(/\b([a-z]{3}-[a-z]{4}-[a-z]{3})\b/i);
  if (bare) return { url: `https://meet.google.com/${bare[1].toLowerCase()}`, codigo: bare[1].toLowerCase(), codigoPadrao: true };
  return text ? { url: null, codigo: text.slice(0, 80), codigoPadrao: false } : null;
}

function errorStatus(error) {
  const name = error?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'negado';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'ausente';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'ocupado';
  return 'falha';
}

async function permissionState(name) {
  try {
    const result = await navigator.permissions.query({ name });
    return ['granted', 'denied', 'prompt'].includes(result.state) ? result.state : 'unknown';
  } catch {
    return 'unknown';
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Mede o nível do microfone por `durationMs`; chama onLevel(pct) a cada quadro. */
async function testMicrophone({ durationMs = 3000, onLevel = () => {} } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) return { status: 'falha', erro: 'getUserMedia indisponível', detalhe: 'Navegador sem suporte a captura de mídia.' };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (error) {
    return { status: errorStatus(error), erro: error.name || 'Erro', detalhe: error.message || '' };
  }
  const track = stream.getAudioTracks()[0];
  let peak = 0;
  let context;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    context = new AudioCtx();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const end = performance.now() + durationMs;
    while (performance.now() < end) {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const sample of data) sum += sample * sample;
      const rms = Math.sqrt(sum / data.length);
      // ~ -60 dBFS (silêncio) a ~ -10 dBFS (voz forte) mapeados para 0–100%.
      const db = 20 * Math.log10(Math.max(rms, 1e-6));
      const pct = Math.max(0, Math.min(100, Math.round(((db + 60) / 50) * 100)));
      peak = Math.max(peak, pct);
      onLevel(pct);
      await sleep(50);
    }
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    await context?.close().catch(() => {});
    onLevel(0);
  }
  const voice = peak >= 12;
  return {
    status: voice ? 'ok' : 'mudo',
    dispositivo: track?.label || 'Microfone',
    picoPct: peak,
    detalhe: voice ? 'Voz captada durante o teste.' : 'O microfone abriu, mas não captou voz (mudo, dispositivo errado ou volume zerado).',
  };
}

/** Abre a câmera, mostra a prévia em `videoEl` por `durationMs` e lê a resolução. */
async function testCamera({ videoEl = null, durationMs = 2500 } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) return { status: 'falha', erro: 'getUserMedia indisponível', detalhe: 'Navegador sem suporte a captura de mídia.' };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (error) {
    return { status: errorStatus(error), erro: error.name || 'Erro', detalhe: error.message || '' };
  }
  const track = stream.getVideoTracks()[0];
  try {
    if (videoEl) {
      videoEl.srcObject = stream;
      await videoEl.play().catch(() => {});
    }
    await sleep(durationMs);
    const settings = track?.getSettings?.() || {};
    const live = track?.readyState === 'live' && !track.muted;
    return {
      status: live ? 'ok' : 'falha',
      dispositivo: track?.label || 'Câmera',
      resolucao: settings.width && settings.height ? `${settings.width}x${settings.height}` : null,
      detalhe: live ? 'Imagem recebida da câmera.' : 'A câmera abriu, mas não entregou imagem.',
    };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    if (videoEl) videoEl.srcObject = null;
  }
}

/** Latência real estação ➔ servidor central (ida e volta HTTP, sem banco). */
async function testNetwork({ base = window.pulsoApiBase || window.location.origin, samples = 6, timeoutMs = 2000 } = {}) {
  const times = [];
  let lost = 0;
  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    try {
      const res = await fetch(`${base}/api/copilot/ping?n=${i}&t=${Date.now()}`, { cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(String(res.status));
      await res.json();
      times.push(performance.now() - started);
    } catch {
      lost++;
    }
    await sleep(120);
  }
  if (!times.length) return { status: 'falha', latenciaMs: null, jitterMs: null, perdaPct: 100, amostras: samples, destino: 'servidor central' };
  const sorted = [...times].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const jitter = times.length > 1 ? times.slice(1).reduce((acc, t, i) => acc + Math.abs(t - times[i]), 0) / (times.length - 1) : 0;
  const loss = Math.round((lost / samples) * 1000) / 10;
  const degraded = loss > 2 || median > 150 || jitter > 30;
  return { status: degraded ? 'degradada' : 'ok', latenciaMs: Math.round(median * 10) / 10, jitterMs: Math.round(jitter * 10) / 10, perdaPct: loss, amostras: samples, destino: 'servidor central' };
}

/**
 * Telemetria do link da comarca (Zabbix) — SIMULADA. Em "auto", comarcas com link via
 * satélite oscilam; as demais ficam estáveis. Os modos forçados servem para demonstração.
 */
export function simulateZabbix(comarca = 'Belém', mode = 'auto') {
  const name = String(comarca || 'Belém');
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^comarca de\s+/, '');
  const jitterRand = (base, spread) => Math.max(0, Math.round((base + (Math.random() * 2 - 1) * spread) * 10) / 10);
  let profile = SATELLITE_LINKS.some((s) => slug.includes(s)) ? 'unstable' : 'stable';
  if (mode !== 'auto') profile = mode;
  const values = {
    stable: { lat: jitterRand(22, 6), loss: 0, jit: jitterRand(4, 2) },
    unstable: { lat: jitterRand(110, 25), loss: jitterRand(7, 2), jit: jitterRand(28, 6) },
    critical: { lat: jitterRand(210, 30), loss: jitterRand(17, 3), jit: jitterRand(55, 10) },
  }[profile] || { lat: 22, loss: 0, jit: 4 };
  const status = profile === 'critical' ? 'CRITICAL' : profile === 'unstable' ? 'WARNING' : 'OPTIMAL';
  return {
    simulado: true,
    comarca: name,
    host: `gw-${slug.replace(/[^a-z0-9]/g, '')}.tjpa.jus.br`,
    status,
    latenciaMs: values.lat,
    perdaPct: values.loss,
    jitterMs: values.jit,
    gatilho: status === 'OPTIMAL' ? 'Link nominal, sem perda de pacotes' : `Perda de pacotes de ${values.loss}% e jitter de ${values.jit} ms no link da comarca`,
  };
}

function browserName() {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Microsoft Edge';
  if (/Chrome\//.test(ua)) return 'Google Chrome';
  if (/Firefox\//.test(ua)) return 'Mozilla Firefox';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'Navegador';
}

/** Veredito local (o servidor recalcula com as mesmas regras). */
export function localVerdict(report) {
  const blocking = [report.microfone.status, report.camera.status].some((s) => ['negado', 'ausente', 'falha', 'ocupado'].includes(s)) || report.rede.status === 'falha' || report.zabbix?.status === 'CRITICAL' || !report.navegador.contextoSeguro;
  const warning = report.microfone.status === 'mudo' || report.rede.status === 'degradada' || report.zabbix?.status === 'WARNING' || (report.sala.url && !report.sala.codigoPadrao);
  return blocking ? 'BLOQUEADA' : warning ? 'ATENCAO' : 'PRONTA';
}

/**
 * Executa o diagnóstico completo. `onStep(etapa, estado, detalhe)` informa o progresso para
 * a interface; `onLevel(pct)` alimenta o medidor do microfone; `videoEl` recebe a prévia.
 */
export async function runMeetDiagnostics({ meetUrl = '', runId = null, comarca = 'Belém', zabbixMode = 'auto', videoEl = null, onStep = () => {}, onLevel = () => {} } = {}) {
  const sala = parseMeetLink(meetUrl) || { url: null, codigo: null, codigoPadrao: false };
  onStep('sala', sala.url ? (sala.codigoPadrao ? 'ok' : 'atencao') : 'na', sala.url ? sala.url : 'Sem link informado');
  const permissoes = { camera: await permissionState('camera'), microfone: await permissionState('microphone') };
  const contextoSeguro = window.isSecureContext !== false;

  onStep('microfone', 'executando', 'Fale algo perto do microfone por 3 segundos…');
  const microfone = await testMicrophone({ onLevel });
  onStep('microfone', microfone.status === 'ok' ? 'ok' : microfone.status === 'mudo' ? 'atencao' : 'falha', microfone.detalhe || microfone.erro);

  onStep('camera', 'executando', 'Abrindo a câmera…');
  const camera = await testCamera({ videoEl });
  onStep('camera', camera.status === 'ok' ? 'ok' : 'falha', camera.detalhe || camera.erro);

  onStep('rede', 'executando', 'Medindo a latência até o servidor central…');
  const rede = await testNetwork();
  onStep('rede', rede.status === 'ok' ? 'ok' : rede.status === 'degradada' ? 'atencao' : 'falha', rede.latenciaMs !== null ? `${rede.latenciaMs} ms · perda ${rede.perdaPct}%` : 'Servidor central inacessível');

  onStep('zabbix', 'executando', 'Consultando a telemetria do link da comarca…');
  await sleep(500);
  const zabbix = simulateZabbix(comarca, zabbixMode);
  onStep('zabbix', zabbix.status === 'OPTIMAL' ? 'ok' : zabbix.status === 'WARNING' ? 'atencao' : 'falha', `${zabbix.latenciaMs} ms · perda ${zabbix.perdaPct}% (simulado)`);

  const report = {
    schema: MEET_REPORT_SCHEMA,
    runId,
    executadoEm: new Date().toISOString(),
    sala,
    navegador: { nome: browserName(), contextoSeguro, permissoes: { camera: camera.status === 'negado' ? 'denied' : permissoes.camera, microfone: microfone.status === 'negado' ? 'denied' : permissoes.microfone } },
    microfone,
    camera,
    rede,
    zabbix,
  };
  report.veredito = localVerdict(report);
  return report;
}
