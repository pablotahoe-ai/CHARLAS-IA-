/* Mini-bot de WhatsApp para la charla (pantalla 29/50).
   - Sirve la charla en http://localhost:3777 y expone /api/status, /api/chats, /api/config, /api/clear.
   - Responde vía el Google Sheet de la charla (Apps Script): clave, contexto, personalidad e instrucciones viven ahí.
   - Portátil: se abre en cualquier PC con Node (iniciar-charla.bat instala lo necesario la primera vez). */
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

const ROOT = path.resolve(__dirname, '..');          // carpeta de la charla (donde está index.html)
const PORT = 3777;

/* La URL del Apps Script se lee de config.js (el mismo archivo que usa la charla).
   La clave de Gemini y los textos del bot viven en el Google Sheet: acá no se guarda nada. */
function apiUrl() {
  try { const m = /api\s*:\s*['"]([^'"]*)['"]/.exec(fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8')); return m ? m[1].trim() : ''; } catch (_) { return ''; }
}
async function api(payload) {
  const url = apiUrl(); if (!url) throw new Error('Falta la URL del Apps Script en config.js');
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow' });
  const t = await r.text(); try { return JSON.parse(t); } catch (_) { throw new Error('Respuesta inválida del Apps Script'); }
}

const state = { qr: null, ready: false, number: '', messages: [] };
const history = new Map(); // por contacto: últimos mensajes

/* ---------- IA (vía Google Sheet / Apps Script) ---------- */
async function reply(contactId, text) {
  const h = history.get(contactId) || [];
  h.push({ role: 'user', text });
  const r = await api({ action: 'chat', messages: h.slice(-12) });
  if (r.error) throw new Error(r.error);
  const out = (r.text || '').trim() || 'No pude responder, ¿me repetís?';
  h.push({ role: 'model', text: out });
  history.set(contactId, h.slice(-20));
  return out;
}

/* ---------- WhatsApp ---------- */
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: path.join(__dirname, '.wwebjs_auth') }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});
client.on('qr', async q => { state.qr = await qrcode.toDataURL(q); state.ready = false; console.log('[bot] QR listo: abrí la pantalla 29/50 y escaneá.'); });
client.on('ready', () => { state.ready = true; state.qr = null; state.number = client.info?.wid?.user || ''; console.log('[bot] WhatsApp conectado:', state.number); });
client.on('disconnected', () => { state.ready = false; state.number = ''; console.log('[bot] desconectado'); client.initialize().catch(() => {}); });
client.on('message', async msg => {
  try {
    if (msg.fromMe || msg.isStatus || (msg.from || '').endsWith('@g.us')) return;
    const text = (msg.body || '').trim(); if (!text) return;
    let name = ''; try { const c = await msg.getContact(); name = c.pushname || c.name || ''; } catch (_) {}
    const who = name || msg.from.replace(/@.*/, '');
    state.messages.push({ from: 'cliente', name: who, text, t: Date.now() });
    try { const chat = await msg.getChat(); await chat.sendStateTyping(); } catch (_) {}
    const out = await reply(msg.from, text);
    await msg.reply(out);
    state.messages.push({ from: 'bot', name: 'bot', text: out, t: Date.now() });
    if (state.messages.length > 300) state.messages = state.messages.slice(-300);
  } catch (e) { console.error('[bot] error:', e.message); state.messages.push({ from: 'bot', name: 'bot', text: '⚠ ' + e.message, t: Date.now() }); }
});

/* ---------- Servidor ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2' };
function json(res, obj, code) { res.writeHead(code || 200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); }
function readBody(req) { return new Promise(r => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (_) { r({}); } }); }); }
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST' }); return res.end(); }
  if (u.pathname === '/api/status') return json(res, { ready: state.ready, qr: state.qr, number: state.number, api: !!apiUrl() });
  if (u.pathname === '/api/chats') return json(res, { messages: state.messages });
  if (u.pathname === '/api/reset' && req.method === 'POST') { history.clear(); return json(res, { ok: true }); }
  if (u.pathname === '/api/clear' && req.method === 'POST') { state.messages = []; history.clear(); return json(res, { ok: true }); }
  /* archivos estáticos de la charla */
  let p = decodeURIComponent(u.pathname); if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('no encontrado'); }
  const range = req.headers.range, size = fs.statSync(file).size, type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  if (range) { const m = /bytes=(\d*)-(\d*)/.exec(range); const s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : size - 1; res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 }); return fs.createReadStream(file, { start: s, end: e }).pipe(res); }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' }); fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`[bot] charla en http://localhost:${PORT}  (pantalla 29/50 muestra el QR)`);
  if (!apiUrl()) console.log('[bot] ATENCIÓN: falta la URL del Apps Script en config.js (carpeta de la charla)');
});
client.initialize().catch(e => console.error('[bot] no pude iniciar WhatsApp:', e.message));
