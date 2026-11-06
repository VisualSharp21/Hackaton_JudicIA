/**
 * Laudo do diagnóstico de audiência (run_meet_check), gerado no navegador pelo módulo
 * public/js/meet-diagnostics.js. O servidor normaliza o JSON recebido (tipos, enums e
 * tamanhos), recalcula o veredito e liga cada falha ao procedimento da base que a corrige.
 */
import { getProcedure, stepsForOs } from './data-loader.js';

export const MEET_REPORT_SCHEMA = 'pulso-meet-check-1';
const DEVICE_STATUS = ['ok', 'mudo', 'falha', 'negado', 'ocupado', 'ausente', 'nao_testado'];
const PERMISSIONS = ['granted', 'denied', 'prompt', 'unknown'];
const NET_STATUS = ['ok', 'degradada', 'falha', 'nao_testado'];

const str = (value, max = 200) => (value === undefined || value === null ? null : String(value).slice(0, max));
const num = (value, min = 0, max = 100000) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 10) / 10)) : null;
};
const oneOf = (value, list, fallback) => (list.includes(value) ? value : fallback);

/** Normaliza o laudo vindo do navegador; lança erro se não for um laudo reconhecível. */
export function sanitizeMeetReport(input) {
  if (!input || typeof input !== 'object' || input.schema !== MEET_REPORT_SCHEMA) throw new Error('Laudo do teste de audiência inválido.');
  const mic = input.microfone || {};
  const cam = input.camera || {};
  const net = input.rede || {};
  const zbx = input.zabbix || null;
  const report = {
    schema: MEET_REPORT_SCHEMA,
    runId: str(input.runId, 40),
    executadoEm: str(input.executadoEm, 40),
    sala: { url: str(input.sala?.url, 300), codigo: str(input.sala?.codigo, 80), codigoPadrao: input.sala?.codigoPadrao === true },
    navegador: {
      nome: str(input.navegador?.nome, 80),
      contextoSeguro: input.navegador?.contextoSeguro !== false,
      permissoes: {
        camera: oneOf(input.navegador?.permissoes?.camera, PERMISSIONS, 'unknown'),
        microfone: oneOf(input.navegador?.permissoes?.microfone, PERMISSIONS, 'unknown'),
      },
    },
    microfone: { status: oneOf(mic.status, DEVICE_STATUS, 'nao_testado'), dispositivo: str(mic.dispositivo, 120), picoPct: num(mic.picoPct, 0, 100), erro: str(mic.erro, 60), detalhe: str(mic.detalhe, 240) },
    camera: { status: oneOf(cam.status, DEVICE_STATUS, 'nao_testado'), dispositivo: str(cam.dispositivo, 120), resolucao: str(cam.resolucao, 20), erro: str(cam.erro, 60), detalhe: str(cam.detalhe, 240) },
    rede: { status: oneOf(net.status, NET_STATUS, 'nao_testado'), latenciaMs: num(net.latenciaMs), jitterMs: num(net.jitterMs), perdaPct: num(net.perdaPct, 0, 100), amostras: num(net.amostras, 0, 50), destino: str(net.destino, 80) },
    zabbix: zbx
      ? { simulado: zbx.simulado !== false, comarca: str(zbx.comarca, 80), host: str(zbx.host, 120), status: oneOf(zbx.status, ['OPTIMAL', 'WARNING', 'CRITICAL'], 'WARNING'), latenciaMs: num(zbx.latenciaMs), perdaPct: num(zbx.perdaPct, 0, 100), jitterMs: num(zbx.jitterMs), gatilho: str(zbx.gatilho, 200) }
      : null,
  };
  return report;
}

function steps(procedureId, family) {
  const procedure = getProcedure(procedureId);
  if (!procedure) return null;
  const list = stepsForOs(procedure, family);
  return list ? { procedureId, titulo: procedure.titulo, fonte: procedure.fonte, passos: list } : null;
}

/** Veredito e falhas do laudo, cada uma com a correção da base procedural. */
export function assessMeetReport(report, family = 'windows') {
  const falhas = [];
  const add = (item, problema, procedureId, gravidade = 'bloqueante') => falhas.push({ item, problema, gravidade, correcao: steps(procedureId, family) });
  const permissionDenied = report.navegador.permissoes.microfone === 'denied' || report.navegador.permissoes.camera === 'denied';

  if (report.sala.url && !report.sala.codigoPadrao)
    falhas.push({ item: 'sala', problema: `O código da sala (${report.sala.codigo}) não segue o padrão do Google Meet (xxx-yyyy-zzz). Confirme o link com a secretaria da vara.`, gravidade: 'atencao', correcao: null });
  if (!report.navegador.contextoSeguro)
    falhas.push({ item: 'navegador', problema: 'A página não está em contexto seguro (HTTPS); o navegador bloqueia câmera e microfone.', gravidade: 'bloqueante', correcao: null });

  const mic = report.microfone;
  if (mic.status === 'negado' || (permissionDenied && mic.status !== 'ok')) add('microfone', 'O navegador bloqueou o acesso ao microfone.', 'meet-permissao');
  else if (mic.status === 'ausente') add('microfone', 'Nenhum microfone foi encontrado (verifique o viva-voz USB/Jabra).', 'meet-microfone');
  else if (mic.status === 'mudo') add('microfone', `O microfone ${mic.dispositivo ? `"${mic.dispositivo}" ` : ''}não captou voz durante o teste (pico de ${mic.picoPct ?? 0}%).`, 'meet-microfone');
  else if (mic.status === 'falha' || mic.status === 'ocupado') add('microfone', `Falha ao abrir o microfone${mic.erro ? ` (${mic.erro})` : ''}.`, 'meet-microfone');

  const cam = report.camera;
  if (cam.status === 'negado' || (permissionDenied && cam.status !== 'ok' && mic.status !== 'negado')) add('camera', 'O navegador bloqueou o acesso à câmera.', 'meet-permissao');
  else if (cam.status === 'ocupado') add('camera', 'A câmera está em uso por outro aplicativo ou aba (Teams, Zoom, outra sala do Meet).', 'meet-camera');
  else if (cam.status === 'ausente') add('camera', 'Nenhuma câmera foi encontrada.', 'meet-camera');
  else if (cam.status === 'falha') add('camera', `Falha ao abrir a câmera${cam.erro ? ` (${cam.erro})` : ''}.`, 'meet-camera');

  const net = report.rede;
  const zbx = report.zabbix;
  const netDegraded = net.status === 'falha' || net.status === 'degradada' || (net.perdaPct ?? 0) > 2 || (net.latenciaMs ?? 0) > 150;
  const zbxDegraded = zbx && zbx.status !== 'OPTIMAL';
  if (netDegraded || zbxDegraded) {
    const parts = [];
    if (netDegraded) parts.push(`latência até o servidor central de ${net.latenciaMs ?? '—'} ms com ${net.perdaPct ?? 0}% de perda`);
    if (zbxDegraded) parts.push(`telemetria da comarca${zbx.simulado ? ' (simulada)' : ''}: ${zbx.gatilho || `perda ${zbx.perdaPct}%`}`);
    add('rede', `Rede instável — ${parts.join('; ')}.`, 'meet-conexao', net.status === 'falha' || zbx?.status === 'CRITICAL' ? 'bloqueante' : 'atencao');
  }

  const blocking = falhas.some((f) => f.gravidade === 'bloqueante');
  const veredito = blocking ? 'BLOQUEADA' : falhas.length ? 'ATENCAO' : 'PRONTA';
  const resumo = veredito === 'PRONTA'
    ? 'Câmera, microfone e rede aprovados: sala pronta para a audiência.'
    : `${veredito === 'BLOQUEADA' ? 'Impedimento' : 'Atenção'}: ${falhas.map((f) => f.problema).join(' ')}`;
  return { veredito, falhas, resumo };
}

/** Texto compacto do laudo para o chamado do GLPI. */
export function meetReportLines(report) {
  if (!report) return [];
  const permission = (value) => ({ granted: 'permitida', denied: 'negada', prompt: 'não decidida', unknown: 'não informada' })[value] || value;
  const lines = [
    `Veredito: ${report.veredito} — ${report.resumo}`,
    `Sala: ${report.sala.url || 'não informada'}${report.sala.url ? ` (código ${report.sala.codigoPadrao ? 'no padrão' : 'fora do padrão'})` : ''}`,
    `Microfone: ${report.microfone.status}${report.microfone.dispositivo ? ` · ${report.microfone.dispositivo}` : ''}${report.microfone.picoPct !== null ? ` · pico ${report.microfone.picoPct}%` : ''}${report.microfone.erro ? ` · erro ${report.microfone.erro}` : ''}`,
    `Câmera: ${report.camera.status}${report.camera.dispositivo ? ` · ${report.camera.dispositivo}` : ''}${report.camera.resolucao ? ` · ${report.camera.resolucao}` : ''}${report.camera.erro ? ` · erro ${report.camera.erro}` : ''}`,
    `Permissões do navegador: câmera ${permission(report.navegador.permissoes.camera)}, microfone ${permission(report.navegador.permissoes.microfone)}`,
    `Rede até o servidor central: ${report.rede.status}${report.rede.latenciaMs !== null ? ` · latência ${report.rede.latenciaMs} ms` : ''}${report.rede.jitterMs !== null ? ` · jitter ${report.rede.jitterMs} ms` : ''}${report.rede.perdaPct !== null ? ` · perda ${report.rede.perdaPct}%` : ''}`,
  ];
  if (report.zabbix)
    lines.push(`Telemetria da comarca${report.zabbix.simulado ? ' (simulada)' : ''} ${report.zabbix.comarca || ''}: ${report.zabbix.status} · latência ${report.zabbix.latenciaMs} ms · perda ${report.zabbix.perdaPct}%`);
  lines.push(`Executado em: ${report.executadoEm || 'não informado'}`);
  return lines;
}
