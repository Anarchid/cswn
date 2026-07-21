#!/usr/bin/env node
// 2026-07-21 migration: the converter-era `detonation:` list + bare
// `"detonate"` trigger refs → explicit per-trigger death lists
// (MOD-FORMAT-SPEC.md §9.1, the detonate retirement).
//
//   - on.fuse: ["detonate"]            → [<effect ref>?, <splinter emit>?, {explo_sound}?]
//                                        (implicit remove — it's a fuse)
//   - on.collide_terrain: ["detonate"] → the full list + {remove}
//   - on.collide_worm "detonate"/{remove} tails → the full/quiet expansion
//     (splinters spawn on either death; effect + sound only on exploding
//     ones; explo_sound is wObject-class only — WL nObjects had no
//     exploSound slot)
//   - detonation: deleted
//
// Compiled behavior is unchanged: the engine expanded the markers into
// exactly these lists at load. Verified by expansion-normalized blob
// comparison at migration time. Run from the package root:
//
//   node tools/migrate-explicit-death-lists.mjs
//
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

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

let migrated = 0;

function pieces(def) {
  const effects = [], emits = [];
  for (const entry of def.detonation ?? []) {
    if (typeof entry === 'string') {
      if (entry === 'detonate') throw new Error('detonate inside its own detonation list');
      effects.push(entry);
    } else if (entry.emit) emits.push({ emit: entry.emit });
    else if (!entry.remove) throw new Error(`unexpected detonation entry ${JSON.stringify(entry)}`);
  }
  const sound = def.legacy?.particle_class === true ? [] : [{ explo_sound: {} }];
  return {
    full: [...effects, ...emits, ...sound, { remove: {} }],
    quiet: [...emits, { remove: {} }],
    fuse: [...effects, ...emits, ...sound],
  };
}

function replaceDetonateRefs(list, expansion) {
  const out = [];
  for (const entry of list) {
    if (entry === 'detonate') out.push(...expansion);
    else out.push(entry);
  }
  return out;
}

for (const f of readdirSync(join(root, 'particles'))) {
  if (!/\.json5?$/.test(f)) continue;
  const path = join(root, 'particles', f);
  const file = load(path);
  const def = file.def;
  if (def.detonation === undefined) continue;
  const p = pieces(def);

  if (Array.isArray(def.on?.fuse)) def.on.fuse = replaceDetonateRefs(def.on.fuse, p.fuse);
  if (Array.isArray(def.on?.collide_terrain)) {
    def.on.collide_terrain = replaceDetonateRefs(def.on.collide_terrain, p.full);
  }
  if (Array.isArray(def.on?.collide_worm)) {
    const list = def.on.collide_worm;
    const explode = list.includes('detonate');
    const consume = list.some((e) => typeof e === 'object' && e.remove);
    const head = list.filter((e) => e !== 'detonate' && !(typeof e === 'object' && e.remove));
    def.on.collide_worm = explode ? [...head, ...p.full]
      : consume ? [...head, ...p.quiet]
      : head;
  }
  delete def.detonation;
  migrated++;
  save(path, file);
}

console.log(`migrated ${migrated} particle def(s) to explicit death lists`);
