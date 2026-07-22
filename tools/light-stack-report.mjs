#!/usr/bin/env node
// Light-stack tree checker: statically walks the weapon → particle → effect
// emission graph and estimates, per weapon, the PEAK number of concurrently
// stacked light sources (and their summed nominal intensity). The lighting
// composite clamps at 1.0, so summed intensity far above 1 is exactly the
// overbright ("bloom") the lightbench measures — mass sibling spawns
// (40 fragments × explosion_medium@1.1) dwarf any single light.
//
// Output: per-weapon peak stack ranking + per-lit-def worst sibling count
// with a proposed √n-normalized intensity (the virus-spore precedent:
// 99-120 spores were hand-tuned from 0.5 to 0.05 ≈ /√100).
//
// Usage: node tools/light-stack-report.mjs [--defs] [--weapon NAME]
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Strip //-comments (string-aware) so JSON.parse handles our JSON5 subset. */
function parseJson5(text) {
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') { inStr = true; out += c; }
    else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else out += c;
  }
  return JSON.parse(out);
}

function loadDir(kind) {
  const defs = new Map();
  for (const f of readdirSync(join(root, kind))) {
    if (!f.endsWith('.json5')) continue;
    defs.set(f.replace(/\.json5$/, ''), parseJson5(readFileSync(join(root, kind, f), 'utf8')));
  }
  return defs;
}
const weapons = loadDir('weapons');
const particles = loadDir('particles');
const effects = loadDir('effects');
const kindOf = (name) => particles.has(name) ? 'particle' : effects.has(name) ? 'effect' : null;
const defOf = (name) => particles.get(name) ?? effects.get(name);

/** Extract (ref, count) pairs from an action list. */
function refsOf(actions) {
  const out = [];
  for (const a of actions ?? []) {
    if (typeof a === 'string') out.push({ ref: a, count: 1 });
    else if (a && typeof a === 'object' && a.emit?.type) out.push({ ref: a.emit.type, count: a.emit.count ?? 1 });
  }
  return out;
}

const lightOf = (def) => def?.presentation?.light ?? null;
const intensityOf = (l) => (l && typeof l.intensity === 'number') ? l.intensity : l ? 1 : 0;

/**
 * Peak concurrent light stack reachable from `name` at multiplicity `mult`.
 * A particle has two phases that never coexist for one instance:
 *  - flight: its own light + steady-state trail lights (tick emitters ×
 *    child lifetime / period)
 *  - death: one alternative trigger's burst (all children simultaneous —
 *    upper bound; fuse variance spreads them a little in reality)
 * The reported peak is whichever phase stacks more summed intensity;
 * siblings' phases are treated as synchronized (they are: shared fuse).
 * Returns { total, insts: Map<defName, count> } for the peak phase.
 */
function peakStack(name, mult, path = new Set(), depth = 0) {
  const empty = { total: 0, insts: new Map() };
  if (depth > 8 || path.has(name)) return empty;
  const def = defOf(name);
  if (!def) return empty;
  const next = new Set(path); next.add(name);

  const own = lightOf(def) ? intensityOf(lightOf(def)) * mult : 0;
  const ownInsts = lightOf(def) ? new Map([[name, mult]]) : new Map();
  if (kindOf(name) === 'effect') return { total: own, insts: ownInsts };

  const merge = (a, b) => {
    const insts = new Map(a.insts);
    for (const [k, v] of b.insts) insts.set(k, (insts.get(k) ?? 0) + v);
    return { total: a.total + b.total, insts };
  };

  // flight phase: own light + steady trails
  let flight = { total: own, insts: ownInsts };
  for (const t of def.on?.tick ?? []) {
    const every = Math.max(1, t.every ?? 1);
    for (const { ref, count } of refsOf(t.do)) {
      const child = defOf(ref);
      // Trail steady-state (child lifetime / emit period) compounds absurdly
      // through nested trails and the runtime caps lights at 1024/frame
      // anyway — only model it when asked; default counts one generation.
      const life = child?.fuse?.ticks > 0 ? child.fuse.ticks : 10;
      const steady = process.argv.includes('--steady')
        ? Math.max(1, Math.min(60, Math.round(life / every))) : 1;
      flight = merge(flight, peakStack(ref, mult * count * steady, next, depth + 1));
    }
  }

  // death phase: best (worst) alternative
  let death = empty;
  for (const [trig, actions] of Object.entries(def.on ?? {})) {
    if (trig === 'tick') continue;
    let alt = { total: 0, insts: new Map() };
    for (const { ref, count } of refsOf(actions)) {
      alt = merge(alt, peakStack(ref, mult * count, next, depth + 1));
    }
    if (alt.total > death.total) death = alt;
  }

  return death.total > flight.total ? death : flight;
}

// --- per-weapon report ---
const args = process.argv.slice(2);
const only = args.includes('--weapon') ? args[args.indexOf('--weapon') + 1] : null;
const rows = [];
const worstSiblings = new Map(); // lit def -> max concurrent count across weapons

for (const [wname, w] of weapons) {
  const title = w.presentation?.name ?? wname;
  if (only && !title.toLowerCase().includes(only.toLowerCase())) continue;
  let stack = { total: 0, insts: new Map() };
  for (const { ref, count } of refsOf(w.on?.fire)) {
    const s = peakStack(ref, count);
    stack = { total: stack.total + s.total, insts: stack.insts };
    for (const [k, v] of s.insts) stack.insts.set(k, (stack.insts.get(k) ?? 0) + v);
  }
  for (const [dn, n] of stack.insts) {
    worstSiblings.set(dn, Math.max(worstSiblings.get(dn) ?? 0, n));
  }
  rows.push({ title, total: stack.total, insts: stack.insts });
}

rows.sort((a, b) => b.total - a.total);
console.log('peak-stacked-intensity  weapon  (def×count@intensity, top contributors)');
for (const r of rows) {
  if (r.total === 0) continue;
  const parts = [...r.insts]
    .map(([dn, n]) => ({ dn, n, contrib: n * intensityOf(lightOf(defOf(dn))) }))
    .sort((a, b) => b.contrib - a.contrib)
    .slice(0, 4)
    .map((p) => `${p.dn}×${p.n}@${intensityOf(lightOf(defOf(p.dn)))}`);
  console.log(`${r.total.toFixed(1).padStart(8)}  ${r.title}  [${parts.join(', ')}]`);
}

if (args.includes('--defs') || args.includes('--apply')) {
  console.log('\nworst sibling count per lit def → proposed /√n intensity (inferred lights only):');
  const drows = [...worstSiblings]
    .map(([dn, n]) => ({ dn, n, l: lightOf(defOf(dn)) }))
    .filter((d) => d.n > 1)
    .sort((a, b) => b.n * intensityOf(b.l) - a.n * intensityOf(a.l));
  for (const { dn, n, l } of drows) {
    const cur = intensityOf(l);
    const prop = cur / Math.sqrt(n);
    const tag = l.inferred ? '' : '  [AUTHORED — hands off]';
    console.log(`${String(n).padStart(5)}×  ${dn}: ${cur} → ${prop.toFixed(3)}${tag}`);
  }
}

// --- --bake: graduate inferred lights with the engine's approved curve -----
// Writes the SAME values the engine's runtime stack-normalization produces
// (webnoita ts/src/light-stacks.ts — walk + curve MUST match it exactly,
// verified by lightbench parity after baking) and drops "inferred": true:
// the lights become authored, the engine skips them (no double-scaling),
// and the room's inferWeaponLights rule no longer affects this package.
if (args.includes('--bake')) {
  const T = 8;      // must match light-stacks.ts targetTotal
  const BUFF = 1.15; // must match light-stacks.ts buff
  const q4 = (v) => Math.round(v * 1e4) / 1e4;
  const scale = (S) => S > 0 ? BUFF * T * (1 - Math.exp(-S / T)) / S : 1;

  // Engine-parity walk (port of stackCountsFromT0): per-weapon SUM of paths,
  // global MAX across weapons; per particle, each child ref takes the MAX
  // contribution across its trigger lists (death alternatives never co-fire
  // and usually repeat the same children); trails count one generation.
  const engineCounts = new Map();
  for (const [, w] of weapons) {
    const acc = new Map();
    const bump = (name, n) => acc.set(name, (acc.get(name) ?? 0) + n);
    const walk = (name, mult, path, depth) => {
      if (depth > 8 || path.has(name) || mult <= 0) return;
      if (effects.has(name)) { bump(name, mult); return; }
      const def = particles.get(name);
      if (!def) return;
      bump(name, mult);
      const next = new Set(path); next.add(name);
      const childMult = new Map();
      for (const [trig, actions] of Object.entries(def.on ?? {})) {
        if (trig === 'tick') continue;
        const perList = new Map();
        for (const { ref, count } of refsOf(actions)) {
          perList.set(ref, (perList.get(ref) ?? 0) + count);
        }
        for (const [ref, count] of perList) {
          childMult.set(ref, Math.max(childMult.get(ref) ?? 0, count));
        }
      }
      for (const t of def.on?.tick ?? []) {
        for (const { ref, count } of refsOf(t.do)) {
          childMult.set(ref, Math.max(childMult.get(ref) ?? 0, count));
        }
      }
      for (const tr of def.trails ?? []) {
        const ref = tr.effect ?? tr.spawn?.type;
        if (typeof ref === 'string') childMult.set(ref, Math.max(childMult.get(ref) ?? 0, 1));
      }
      for (const [ref, count] of childMult) walk(ref, mult * count, next, depth + 1);
    };
    for (const { ref, count } of refsOf(w.on?.fire)) walk(ref, count, new Set(), 0);
    for (const [name, n] of acc) engineCounts.set(name, Math.max(engineCounts.get(name) ?? 0, n));
  }

  const { writeFileSync } = await import('node:fs');
  let baked = 0;
  for (const [name, def] of [...particles, ...effects]) {
    const l = lightOf(def);
    if (!l || l.inferred !== true) continue;
    const kind = kindOf(name) === 'particle' ? 'particles' : 'effects';
    const file = join(root, kind, `${name}.json5`);
    let text = readFileSync(file, 'utf8');
    const S = intensityOf(l) * Math.max(1, engineCounts.get(name) ?? 0);
    const newI = q4(intensityOf(l) * scale(S));
    const before = text;
    text = text.replace(
      /("light"\s*:\s*\{[^}]*"intensity"\s*:\s*)([0-9.]+)/,
      (_, pre) => `${pre}${newI}`,
    );
    text = text.replace(/,(\s*)"inferred": true(?=\s*\})/, '');
    if (text === before) { console.log(`  !! no edit landed in ${file}`); continue; }
    writeFileSync(file, text);
    baked++;
    console.log(`  baked: ${name} ${intensityOf(l)} → ${newI} (n=${engineCounts.get(name) ?? 0})`);
  }
  console.log(`${baked} defs graduated to authored`);
}
