/* CharlaBot — WhatsApp en vivo para la charla (pantalla del bot, sección #q12b).
   Simple a propósito:
   - Muestra un QR para vincular cualquier celular (WhatsApp > Dispositivos vinculados).
   - Cada mensaje que llega se responde con la IA del Google Sheet de la charla (acción "chat" del Apps Script,
     que usa la clave gratis de Gemini y la personalidad/contexto/instrucciones de la pestaña "bot").
   - La pantalla del bot en el HTML lee todo desde http://127.0.0.1:3777 (QR, estado y chats).
   Nada de claves acá: la clave vive en el Apps Script. */
import makeWASocket, { useMultiFileAuthState, initAuthCreds, BufferJSON, proto, DisconnectReason, fetchLatestBaileysVersion, Browsers, normalizeMessageContent } from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const VERSION = '1.1.0';
const PORT = 3777;
const HOST = '127.0.0.1';
const DATA = process.env.CHARLABOT_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'CharlaBot');
const OLD_AUTH = path.join(DATA, 'sesion');   // sesión guardada por la v1.0.0 (se desvincula y se borra)
const SETTINGS = path.join(DATA, 'ajustes.json');
fs.mkdirSync(DATA, { recursive: true });

/* ---------- ajustes (solo la URL del Apps Script; la manda el HTML) ---------- */
let settings = {};
try { settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch (_) {}
function saveSettings() { try { fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2)); } catch (_) {} }

/* ---------- estado que ve el HTML ---------- */
const S = { ready: false, qr: null, qrText: '', number: '', name: '', phase: 'iniciando', error: '', messages: [], queue: 0, stats: { replies: 0, limited: 0, lastLimitAt: 0 } };
const history = new Map();          // jid -> [{role,text}]
const sent = new Map();             // id -> message (para reintentos de WhatsApp)
let seq = 0;
const LOG = [];
function log(...a) { const line = new Date().toLocaleTimeString('es-AR') + ' ' + a.join(' '); console.log(line); LOG.push(line); if (LOG.length > 150) LOG.shift(); }
function pushMsg(m) { m.id = ++seq; m.t = Date.now(); S.messages.push(m); if (S.messages.length > 400) S.messages = S.messages.slice(-400); }

/* ---------- IA vía Google Sheet (Apps Script) ---------- */
async function askSheet(messages) {
  if (!settings.api) throw new Error('Falta conectar el Google Sheet: abrí la charla con el programa abierto.');
  const r = await fetch(settings.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: 'chat', messages }), redirect: 'follow', signal: AbortSignal.timeout(45000) });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch (_) { throw new Error('El Sheet no respondió bien (HTTP ' + r.status + ').'); }
  if (d.error) { const e = new Error(d.error); e.busy = /429|RESOURCE_EXHAUSTED|quota|rate/i.test(d.error); throw e; }
  return String(d.text || '').trim();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* cola: de a 2 por vez, con reintentos si Gemini gratis dice "muchas consultas" */
const jobs = []; let running = 0;
function enqueue(job) { jobs.push(job); S.queue = jobs.length + running; pump(); }
function pump() {
  while (running < 2 && jobs.length) {
    const job = jobs.shift(); running++; S.queue = jobs.length + running;
    job().catch(e => log('[error]', e.message)).finally(() => { running--; S.queue = jobs.length + running; pump(); });
  }
}

/* ---------- WhatsApp ---------- */
let sock = null, startedAt = Date.now(), restarting = false;

function textOf(msg) {
  const c = normalizeMessageContent(msg.message);
  if (!c) return { text: '' };
  const text = c.conversation || c.extendedTextMessage?.text || c.imageMessage?.caption || c.videoMessage?.caption || c.documentMessage?.caption || '';
  if (text) return { text };
  if (c.audioMessage) return { media: 'un audio' };
  if (c.imageMessage) return { media: 'una imagen' };
  if (c.videoMessage) return { media: 'un video' };
  if (c.stickerMessage) return { media: 'un sticker' };
  if (c.documentMessage) return { media: 'un archivo' };
  return { text: '' };
}

async function handle(msg) {
  const jid = msg.key.remoteJid;
  const { text, media } = textOf(msg);
  if (!text && !media) return;
  const name = msg.pushName || jid.replace(/@.*/, '');
  pushMsg({ from: 'cliente', jid, name, text: text || '[' + media + ']' });
  try { await sock.readMessages([msg.key]); } catch (_) {}
  enqueue(async () => {
    const h = history.get(jid) || [];
    h.push({ role: 'user', text: text || '(El cliente mandó ' + media + ' que no podés ver ni escuchar. Pedile amablemente que lo escriba.)' });
    try { await sock.sendPresenceUpdate('composing', jid); } catch (_) {}
    let out = '', lastErr = null;
    for (let i = 0; i < 4 && !out; i++) {
      try { out = await askSheet(h.slice(-12)); }
      catch (e) { lastErr = e; if (!e.busy) break; S.stats.limited++; S.stats.lastLimitAt = Date.now(); await sleep(8000 + i * 6000); }
    }
    try { await sock.sendPresenceUpdate('paused', jid); } catch (_) {}
    if (!out) {
      pushMsg({ from: 'sistema', jid, name: 'aviso', to: name, text: 'No respondió: ' + (lastErr ? lastErr.message : 'sin texto') });
      log('[ia] no pude responder a', name, '-', lastErr && lastErr.message);
      return;
    }
    S.stats.replies++;
    h.push({ role: 'model', text: out });
    history.set(jid, h.slice(-20));
    const r = await sock.sendMessage(jid, { text: out });
    if (r?.key?.id) { sent.set(r.key.id, r.message); if (sent.size > 500) sent.delete(sent.keys().next().value); }
    pushMsg({ from: 'bot', jid, name: 'bot', to: name, text: out });
  });
}

const silent = { level: 'silent', child() { return silent; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

/* ---------- sesión SOLO en memoria: al cerrar el programa no queda nada en la PC ---------- */
function memoryAuth() {
  const creds = initAuthCreds(), store = new Map();
  const ser = v => JSON.stringify(v, BufferJSON.replacer), de = t => JSON.parse(t, BufferJSON.reviver);
  return {
    state: { creds, keys: {
      get: async (type, ids) => { const d = {}; for (const id of ids) { const t = store.get(type + '|' + id); let v = t ? de(t) : null; if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v); d[id] = v; } return d; },
      set: async data => { for (const c in data) for (const id in data[c]) { const v = data[c][id]; if (v) store.set(c + '|' + id, ser(v)); else store.delete(c + '|' + id); } }
    } },
    saveCreds: async () => {}
  };
}
let auth = memoryAuth();

/* si quedó una sesión guardada por la versión anterior: la desvinculo del celular y la borro */
async function cleanupOld() {
  if (!fs.existsSync(path.join(OLD_AUTH, 'creds.json'))) { try { fs.rmSync(OLD_AUTH, { recursive: true, force: true }); } catch (_) {} return; }
  log('Desvinculo la sesión anterior que había quedado guardada…');
  try {
    const { state } = await useMultiFileAuthState(OLD_AUTH);
    const old = makeWASocket({ auth: state, logger: silent, browser: Browsers.windows('Chrome'), markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false });
    await Promise.race([
      new Promise(res => old.ev.on('connection.update', async u => {
        if (u.connection === 'open') { try { await old.logout(); } catch (_) {} res(); }
        if (u.connection === 'close' || u.qr) res();
      })),
      sleep(20000)
    ]);
    try { old.end(); } catch (_) {}
  } catch (_) {}
  try { fs.rmSync(OLD_AUTH, { recursive: true, force: true }); } catch (_) {}
}

let watchdog = null, gen = 0;
function restart(ms) { if (restarting) return; restarting = true; clearTimeout(watchdog); setTimeout(() => start().catch(fail), ms); }
async function start() {
  restarting = false;
  const my = ++gen;
  S.phase = 'iniciando'; S.ready = false;
  clearTimeout(watchdog);
  /* si en 45 s no hay QR ni conexión, reintento solo */
  watchdog = setTimeout(() => {
    if (my === gen && S.phase === 'iniciando') { log('WhatsApp no contesta. Reintento… (¿hay internet?)'); try { sock.end(new Error('watchdog')); } catch (_) {} restart(1500); }
  }, 45000);
  const { state, saveCreds } = auth;
  let version;
  try { version = (await Promise.race([fetchLatestBaileysVersion(), sleep(6000).then(() => ({}))])).version; } catch (_) {}
  if (my !== gen) return;
  const me = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    logger: silent,
    browser: Browsers.windows('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    getMessage: async key => sent.get(key.id)
  });
  sock = me;
  me.ev.on('creds.update', saveCreds);
  me.ev.on('connection.update', async u => {
    if (my !== gen) return;                          // eventos de una conexión vieja
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      S.qrText = qr; S.phase = 'qr'; S.ready = false;
      try { S.qr = await QRCode.toDataURL(qr, { margin: 1, width: 360 }); } catch (_) {}
      log('QR nuevo: escanealo desde la charla (o abrí http://127.0.0.1:' + PORT + ')');
    }
    if (connection === 'open') {
      clearTimeout(watchdog);
      S.ready = true; S.qr = null; S.qrText = ''; S.phase = 'conectado'; S.error = '';
      S.number = (me.user?.id || '').split(':')[0].split('@')[0];
      S.name = me.user?.name || '';
      startedAt = Date.now();
      log('WhatsApp CONECTADO: +' + S.number + ' ' + S.name);
    }
    if (connection === 'close') {
      S.ready = false; S.phase = 'iniciando';
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log('Se desvinculó el celular. Genero un QR nuevo…');
        auth = memoryAuth();
        S.number = ''; S.name = ''; S.qr = null;
        restart(500);
      } else { log('Conexión cerrada (' + (code || 'sin código') + '). Reconectando…'); restart(2500); }
    }
  });
  me.ev.on('messages.upsert', ({ messages, type }) => {
    if (my !== gen || type !== 'notify') return;
    for (const m of messages) {
      const jid = m.key?.remoteJid || '';
      if (m.key.fromMe || !jid || /@g\.us$|@broadcast$|@newsletter$/.test(jid)) continue;
      const ts = Number(m.messageTimestamp || 0) * 1000;
      if (ts && ts < startedAt - 120000) continue;   // no contestar mensajes viejos
      handle(m).catch(e => log('[error]', e.message));
    }
  });
}
function fail(e) { S.error = e.message; log('[error al iniciar] ' + e.message); restarting = false; restart(5000); }

async function logout() {
  history.clear(); S.messages = []; S.number = ''; S.name = ''; S.ready = false; S.qr = null; S.phase = 'iniciando';
  log('Cambiar celular: desvinculo el actual…');
  const old = sock;
  try { await Promise.race([old.logout(), sleep(5000)]); } catch (_) {}
  gen++;                                             // ignoro lo que diga la conexión vieja
  try { old.end(); } catch (_) {}
  auth = memoryAuth();
  restarting = false; restart(800);
}

/* al cerrar la ventana negra (o Ctrl+C): desvinculo el celular y no queda nada */
let closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  console.log('\n  Cerrando: desvinculo el celular y borro todo…');
  history.clear(); S.messages = [];
  try { if (sock && S.ready) await Promise.race([sock.logout(), sleep(3500)]); } catch (_) {}
  process.exit(0);
}
['SIGINT', 'SIGHUP', 'SIGBREAK', 'SIGTERM'].forEach(sig => { try { process.on(sig, shutdown); } catch (_) {} });

/* ---------- servidor local para el HTML ---------- */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Private-Network': 'true', 'Cache-Control': 'no-store' };
function json(res, obj) { res.writeHead(200, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (_) { r({}); } }); }); }
const PAGE = `<!doctype html><meta charset="utf-8"><title>CharlaBot</title><meta name="viewport" content="width=device-width">
<style>body{font:16px system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}main{text-align:center}img{width:300px;height:300px;background:#fff;border-radius:12px}p{color:#aaa}</style>
<main><h2>CharlaBot</h2><div id=q></div><p id=s>…</p><p>Esta ventana es solo de respaldo: lo mismo se ve en la pantalla del bot en la charla.</p></main>
<script>async function t(){try{const s=await (await fetch('/api/status')).json();document.getElementById('s').textContent=s.ready?'Conectado: +'+s.number:(s.qr?'Escaneá el QR con WhatsApp > Dispositivos vinculados':'Iniciando…');document.getElementById('q').innerHTML=s.qr&&!s.ready?'<img src="'+s.qr+'">':''}catch(e){document.getElementById('s').textContent='El programa está cerrado.'}}setInterval(t,2000);t()</script>`;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (u.pathname === '/api/status') return json(res, { ok: true, app: 'charlabot', version: VERSION, ready: S.ready, qr: S.ready ? null : S.qr, number: S.number, name: S.name, phase: S.phase, error: S.error, api: !!settings.api, queue: S.queue, last: seq, stats: S.stats });
  if (u.pathname === '/api/log') return json(res, { log: LOG });
  if (u.pathname === '/api/chats') { const since = +u.searchParams.get('since') || 0; return json(res, { last: seq, messages: S.messages.filter(m => m.id > since).slice(-80) }); }
  if (req.method === 'POST' && u.pathname === '/api/setup') { const b = await body(req); if (typeof b.api === 'string' && /^https:\/\/script\.google(usercontent)?\.com\//.test(b.api.trim())) { settings.api = b.api.trim(); saveSettings(); } return json(res, { ok: true, api: !!settings.api }); }
  if (req.method === 'POST' && u.pathname === '/api/reset') { history.clear(); return json(res, { ok: true }); }
  if (req.method === 'POST' && u.pathname === '/api/clear') { history.clear(); S.messages = []; return json(res, { ok: true, last: seq }); }
  if (req.method === 'POST' && u.pathname === '/api/logout') { logout(); return json(res, { ok: true }); }
  if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
  res.writeHead(404, CORS); res.end('no');
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { console.log('\n  CharlaBot ya está abierto en otra ventana. Podés cerrar esta.\n'); setTimeout(() => process.exit(0), 4000); }
  else { console.log('Error del servidor:', e.message); }
});
server.listen(PORT, HOST, () => {
  console.log('\n  ==============================================');
  console.log('   CharlaBot ' + VERSION + ' · WhatsApp en vivo para la charla');
  console.log('  ==============================================');
  console.log('   Dejá esta ventana ABIERTA durante la charla (podés minimizarla).');
  console.log('   El QR y los chats se ven en la charla (pantalla del bot de WhatsApp).');
  console.log('   Al cerrarla se borra todo y el celular se desvincula.');
  console.log('   Respaldo: http://127.0.0.1:' + PORT + '\n');
  if (!settings.api) console.log('   (El Google Sheet se conecta solo al abrir la charla)\n');
  cleanupOld().catch(() => {}).then(() => start().catch(fail));
});
process.on('uncaughtException', e => log('[error]', e.message));
process.on('unhandledRejection', e => log('[error]', e && e.message || e));
