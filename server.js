'use strict';
/* Couch Cabinet server: serves the static web app and relays room messages between two players.
   Game logic runs in both browsers (lockstep). The server only forwards small JSON messages. */
const http = require('http'), fs = require('fs'), path = require('path');
const { WebSocketServer } = require('ws');
const PUB = path.join(__dirname, 'public'), PORT = process.env.PORT || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': p === '/sw.js' || p === '/index.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(buf);
  });
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const rooms = new Map();
server.on('upgrade', (req, sock, head) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname !== '/ws') { sock.destroy(); return; }
  const room = (u.searchParams.get('room') || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  if (room.length < 4) { sock.destroy(); return; }
  wss.handleUpgrade(req, sock, head, ws => {
    let set = rooms.get(room); if (!set) rooms.set(room, set = new Set());
    if (set.size >= 2) { ws.send('{"full":1}'); ws.close(); return; }
    ws.last = null; ws.alive = true; set.add(ws);
    for (const o of set) if (o !== ws && o.last) ws.send(o.last);
    ws.on('pong', () => { ws.alive = true; });
    ws.on('message', data => {
      const s = data.toString(); let o; try { o = JSON.parse(s); } catch (e) { return; }
      if (!o || !o.p) return;
      ws.last = s; for (const x of set) if (x !== ws && x.readyState === 1) x.send(s);
    });
    ws.on('close', () => {
      set.delete(ws); for (const x of set) if (x.readyState === 1) x.send('{"left":1}');
      if (!set.size) rooms.delete(room);
    });
  });
});
setInterval(() => { for (const set of rooms.values()) for (const ws of set) { if (!ws.alive) { ws.terminate(); continue; } ws.alive = false; try { ws.ping(); } catch (e) { } } }, 30000);
server.listen(PORT, () => console.log('Couch Cabinet running on port ' + PORT));
