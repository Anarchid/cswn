/**
 * One-shot migration, 2026-08-05: lift the 30 csliero-derived wavs out of the
 * Liero 1/16 frame and onto full scale, so every file in sounds/ is mastered
 * the same way a map's sounds are and the engine does the bridging.
 *
 * These files were written by tools/migrate-sounds.mjs as `s16 = s8 * 16`,
 * which put the 8-bit source at 1/16 of int16 full scale — matching what the
 * engine's own `.snd` parse (s8/2048) produces, back when the mod bank played
 * at unity. Now that the named bank is bridged by LIERO_FRAME_GAIN like the
 * map bank, that baked-in 1/16 would land them at 1/256.
 *
 * So: multiply by 16, giving `s16 = s8 * 256` — the canonical int8→int16
 * upconversion. This is EXACT and reversible, not a normalisation:
 *   - every sample is already a multiple of 16 (verified before running);
 *   - the bank's largest positive sample is 2032, so 2032*16 = 32512 fits,
 *     and the -2048 peaks land on -32768, int16's true floor. Nothing clips,
 *     nothing rounds, and playback through the new 1/16 bridge reproduces the
 *     old buffers sample-for-sample.
 *
 * Idempotency: a file is "already lifted" if x16 would clip it. Note that
 * all-multiples-of-16 is NOT the test on its own — the lifted form (s8*256) is
 * a multiple of 16 too, so a second run sees the same thing the first did and
 * must be stopped by headroom, not by divisibility.
 *
 *   node tools/unbake-liero-frame.mjs [--check]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'sounds');
const check = process.argv.includes('--check');

/** Offset and length of a RIFF/WAVE `data` chunk. */
function dataChunk(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let p = 12;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (id === 'data') return { start: p + 8, size: Math.min(size, buf.length - p - 8) };
    p += 8 + size + (size & 1); // chunks are word-aligned
  }
  throw new Error('no data chunk');
}

let done = 0, skipped = 0;
for (const f of readdirSync(DIR).sort()) {
  if (!f.endsWith('.wav')) continue;
  const buf = readFileSync(join(DIR, f));
  const { start, size } = dataChunk(buf);
  const n = size >> 1;

  let allMul16 = true, maxPos = 0, minNeg = 0;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(start + i * 2);
    if (s % 16 !== 0) { allMul16 = false; break; }
    if (s > maxPos) maxPos = s;
    if (s < minNeg) minNeg = s;
  }
  const wouldClip = maxPos * 16 > 32767 || minNeg * 16 < -32768;
  if (wouldClip || !allMul16) {
    console.log(`  skip ${f.padEnd(15)} — already full scale`
      + (wouldClip ? ' (no headroom for x16)' : ' (not 8-bit-derived)'));
    skipped++;
    continue;
  }
  if (!check) {
    for (let i = 0; i < n; i++) {
      buf.writeInt16LE(buf.readInt16LE(start + i * 2) * 16, start + i * 2);
    }
    writeFileSync(join(DIR, f), buf);
  }
  console.log(`  ${check ? 'would lift' : 'lifted'} ${f.padEnd(15)} peak ${String(Math.max(maxPos, -minNeg)).padStart(5)} -> ${Math.max(maxPos, -minNeg) * 16}`);
  done++;
}
console.log(`${check ? 'checked' : 'rewrote'} ${done} file(s), skipped ${skipped}`);
