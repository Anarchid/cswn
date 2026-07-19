# cswn-native

The native-format (MOD-FORMAT-SPEC T0 package) counterpart of *csliero
rewormed v0.36b* for the wormnõid engine — **hand-authored from here on**.

## Provenance

Bootstrapped by the T1 converter (`npm run t0-materialize -- --native-extras`)
from `webliero-mods/csliero-webnoita` (WL mod by Radon / kami lineage), last
regenerated at webnoita commit 47488e1 — the "merged particle table"
final regeneration, 2026-07-20. Earlier iterations of these files lived in
`webliero-mods/cs-wormnoid-native` (history preserved there).

**Do not regenerate over this tree.** The converter remains a bootstrap tool
for importing *other* WL mods; running it against this directory would
destroy authored changes. Format migrations arrive as migration scripts.

## Layout

- `package.json5` — manifest (engine sprite names, member index)
- `weapons/ particles/ effects/` — one def per file (§3); particles are one
  merged table (`legacy.particle_class` marks WL nObject-class behavior)
- `sprites/` — §6.1 RGBA flipbooks + sidecars, palette.png, dirt fills
- `physics.json5`, `textures.json5`
