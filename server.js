'use strict';
/* Couch Cabinet server: serves the static web app and relays room messages between two players.
   Game logic runs in both browsers (lockstep). The server only forwards small JSON messages.
   Hardening: gzip + caching for static files, security headers, /health, per-socket message
   rate limit, room count cap, heartbeat reaping and graceful shutdown. */
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const { WebSocketServer } = require('ws');
const PUB = path.join(__dirname, 'public'), PORT = process.env.PORT || 3000;
const MAX_ROOMS = +process.env.MAX_ROOMS || 5000, MSG_PER_SEC = +process.env.MSG_PER_SEC || 240;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' };
const cache = new Map();   // path -> { buf, gz, type, mtime }
const rooms = new Map(), started = Date.now();
function load(f, cb) {
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) return cb(e || new Error('nf'));
    const c = cache.get(f); if (c && c.mtime === st.mtimeMs) return cb(null, c);
    fs.readFile(f, (err, buf) => {
      if (err) return cb(err);
      const type = TYPES[path.extname(f)] || 'application/octet-stream', o = { buf, type, mtime: st.mtimeMs, gz: null };
      if (/^(text|application\/(json|manifest)|image\/svg)/.test(type) && buf.length > 1024) o.gz = zlib.gzipSync(buf, { level: 9 });
      cache.set(f, o); cb(null, o);
    });
  });
}
const server = http.createServer((req, res) => {
  let p; try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/health') { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, SEC)); return res.end(JSON.stringify({ ok: true, rooms: rooms.size, up: Math.round((Date.now() - started) / 1000) })); }
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  load(f, (err, o) => {
    if (err) { res.writeHead(404, SEC); return res.end('Not found'); }
    const h = Object.assign({ 'Content-Type': o.type, 'Cache-Control': p === '/sw.js' || p === '/index.html' ? 'no-cache' : 'public, max-age=3600', Vary: 'Accept-Encoding' }, SEC);
    if (o.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) { h['Content-Encoding'] = 'gzip'; res.writeHead(200, h); return res.end(o.gz); }
    res.writeHead(200, h); res.end(o.buf);
  });
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on('upgrade', (req, sock, head) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname !== '/ws') { sock.destroy(); return; }
  const room = (u.searchParams.get('room') || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  if (room.length < 4 || (!rooms.has(room) && rooms.size >= MAX_ROOMS)) { sock.destroy(); return; }
  wss.handleUpgrade(req, sock, head, ws => {
    let set = rooms.get(room); if (!set) rooms.set(room, set = new Set());
    if (set.size >= 2) { ws.send('{"full":1}'); ws.close(); return; }
    ws.last = null; ws.alive = true; ws.win = Date.now(); ws.cnt = 0; set.add(ws);
    for (const o of set) if (o !== ws && o.last) ws.send(o.last);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', data => {
      const now = Date.now(); if (now - ws.win > 1000) { ws.win = now; ws.cnt = 0; }
      if (++ws.cnt > MSG_PER_SEC) return;               // drop floods instead of relaying them
      const s = data.toString(); let o; try { o = JSON.parse(s); } catch (e) { return; }
      if (!o || !o.p) return;
      ws.last = s; for (const x of set) if (x !== ws && x.readyState === 1) x.send(s);
    });
    ws.on('close', () => {
      set.delete(ws); for (const x of set) if (x.readyState === 1) x.send('{"left":1}');
      if (!set.size) rooms.delete(room);
    });
    ws.on('error', () => { try { ws.terminate(); } catch (e) { } });
  });
});
const beat = setInterval(() => { for (const set of rooms.values()) for (const ws of set) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch (e) { } } }, 20000);
server.listen(PORT, () => console.log('Couch Cabinet running on port ' + PORT));
const bye = () => { clearInterval(beat); wss.clients.forEach(c => { try { c.close(1001); } catch (e) { } }); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', bye); process.on('SIGINT', bye);
