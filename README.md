# csliero-wormnõid

*cswn* for short. A total-conversion weapon mod for the wormnõid engine, in
its native package format: **124 weapons, 342 particles and 81 effects, one definition per file,
every one of them named for what it does.**

It began life as *csliero rewormed v0.36b*, a WebLiero mod whose entire
vocabulary was numeric — `wo47`, `nobj112`, sprite `s40_15` — with particles
reused across weapons and across each other, so that no filename told you
anything and no weapon's effect tree could be read without tracing ids by
hand. This repository is that mod after the untangling.

The engine is not public yet, so a checkout here is data without a runtime —
a legible one, which is rather the point.

## What's here

- `package.json5` — the manifest: engine sprite bindings, member index
- `weapons/`, `particles/`, `effects/` — one def per file. Particles are a
  single merged table; `legacy.particle_class` marks which of WebLiero's two
  entity classes a given def behaves as
- `sprites/` — RGBA flipbooks with JSON5 sidecars, plus palette and dirt fills
- `physics.json5` — worm/rope/aim constants, and the engine role bindings
  (`blood_particle`, `bonus_death_effect`, `bonus_spawn_effect`) that let a
  mod say *which* of its defs fills an engine-reserved job, by name
- `textures.json5`, `wl-id-map.tsv` — terrain fills, and the original-id
  crosswalk kept for archaeology

Names are not decoration here. Def ids are assigned in sorted-filename order,
so renaming a file permutes the id space the engine sees — which means the
rename that produced this tree had to be gated by a harness that recompiles
both versions and proves the engine observes an identical per-weapon effect
tree modulo the permutation. That gate earned its keep the hard way: it
passed clean, the playtest did not, and the hunt that followed found a real
namespace error that had been latent in the converter from the start.

## Provenance and permissions

The lineage, as far as the files themselves record it:

- **csliero 2.2b** by **Radon** — one of the best-known Liero total
  conversions, and a default mod in WebLiero
- **csliero rewormed v0.36b** — a later community revision, attributed in our
  notes to kami; the mod metadata itself records no author
- **csliero-webnoita** — our adaptation layer, replacing the weapons whose
  classic map-hacks don't survive a falling-sand engine (nuclear strike,
  gadget, nuka-cola, barracuda, badger)
- **csliero-wormnõid** — this repository: converted to the native package
  format, then hand-authored

One asset comes from outside that lineage: `sprites/nuke_scar.png`, the
nuclear-blast ground scar, is the Zero-K RTS project's `scar5_big.png` decal
([ZeroK-RTS/Zero-K](https://github.com/ZeroK-RTS/Zero-K), GPL v2),
downscaled. Credit and thanks to the Zero-K artists; that file keeps its
upstream license.

No license is known to have been published for any of the upstream work, and
none of it carries a license file. This package is published in the spirit in
which the Liero and WebLiero modding scene has always operated — where
reworking someone else's total conversion is the normal way of things, this
mod being itself a rework of a rework — and for the practical purpose of
demonstrating the native mod format.

If you are Radon, or made the rewormed revision, and would like attribution
corrected, terms stated, or this material taken down: please open an issue.
We will act on it.

## License

GPL v2, covering the work authored here — see [LICENSE](LICENSE), which sets
out what that does and does not extend to. In short: the packaging, naming,
organization and WebNoita adaptations are GPL v2 (matching the Zero-K asset
this package borrows); the inherited weapon data and sprite art carry
whatever status their original authors gave them, which is to say none
stated.
