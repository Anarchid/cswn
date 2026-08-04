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

## Heat

Explosions in this mod leave the ground *hot*, and hot ground burns. The
engine has carried temperature per cell for a long time, but until the
`modify_temperature` verb landed (2026-07-30) no weapon could write to it, so
a map could declare a flammable material and a flashpoint and nothing in a
match could ever reach it. These are the numbers that close that loop.

The verb's limit is **directional**: with a positive `amount` it heats *up to*
the limit and refuses to touch anything already hotter, so bands stack toward
a ceiling instead of fighting each other. That is what lets a nuke's glow
apron sit at 150–190° while the 255 fireballs raining +25/limit-150 across it
leave both the apron and the 200° slag ring exactly where they are.

| tier | amount | limit | where |
| --- | --- | --- | --- |
| scorch | +25 | 150 | every yellow-circle explosion that digs, at ~1.5× its carve radius; every fire-weapon flame that lands, at r 4 (r 6 on the two that carve) |
| excimer | +25 | 80 | `laser_pulse`, annulus r 4–6, at the impact |
| plasma | +90 | 200 | `plasma_rocket`, r 6, at the impact |
| thermal pulse | +220 fading to zero at r 192 | 190 | `nuke_epicenter` / `nuka_epicenter`, in the same pass as the soot stain |

The thermal pulse is the mod's one faded disc (`falloff: 0`); everything else
keeps the default flat disc, which is what every stamp here was tuned
against — at r 4–12 a flat edge doesn't read, and flat is the shape a modder
can do arithmetic on. At nuke scale the edge *does* read, so the pulse fades:
riding the epicenter with the soot — one pass stains and heats, five ticks
before the shatter wave — its profile from a 20° ambient caps at 190° out to
d 43 (inside the crater), crosses `core:hot_rock`'s 150° flip at d 78 —
where the scar texture's alpha actually runs out, its stretched r 94 box
being mostly empty fringe — so everything sooted glows and the glow dies
with the soot, then grades fuel ignition out to ~d 139 before reaching true
zero at 192. The apron cools back out through hot_rock's 140° exit
afterwards.

The two constants worth knowing when you retune any of this:

- **80** is `core:wood`'s ignition point, and the highest flashpoint anything
  ships with. Every limit above it can start a fire. Ignition tests `>=`, so a
  limit of exactly 80 still lights wood.
- **200** is `core:sand`'s melting point, the lowest in the engine. Every
  limit below it is guaranteed never to turn ground to lava. Only plasma is
  allowed to reach it.

**Heat must always be wider than the carve it travels with**, and this is the
easiest thing here to get wrong. Bands run in list order over the world the
previous band left, and `carve` takes exactly the `DESTRUCTIBLE` cells — which
is exactly the fuel. A heat disc the size of its own crater therefore heats
nothing but air. It is silent: the shots land, the wood disappears, and not one
cell ever catches. Both `flame` and the excimer shipped that way for an hour
and were caught only by counting cells in a running match — 40 held laser shots
drilled 250 cells of timber and started zero fires. `plasma_rocket` (heat 6
over a carve of 3) and the explosion effects (~1.5×, and the heat band listed
after the carve) were right by construction.

Measured on `kamikaze/jungle-mossfire`, counting material in a 48×48 box on the
densest timber structure (523 cells of `timber`, flashpoint 80, ambient 0):

| weapon | result |
| --- | --- |
| M79 (plain explosion) | shells 1–3 carve and do not ignite; the **4th** lights it — 0→25→50→75→100 |
| EXCIMER LASER | first cells at the 2nd shot, settling into a ~60-cell smoulder |
| PLASMAROCKETS | ignites on the **first** hit (60 cells); 228 by the fourth |
| MOLOTOV COCKTAIL | one bottle: 523 timber → 27, 129 cells alight |
| NAPALM | one charge: 81% of the timber gone in about a second |

Scorch is deliberately too weak to light `core:wood` in one hit — it takes
three, or four on the jungle-mossfire tiers, which cool at about 7.5°/second
and so need the hits inside roughly a ten-second window. Sustained shelling
starts fires; a stray grenade does not. The soft tiers give way sooner:
jungle tinder (45) goes in two, `core:oil` (60) in two, bloodrun-emberfall's
banner cloth (58, and it never cools) in two whenever they happen to land.

A flame that burns out in mid-air rather than hitting anything leaves one
pixel of `core:fire` behind — the ember on `flame`, `napalm_flame` and
`bumblebee_flame`. Those three are the terminal flames; the delivery flames
already emit one of them, so putting the ember anywhere else double-counts it.

Since `core:hot_rock` (2026-08-02) heat is visible on plain rock too: any
band that reaches 150 makes the rock itself glow, which is what the nukes'
thermal pulse does out to the soot scar's rim. Below that line, on terrain
that is neither flammable nor emissive, heating writes a number nothing
reads. The fire payoff is still maps that declare fuel —
`kamikaze/jungle-mossfire` and `dsds/bloodrun-emberfall` today — and any map
authored against it later.

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
