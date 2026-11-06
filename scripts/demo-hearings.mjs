import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sqliteStore } from '../src/prevention/sqlite-store.js';
import { createServices } from '../src/prevention/runtime.js';
import { ensureDemoAgenda } from '../src/prevention/demo.js';
import { handlePreventionRoute } from '../src/prevention/routes.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store = sqliteStore(process.env.DEMO_STATE_FILE || path.join(root, 'data', 'hearings-demo.sqlite'));
let config = await store.get('settings', 'demo-clock');
if (!config) {
  config = { id: 'demo-clock', realStartedAt: Date.now(), virtualStartedAt: Date.now(), speed: 30 };
  await store.transaction((tx) => tx.put('settings', config));
}
const clock = () => config.virtualStartedAt + (Date.now() - config.realStartedAt) * config.speed;
const services = createServices(store, { clock });
await store.transaction(async (tx) => { for (const h of await tx.list('hearing')) await tx.put('hearing', h); });
const user = { id: 'demo-tic', role: 'tic' };
async function seedDemo() { await ensureDemoAgenda(services, true); }
await seedDemo();
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
async function bodyJson(req, max = 12000) { let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > max) throw new Error('Corpo excede limite.'); } return raw ? JSON.parse(raw) : {}; }
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JUDICI.A · Central DEMO</title><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/hearings.css"></head><body style="background:#f4f7fa"><main style="max-width:1200px;margin:auto;padding:32px"><section id="view-hearings"></section><p id="demo-message" role="status"></p></main><script type="module">
import { createHearingsPage } from '/pages/hearings.js';
window.judiciaApiBase = location.origin;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const api = async (p,o={}) => { const r=await fetch(p,{...o,headers:{'Content-Type':'application/json',...o.headers}}); const d=await r.json(); if(!r.ok)throw new Error(d.error);return d; };
const page=createHearingsPage({$:s=>document.querySelector(s),api,esc,state:{currentUser:{id:'demo-tic',role:'tic'}},toast:s=>document.querySelector('#demo-message').textContent=s,demo:true});
page.mount().catch(e=>document.querySelector('#demo-message').textContent=e.message);
</script></body></html>`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const host = String(req.headers.host || '');
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) return send(res, 403, { error: 'Host não autorizado.' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}`) return send(res, 403, { error: 'Origem não autorizada.' });
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['content-type'] !== 'application/json') return send(res, 403, { error: 'JSON obrigatório.' });
    if (url.pathname === '/api/demo/new-cycle' && req.method === 'POST') {
      for (const h of await store.list('hearing')) if (h.lifecycle === 'ATIVA') await services.agenda.end(h.id, 'CONCLUÍDA', user.id);
      await store.transaction((tx) => tx.put('settings', { id: 'preventive-demo', expiresAt: 0 }));
      await seedDemo(); return send(res, 201, { created: true });
    }
    if (url.pathname === '/' || /^\/audiencias(?:\/[^/]+)?\/?$/.test(url.pathname)) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(html); }
    const staticFiles = new Map([['/styles.css', 'text/css'], ['/hearings.css', 'text/css'], ['/pages/hearings.js', 'text/javascript'], ['/pages/hearing-details.js', 'text/javascript'], ['/pages/prevention-operations.js', 'text/javascript']]);
    if (staticFiles.has(url.pathname)) { res.writeHead(200, { 'Content-Type': staticFiles.get(url.pathname) }); return res.end(await fs.readFile(path.join(root, 'public', url.pathname.slice(1)))); }
    const originalWrite = res.write.bind(res);
    // Add clock metadata to snapshots; scheduler and diagnostic logic remain identical.
    res.write = (chunk, ...args) => originalWrite(typeof chunk === 'string' && chunk.startsWith('event: hearings') ? chunk.replace('"serverTime":', `"clockSpeed":${config.speed},"serverTime":`) : chunk, ...args);
    const demoSend = (r, status, body) => send(r, status, body.serverTime ? { ...body, clockSpeed: config.speed } : body);
    if (!await handlePreventionRoute({ req, res, url, user, services, bodyJson, send: demoSend, demoOnly: true })) send(res, 404, { error: 'Não encontrado.' });
  } catch (e) { if (!res.headersSent) send(res, e.status || 400, { error: e.message }); else res.end(); }
});
services.scheduler.start(1000);
server.listen(Number(process.env.DEMO_PORT || 5174), '127.0.0.1', () => console.log(`Central DEMO: http://127.0.0.1:${server.address().port} · relógio ${config.speed}x · persistência SQLite`));
async function stop() { services.scheduler.stop(); server.closeAllConnections(); server.close(); await store.close(); }
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
