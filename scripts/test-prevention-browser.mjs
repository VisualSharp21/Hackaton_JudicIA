import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// Uses an already running, isolated headless Chromium CDP instance on 9223.
const demoFile = path.resolve('.demo', `browser-test-${Date.now()}.sqlite`);
await fs.mkdir(path.dirname(demoFile), { recursive: true });
const server = spawn(process.execPath, ['scripts/demo-hearings.mjs'], { env: { ...process.env, DEMO_PORT: '0', DEMO_STATE_FILE: demoFile }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let socket; let target;
try {
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Demo server startup timeout')), 15000);
    server.stdout.on('data', (chunk) => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); resolve(match[0]); } });
    server.on('exit', (code) => { clearTimeout(timeout); reject(new Error(`Demo server exited: ${code}`)); });
  });
  target = await (await fetch('http://127.0.0.1:9223/json/new?' + encodeURIComponent(base), { method: 'PUT' })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map(); const exceptions = []; let sequence = 0;
  socket.onmessage = (event) => { const data = JSON.parse(event.data); if (data.method === 'Runtime.exceptionThrown') exceptions.push(data.params.exceptionDetails.text); if (data.id) { const waiter = pending.get(data.id); pending.delete(data.id); if (data.error) waiter.reject(new Error(data.error.message)); else waiter.resolve(data.result); } };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  await call('Runtime.enable'); await call('Page.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false }); await call('Page.navigate', { url: base });
  async function until(expression) { for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error('Browser condition timed out: ' + expression); }
  await until('document.querySelectorAll(".hearing-card").length === 7');
  await until('document.body.textContent.includes("PRONTA") && document.body.textContent.includes("ATENÇÃO")');
  assert.equal(await evaluate('document.body.textContent.includes("Importar JSON")'), false);
  await evaluate('document.querySelector(".hearing-card[data-state=ATENÇÃO] [data-hearing-action=details]").click()');
  await until('document.querySelector("#hearing-details").textContent.includes("Precedente encontrado")');
  assert.ok(await evaluate('location.pathname.startsWith("/audiencias/")'));
  assert.ok(await evaluate('document.querySelector("#hearing-details").textContent.includes("Microfone detectado")'));
  assert.ok(await evaluate('document.querySelector("#hearing-details").textContent.includes("Verificação preventiva iniciada automaticamente")'));
  await evaluate('document.querySelector("[data-hearing-action=assist]").click()');
  await until('document.querySelector("#hearing-copilot-result").textContent.includes("determinísticas")');
  await call('Page.reload');
  await until('document.querySelector("#hearing-details")?.textContent.includes("Checklist de prontidão")');
  await evaluate('document.querySelector("[data-hearing-action=back]").click(); document.querySelector("[data-hearing-action=tour-start]").click()');
  await until('document.querySelector("#hearing-tour").textContent.includes("1/6")');
  await until('document.querySelector("#hearing-operations").textContent.includes("2 audiências associadas")');
  assert.ok(await evaluate('document.querySelector("#hearing-notices").textContent.includes("Instabilidade de rede")'));
  await evaluate('document.querySelector("[data-hearing-action=tour-close]").click(); document.querySelector("#hearing-operations [data-hearing-action=details]").click()');
  await until('document.querySelector("#hearing-details").textContent.includes("Plano de contingência")');
  await evaluate(`(() => { const f=document.querySelector('[data-operations-form=step]'); f.closest('details').open=true; f.elements.responsible.value='TIC DEMO'; f.elements.status.value='DONE'; f.elements.evidence.value='SIMULACAO: responsavel local confirmou disponibilidade.'; f.requestSubmit(); })()`);
  await until('document.querySelector("#hearing-details").textContent.includes("responsavel local confirmou")');
  await evaluate(`(() => { const f=document.querySelector('[data-operations-form=close]'); f.closest('details').open=true; f.elements.resolution.value='SIMULACAO: contingencia de rede confirmada pela equipe.'; f.requestSubmit(); })()`);
  await until('document.querySelector("#hearing-details").textContent.includes("Rascunho para revisão")');
  await evaluate(`(() => { const f=document.querySelector('[data-operations-form=review]'); f.closest('details').open=true; f.elements.reviewNote.value='Evidencias conferidas pela equipe DEMO.'; f.requestSubmit(); })()`);
  await until('document.querySelector("#hearing-details").textContent.includes("Relatório pós-incidente · Revisado")');
  await evaluate('document.querySelector("[data-hearing-action=back]").click(); document.querySelector("[data-hearing-action=executive]").click()');
  await until('document.querySelector("#operations-report-dialog").open');
  assert.ok(await evaluate('document.querySelector("#operations-report-content").textContent.includes("REAL")'));
  await evaluate('document.querySelector("#operations-report-dialog [data-close-dialog]").click(); document.querySelector("[data-hearing-action=support-registry]").click()');
  await until('document.querySelector("#support-registry-dialog").open');
  assert.ok(await evaluate('document.querySelector("#support-registry-content").textContent.includes("Radar de certificados")'));
  await evaluate('document.querySelector("#support-registry-dialog [data-close-dialog]").click()');
  const screenshot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await fs.writeFile('.demo/central-desktop.png', Buffer.from(screenshot.data, 'base64'));
  await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  const mobile = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await fs.writeFile('.demo/central-mobile.png', Buffer.from(mobile.data, 'base64'));
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), true, 'Overflow horizontal no celular');
  assert.deepEqual(exceptions, []);
  console.log('PASS Chrome headless: SSE, detalhes, Copilot, roteiro DEMO, ocorrência coletiva, contingência, encerramento/revisão, relatório executivo, radar e layout desktop/mobile; nenhuma exceção JS.');
} finally {
  socket?.close();
  if (target?.id) await fetch(`http://127.0.0.1:9223/json/close/${target.id}`).catch(() => {});
  server.kill();
}
