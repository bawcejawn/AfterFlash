// Integration test: the site's ABI module + koilib (same versions the browser uses) talking to
// the compiled contract running in the Koinos mock VM. Exercises the exact calls archive.html
// and recover.html make, including a multi-operation transaction.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import abi from '../../site/assets/js/photoshare-abi.js';
import { buildManifest, fingerprint, merkleRoot, chainMeta, keepsakeMimeOk, bytesToHex } from '../../site/assets/js/proof.js';

const require = createRequire(import.meta.url);
const { MockVM } = require('@koinos/mock-vm');
const C = require('@koinos/mock-vm/src/constants.js');
const { koinos } = require('@koinos/proto-js');
const { Contract, Signer, Transaction, utils } = require('koilib');

const dir = path.dirname(new URL(import.meta.url).pathname);
const wasm = new WebAssembly.Module(fs.readFileSync(path.join(dir, '../build/test/contract.wasm')));
const vm = new MockVM(true);
const CONTRACT = '1ESUaEUU6SEvsTfCSvfPZ7AHVfpFhdGubx';
const signer = Signer.fromSeed('photoshare-owner-test');
const OWNER = signer.getAddress();
const put = (k, v) => vm.db.putObject(C.METADATA_SPACE, k, v);
put(C.CONTRACT_ID_KEY, utils.decodeBase58(CONTRACT));
put(C.HEAD_INFO_KEY, koinos.chain.head_info.encode({ head_block_time: 1800000000000 }).finish());
put(C.CALLER_KEY, koinos.chain.caller_data.encode({ caller: new Uint8Array(0), caller_privilege: 1 }).finish());

function run(entryPoint, argsBytes, authorizedAddr) {
  put(C.AUTHORITY_KEY, koinos.chain.list_type.encode({ values: authorizedAddr ? [{ bool_value: true, bytes_value: utils.decodeBase58(authorizedAddr), int32_value: 0 }] : [] }).finish());
  put(C.ENTRY_POINT_KEY, koinos.chain.value_type.encode({ int32_value: entryPoint | 0 }).finish());
  put(C.CONTRACT_ARGUMENTS_KEY, argsBytes);
  vm.db.removeObject(C.METADATA_SPACE, C.CONTRACT_RESULT_KEY);
  vm.db.removeObject(C.METADATA_SPACE, C.EXIT_CODE_KEY);
  vm.db.removeObject(C.METADATA_SPACE, C.ERROR_MESSAGE_KEY);
  vm.db.commitTransaction();
  const inst = new WebAssembly.Instance(wasm, { env: vm.getImports() });
  inst.exports.memory.grow(512);
  vm.setInstance(inst);
  try { inst.exports._start(); } catch { /* exit */ }
  const code = koinos.chain.value_type.decode(vm.db.getObject(C.METADATA_SPACE, C.EXIT_CODE_KEY).value).int32_value || 0;
  if (code !== 0) {
    const m = vm.db.getObject(C.METADATA_SPACE, C.ERROR_MESSAGE_KEY);
    throw new Error((m ? new TextDecoder().decode(m.value) : '') + ' (exit ' + code + ')');
  }
  const r = vm.db.getObject(C.METADATA_SPACE, C.CONTRACT_RESULT_KEY);
  return r ? r.value : new Uint8Array(0);
}

// Minimal provider: reads and transactions execute directly on the mock VM.
const provider = {
  async readContract(op) {
    const res = run(op.entry_point, utils.decodeBase64url(op.args), null);
    return { result: utils.encodeBase64url(res), logs: [] };
  },
  async getNonce() { return 0; },
  async getNextNonce() { return 'KAE='; },
  async getChainId() { return 'EiBZK_GGVP0H_fXVAM3j6EAuz3-B-l3ejxRSewi7qIBfSA=='; },
  async getAccountRc() { return '100000000000000'; },
  async call(method) { throw new Error('unexpected rpc ' + method); },
  async sendTransaction(tx) {
    // all operations or none (snapshot the db)
    const snapshot = new Map(vm.db.db);
    try {
      for (const op of tx.operations) {
        if (process.env.DEBUG) console.log(JSON.stringify(op));
        assert.equal(op.call_contract.contract_id, CONTRACT);
        run(op.call_contract.entry_point, utils.decodeBase64url(op.call_contract.args), OWNER);
      }
    } catch (e) {
      vm.db.initDb([...snapshot.entries()]);
      throw e;
    }
    return { receipt: { id: tx.id }, transaction: { ...tx, wait: async () => ({ blockId: '0x1220', blockNumber: 1 }) } };
  },
  async wait() { return { blockId: '0x1220', blockNumber: 1 }; },
};

signer.provider = provider;
const contract = new Contract({ id: CONTRACT, abi, provider, signer });
const fn = contract.functions;
const EVENT = 'Abc23xyzKP';

function jpeg(n, seed) { const a = new Uint8Array(n).fill(seed); a[0] = 0xff; a[1] = 0xd8; a[2] = 0xff; return a; }
const b64url = (b) => utils.encodeBase64url(b);

let n = 0;
async function t(name, f) { await f(); n++; console.log('ok -', name); }

await t('register via koilib function + read back', async () => {
  const meta = chainMeta({ name: 'Sam & Alex', date: '2027-06-12' });
  await fn.register_event({ owner: OWNER, event_id: EVENT, meta });
  const { result } = await fn.get_event({ owner: OWNER, event_id: EVENT });
  assert.equal(result.value.exists, true);
  assert.deepEqual(JSON.parse(result.value.meta), { name: 'Sam & Alex', date: '2027-06-12', app: 'photoshare' });
});

const originals = [];
await t('batched add_keepsake in one transaction (archive.html path)', async () => {
  const tx = new Transaction({ signer, provider, options: { payer: OWNER } });
  for (let i = 0; i < 3; i++) {
    const sha = bytesToHex(new Uint8Array(32).fill(i + 1));
    originals.push({ sha256: sha, kind: 'photo', createdAt: 1000 + i });
    const data = jpeg(40000 + i, i + 3);
    assert.ok(keepsakeMimeOk('image/jpeg', data));
    await tx.pushOperation(fn.add_keepsake, { owner: OWNER, event_id: EVENT, mime: 'image/jpeg', data: b64url(data), caption: '', original_sha256: '0x' + sha });
  }
  await tx.prepare();
  await tx.sign();
  await tx.send();
  const { result } = await fn.get_event({ owner: OWNER, event_id: EVENT });
  assert.equal(result.value.keepsake_count, 3);
  const k = (await fn.get_keepsake({ owner: OWNER, event_id: EVENT, index: 2 })).result.value;
  assert.equal(k.mime, 'image/jpeg');
  assert.equal(utils.decodeBase64url(k.data).length, 40002);
  assert.equal(k.original_sha256, '0x' + originals[2].sha256);
});

await t('a bad operation reverts the whole batch', async () => {
  const tx = new Transaction({ signer, provider, options: { payer: OWNER } });
  await tx.pushOperation(fn.add_keepsake, { owner: OWNER, event_id: EVENT, mime: 'image/jpeg', data: b64url(jpeg(100, 1)), caption: '' });
  await tx.pushOperation(fn.add_keepsake, { owner: OWNER, event_id: EVENT, mime: 'image/jpeg', data: b64url(new Uint8Array(100)), caption: '' });
  await tx.prepare(); await tx.sign();
  await assert.rejects(tx.send());
  const { result } = await fn.get_event({ owner: OWNER, event_id: EVENT });
  assert.equal(result.value.keepsake_count, 3);
});

await t('anchor fingerprint and verify it like recover.html', async () => {
  const manifest = buildManifest({ eventId: EVENT, name: 'Sam & Alex', items: originals });
  const fp = await fingerprint(manifest);
  await fn.anchor_album({ owner: OWNER, event_id: EVENT, album_root: '0x' + fp.root, manifest_hash: '0x' + fp.manifestHash, photo_count: String(manifest.count) });
  const rec = (await fn.get_event({ owner: OWNER, event_id: EVENT })).result.value;
  assert.equal(rec.anchor_version, 1);
  assert.equal(rec.photo_count, '3');
  // recover.html: hash of the manifest file must equal on-chain manifest_hash, root must match
  const fileHash = bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fp.text))));
  assert.equal('0x' + fileHash, rec.manifest_hash);
  const root = bytesToHex(await merkleRoot(JSON.parse(fp.text).items.map((x) => x.h)));
  assert.equal('0x' + root, rec.album_root);
});

await t('reads for unknown owner/event return empty', async () => {
  const { result } = await fn.get_event({ owner: '12ddVGZ4mjErQ5SSrfAjeDo6E3L6uAmpZ9', event_id: EVENT });
  assert.ok(!result || !result.value || !result.value.exists);
  const l = (await fn.list_events({ owner: OWNER, start: 0, limit: 10 })).result;
  assert.deepEqual(l.event_ids, [EVENT]);
});

console.log(`\n${n} koilib integration tests passed`);
