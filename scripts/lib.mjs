// Shared helpers for the command-line tools.
import { createRequire } from 'node:module';
import abi from '../site/assets/js/photoshare-abi.js';
import config from '../site/config.js';

const require = createRequire(import.meta.url);
export const { Contract, Provider, Signer, Transaction, utils } = require('koilib');
export { abi, config };

export function env(name, { required = true, secret = false } = {}) {
  const v = process.env[name];
  if (required && !v) {
    console.error(`Missing ${name}.${secret ? ' (Set it in your shell, never commit it.)' : ''}`);
    process.exit(2);
  }
  return v;
}

export function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

export function provider() {
  return new Provider([arg('rpc', process.env.KOINOS_RPC || config.koinos.rpc)]);
}

export function contractId() {
  const id = arg('contract', process.env.PHOTOSHARE_CONTRACT || config.koinos.contract);
  if (!/^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(id || '')) { console.error('Set the contract address (--contract or config.js koinos.contract).'); process.exit(2); }
  return id;
}

/** Sign with the owner and, if different, the payer; then send and wait. */
export async function sendOps(prov, ownerSigner, payerSigner, calls) {
  const contract = new Contract({ id: contractId(), abi, provider: prov, signer: ownerSigner });
  const payer = (payerSigner || ownerSigner).getAddress();
  const tx = new Transaction({ signer: ownerSigner, provider: prov, options: { payer } });
  for (const c of calls) await tx.pushOperation(contract.functions[c.fn], c.args);
  await tx.prepare();
  await tx.sign();
  if (payerSigner && payerSigner.getAddress() !== ownerSigner.getAddress()) {
    tx.transaction = await payerSigner.signTransaction(tx.transaction);
  }
  const receipt = await tx.send();
  await tx.wait('byBlock', 120000);
  return { id: tx.transaction.id, receipt };
}

/** POST to a PhotoShare Apps Script backend (same protocol as the site). */
export async function backend(url, action, payload) {
  if (!/^https:\/\/script\.google\.com\/(?:a\/macros\/[A-Za-z0-9.-]+|macros)\/s\/[A-Za-z0-9_-]+\/exec$/.test(url)) throw new Error('Backend URL must be an Apps Script /exec URL');
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ ...payload, a: action }), redirect: 'follow' });
      const data = await res.json();
      if (!data.ok) { const e = new Error(data.message || data.error); e.code = data.error; throw e; }
      return data;
    } catch (e) {
      if (attempt >= 3 || (e.code && !['busy', 'rate_limited', 'server_error'].includes(e.code))) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
    }
  }
}
