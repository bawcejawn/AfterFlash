// Local PhotoShare Cloud for the browser tests: the real worker + fake Google/Stripe on :8788.
// Usage: node cloud/test/server.mjs [port]  (prints the owner key)
import http from 'node:http';
import fs from 'node:fs';
import { makeEnv } from './harness.mjs';

const port = Number(process.argv[2] || 8788);
const origin = `http://localhost:${port}`;
const { env, fk, worker } = makeEnv({ GOOGLE_AUTH_BASE: origin + '/__google-auth', SITE_ORIGIN: origin, IMAGE_BASE: origin + '/mock-lh3', DRIVE_BASE: origin + '/mock-drive' });
fs.writeFileSync('/tmp/photoshare-owner-key', env.OWNER_KEY);

http.createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  // ---- test hooks: what Google/Stripe would do in the browser
  if (url.pathname === '/__google-auth') { // stands in for accounts.google.com's sign-in page
    const q = url.searchParams;
    const purpose = q.get('access_type') === 'offline' ? 'connect' : 'recover';
    res.writeHead(302, { location: `${origin}/__google-consent?state=${encodeURIComponent(q.get('state'))}&purpose=${purpose}&sub=google-sub-1` }); res.end(); return;
  }
  if (url.pathname === '/__google-consent') { // Google's consent screen: the user clicks "Allow"
    const sub = url.searchParams.get('sub') || 'google-sub-1';
    const scope = url.searchParams.get('noscope') ? 'openid email' : undefined;
    const code = fk.approve({ sub, email: url.searchParams.get('email') || 'host@example.com', ...(scope ? { scope } : {}), noRefresh: url.searchParams.get('purpose') === 'recover' });
    res.writeHead(302, { location: `${origin}/oauth/callback?state=${encodeURIComponent(url.searchParams.get('state'))}&code=${code}` }); res.end(); return;
  }
  if (url.pathname === '/__stripe-pay') { // Stripe Checkout: the buyer pays
    res.writeHead(302, { location: fk.pay(url.searchParams.get('sid')) }); res.end(); return;
  }
  if (url.pathname === '/__files') { // what's in the fake Drive
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([...fk.drive.values()].filter((f) => f.bytes).map((f) => ({ name: f.name, public: f.public, owner: f.owner, head: Buffer.from(f.bytes.subarray(0, 4)).toString('latin1') })))); return;
  }
  if (url.pathname.startsWith('/mock-lh3/d/')) {
    const id = decodeURIComponent(url.pathname.split('/')[3].split('=')[0]);
    const f = fk.drive.get(id);
    if (!f || !f.public || f.trashed) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f.mime }); res.end(Buffer.from(f.bytes)); return;
  }
  if (url.pathname.startsWith('/mock-drive/')) {
    const id = url.searchParams.get('id') || url.pathname.split('/')[4];
    const f = fk.drive.get(id);
    if (!f || !f.public || f.trashed) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f.mime }); res.end(Buffer.from(f.bytes)); return;
  }
  const chunks = [];
  for await (const ch of req) chunks.push(ch);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(origin + req.url, { method: req.method, headers: req.headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body });
  const out = await worker.fetch(request, env);
  const headers = {};
  out.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(out.status, headers);
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(port, () => console.log(`${origin}  owner key: ${env.OWNER_KEY}`));
