// Local test server: serves site/ and runs the REAL backend/Code.gs behind /mock-api
// (on top of the in-memory Apps Script mock). Media is served from /mock-drive.
// Usage: node test/server.mjs [port]   → prints the admin key.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createGas } from './gas-mock.mjs';

const port = Number(process.argv[2] || 8787);
const siteDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../site');
const gas = createGas();
gas.ctx.setup();
// A second, never-set-up backend: stands in for a friend's own Apps Script deployment
// (the e2e test routes https://script.google.com/macros/s/AKfy…/exec here).
const byo = createGas();
const adminKey = gas.logs.find((l) => l.includes('NEW ADMIN KEY')).split(': ').pop().trim();
fs.writeFileSync('/tmp/photoshare-admin-key', adminKey);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

const testConfig = `export default { appName: 'Afterflash', backends: { main: '/mock-api', alt: '/mock-api' }, koinos: { rpc: 'https://api.koinos.io', contract: '1ESUaEUU6SEvsTfCSvfPZ7AHVfpFhdGubx', explorer: 'https://koinosblocks.com' }, driveBase: '/mock-drive', imageBase: '/mock-lh3' };\n`;

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/mock-byo') {
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(byo.ctx.doGet().body); return; }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(byo.ctx.doPost({ postData: { contents: body, length: body.length } }).body); });
    return;
  }
  if (url.pathname === '/mock-api' && req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const out = gas.ctx.doPost({ postData: { contents: body, length: body.length } });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(out.body);
    });
    return;
  }
  if (url.pathname === '/mock-api' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(gas.ctx.doGet().body);
    return;
  }
  if (url.pathname.startsWith('/mock-lh3/')) {
    // Google sometimes answers with a small generic icon instead of the photo: the site must fall back.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGNgGAWjYBSMglEwCkYBAAAB4AABsW4UNAAAAABJRU5ErkJggg==', 'base64');
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(png);
    return;
  }
  if (url.pathname === '/mock-files') { // test-only: what Drive holds (name, first bytes, sharing)
    const out = [...gas.files.values()].filter((f) => f.blob && f.blob.bytes && !f.trashed).map((f) => ({ name: f.getName(), head: String.fromCharCode(...gas.unsigned(f.blob.bytes.slice(0, 4))), shared: f.sharing !== 'PRIVATE' }));
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(out)); return;
  }
  if (url.pathname.startsWith('/mock-drive/')) {
    const id = url.searchParams.get('id') || url.pathname.split('/')[4];
    const f = gas.files.get(id) || byo.files.get(id);
    if (!f || f.trashed || f.sharing !== 'ANYONE_WITH_LINK' || !f.blob) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f.blob.mime });
    res.end(gas.unsigned(f.blob.bytes));
    return;
  }
  if (url.pathname === '/backend/Code.gs.txt') { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(fs.readFileSync(path.join(siteDir, '../backend/Code.gs'))); return; }
  if (url.pathname === '/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(testConfig); return; }
  let p = path.normalize(path.join(siteDir, decodeURIComponent(url.pathname)));
  if (!p.startsWith(siteDir)) { res.writeHead(403); res.end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); res.end(fs.readFileSync(path.join(siteDir, '404.html'))); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}  admin key: ${adminKey}`));
