// Deploy (or upgrade) the Afterflash contract to Koinos.
//
//   node deploy-contract.mjs --new-key           # create a fresh contract account key (prints it once)
//   CONTRACT_WIF=... PAYER_WIF=... node deploy-contract.mjs [--rpc https://api.koinos.io]
//
// CONTRACT_WIF: private key of the account the contract will live at (a NEW, dedicated account).
// PAYER_WIF   : (optional) key of the account whose mana pays for the upload — e.g. your
//               KOIN-holding sponsor address. Defaults to the contract account itself.
// Keys are read from the environment only; nothing is written to disk.
import fs from 'node:fs';
import path from 'node:path';
import { Contract, Signer, abi, env, arg, provider, utils } from './lib.mjs';

if (arg('new-key')) {
  const key = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
  const s = new Signer({ privateKey: key });
  console.log('New contract account (store the WIF in a password manager, offline if possible):');
  console.log('  address:', s.getAddress());
  console.log('  WIF    :', s.getPrivateKey('wif'));
  console.log('\nWhoever holds this key can replace the contract code. Keep it secret.');
  process.exit(0);
}

const here = path.dirname(new URL(import.meta.url).pathname);
const wasmPath = path.join(here, '../contract/build/release/contract.wasm');
const bytecode = fs.readFileSync(wasmPath);
const expected = fs.readFileSync(wasmPath + '.sha256', 'utf8').split(/\s+/)[0];
const actual = await crypto.subtle.digest('SHA-256', bytecode).then((d) => Buffer.from(d).toString('hex'));
if (expected !== actual) { console.error('contract.wasm does not match contract.wasm.sha256 — rebuild with contract/build.sh'); process.exit(1); }

const prov = provider();
const contractSigner = Signer.fromWif(env('CONTRACT_WIF', { secret: true }));
contractSigner.provider = prov;
const payerWif = process.env.PAYER_WIF;
const payerSigner = payerWif ? Signer.fromWif(payerWif) : null;
const payer = payerSigner ? payerSigner.getAddress() : contractSigner.getAddress();

console.log('Contract address:', contractSigner.getAddress());
console.log('Mana payer      :', payer);
console.log('Wasm sha256     :', actual);
if (!arg('yes')) {
  console.log('\nRe-run with --yes to deploy.');
  process.exit(0);
}

const contract = new Contract({ signer: contractSigner, provider: prov, bytecode, abi });
const { transaction } = await contract.deploy({
  abi: JSON.stringify(abi),
  authorizesCallContract: false,
  authorizesTransactionApplication: false,
  authorizesUploadContract: false,
  payer,
  sendTransaction: false,
});
let tx = transaction;
if (payerSigner && payer !== contractSigner.getAddress()) tx = await payerSigner.signTransaction(tx);
const { transaction: sent } = await prov.sendTransaction(tx);
console.log('Sent', sent.id, '— waiting for a block…');
await sent.wait('byBlock', 120000);
console.log(`\nDeployed. Put this in site/config.js → koinos.contract:\n  '${contractSigner.getAddress()}'`);
