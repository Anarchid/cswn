#!/usr/bin/env node
// 2026-07-22 migration: soundpack decomposition (MOD-FORMAT-SPEC.md §16.1
// item 7) — the legacy csliero.zip Liero soundpack becomes individual named
// files in sounds/, and numeric `sounds_wl` index blocks become filename
// `presentation.sounds` refs:
//
//   - sounds/<name>.wav ×30 extracted from the pack's sounds.snd (names come
//     from the SND directory itself; 8-bit samples widened to 16-bit PCM as
//     s16 = s8 * 16, which keeps playback amplitude bit-identical to the
//     engine's parseSnd path: (s8*16)/32768 == s8/2048)
//   - weapons: sounds_wl {fire, play_reload, reload} → sounds {fire?, reload?}
//     (play_reload true → the pack's RELOADED sample; reload >= 0 overrides)
//   - particles: sounds_wl {explode} → sounds {explode?}
//   - effects: sounds_wl {start, num} → sounds {start} — num > 1 becomes a
//     random-pick list {any: [...]} of the num consecutive samples
//
// The compiled blob is byte-identical before and after (presentation blocks
// never reach the blob). package.json5 is hand-edited separately: remove
// legacy_assets.soundpack, add the engine-slot `sounds:` map (hurt/death/
// bump/throw). Idempotent. Run from the package root:
//
//   node tools/migrate-sounds.mjs [path/to/csliero.zip]
//
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const zipPath = process.argv[2] ?? join(root, '..', '..', 'liero-soundpacks', 'csliero.zip');

// --- Extract sounds.snd from the pack zip (store/deflate members only) ---
function zipEntry(zip, wanted) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP: no end-of-central-directory');
  let pos = zip.readUInt32LE(eocd + 16);
  while (pos < eocd) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) break;
    const method = zip.readUInt16LE(pos + 10), csize = zip.readUInt32LE(pos + 20);
    const nl = zip.readUInt16LE(pos + 28), el = zip.readUInt16LE(pos + 30), cl = zip.readUInt16LE(pos + 32);
    const lho = zip.readUInt32LE(pos + 42);
    const name = zip.toString('latin1', pos + 46, pos + 46 + nl);
    if (name === wanted) {
      const lnl = zip.readUInt16LE(lho + 26), lel = zip.readUInt16LE(lho + 28);
      const data = zip.subarray(lho + 30 + lnl + lel, lho + 30 + lnl + lel + csize);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error(`ZIP: unsupported method ${method}`);
    }
    pos += 46 + nl + el + cl;
  }
  throw new Error(`ZIP: ${wanted} not found`);
}

// --- Parse the SND directory: count u16, then per sound 8-byte name +
// u32 offset + u32 length; samples are signed 8-bit @22050 Hz mono ---
function parseSnd(snd) {
  const count = snd.readUInt16LE(0);
  const out = [];
  let p = 2;
  for (let i = 0; i < count; i++) {
    const name = snd.toString('latin1', p, p + 8).replace(/\0.*$/, '').trim();
    const off = snd.readUInt32LE(p + 8), len = snd.readUInt32LE(p + 12);
    out.push({ name, samples: snd.subarray(off, off + len) });
    p += 16;
  }
  return out;
}

function writeWav(path, s8) {
  const n = s8.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);       // PCM
  buf.writeUInt16LE(1, 22);       // mono
  buf.writeUInt32LE(22050, 24);   // sample rate
  buf.writeUInt32LE(22050 * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);       // block align
  buf.writeUInt16LE(16, 34);      // bits per sample
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(s8.readInt8(i) * 16, 44 + i * 2);
  writeFileSync(path, buf);
}

const sounds = parseSnd(zipEntry(readFileSync(zipPath), 'sounds.snd'));
const fileOf = (idx) => {
  const s = sounds[idx];
  if (!s) throw new Error(`sound index ${idx} out of range (pack has ${sounds.length})`);
  return s.name.toLowerCase() + '.wav';
};
const RELOADED = sounds.findIndex((s) => s.name === 'RELOADED');
if (RELOADED < 0) throw new Error('pack has no RELOADED sample');

mkdirSync(join(root, 'sounds'), { recursive: true });
for (const s of sounds) writeWav(join(root, 'sounds', s.name.toLowerCase() + '.wav'), s.samples);
console.log(`sounds/: ${sounds.length} wav files from ${zipPath}`);

// --- Def rewrites. Bodies are strict JSON under a // comment header. ---
function load(path) {
  const lines = readFileSync(path, 'utf8').split('\n');
  let hdr = 0;
  while (hdr < lines.length && lines[hdr].startsWith('//')) hdr++;
  return { header: lines.slice(0, hdr), def: JSON.parse(lines.slice(hdr).join('\n')) };
}
function save(path, { header, def }) {
  const body = JSON.stringify(def, null, 2) + '\n';
  writeFileSync(path, header.length ? header.join('\n') + '\n' + body : body);
}

// Replace sounds_wl with sounds in place (key order preserved); an empty
// refs map drops the key entirely.
function swapKey(pres, refs) {
  const out = {};
  for (const [k, v] of Object.entries(pres)) {
    if (k !== 'sounds_wl') { out[k] = v; continue; }
    if (Object.keys(refs).length > 0) out.sounds = refs;
  }
  return out;
}

let weapons = 0, particles = 0, effects = 0;
for (const kind of ['weapons', 'particles', 'effects']) {
  for (const f of readdirSync(join(root, kind)).sort()) {
    if (!/\.json5?$/.test(f)) continue;
    const path = join(root, kind, f);
    const doc = load(path);
    const wl = doc.def.presentation?.sounds_wl;
    if (wl === undefined) continue;
    const refs = {};
    if (kind === 'weapons') {
      if ((wl.fire ?? -1) >= 0) refs.fire = fileOf(wl.fire);
      if (wl.play_reload === true) refs.reload = fileOf((wl.reload ?? -1) >= 0 ? wl.reload : RELOADED);
      weapons++;
    } else if (kind === 'particles') {
      if ((wl.explode ?? -1) >= 0) refs.explode = fileOf(wl.explode);
      particles++;
    } else {
      const start = wl.start ?? -1, num = wl.num ?? 0;
      if (start >= 0) {
        refs.start = num > 1
          ? { any: Array.from({ length: num }, (_, i) => fileOf(start + i)) }
          : fileOf(start);
      }
      effects++;
    }
    doc.def.presentation = swapKey(doc.def.presentation, refs);
    save(path, doc);
  }
}
console.log(`defs: ${weapons} weapons, ${particles} particles, ${effects} effects migrated`);
console.log('REMINDER: hand-edit package.json5 — remove legacy_assets.soundpack,');
console.log('add the engine-slot sounds: map — then regenerate package.index.json.');
