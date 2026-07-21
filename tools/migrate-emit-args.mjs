#!/usr/bin/env node
// 2026-07-21 migration: legacy per-site emission spellings → §7 authored args
// (MOD-FORMAT-SPEC.md rev 13).
//
//   - detonation `emit: { ..., scatter: 0 }`  → `velocity: "radial", wl_free_step: true`
//   - detonation `emit: { ..., scatter: ≠0 }` → `velocity: "inherit", inherit: 1`
//   - `trails:` blocks → `on.tick` entries (unit "wl_tick_burst" for the WL
//     per-substep cadence; blood keeps the plain per-tick cadence), with the
//     physics.json5 trail divisors baked per-site as `wl_inherit_div`
//
// The compiled blob is byte-identical before and after (verified against the
// engine's compiler at migration time). Run from the package root:
//
//   node tools/migrate-emit-args.mjs
//
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// Def bodies are strict JSON under a // comment header.
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

// physics.json5 has interior comments (it is read, never rewritten) — a
// line-comment strip is enough for the two divisor values.
const physics = JSON.parse(readFileSync(join(root, 'physics.json5'), 'utf8')
  .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n'));
const DIVS = {
  larpa: Math.max(1, Math.round(physics.worm?.splinter_larpa_vel_div ?? 3)),
  crackler: Math.max(1, Math.round(physics.worm?.splinter_crackler_vel_div ?? 3)),
};

let emits = 0, trails = 0;

function migrateEmit(a) {
  if (a.scatter === undefined) return a;
  emits++;
  const { type, count, scatter, ...rest } = a;
  const extra = Object.keys(rest);
  if (extra.length) throw new Error(`unexpected emit keys alongside scatter: ${extra}`);
  return scatter === 0
    ? { type, count, velocity: 'radial', wl_free_step: true }
    : { type, count, velocity: 'inherit', inherit: 1 };
}

function migrateList(list) {
  for (const entry of list ?? []) {
    if (entry && typeof entry === 'object' && entry.emit) entry.emit = migrateEmit(entry.emit);
  }
}

function trailToTick(tr) {
  trails++;
  const every = tr.tick ?? 0;
  if (every === 0) throw new Error('zero-cadence trail (legacy sugar dropped these; decide by hand)');
  if (tr.effect !== undefined) {
    return { every, unit: 'wl_tick_burst', do: [tr.effect] };
  }
  const type = tr.spawn?.type;
  if (type === 'core:blood') {
    return { every, do: [{ emit: { type: 'core:blood' } }] };
  }
  return {
    every, unit: 'wl_tick_burst',
    do: [{ emit: (tr.larpa_mode ?? 0) === 1
      ? { type, velocity: 'inherit', wl_inherit_div: DIVS.larpa }
      : { type, velocity: 'radial', wl_inherit_div: DIVS.crackler, wl_free_step: true } }],
  };
}

for (const kind of ['particles', 'weapons', 'effects']) {
  for (const f of readdirSync(join(root, kind))) {
    if (!/\.json5?$/.test(f)) continue;
    const path = join(root, kind, f);
    const file = load(path);
    const def = file.def;
    const before = JSON.stringify(def);

    migrateList(def.detonation);
    for (const key of ['settle', 'collide_terrain', 'fuse', 'collide_worm']) migrateList(def.on?.[key]);
    for (const e of [...(def.on?.tick ?? []), ...(def.on?.step ?? [])]) migrateList(e.do);

    if (def.trails) {
      const entries = def.trails.map(trailToTick);
      delete def.trails;
      if (def.on) {
        def.on.tick = [...entries, ...(def.on.tick ?? [])];
      } else {
        def.on = { tick: entries };
      }
    }

    if (JSON.stringify(def) !== before) save(path, file);
  }
}

console.log(`migrated ${emits} emit site(s), ${trails} trail entr(ies); divisors`, DIVS);
