// Minimal in-memory mock of the Google Apps Script services used by backend/Code.gs.
// Enough fidelity to exercise the real backend code paths in Node.
import crypto from 'node:crypto';
import vm from 'node:vm';
import fs from 'node:fs';

const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const unsigned = (arr) => Buffer.from(arr.map((b) => (b < 0 ? b + 256 : b)));
let idCounter = 0;
const newId = (p) => `${p}${(++idCounter).toString(36)}x${crypto.randomBytes(12).toString('hex')}`;

export function createGas() {
  const props = new Map();
  const cache = new Map();
  const files = new Map(); // id -> file
  const sheets = new Map(); // id -> spreadsheet
  const logs = [];
  const faults = {};

  class Blob {
    constructor(bytes, mime, name) { this.bytes = bytes; this.mime = mime; this.name = name; }
    getBytes() { return this.bytes.slice(); }
    getContentType() { return this.mime; }
    setName(n) { this.name = n; return this; }
  }
  class File {
    constructor(blob, parent) {
      this.id = newId('f'); this.blob = blob; this.parent = parent; this.sharing = 'PRIVATE'; this.trashed = false; this.created = new Date();
      files.set(this.id, this);
    }
    getId() { return this.id; }
    getBlob() { return this.blob; }
    setSharing(access) { if (faults.sharing) throw new Error('Sharing is restricted by your organization'); this.sharing = access; }
    setTrashed(t) { this.trashed = t; }
    moveTo(folder) { this.parent = folder; }
    isTrashed() { return this.trashed; }
    getMimeType() { return this.blob.mime; }
    getName() { return this.blob.name || 'file'; }
    getDateCreated() { return this.created; }
    getThumbnail() { return new Blob(this.blob.bytes.slice(0, 2000), 'image/jpeg', 'thumb'); }
  }
  class Folder {
    constructor(name, parent) { this.id = newId('d'); this.name = name; this.parent = parent; this.trashed = false; files.set(this.id, this); }
    getId() { return this.id; }
    createFolder(name) { return new Folder(name, this); }
    getFoldersByName(name) {
      const list = [...files.values()].filter((f) => f instanceof Folder && f.parent === this && f.name === name);
      let i = 0;
      return { hasNext: () => i < list.length, next: () => list[i++] };
    }
    createFile(blob) { return new File(blob, this); }
    getFiles() {
      const list = [...files.values()].filter((f) => f instanceof File && f.parent === this);
      let i = 0;
      return { hasNext: () => i < list.length, next: () => list[i++] };
    }
    setTrashed(t) { this.trashed = t; }
  }
  class Range {
    constructor(sheet, r, c, nr = 1, nc = 1) { Object.assign(this, { sheet, r, c, nr, nc }); }
    getValues() {
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = this.sheet.rows[this.r - 1 + i] || [];
        const o = [];
        for (let j = 0; j < this.nc; j++) o.push(row[this.c - 1 + j] ?? '');
        out.push(o);
      }
      return out;
    }
    setValues(v) {
      for (let i = 0; i < this.nr; i++) {
        const idx = this.r - 1 + i;
        this.sheet.rows[idx] = this.sheet.rows[idx] || [];
        for (let j = 0; j < this.nc; j++) this.sheet.rows[idx][this.c - 1 + j] = v[i][j];
      }
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
  }
  class Sheet {
    constructor(name) { this.name = name; this.rows = []; }
    setName(n) { this.name = n; return this; }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
    appendRow(row) { if (faults.append) throw new Error('Service Spreadsheets failed'); this.rows.push(row.slice()); return this; }
    getLastRow() { return this.rows.length; }
    getDataRange() {
      const nc = Math.max(1, ...this.rows.map((r) => r.length));
      return new Range(this, 1, 1, Math.max(1, this.rows.length), nc);
    }
  }
  class Spreadsheet {
    constructor(name) { this.id = newId('s'); this.name = name; this.sheets = [new Sheet('Sheet1')]; sheets.set(this.id, this); files.set(this.id, new File(new Blob([], 'sheet', name), null)); files.get(this.id).id = this.id; }
    getId() { return this.id; }
    getSheets() { return this.sheets; }
    insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
    getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  }
  const root = new Folder('root', null);

  const g = {
    console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, String(v)), deleteProperty: (k) => props.delete(k) }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => cache.get(k) ?? null,
        put: (k, v) => { if (String(v).length > 100 * 1024) throw new Error('cache value too large'); cache.set(k, String(v)); },
        remove: (k) => cache.delete(k),
      }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock: () => {}, releaseLock: () => {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, input) => signed(crypto.createHash('sha256').update(typeof input === 'string' ? Buffer.from(input, 'utf8') : unsigned(input)).digest()),
      base64Decode: (s) => { if (!/^[A-Za-z0-9+/=]*$/.test(s)) throw new Error('bad b64'); return signed(Buffer.from(s, 'base64')); },
      base64DecodeWebSafe: (s) => signed(Buffer.from(s, 'base64url')),
      base64Encode: (b) => unsigned(b).toString('base64'),
      base64EncodeWebSafe: (b) => unsigned(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      getUuid: () => crypto.randomUUID(),
      newBlob: (data, mime, name) => new Blob(typeof data === 'string' ? signed(Buffer.from(data)) : data.slice(), mime, name),
      formatDate: (d) => d.toISOString().replace(/[-:]/g, '').slice(0, 15),
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' },
      Permission: { VIEW: 'VIEW', NONE: 'NONE' },
      createFolder: (n) => root.createFolder(n),
      getRootFolder: () => root,
      getFolderById: (id) => { const f = files.get(id); if (!(f instanceof Folder)) throw new Error('No folder ' + id); return f; },
      getFileById: (id) => { const f = files.get(id); if (!f || f instanceof Folder) throw new Error('No file ' + id); return f; },
    },
    SpreadsheetApp: {
      create: (n) => new Spreadsheet(n),
      openById: (id) => { const s = sheets.get(id); if (!s) throw new Error('No sheet ' + id); return s; },
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }),
    },
  };
  const ctx = vm.createContext(g);
  vm.runInContext(fs.readFileSync(new URL('../backend/Code.gs', import.meta.url), 'utf8'), ctx, { filename: 'Code.gs' });

  function post(body) {
    const res = ctx.doPost({ postData: { contents: JSON.stringify(body) } });
    return JSON.parse(res.body);
  }
  return { ctx, post, logs, files, props, cache, sheets, unsigned, faults };
}
