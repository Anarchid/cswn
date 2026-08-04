#!/usr/bin/env bash
#
# Provenance record for the 2026-08-05 trigger-hook sound batch: exactly how
# the nine shipped sounds/*.ogg were cut from their freesound originals.
#
# The originals are NOT in this repo — they are multi-megabyte multi-take
# recordings, and anything with a .wav/.ogg extension anywhere under a package
# directory becomes an index member and gets downloaded by every client. Grab
# them from the URLs in sounds/origin.txt and point SRC at wherever you put
# them; this script is the record of what was done to them, not a build step.
#
#   SRC=/path/to/originals ./tools/cut-new-sounds.sh
#
# Two things every cut has to get right:
#
# 1. LEVEL. Everything in sounds/ is mastered FULL SCALE; the engine bridges
#    the whole named bank into Liero's 1/16 frame at play time. So these
#    targets are ordinary peak-normalisation figures, and they are relative to
#    each other, not to any absolute frame: dry clicks sit with hurt1.wav
#    (0.73), the selection blip with select.wav (0.40), and the plasma shot in
#    the gunshot band alongside the bazooka.wav (0.79) it replaces. The
#    inherited csliero wavs were lifted onto the same scale by
#    tools/unbake-liero-frame.mjs — read its header before touching levels.
# 2. FADES. Several source takes are hard-cut mid-signal (the laser power-up
#    ends at full level); without the tail fade the cut itself is an audible
#    click, which is comic on a sound whose whole job is to be a click.
#
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${SRC:-$ROOT/../cswn-sound-sources}"
OUT="$ROOT/sounds"

# LICENCE NOTE. cswn is GPL v2 and ships on itch, so every source here has to
# permit commercial redistribution: these are CC0 or CC-BY 4.0 only. The batch
# also contained freesound 515194 (JoseIgnacioTriay, "rifle, assault rifle mp5,
# empty chamber, dry fire") which is **CC-BY-NC** — unusable, and deliberately
# not merely unreferenced but absent. The rifle class is cut from jackyyang09's
# CC-BY "Generic Firearm Dryfire" instead, and the heavy class from
# DrinkingWindGames' CC-BY shotgun pull dropped ~4 semitones (an adaptation
# CC-BY allows, credited in sounds/origin.txt like any other).
#
# name | source | start | duration | peak target | fade-in | fade-out | rate
CUTS=$(cat <<'EOF'
dryfire_pistol   9mm_dryfire.wav      0.000  0.270  0.720  0.000  0.040  1.00
dryfire_rifle    dryfire_generic.wav  0.000  0.190  0.720  0.000  0.030  1.00
dryfire_shotgun  dryfire_shotgun.wav  0.000  0.265  0.720  0.000  0.050  1.00
dryfire_heavy    dryfire_shotgun.wav  0.000  0.265  0.720  0.000  0.050  0.78
laser_charge     lazer_in_out.wav     0.000  1.005  0.768  0.000  0.015  1.00
laser_drain      lazer_in_out.wav     1.900  1.120  0.768  0.005  0.080  1.00
energy_reload    energy_activate.wav  0.000  0.960  0.768  0.000  0.070  1.00
sight_on         switch_on.wav        0.000  0.300  0.480  0.000  0.060  1.00
plasma_blast     blaster.aiff        17.980  1.470  0.880  0.000  0.100  1.00
EOF
)

while read -r name src ss dur target fin fout rate; do
  [ -z "$name" ] && continue
  cut="/tmp/cut_$name.wav"
  fstart=$(python3 -c "print(max(0, $dur - $fout))")
  # `rate` < 1 is a tape-style pitch drop: asetrate reinterprets the sample
  # rate (pitch AND length move together, which is what makes a click read as
  # a bigger mechanism), aresample puts it back on 44100. The fade offsets are
  # in SOURCE time, so they go before the stretch.
  shift_f=""
  [ "$rate" != "1.00" ] && shift_f=",asetrate=44100*${rate},aresample=44100"
  # Pass 1: cut, downmix to mono, resample to the bank's working rate, fade.
  ffmpeg -nostdin -v error -y -ss "$ss" -t "$dur" -i "$SRC/$src" -ac 1 -ar 44100 \
    -af "afade=t=in:st=0:d=${fin},afade=t=out:st=${fstart}:d=${fout}${shift_f}" "$cut"
  # Pass 2: measure the cut's true peak and scale it onto the Liero frame.
  # NB: volumedetect reports at INFO level — `-v error` here silently yields
  # an empty peak and the gain maths blows up downstream.
  peak=$(ffmpeg -nostdin -i "$cut" -af volumedetect -f null - 2>&1 \
         | sed -n 's/.*max_volume: \([-0-9.]*\) dB.*/\1/p' | tail -1)
  gain=$(python3 -c "import math; print(f'{20*math.log10($target) - ($peak):.3f}')")
  ffmpeg -nostdin -v error -y -i "$cut" -af "volume=${gain}dB" \
    -c:a libvorbis -q:a 4 "$OUT/$name.ogg"
  rm -f "$cut"
  printf '%-16s %s +%sdB -> %s.ogg\n' "$name" "$src" "$gain" "$name"
done <<< "$CUTS"
