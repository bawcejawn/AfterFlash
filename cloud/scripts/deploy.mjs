#!/usr/bin/env node
// Deploys PhotoShare Cloud to Cloudflare (run by .github/workflows/cloud.yml, or locally).
// Reads settings from environment variables (GitHub repository secrets/variables):
//   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID                       (required)
//   OWNER_KEY, GOOGLE_CLIENT_SECRET, STRIPE_SECRET_KEY, DATA_KEY       (secrets; DATA_KEY optional)
//   GOOGLE_CLIENT_ID, PRICE_EVENT / PRICE_MONTH / PRICE_YEAR (dollars), SUPPORT_EMAIL,
//   BUSINESS_NAME, APP_NAME, SITE_ORIGIN, GOOGLE_SITE_VERIFICATION                              (plain settings; all optional)
// Never prints secret values (this repository's Actions logs are public).
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..');
const wrangler = path.join(root, 'node_modules/.bin/wrangler');
const env = process.env;
const run = (args, opts = {}) => execFileSync(wrangler, args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'], env: { ...env, WRANGLER_SEND_METRICS: 'false' }, ...opts });
const fail = (msg) => { console.error('\n✖ ' + msg + '\n'); process.exit(1); };

if (!env.CLOUDFLARE_API_TOKEN) fail('CLOUDFLARE_API_TOKEN is missing. Add it under GitHub → Settings → Secrets and variables → Actions (see docs/LAUNCH.md).');
if (!env.CLOUDFLARE_ACCOUNT_ID) fail('CLOUDFLARE_ACCOUNT_ID is missing. Add it as a repository secret (see docs/LAUNCH.md).');
if (!env.OWNER_KEY || env.OWNER_KEY.length < 24) fail('OWNER_KEY is missing or shorter than 24 characters. Add it as a repository secret (see docs/LAUNCH.md).');

// 1. The database (created on the first run)
let dbs = [];
try { dbs = JSON.parse(run(['d1', 'list', '--json'])); } catch { fail('Couldn’t list Cloudflare D1 databases: check the API token has "D1: Edit" permission.'); }
let db = dbs.find((d) => d.name === 'photoshare');
if (!db) {
  console.log('Creating the database…');
  run(['d1', 'create', 'photoshare']);
  db = JSON.parse(run(['d1', 'list', '--json'])).find((d) => d.name === 'photoshare');
}
const dbId = db.uuid || db.database_id || db.id;

// 2. The site's address
let origin = (env.SITE_ORIGIN || '').replace(/\/+$/, '');
if (!origin) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/subdomain`, { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } });
  const data = await res.json().catch(() => ({}));
  const sub = data && data.result && data.result.subdomain;
  if (!sub) fail('Your Cloudflare account has no workers.dev subdomain yet. In the Cloudflare dashboard open "Workers & Pages" once (it asks you to pick one), then run this again.');
  origin = `https://photoshare.${sub}.workers.dev`;
}
if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin)) fail('SITE_ORIGIN must look like https://photos.example.com (no path).');

// 3. Config for this deployment
const vars = {
  APP_NAME: env.APP_NAME || 'PhotoShare',
  SITE_ORIGIN: origin,
  GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID || '',
  SUPPORT_EMAIL: env.SUPPORT_EMAIL || '',
  BUSINESS_NAME: env.BUSINESS_NAME || '',
  GOOGLE_SITE_VERIFICATION: env.GOOGLE_SITE_VERIFICATION || '',
  PRICE_EVENT: env.PRICE_EVENT || '5',
  PRICE_MONTH: env.PRICE_MONTH || '10',
  PRICE_YEAR: env.PRICE_YEAR || '30',
  OVERRIDE_PCT: env.OVERRIDE_PCT || '5',
};
let toml = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8')
  .replace(/database_id = "[^"]*"/, `database_id = "${dbId}"`)
  .replace(/\[vars\][\s\S]*$/, '[vars]\n' + Object.entries(vars).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n') + '\n');
const cfg = path.join(root, 'wrangler.deploy.toml');
fs.writeFileSync(cfg, toml);

// 4. Database tables, then the code + website
console.log('Updating database tables…');
run(['d1', 'migrations', 'apply', 'photoshare', '--remote', '-c', cfg], { input: 'y\n' });
console.log('Deploying…');
run(['deploy', '-c', cfg]);

// 5. Secrets (only the ones provided; DATA_KEY is generated once if you didn't set one)
let existing = [];
try { existing = JSON.parse(run(['secret', 'list', '--format', 'json', '-c', cfg])).map((s) => s.name); } catch { /* first deploy */ }
const secrets = {};
for (const k of ['OWNER_KEY', 'GOOGLE_CLIENT_SECRET', 'STRIPE_SECRET_KEY', 'DATA_KEY']) if (env[k]) secrets[k] = env[k];
if (!secrets.DATA_KEY && !existing.includes('DATA_KEY')) {
  secrets.DATA_KEY = crypto.randomBytes(32).toString('base64url');
  console.log('Generated DATA_KEY (kept only inside Cloudflare). Don’t delete it: it unlocks saved Google connections.');
}
const tmp = path.join(root, '.secrets.json');
fs.writeFileSync(tmp, JSON.stringify(secrets), { mode: 0o600 });
try { run(['secret', 'bulk', tmp, '-c', cfg]); } finally { fs.rmSync(tmp, { force: true }); fs.rmSync(cfg, { force: true }); }

// 6. What's still missing
const missing = [];
if (!vars.GOOGLE_CLIENT_ID || !(secrets.GOOGLE_CLIENT_SECRET || existing.includes('GOOGLE_CLIENT_SECRET'))) missing.push('Google sign-in (GOOGLE_CLIENT_ID variable + GOOGLE_CLIENT_SECRET secret)');
if (!(secrets.STRIPE_SECRET_KEY || existing.includes('STRIPE_SECRET_KEY'))) missing.push('payments (STRIPE_SECRET_KEY secret)');
console.log(`\n✔ PhotoShare Cloud is live at ${origin}`);
console.log(`  Google sign-in redirect URI to register: ${origin}/oauth/callback`);
if (missing.length) console.log('  Still to set up: ' + missing.join('; ') + '. See docs/LAUNCH.md.');
