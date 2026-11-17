// Runs the compiled contract wasm inside @koinos/mock-vm and exercises every entry point.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { MockVM } = require('@koinos/mock-vm');
const C = require('@koinos/mock-vm/src/constants.js');
const { koinos } = require('@koinos/proto-js');
const { Serializer, utils } = require('koilib');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const abi = JSON.parse(fs.readFileSync(path.join(root, 'abi/photoshare-abi.json'), 'utf8'));
const wasm = new WebAssembly.Module(fs.readFileSync(path.join(root, 'build/test/contract.wasm')));
const ser = new Serializer(abi.koilib_types);

const vm = new MockVM(true);
const CONTRACT = utils.decodeBase58('1ESUaEUU6SEvsTfCSvfPZ7AHVfpFhdGubx');
const OWNER = '1ESjKUfpqNasvQDS7gmKNCCbbzLLPRr7jR';
const STRANGER = '12ddVGZ4mjErQ5SSrfAjeDo6E3L6uAmpZ9';
const vt = (o) => koinos.chain.value_type.encode(o).finish();
const put = (k, v) => vm.db.putObject(C.METADATA_SPACE, k, v);

put(C.CONTRACT_ID_KEY, CONTRACT);
put(C.HEAD_INFO_KEY, koinos.chain.head_info.encode({ head_block_time: 1700000000000, head_topology: { height: 10 } }).finish());
put(C.CALLER_KEY, koinos.chain.caller_data.encode({ caller: new Uint8Array(0), caller_privilege: 1 }).finish());

function setAuth(addr, ok) {
  put(C.AUTHORITY_KEY, koinos.chain.list_type.encode({ values: [{ bool_value: ok, bytes_value: utils.decodeBase58(addr), int32_value: 0 }] }).finish());
}

async function call(method, args, { auth = OWNER, ok = true } = {}) {
  const m = abi.methods[method];
  setAuth(auth, ok);
  put(C.ENTRY_POINT_KEY, vt({ int32_value: m.entryPoint | 0 }));
  put(C.CONTRACT_ARGUMENTS_KEY, await ser.serialize(args, m.input));
  vm.db.removeObject(C.METADATA_SPACE, C.CONTRACT_RESULT_KEY);
  vm.db.removeObject(C.METADATA_SPACE, C.ERROR_MESSAGE_KEY);
  vm.db.removeObject(C.METADATA_SPACE, C.EXIT_CODE_KEY);
  vm.db.commitTransaction();
  const inst = new WebAssembly.Instance(wasm, { env: vm.getImports() });
  inst.exports.memory.grow(512);
  vm.setInstance(inst);
  try { inst.exports._start(); } catch (e) { /* exit is signalled by throwing */ }
  const code = koinos.chain.value_type.decode(vm.db.getObject(C.METADATA_SPACE, C.EXIT_CODE_KEY).value).int32_value || 0;
  const res = vm.db.getObject(C.METADATA_SPACE, C.CONTRACT_RESULT_KEY);
  const err = vm.db.getObject(C.METADATA_SPACE, C.ERROR_MESSAGE_KEY);
  return {
    code,
    error: err ? new TextDecoder().decode(err.value) : '',
    result: res ? await ser.deserialize(res.value, m.output) : {},
  };
}

const hex = (n, b) => '0x' + b.toString(16).padStart(2, '0').repeat(n);
const jpeg = (n) => { const a = new Uint8Array(n).fill(7); a[0] = 0xff; a[1] = 0xd8; a[2] = 0xff; return utils.encodeBase64url(a); };

let pass = 0;
async function t(name, fn) { await fn(); pass++; console.log('ok -', name); }

await t('register + read', async () => {
  const r = await call('register_event', { owner: OWNER, event_id: 'abcd1234', meta: '{"name":"Test"}' });
  assert.equal(r.code, 0, r.error);
  const g = await call('get_event', { owner: OWNER, event_id: 'abcd1234' });
  assert.equal(g.result.value.exists, true);
  assert.equal(g.result.value.meta, '{"name":"Test"}');
  assert.equal(g.result.value.created_at, '1700000000000');
  const l = await call('list_events', { owner: OWNER, start: 0, limit: 10 });
  assert.deepEqual(l.result.event_ids, ['abcd1234']);
});
await t('duplicate rejected', async () => {
  const r = await call('register_event', { owner: OWNER, event_id: 'abcd1234', meta: '{}' });
  assert.notEqual(r.code, 0); assert.match(r.error, /already registered/);
});
await t('unauthorized rejected and state unchanged', async () => {
  const r = await call('register_event', { owner: OWNER, event_id: 'evil0001', meta: '{}' }, { ok: false });
  assert.notEqual(r.code, 0); assert.match(r.error, /authorization failed/);
  const g = await call('get_event', { owner: OWNER, event_id: 'evil0001' });
  assert.ok(!g.result.value || !g.result.value.exists);
});
await t('stranger cannot write to owner event', async () => {
  const r = await call('anchor_album', { owner: OWNER, event_id: 'abcd1234', album_root: hex(32, 1), manifest_hash: hex(32, 2), photo_count: '3' }, { auth: STRANGER, ok: true });
  assert.notEqual(r.code, 0);
});
await t('bad ids / big meta rejected', async () => {
  assert.notEqual((await call('register_event', { owner: OWNER, event_id: 'bad id!', meta: '' })).code, 0);
  assert.notEqual((await call('register_event', { owner: OWNER, event_id: 'ab', meta: '' })).code, 0);
  assert.notEqual((await call('register_event', { owner: OWNER, event_id: 'okid0001', meta: 'x'.repeat(513) })).code, 0);
});
await t('anchor versions', async () => {
  const r1 = await call('anchor_album', { owner: OWNER, event_id: 'abcd1234', album_root: hex(32, 1), manifest_hash: hex(32, 2), photo_count: '42' });
  assert.equal(r1.code, 0, r1.error); assert.equal(r1.result.anchor_version, 1);
  const r2 = await call('anchor_album', { owner: OWNER, event_id: 'abcd1234', album_root: hex(32, 3), manifest_hash: hex(32, 4), photo_count: '43' });
  assert.equal(r2.result.anchor_version, 2);
  const g = await call('get_event', { owner: OWNER, event_id: 'abcd1234' });
  assert.equal(g.result.value.photo_count, '43');
  assert.equal(g.result.value.album_root, hex(32, 3));
  assert.notEqual((await call('anchor_album', { owner: OWNER, event_id: 'abcd1234', album_root: hex(31, 1), manifest_hash: hex(32, 2), photo_count: '1' })).code, 0);
});
await t('keepsakes: large (48KiB) round trip, remove', async () => {
  const big = jpeg(49152);
  const r = await call('add_keepsake', { owner: OWNER, event_id: 'abcd1234', mime: 'image/jpeg', data: big, caption: 'first dance', original_sha256: hex(32, 9) });
  assert.equal(r.code, 0, r.error); assert.equal(r.result.index ?? 0, 0);
  const r2 = await call('add_keepsake', { owner: OWNER, event_id: 'abcd1234', mime: 'image/jpeg', data: jpeg(100), caption: '' });
  assert.equal(r2.code, 0, r2.error); assert.equal(r2.result.index, 1);
  const g = await call('get_keepsake', { owner: OWNER, event_id: 'abcd1234', index: 0 });
  assert.equal(g.code, 0, g.error);
  assert.equal(g.result.value.data, big);
  assert.equal(g.result.value.caption, 'first dance');
  assert.equal((await call('remove_keepsake', { owner: OWNER, event_id: 'abcd1234', index: 0 })).code, 0);
  const g2 = await call('get_keepsake', { owner: OWNER, event_id: 'abcd1234', index: 0 });
  assert.equal(g2.result.value.removed, true);
  assert.ok(!g2.result.value.data);
});
await t('keepsakes: reject non-images / oversize / bad mime', async () => {
  const notImg = utils.encodeBase64url(new Uint8Array(500));
  assert.notEqual((await call('add_keepsake', { owner: OWNER, event_id: 'abcd1234', mime: 'image/jpeg', data: notImg, caption: '' })).code, 0);
  assert.notEqual((await call('add_keepsake', { owner: OWNER, event_id: 'abcd1234', mime: 'image/jpeg', data: jpeg(49153), caption: '' })).code, 0);
  assert.notEqual((await call('add_keepsake', { owner: OWNER, event_id: 'abcd1234', mime: 'image/svg+xml', data: jpeg(100), caption: '' })).code, 0);
  assert.notEqual((await call('add_keepsake', { owner: OWNER, event_id: 'nope0000', mime: 'image/jpeg', data: jpeg(100), caption: '' })).code, 0);
});
await t('owner isolation', async () => {
  const g = await call('get_event', { owner: STRANGER, event_id: 'abcd1234' });
  assert.ok(!g.result.value || !g.result.value.exists);
});
console.log(`\n${pass} contract tests passed`);
