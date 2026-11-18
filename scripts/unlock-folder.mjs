#!/usr/bin/env node
// Unlocks a downloaded Drive folder from a "Private storage" event, without the website or backend.
// Usage: node scripts/unlock-folder.mjs <key-backup.json> <EVENT_CODE> <folder-with-.enc-files> [output-folder]
// The key backup comes from the admin page ("Download key backup"). Nothing leaves your computer.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [backupPath, eventId, inDir, outArg] = process.argv.slice(2);
if (!backupPath || !eventId || !inDir) {
  console.error('Usage: node scripts/unlock-folder.mjs <key-backup.json> <EVENT_CODE> <folder> [output-folder]');
  process.exit(2);
}
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const k = (backup.keys || {})[eventId];
if (!k) { console.error(`No key for event ${eventId} in ${backupPath}`); process.exit(1); }
const key = Buffer.from(k.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
if (key.length !== 32) { console.error('That key backup looks damaged.'); process.exit(1); }
const outDir = outArg || path.join(inDir, 'unlocked');
fs.mkdirSync(outDir, { recursive: true });

let ok = 0, bad = 0;
const walk = (dir) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { if (path.resolve(p) !== path.resolve(outDir)) walk(p); continue; }
    if (!ent.name.endsWith('.enc')) continue;
    const data = fs.readFileSync(p);
    try {
      if (data.subarray(0, 4).toString('latin1') !== 'PSE1' || data.length < 32) throw new Error('not an Afterflash locked file');
      const iv = data.subarray(4, 16), tag = data.subarray(data.length - 16), ct = data.subarray(16, data.length - 16);
      const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
      d.setAuthTag(tag);
      const plain = Buffer.concat([d.update(ct), d.final()]);
      const name = path.basename(ent.name.slice(0, -4)).replace(/[^A-Za-z0-9._-]/g, '_');
      fs.writeFileSync(path.join(outDir, name), plain);
      ok++;
    } catch (e) { console.warn(`Skipped ${p}: ${e.message}`); bad++; }
  }
};
walk(inDir);
console.log(`Unlocked ${ok} file(s) into ${outDir}${bad ? `, skipped ${bad}` : ''}.`);
