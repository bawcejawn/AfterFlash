// Thin wrapper around koilib (loaded as a vendored global) for the Afterflash contract.
import { config } from './util.js';
import abi from './photoshare-abi.js';

const K = () => {
  if (!window.Contract || !window.Provider) throw new Error('Koinos library failed to load.');
  return window;
};

export function chainEnabled() {
  return !!(config.koinos && /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(config.koinos.contract || ''));
}

export function isAddress(a) {
  return typeof a === 'string' && /^1[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a);
}

let provider;
export function getProvider() {
  if (!provider) provider = new (K().Provider)([config.koinos.rpc]);
  return provider;
}

export function getContract(signer) {
  return new (K().Contract)({ id: config.koinos.contract, abi, provider: getProvider(), signer });
}

export async function resourceLimits() {
  const r = await getProvider().call('chain.get_resource_limits', {});
  return r.resource_limit_data;
}

export async function manaOf(address) {
  const rc = await getProvider().getAccountRc(address);
  return Number(rc) / 1e8;
}

export async function getEvent(owner, eventId) {
  const { result } = await getContract().functions.get_event({ owner, event_id: eventId });
  return result && result.value && result.value.exists ? result.value : null;
}

export async function getKeepsake(owner, eventId, index) {
  const { result } = await getContract().functions.get_keepsake({ owner, event_id: eventId, index });
  return result && result.value && result.value.exists ? result.value : null;
}

export function explorerTx(id) {
  return `${config.koinos.explorer}/tx/${encodeURIComponent(id)}`;
}

// ---------------- Kondor wallet
export async function kondorAccounts(timeoutMs = 10000) {
  if (!window.kondor) throw new Error('Kondor wallet script failed to load.');
  const t = new Promise((_, rej) => setTimeout(() => rej(new Error('Kondor wallet didn’t answer. Install the Kondor extension, unlock it, and reload this page.')), timeoutMs));
  const accounts = await Promise.race([window.kondor.getAccounts(), t]);
  if (!accounts || !accounts.length) throw new Error('No account shared from Kondor.');
  return accounts.map((a) => a.address).filter(isAddress);
}

export function kondorSigner(address) {
  return window.kondor.getSigner(address);
}

/**
 * Sign once and send a transaction containing several contract calls.
 * calls: [{ fn: 'add_keepsake', args: {...} }]
 */
export async function sendBatch(signer, calls) {
  const contract = getContract(signer);
  const tx = new (K().Transaction)({ signer, provider: getProvider(), options: { payer: signer.getAddress ? signer.getAddress() : undefined } });
  for (const c of calls) await tx.pushOperation(contract.functions[c.fn], c.args);
  await tx.prepare();
  await tx.sign();
  const receipt = await tx.send();
  const wait = await tx.wait('byBlock', 90000);
  return { id: tx.transaction.id, receipt, block: wait };
}
