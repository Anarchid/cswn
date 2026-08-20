#!/usr/bin/env node
// Rasters for the two rigidised cs weapons: DOBERMAN UAV9/DR and FORCE FIELD.
//
//   node tools/make-gunship-art.mjs
//
// Writes, into this package:
//   bodies/doberman_uav.png            blueprint mask (both phases share it)
//   bodies/doberman_uav.stain.png      the mod's own drone sprite, baked
//   bodies/doberman_uav_wrecked.stain.png   the same pixels, burnt
//   bodies/force_field_emitter.png     blueprint mask (all three phases)
//   bodies/force_field_emitter.stain.png
//   bodies/force_field_emitter_wrecked.stain.png
//   sprites/force_field_beam.png       PowerEternal's beamlaser, de-tinted
//   sprites/force_field_flare.png      2-frame beam-impact highlight
//   sprites/force_field_pod.png        the emitter as the carrier draws it
//
// ...and PRINTS the derived geometry (COM, muzzle reach, aperture offset) that
// the def files quote. Those numbers are hand-copied into bodies/*.json5 with a
// comment naming this script; move a silhouette and the print tells you what
// has to move with it.
//
// ---------------------------------------------------------------------------
// Where the look comes from
// ---------------------------------------------------------------------------
// Qwen-Image concept sheets (4 x 1024px, csreskin's lib/comfy.qwen_txt2img,
// prompts in the commit message) decided the visual LANGUAGE and nothing else,
// which is all diffusion is good for at this size — the hoverboard pass reached
// the same conclusion. What survived the trip down to 26px:
//
//   FORCE FIELD  a wide flat grey deck plate over an olive ribbed pod, a dark
//                viewport, an amber status lamp, and the emitter aperture on
//                the UNDERSIDE ringed with acid-green coils. Wrecked: casing
//                split, coils guttering, one leg bent, white arc flashes.
//
// The DOBERMAN concepts were binned. The mod already has a drone and it is a
// good one; a hand-quantised gunship next to it would just be a second drone.
// So the airframe is the existing `sprites/s653_16` art baked into the body,
// and only its burnt twin is new — see the section below.
//
// The deck plate is not decoration: a worm has to be able to walk on this
// thing, so the top two rows are flat, full-width and unbroken. Same reasoning
// as the hoverboard's tray, one step simpler — nothing here has to keep a
// rider aboard under thrust, only hold one up.
//
// The emitter's silhouette is a span table rather than region predicates. The
// hoverboard is a symmetric geometric object and reads best as painters over
// predicates; a legged pod does not, and a table of [row, x0, x1] spans is the
// form where a mistake is visible.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const PKG = dirname(dirname(fileURLToPath(import.meta.url)));
mkdirSync(join(PKG, 'bodies'), { recursive: true });
mkdirSync(join(PKG, 'sprites'), { recursive: true });

// ---- PNG encoders (same pair as tools/make-body-lab.mjs) --------------------
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function encodeIndexedPng(width, height, pixels, palette) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 3;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    pixels.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('PLTE', Buffer.from(palette)),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function encodeRgbaPng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- shared painting helpers ----------------------------------------------
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16)];
// Sprite-atlas alpha 64 and 128 are owner-tint BANDS, not opacities, and the
// painter clamps off both — nothing here wants to be recoloured per player.
const safeAlpha = (a) => (a === 64 || a === 128 ? a + 1 : a);
/** Deterministic 2-bit hash: the scuff/soot noise. No RNG — a rebuild of this
 *  file must be byte-identical or the blueprint (a SIM asset) forks. */
const grit = (x, y, k) => ((x * 7 + y * 13 + k * 31) * 2654435761 >>> 24) & 3;

/** A silhouette described as named span runs. Returns {mask, region, W, H}. */
function build(W, H, parts) {
  const mask = new Uint8Array(W * H);
  const region = new Array(W * H).fill(null);
  for (const [name, spans] of parts) {
    for (const [y, x0, x1] of spans) {
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || x >= W || y < 0 || y >= H) throw new Error(`${name} span off raster`);
        mask[y * W + x] = 1;
        region[y * W + x] = name;
      }
    }
  }
  return { mask, region, W, H };
}

/** Occupied-pixel centroid — the engine's body origin, and therefore the frame
 *  every `at:` in the def is measured in. Derived, never typed. */
function centroid({ mask, W, H }) {
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x]) { n++; sx += x + 0.5; sy += y + 0.5; }
    }
  }
  return [sx / n, sy / n, n];
}

const r2 = (v) => Math.round(v * 100) / 100;

/** Darken the OUTERMOST solid pixel of each row.
 *
 *  Not "any pixel with air beside it": at this scale the tail fin, the barrel
 *  and the landing legs are one or two pixels wide, every pixel of them has air
 *  on both sides, and the obvious spelling turns each into a black stick.
 *  Rows narrower than `minRun` are left alone for exactly that reason, and
 *  `skipRows` exempts the ones that are meant to glow edge to edge. */
function outlineRows(rgba, { mask, W, H }, ink, { minRun = 3, skipRows = [] } = {}) {
  for (let y = 0; y < H; y++) {
    if (skipRows.includes(y)) continue;
    const row = [];
    for (let x = 0; x < W; x++) if (mask[y * W + x]) row.push(x);
    if (row.length < minRun) continue;
    for (const x of [row[0], row[row.length - 1]]) {
      const i = (y * W + x) * 4;
      rgba[i] = ink[0]; rgba[i + 1] = ink[1]; rgba[i + 2] = ink[2];
    }
  }
}

/** Paint a silhouette through a per-region colour function. */
function paint(sil, colorAt) {
  const { mask, region, W, H } = sil;
  const rgba = Buffer.alloc(W * H * 4, 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      const c = colorAt(x, y, region[y * W + x]);
      if (!c) continue;
      const i = (y * W + x) * 4;
      rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2];
      rgba[i + 3] = safeAlpha(c.length > 3 ? c[3] : 255);
    }
  }
  return rgba;
}

/** Blueprint: a MASK, not a picture. With `material:` on the def its indices
 *  degrade to cell/no-cell and the whole body is that material — materials come
 *  from indices, never from colours, so the palette here exists only because
 *  PNG demands one. */
function writeBlueprint(path, sil) {
  const { mask, W, H } = sil;
  const px = Buffer.from(mask);
  const pal = new Uint8Array(256 * 3);
  pal.set([0, 0, 0], 0);
  pal.set([180, 180, 190], 3);
  writeFileSync(path, encodeIndexedPng(W, H, px, pal));
}

// ===========================================================================
// DOBERMAN UAV9/DR — the mod's own drone sprite, baked into a body
// ===========================================================================
// No new silhouette: the WL drone art stays the drone art. `sprites/s653_16`
// is sixteen DIRECTIONAL frames of the same craft seen from above, and a rigid
// body already has a real angle — so baking the +x-facing frame and letting the
// body's rotation choose the bearing reproduces the whole set, continuously
// instead of in sixteen steps.
//
// Frame 12 is that pose (0 = nose up, 4 = left, 8 = down, 12 = right; the tell
// is the pale nose spike, which points +x there and -x in frame 4). Local +x is
// therefore the bore, which is also the direction a body's lists emit along
// (`body_emit_dir`), so "down the barrel" costs an `offset:` and no arithmetic.
//
// ALPHA IS THE COLLISION MASK — the crate-body rule. This sheet uses only 0 and
// 255, so nothing lands on the atlas's 64/128 owner-tint bands and the bake is
// a straight copy.
const DOBERMAN_FRAME = 12;
const D_SRC = (() => {
  const { w, h, rgba } = decodeRgbaPng(readFileSync(join(PKG, 'sprites/s653_16.png')));
  const fw = w / 16;
  if (fw !== Math.floor(fw)) throw new Error('s653_16 is not 16 frames wide');
  // Crop to the frame's own ink: the sheet cell is 23x23 of mostly nothing, and
  // a body whose bitmap is 80% empty pays for every one of those cells in
  // broadphase and in the CA stamp.
  let x0 = fw, x1 = -1, y0 = h, y1 = -1;
  const at = (x, y) => (y * w + DOBERMAN_FRAME * fw + x) * 4;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < fw; x++) {
      if (rgba[at(x, y) + 3] === 0) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const W = x1 - x0 + 1, H = y1 - y0 + 1;
  const px = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      rgba.copy(px, (y * W + x) * 4, at(x0 + x, y0 + y), at(x0 + x, y0 + y) + 4);
    }
  }
  return { W, H, px };
})();
const DW = D_SRC.W, DH = D_SRC.H;
const DOBERMAN = (() => {
  const mask = new Uint8Array(DW * DH);
  for (let i = 0; i < DW * DH; i++) mask[i] = D_SRC.px[i * 4 + 3] ? 1 : 0;
  return { mask, region: new Array(DW * DH).fill('hull'), W: DW, H: DH };
})();
const [DCX, DCY, DCELLS] = centroid(DOBERMAN);
const MUZZLE = [DW - 0.5, DH / 2];            // tip of the nose spike, bore centre
const BORE = r2(MUZZLE[0] - DCX);             // COM -> muzzle, along local +x
const BORE_DY = r2(MUZZLE[1] - DCY);

/** The intact stain IS the sprite. */
function paintDrone() {
  return Buffer.from(D_SRC.px);
}

/** The wreck: the same 39 pixels, burnt.
 *
 *  Colour-driven rather than position-driven, because there is no silhouette
 *  here that this file authored — it is somebody else's 7x11 sprite, and a
 *  hand-placed decal on it would be a magic coordinate that breaks the day the
 *  frame index changes. So: knock the airframe down to charcoal and rust by
 *  channel, then turn the two brightest pixels — the reactor core and the hot
 *  spot beside it — into embers. Every rule below reads the SOURCE pixel.
 *
 *  The MASK is untouched, and deliberately: the morph spawns the wreck at the
 *  intact body's own COM, so two silhouettes with different centroids would
 *  land it off by the difference. Damage is paint, which is also exactly what
 *  "a damaged version with a charred texture" asks for. */
function paintDroneWrecked() {
  const out = Buffer.from(D_SRC.px);
  for (let y = 0; y < DH; y++) {
    for (let x = 0; x < DW; x++) {
      const i = (y * DW + x) * 4;
      if (!out[i + 3]) continue;
      const r = out[i], g = out[i + 1], b = out[i + 2];
      const lum = (r * 3 + g * 6 + b) / 10;
      let c;
      if (g > 100 && g > r) {
        // The green reactor core, cooked: this is the one pixel a player looks
        // at to tell the two phases apart at a glance.
        c = hex('#dc732c');
      } else if (r > 120 && g < 80) {
        // Red airframe -> charred maroon, with the darkest plates going to soot
        // so the burn is not a flat repaint.
        c = grit(x, y, 12) === 0 ? hex('#221a18') : (r > 190 ? hex('#5a2a22') : hex('#3a221e'));
      } else if (Math.abs(r - g) < 24 && Math.abs(g - b) < 24) {
        // Greys (the nose spike, the wing pins) -> dulled and slightly warm,
        // as bare steel goes once the paint is off it.
        const v = Math.round(lum * 0.42);
        c = [v + 8, v + 3, v];
      } else {
        c = hex('#4c3632');                       // the orange accents rust out
      }
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2];
    }
  }
  // One ember at the trailing edge of the widest row — the hole the 250 damage
  // went through, and the anchor the smoke and sparks are emitted from.
  const holeY = Math.round(DH / 2);
  for (let x = 0; x < DW; x++) {
    const i = (holeY * DW + x) * 4;
    if (!out[i + 3]) continue;
    if (x === 0) { out[i] = 0; out[i + 1] = 0; out[i + 2] = 0; }
    else if (x === 1) { const e = hex('#b45527'); out[i] = e[0]; out[i + 1] = e[1]; out[i + 2] = e[2]; }
    break;
  }
  return out;
}

writeBlueprint(join(PKG, 'bodies/doberman_uav.png'), DOBERMAN);
writeFileSync(join(PKG, 'bodies/doberman_uav.stain.png'),
  encodeRgbaPng(DW, DH, paintDrone()));
writeFileSync(join(PKG, 'bodies/doberman_uav_wrecked.stain.png'),
  encodeRgbaPng(DW, DH, paintDroneWrecked()));


// ===========================================================================
// FORCE FIELD emitter — 18 x 12, rotation-locked, walkable
// ===========================================================================
// Rows 0-1 are the deck plate: flat, full width, unbroken. That is the whole
// reason the pod is 18 wide rather than the 12 the casing needs — a worm has to
// find somewhere to stand, and a two-pixel ledge is not somewhere.
//
// The aperture is UNDER the pod, between the legs, because the beam leaves
// straight down (`angle: 270`, absolute — the body is `fixed_rotation`, so a
// pose-blind bearing is the honest spelling).
const FW = 18, FH = 12;
const EMITTER = build(FW, FH, [
  ['plate', [[0, 0, 17], [1, 0, 17]]],
  ['casing', [[2, 2, 15], [3, 2, 15], [4, 2, 15], [5, 2, 15], [6, 3, 14]]],
  ['housing', [[7, 4, 13]]],
  ['coil', [[8, 5, 12], [9, 6, 11]]],
  ['mouth', [[10, 7, 10]]],
  ['leg', [[7, 2, 3], [8, 1, 2], [9, 0, 1], [10, 0, 1], [11, 0, 2],
    [7, 14, 15], [8, 15, 16], [9, 16, 17], [10, 16, 17], [11, 15, 17]]],
]);
const [FCX, FCY, FCELLS] = centroid(EMITTER);
const APERTURE = [8.5, FH + 1.5];             // 1.5px clear of the pod's underside

const F_INTACT = {
  ink: hex('#10130f'),
  oliveD: hex('#2b3326'), olive: hex('#4a5540'), oliveL: hex('#66734f'),
  gunD: hex('#414949'), gun: hex('#697273'), gunL: hex('#96a4a4'),
  grnD: hex('#2c5320'), grn: hex('#4f7c33'), grnL: hex('#7ad945'), grnW: hex('#c8ffa0'),
  amber: hex('#f09730'),
};
const F_WRECK = {
  ink: hex('#080907'),
  oliveD: hex('#1a1815'), olive: hex('#2e2b26'), oliveL: hex('#413a32'),
  gunD: hex('#222626'), gun: hex('#3d4142'), gunL: hex('#5f6462'),
  grnD: hex('#20351d'), grn: hex('#336d3a'), grnL: hex('#4e8f3e'), grnW: hex('#76c871'),
  amber: hex('#6a4a24'),                      // status lamp dead
  rust: hex('#58453a'), arc: hex('#dfeeff'),
};

function paintEmitter(wreck) {
  const P = wreck ? F_WRECK : F_INTACT;
  const rgba = paint(EMITTER, (x, y, reg) => {
    switch (reg) {
      case 'plate':
        // Two values, not one: the top row catches the light and the row under
        // it is the plate's own thickness. One value reads as a floating bar.
        if (y === 0) return grit(x, y, 8) === 0 ? P.gun : P.gunL;
        return x <= 1 || x >= FW - 2 ? P.ink : P.gunD;
      case 'casing': {
        if (y >= 3 && y <= 4 && x >= 4 && x <= 8) return y === 3 ? P.ink : P.gunD; // viewport
        if (y === 3 && x === 12) return P.amber;                                    // status lamp
        if (y === 6) return P.oliveD;
        if (x >= 10 && x <= 13 && (y === 4 || y === 5)) {
          return y === 4 ? P.oliveD : P.ink;                                        // cooling vents
        }
        return y === 2 ? P.oliveL : (grit(x, y, 9) === 0 ? P.oliveD : P.olive);
      }
      case 'housing':
        return x <= 5 || x >= 12 ? P.gunD : P.gun;
      case 'coil': {
        // Two coil rings, the lower one hotter — the field is being wound up
        // toward the mouth, so brightness has to increase downward.
        const ring = y === 8 ? [P.grnD, P.grn] : [P.grn, P.grnL];
        return grit(x, y, 10) === 0 ? ring[0] : ring[1];
      }
      case 'mouth':
        return x === 7 || x === 10 ? P.grnL : P.grnW;
      case 'leg':
        return x <= 2 || x >= FW - 3 ? P.gunD : P.gun;
      default:
        return P.olive;
    }
  });
  const put = (x, y, c, a = 255) => {
    if (x < 0 || x >= FW || y < 0 || y >= FH) return;
    if (!EMITTER.mask[y * FW + x]) return;
    const i = (y * FW + x) * 4;
    rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; rgba[i + 3] = safeAlpha(a);
  };
  if (wreck) {
    // Split casing: a black seam running down from the deck with the coil
    // light leaking out of it, which is what says the damage is INTERNAL.
    for (const [x, y] of [[9, 2], [9, 3], [9, 4], [10, 5], [10, 6]]) put(x, y, [0, 0, 0]);
    put(8, 3, F_WRECK.rust); put(8, 4, F_WRECK.grn); put(9, 5, F_WRECK.grnW);
    // Rust bloom around the seam and up under the plate.
    for (const [x, y] of [[11, 2], [12, 2], [7, 2], [13, 4], [3, 5], [12, 5]]) {
      put(x, y, F_WRECK.rust);
    }
    // Arc flash across the severed vent cabling — a CONNECTED zigzag, because
    // three unconnected white pixels read as dirt on the screen, not as
    // electricity.
    for (const [x, y] of [[11, 4], [12, 4], [12, 5], [13, 5], [13, 6]]) {
      put(x, y, F_WRECK.arc);
    }
    // Buckled left leg, and one foot missing its pad.
    put(1, 8, [0, 0, 0]); put(0, 9, F_WRECK.rust); put(0, 10, [0, 0, 0]);
  }
  // Rows 8-10 are the coils and the mouth: outlining them eats the glow.
  outlineRows(rgba, EMITTER, P.ink, { minRun: 4, skipRows: [8, 9, 10] });
  return rgba;
}

writeBlueprint(join(PKG, 'bodies/force_field_emitter.png'), EMITTER);
writeFileSync(join(PKG, 'bodies/force_field_emitter.stain.png'),
  encodeRgbaPng(FW, FH, paintEmitter(false)));
writeFileSync(join(PKG, 'bodies/force_field_emitter_wrecked.stain.png'),
  encodeRgbaPng(FW, FH, paintEmitter(true)));

// ===========================================================================
// sprites/force_field_pod.png — the emitter, in flight
// ===========================================================================
// The intact stain again, re-emitted as a sprite. The FORCE FIELD is thrown as
// a carrier particle that coasts for 22 ticks and only THEN unfolds into the
// body (particles/force_field_cell.json5), and that carrier used to be drawn
// with nothing at all: for a third of a second after the throw the screen was
// empty and the pod then appeared to teleport into place. The original could
// afford an invisible carrier because its drips started falling three ticks
// in, so the FIELD was the throw's feedback; a body that unfolds at the end
// has no such cover.
//
// Drawing the carrier with the body's own pixels closes that gap without
// touching the flight at all — the thing you watch fly is the thing that
// lands, and the handover is invisible because there is nothing to hand over.
// Same buffer, so the two can never drift apart.
//
// The sidecar's origin is [-9, -5]: the negated COM ([9, 5.15]) at whole-pixel
// resolution. `spawn_body` lands the body's ANCHOR on the carrier's position,
// and with no `spawn_offset` the anchor is the COM — so that is the one offset
// that makes sprite and body cover the same pixels.
writeFileSync(join(PKG, 'sprites/force_field_pod.png'),
  encodeRgbaPng(FW, FH, paintEmitter(false)));

// ===========================================================================
// sprites/force_field_beam.png — dark/PowerEternal's beamlaser, de-tinted
// ===========================================================================
// The source (`sprites/beam.png`, byte-identical to the one in
// gusanos/dark/PowerEternal.wnmd) is a chevron chain drawn in the RED CHANNEL
// ONLY — g and b top out at 15. The beam shader multiplies texel by the line's
// `color`, so tinting that file green multiplies ~0 by green and the beam
// disappears. Lifting r into all three channels leaves the identical pattern
// and hands the hue back to `line.color`, where it belongs.
{
  const src = readFileSync(join(PKG, 'sprites/beam.png'));
  const { w, h, rgba } = decodeRgbaPng(src);
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Math.max(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = rgba[i * 4 + 3];
  }
  writeFileSync(join(PKG, 'sprites/force_field_beam.png'), encodeRgbaPng(w, h, out));
}

// ===========================================================================
// sprites/force_field_flare.png — the beam's impact highlight, 2 frames of 9x9
// ===========================================================================
// PowerEternal's flare is 32x32 with an r10 / intensity-2 light on a beam 15px
// wide. This beam is 6px wide and fires every single frame from a pod a worm
// can stand next to, so the highlight is a third of the size and a fraction of
// the light — a 32px bloom at 60Hz is a green screen, not a spark.
{
  const S = 9, N = 2;
  const rgba = Buffer.alloc(S * N * S * 4, 0);
  const stride = S * N;
  const cols = [hex('#c8ffa0'), hex('#7ad945'), hex('#4f7c33')];
  for (let f = 0; f < N; f++) {
    const rad = f === 0 ? 3.4 : 4.2;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x - (S - 1) / 2, dy = y - (S - 1) / 2;
        const d = Math.hypot(dx, dy);
        // A four-point star, not a disc: a disc at nine pixels reads as a blob
        // and the whole job of this sprite is to say "the beam ends HERE".
        const spike = Math.abs(dx) < 0.6 || Math.abs(dy) < 0.6;
        const reach = spike ? rad + 1.3 : rad * 0.62;
        if (d > reach) continue;
        const c = d <= 1.2 ? cols[0] : d <= rad * 0.7 ? cols[1] : cols[2];
        const i = (y * stride + f * S + x) * 4;
        rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2];
        rgba[i + 3] = f === 0 ? 255 : 191;
      }
    }
  }
  writeFileSync(join(PKG, 'sprites/force_field_flare.png'), encodeRgbaPng(stride, S, rgba));
}

// ---- minimal RGBA PNG reader (8-bit colour type 6, the only form here) -----
function decodeRgbaPng(buf) {
  let p = 8, w = 0, h = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6) throw new Error('want 8-bit RGBA png');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * 4;
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[y * stride + i - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + i] = v & 255;
    }
  }
  return { w, h, rgba: out };
}

// ---- the numbers the def files quote ---------------------------------------
console.log(`
DOBERMAN UAV9/DR   ${DW}x${DH}, ${DCELLS} cells
  COM (blueprint px)      [${r2(DCX)}, ${r2(DCY)}]
  muzzle                  [${MUZZLE[0]}, ${MUZZLE[1]}]
  emit  offset:           ${BORE}        <- COM -> muzzle down the bore
  bore/COM y mismatch     ${BORE_DY}     <- keep small; the bore is +x from COM

FORCE FIELD emitter ${FW}x${FH}, ${FCELLS} cells
  COM (blueprint px)      [${r2(FCX)}, ${r2(FCY)}]
  aperture (blueprint px) [${APERTURE[0]}, ${APERTURE[1]}]
  emit  at:               [${r2(APERTURE[0] - FCX)}, ${r2(APERTURE[1] - FCY)}]
  spark bed at:           [${r2(8.5 - FCX)}, ${r2(4.5 - FCY)}]   scatter: [10, 5]

Both bodies omit \`spawn_offset\`, so their action lists run AT the COM and every
\`at:\` above is a COM-relative nudge. Each phase pair shares one blueprint, so a
morph lands COM on COM with no offset arithmetic at all.
`);
