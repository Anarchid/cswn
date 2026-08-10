#!/usr/bin/env bash
#
# Provenance record for the 2026-08-10 flamethrower batch: exactly how
# sounds/flamer_loop.ogg and sounds/flamer_select.ogg were cut from Zero-K.
#
# Unlike tools/cut-new-sounds.sh (whose freesound originals live nowhere in
# particular), these two sources ship inside a game that is probably already
# installed: SRC defaults to a Zero-K game directory. Point it elsewhere if
# yours lives somewhere else. This is the record of what was done, not a build
# step — the .ogg outputs are committed.
#
#   SRC=/path/to/zk.sdd/sounds ./tools/cut-zk-flamer-sounds.sh
#
# LICENCE. Zero-K's legal.txt: "Unless otherwise specified everything in this
# project is released under the GNU General Public License or Public Domain",
# GPL v2 or later. cswn is GPL v2, so both cuts are redistributable here, and
# the Zero-K credit is recorded in sounds/origin.txt beside the nuke scar
# sprite that came from the same place. Note the pleasing circularity of the
# first one: zk's own sounds/weapon/origin.txt credits flamethrower.wav to
# OpenLieroX, so it is a Liero-clone sound going back into a Liero mod.
#
# Two things every cut has to get right — read cut-new-sounds.sh's header for
# the full statement of both. In short: everything in sounds/ is mastered FULL
# SCALE (the engine bridges the bank into Liero's 1/16 frame at play time), and
# a hard cut mid-signal is an audible click, so both ends get a fade. That
# matters more here than in the click batch, because flamer_loop is a LOOP
# CELL: it is re-triggered every `cooldown` ticks for as long as the trigger is
# held (particles/snd_flamer_loop.json5), so its two ends meet each other.
#
#   cell length 0.320 s vs a cooldown of 18 ticks (0.300 s) = 20 ms of overlap,
#   which is what the 20 ms fade-in and 30 ms fade-out crossfade into. Change
#   one of those three numbers and you have to change the others.
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SRC:-$HOME/.spring/games/zk.sdd/sounds}"
OUT="$ROOT/sounds"

# name | source | start | duration | peak target | fade-in | fade-out
#
# flamer_loop  — the source is a flat ~0.95 s roar (-13..-18 dBFS RMS the whole
#   way, no attack transient), so the cut is chosen for its TURBULENCE rather
#   than for any onset: 0.15-0.47 s spans the two loudest gouts, which at cell
#   rate reads as the flutter of a real flamethrower instead of a flat hiss.
#   Peak target sits under the one-shot gunshot band (bazooka 0.79) because
#   this one plays 3.3x a second for as long as you hold the trigger.
# flamer_select — the source starts on 50 ms of silence, then the torch lights
#   and settles over ~0.8 s. Taking 0.03-0.50 s keeps the ignition and the
#   first of the roar and throws away the long decay. Levelled into the
#   selection band with sight_on.ogg (0.48).
CUTS=$(cat <<'EOF'
flamer_loop     weapon/flamethrower.wav  0.150  0.320  0.550  0.020  0.030
flamer_select   misc/blowtorch.wav       0.030  0.470  0.500  0.005  0.150
EOF
)

while read -r name src ss dur target fin fout; do
  [ -z "$name" ] && continue
  cut="/tmp/cut_$name.wav"
  fstart=$(python3 -c "print(max(0, $dur - $fout))")
  # Pass 1: cut, downmix to mono, resample to the bank's working rate, fade.
  ffmpeg -nostdin -v error -y -ss "$ss" -t "$dur" -i "$SRC/$src" -ac 1 -ar 44100 \
    -af "afade=t=in:st=0:d=${fin},afade=t=out:st=${fstart}:d=${fout}" "$cut"
  # Pass 2: measure the cut's true peak and scale it onto the target.
  # NB: volumedetect reports at INFO level — `-v error` here silently yields
  # an empty peak and the gain maths blows up downstream.
  peak=$(ffmpeg -nostdin -i "$cut" -af volumedetect -f null - 2>&1 \
         | sed -n 's/.*max_volume: \([-0-9.]*\) dB.*/\1/p' | tail -1)
  gain=$(python3 -c "import math; print(f'{20*math.log10($target) - ($peak):.3f}')")
  ffmpeg -nostdin -v error -y -i "$cut" -af "volume=${gain}dB" \
    -c:a libvorbis -q:a 4 "$OUT/$name.ogg"
  rm -f "$cut"
  printf '%-16s %-24s +%sdB -> %s.ogg\n' "$name" "$src" "$gain" "$name"
done <<< "$CUTS"
