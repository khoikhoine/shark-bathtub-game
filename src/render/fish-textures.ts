import { CanvasTexture, ClampToEdgeWrapping, NoColorSpace, RepeatWrapping, SRGBColorSpace } from 'three/webgpu';
import type { SpeciesSpec } from '../sim/types.ts';

type RGB = readonly [number, number, number];
type Skin = 'scale' | 'smooth' | 'plate';
type Details = Readonly<{ normalMap: CanvasTexture; roughnessMap: CanvasTexture }>;
type FishTextures = Readonly<{ map: CanvasTexture; normalMap: CanvasTexture; roughnessMap: CanvasTexture }>;
interface Spot { t: number; c: number; rx: number; ry: number; phase: number }
interface AtlasPaint {
  spec: SpeciesSpec; body: RGB; accent: RGB; third: RGB; underside: RGB; dark: RGB;
  pale: RGB; seed: number; spots: readonly Spot[]; cells: readonly Spot[]; aa: number;
}

const TAU = Math.PI * 2;
const NEUTRAL: RGB = [229, 231, 216];
const WHITE: RGB = [255, 255, 255];
const maps = new Map<string, FishTextures>();
const details = new Map<Skin, Details>();
const HIGH_RES: Readonly<Partial<Record<string, true>>> = {
  discus: true, mandarin: true, 'emperor-angelfish': true, 'whale-shark': true,
};
const NEUTRAL_UNDERSIDE: Readonly<Partial<Record<string, true>>> = {
  koi: true, clownfish: true, 'blue-tang': true, 'moorish-idol': true,
};

function clamp(x: number, low = 0, high = 1): number { return Math.max(low, Math.min(high, x)); }
function smooth(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function band(x: number, center: number, width: number, aa: number): number {
  return 1 - smooth(width - aa, width + aa, Math.abs(x - center));
}
function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number, aa: number): number {
  const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
  return 1 - smooth(1 - aa, 1 + aa, d);
}
function rgb(hex: string): RGB {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
function blend(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function fnv(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
function hash(seed: number, index: number): number {
  let h = Math.imul(seed ^ index, 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** One reusable pixel accumulator, so atlas baking does not allocate per texel. */
class Paint {
  r = 0; g = 0; b = 0;
  set(c: RGB): void { this.r = c[0]; this.g = c[1]; this.b = c[2]; }
  mix(c: RGB, amount: number): void {
    const t = clamp(amount);
    this.r += (c[0] - this.r) * t; this.g += (c[1] - this.g) * t; this.b += (c[2] - this.b) * t;
  }
  shade(amount: number): void { this.r *= amount; this.g *= amount; this.b *= amount; }
}

function makePaint(spec: SpeciesSpec, size: number): AtlasPaint {
  const body = rgb(spec.colors[0]), accent = rgb(spec.colors[1]), third = rgb(spec.colors[2]);
  const seed = fnv(spec.id);
  const spots: Spot[] = [], cells: Spot[] = [];
  for (let i = 0; i < 45; i++) spots.push({
    t: .04 + .94 * hash(seed, i * 6), c: hash(seed, i * 6 + 1),
    rx: .008 + .025 * hash(seed, i * 6 + 2), ry: .012 + .035 * hash(seed, i * 6 + 3),
    phase: TAU * hash(seed, i * 6 + 4),
  });
  // Jittered cells form branching, closed, non-parallel labyrinth boundaries.
  for (let row = 0; row < 6; row++) for (let col = 0; col < 8; col++) {
    const i = row * 8 + col;
    cells.push({ t: (col + .2 + .6 * hash(seed, 500 + i * 2)) / 8,
      c: -1.2 + (row + .2 + .6 * hash(seed, 501 + i * 2)) * .4,
      rx: 1, ry: 1, phase: 0 });
  }
  return { spec, body, accent, third, underside: NEUTRAL_UNDERSIDE[spec.id] ? blend(body, NEUTRAL, .65) : third,
    dark: blend(body, [14, 24, 27], .72), pale: blend(body, NEUTRAL, .5), seed, spots, cells, aa: 1.25 / size };
}

function spotMask(p: AtlasPaint, t: number, c: number, count: number, irregular = true): number {
  let result = 0;
  for (let i = 0; i < count; i++) {
    const s = p.spots[i];
    const dx = (t - s.t) / s.rx;
    const dy = Math.min(Math.abs(c - s.c), 1 - Math.abs(c - s.c)) / s.ry;
    if (Math.abs(dx) > 1.3 || dy > 1.3) continue;
    const angle = Math.atan2(dy, dx);
    const radius = irregular ? 1 + .16 * Math.sin(angle * 3 + s.phase) + .09 * Math.cos(angle * 5 - s.phase) : 1;
    result = Math.max(result, 1 - smooth(radius - .1, radius + .1, Math.hypot(dx, dy)));
  }
  return result;
}

function mazeMask(p: AtlasPaint, t: number, y: number, width: number): number {
  const u = t + .014 * Math.sin(19 * y + 9 * t) + .008 * Math.cos(37 * y - 13 * t);
  const v = y + .042 * Math.sin(25 * t + 6 * y) + .02 * Math.cos(49 * t - 11 * y);
  let first = Infinity, second = Infinity;
  for (const cell of p.cells) {
    const d = (u - cell.t) ** 2 * 5 + (v - cell.c) ** 2;
    if (d < first) { second = first; first = d; } else if (d < second) second = d;
  }
  return 1 - smooth(width, width + p.aa * 1.8, Math.sqrt(second) - Math.sqrt(first));
}

function bars(t: number, y: number, centers: readonly number[], width: number, curve: number, aa: number): number {
  let mask = 0;
  for (let i = 0; i < centers.length; i++) mask = Math.max(mask, band(t, centers[i] + curve * (y * y - .25), width, aa));
  return mask;
}

const ANGEL_BARS = [.075, .31, .57, .82];
const COPPER_BARS = [.055, .29, .55, .81];
const CLOWN_BARS = [.145, .49, .84];
const CICHLID_BARS = [.2, .36, .52, .68, .84];
const MOORISH_BARS = [.13, .54, .91];
const LION_BARS = [.06, .21, .37, .52, .68, .83, .96];
const LEOPARD_SADDLES = [.18, .39, .62, .84];

function bodyPixel(p: AtlasPaint, t: number, c: number, out: Paint): void {
  const angle = c * TAU, y = Math.sin(angle), flank = Math.abs(Math.cos(angle));
  const belly = smooth(-.08, -.78, y), dorsal = smooth(.03, .9, y);
  const { body, accent, underside, dark, aa } = p;
  out.set(body);
  out.mix(dark, .18 * dorsal);
  out.mix(underside, belly * .78);
  // Very subtle directional sheen, not a painted universal scale pattern.
  out.mix(p.pale, .02 * flank * (1 - belly));
  switch (p.spec.id) {
    case 'guppy':
      out.mix(accent, .2 * smooth(.6, .94, t) * (1 - belly));
      out.mix(p.pale, band(y, .14, .045, aa) * .45 * flank);
      break;
    case 'goldfish':
      out.mix(accent, .18 * Math.sin(t * Math.PI) * (1 - belly));
      out.mix(underside, .3 * smooth(-.1, -.7, y));
      break;
    case 'neon-tetra': {
      out.mix(dark, .22 * (1 - belly));
      out.mix(accent, smooth(.45, .52, t) * smooth(.16, -.1, y));
      const stripe = band(y, .19, .105, aa * 2) * smooth(.015, .055, t) * (1 - smooth(.96, 1, t));
      out.mix(body, stripe);
      out.mix(underside, stripe * .22);
      break;
    }
    case 'zebra-danio': {
      // Five horizontal flank lines run from head to peduncle, not rings along Z.
      let stripe = 0;
      for (let i = 0; i < 5; i++) stripe = Math.max(stripe, band(y, -.66 + i * .33, .065, aa * 2));
      out.mix(accent, stripe * (.45 + .55 * flank));
      break;
    }
    case 'platy': out.mix(accent, smooth(.91, .995, t)); break;
    case 'molly': out.mix(accent, spotMask(p, t, c, 38)); break;
    case 'swordtail': out.mix(accent, band(y, -.02, .035, aa) * .5); break;
    case 'white-cloud':
      out.mix(accent, smooth(.85, .95, t) * (1 - .5 * belly));
      out.mix(underside, band(y, .12, .065, aa * 2) * .95);
      out.mix(dark, band(y, -.02, .025, aa) * .35);
      break;
    case 'betta':
      out.mix(accent, .18 * smooth(.42, .95, t));
      out.mix(underside, band(y, .2 + .03 * Math.sin(t * 16), .025, aa) * .2);
      break;
    case 'angelfish': out.mix(accent, bars(t, y, ANGEL_BARS, .035, .025, aa)); break;
    case 'discus': out.mix(accent, mazeMask(p, t, y, .014) * (.5 + .5 * flank)); break;
    case 'koi': {
      // Large coherent koi patches retain a cream belly and do not reuse black as underside.
      const u = t + .026 * Math.sin(y * 8 + t * 17 + p.spots[0].phase);
      const v = y + .1 * Math.sin(t * 19 + p.spots[1].phase);
      const orange = Math.max(ellipse(u, v, .16, .55, .13, .56, .06), ellipse(u, v, .52, .2, .19, .62, .06), ellipse(u, v, .86, .63, .13, .55, .06));
      const black = Math.max(ellipse(u, v, .36, .55, .075, .38, .08), ellipse(u, v, .73, .12, .065, .31, .08));
      out.mix(accent, orange * (1 - belly));
      out.mix(p.third, black * (1 - belly));
      break;
    }
    case 'clownfish': {
      const mask = bars(t, y, CLOWN_BARS, .055, .04, aa);
      out.mix(p.third, bars(t, y, CLOWN_BARS, .073, .04, aa));
      out.mix(accent, mask);
      break;
    }
    case 'blue-tang': {
      const u = (t - .56) / .34, v = (y - .16) / .58;
      const loop = band(Math.hypot(u, v), .79, .2, aa * 4);
      const upper = ellipse(t, y, .56, .6, .38, .28, .04);
      out.mix(accent, Math.max(loop, upper) * (1 - belly));
      break;
    }
    case 'yellow-tang': out.mix(accent, .09 * dorsal); break;
    case 'royal-gramma':
      out.mix(accent, smooth(.47 + .025 * Math.sin(y * 7), .54 + .025 * Math.sin(y * 7), t));
      out.mix(dark, band(y - 2.5 * (t - .08), .1, .035, aa) * (1 - smooth(.1, .19, t)));
      break;
    case 'mandarin': {
      out.mix(accent, .95);
      const line = mazeMask(p, t, y, .04);
      out.mix(dark, mazeMask(p, t, y, .055) * .92);
      out.mix(body, line);
      out.mix(underside, mazeMask(p, t, y, .009) * .35);
      break;
    }
    case 'copperband':
      out.mix(accent, bars(t, y, COPPER_BARS, .035, .018, aa));
      out.mix(dark, ellipse(t, y, .78, .62, .055, .18, .08));
      out.mix(underside, band(Math.hypot((t - .78) / .055, (y - .62) / .18), 1.18, .14, .05));
      break;
    case 'moorish-idol':
      out.mix(p.third, smooth(.64, .73, t) * (1 - belly) * .85);
      out.mix(accent, bars(t, y, MOORISH_BARS, .09, .035, aa));
      break;
    case 'emperor-angelfish': {
      let mask = 0;
      for (let i = 0; i < 12; i++) mask = Math.max(mask, band(y, -.9 + i * (1.8 / 11) + .035 * Math.sin(t * 5), .026, aa * 2));
      out.mix(accent, mask);
      out.mix(dark, band(t, .085 + .025 * y, .06, aa));
      out.mix(underside, band(t, .16 + .025 * y, .013, aa));
      break;
    }
    case 'blue-gourami': {
      out.mix(accent, (.5 + .5 * Math.sin(t * 57 + y * 14 + Math.sin(y * 25))) * .12);
      const dots = Math.max(ellipse(t, y, .5, .03, .065, .21, .35), ellipse(t, y, .87, .02, .048, .16, .35));
      out.mix(accent, dots * .88);
      break;
    }
    case 'blue-cichlid':
      out.mix(accent, bars(t, y, CICHLID_BARS, .04, -.018, aa) * (1 - .4 * belly));
      out.mix(underside, .12 * Math.max(0, Math.sin(t * 120 + y * 18)) * flank);
      break;
    case 'dwarf-gourami':
      out.mix(accent, band(Math.sin(t * 64 + y * 5 + .25 * Math.sin(y * 7)), 0, .46, aa * 10) * (1 - .35 * belly));
      break;
    case 'rainbowfish':
      out.mix(accent, smooth(.42, .62, t) * (1 - .45 * belly));
      out.mix(dark, band(y, .02, .045, aa) * .22);
      out.mix(underside, band(y, .14, .03, aa) * .4);
      break;
    case 'puffer': out.mix(accent, spotMask(p, t, c, 30) * (1 - .85 * belly)); break;
    case 'lionfish':
      out.mix(accent, bars(t, y, LION_BARS, .045, .025, aa));
      out.mix(p.third, bars(t, y, LION_BARS, .009, .025, aa) * .45);
      break;
    case 'hammerhead': out.mix(accent, .14 * dorsal); break;
    case 'seahorse': {
      const rings = band(Math.sin(t * Math.PI * 30 + .1 * Math.cos(angle * 6)), 0, .19, aa * 12);
      out.mix(accent, rings * .62);
      out.mix(underside, band(Math.cos(angle * 6), 1, .1, aa * 8) * .3);
      break;
    }
    case 'sunfish':
      out.mix(accent, spotMask(p, t, c, 45) * .3);
      out.mix(underside, .08 * Math.sin(t * 83 + y * 25) ** 2);
      break;
    case 'ribbon-eel':
      out.mix(accent, smooth(.75, .96, y));
      out.mix(underside, band(y, -.05, .02, aa) * .2);
      break;
    case 'stingray': out.mix(accent, spotMask(p, t, c, 42) * (1 - belly)); break;
    case 'manta':
      out.mix(accent, .3 * dorsal);
      out.mix(accent, spotMask(p, t, c, 10) * belly * .65);
      break;
    case 'nurse-shark': out.mix(accent, .1 * dorsal); break;
    case 'zebra-shark': out.mix(accent, spotMask(p, t, c, 45) * (1 - belly)); break;
    case 'leopard-shark': {
      const saddle = bars(t, y, LEOPARD_SADDLES, .055, .015, aa) * smooth(.02, .6, y);
      out.mix(accent, Math.max(saddle, spotMask(p, t, c, 25) * smooth(-.55, -.1, y)) * (1 - belly));
      break;
    }
    case 'blacktip-shark':
      out.mix(underside, band(y, -.05, .14, aa * 3) * .5);
      break;
    case 'whale-shark': {
      const u = t * 17, v = c * 20, row = Math.floor(v), col = Math.floor(u);
      const jitter = (hash(p.seed, row * 71 + col) - .5) * .2;
      const dots = ellipse(u - col, v - row, .5 + jitter, .5, .115, .14, .12);
      const grid = Math.max(band(u - col, .5, .013, .012), band(v - row, .5, .016, .012));
      out.mix(accent, Math.max(dots, grid * .23) * (1 - belly));
      break;
    }
    case 'thresher-shark': out.mix(accent, dorsal * .15); break;
    case 'sawfish':
      out.mix(accent, dorsal * .12);
      out.mix(underside, belly * .25);
      break;
    case 'oarfish':
      out.mix(accent, smooth(.85, .98, y));
      out.mix(dark, band(Math.sin(t * 140 + y * 5), 0, .15, aa * 10) * .09);
      out.mix(WHITE, .15 * flank);
      break;
    default: throw new Error(`Missing fish texture signature: ${p.spec.id}`);
  }
}

function finPixel(p: AtlasPaint, distal: number, chord: number, out: Paint): void {
  const { body, accent, underside, dark, aa } = p;
  const id = p.spec.id;
  out.set(body); out.mix(accent, .68);
  if (p.spec.family === 'shark' || p.spec.family === 'ray') { out.set(body); out.mix(accent, .12); }
  if (id === 'blue-tang') out.set(body);
  if (id === 'yellow-tang') { out.set(body); out.mix(accent, smooth(.82, 1, distal) * .6); }
  if (id === 'koi') { out.set(body); out.mix(accent, .3); }
  if (id === 'white-cloud') { out.set(underside); out.mix(accent, smooth(.86, .96, distal)); }
  if (id === 'ribbon-eel') { out.set(body); out.mix(accent, smooth(.76, .94, distal)); }
  if (id === 'oarfish') out.set(accent);
  if (id === 'betta') out.set(accent);
  // Opaque membrane: slightly lighter than the corresponding pigment, with darker rays.
  out.mix(NEUTRAL, .10);
  const rays = band(Math.sin(chord * Math.PI * 24 + .5 * distal * distal), 0, .12, aa * 8);
  const folds = Math.cos(chord * Math.PI * 24 + distal * 2) * .035 * distal;
  out.shade(1 + folds);
  out.mix(dark, rays * (.12 + .16 * distal));
  out.mix(underside, band(distal, .985, .016, aa) * .24);
  switch (id) {
    case 'guppy':
      out.mix(accent, .35);
      out.mix(underside, band(Math.sin(chord * 36 + distal * 2), 0, .4, aa * 10) * .7);
      break;
    case 'zebra-danio': out.mix(accent, band(Math.sin(chord * Math.PI * 10), 0, .3, aa * 10) * .8); break;
    case 'swordtail': out.mix(accent, smooth(.9, .98, chord) * .6); break;
    case 'angelfish': out.mix(accent, bars(chord, distal, ANGEL_BARS, .035, .025, aa) * .65); break;
    case 'discus': out.mix(accent, mazeMask(p, distal, chord * 2 - 1, .014) * .75); break;
    case 'clownfish': out.mix(p.third, smooth(.86, .96, distal)); break;
    case 'royal-gramma': {
      const eye = ellipse(distal, chord, .58, .36, .13, .08, .1);
      out.mix(underside, ellipse(distal, chord, .58, .36, .17, .11, .08));
      out.mix(dark, eye);
      break;
    }
    case 'mandarin': out.mix(body, mazeMask(p, distal, chord * 2 - 1, .035) * .9); break;
    case 'copperband': out.mix(accent, bars(chord, distal, COPPER_BARS, .03, .018, aa)); break;
    case 'moorish-idol': out.mix(accent, bars(chord, distal, MOORISH_BARS, .09, .035, aa)); break;
    case 'emperor-angelfish': out.mix(accent, band(Math.sin(chord * Math.PI * 24), 0, .32, aa * 10) * .8); break;
    case 'dwarf-gourami': out.mix(accent, band(Math.sin(chord * 40 + distal * 5), 0, .36, aa * 10) * .6); break;
    case 'lionfish': out.mix(accent, band(Math.sin(distal * 34 + chord * 8), 0, .5, aa * 10) * .85); break;
    case 'puffer': out.mix(underside, .5); break;
    case 'blacktip-shark': out.mix(accent, smooth(.76 + .025 * Math.cos(chord * TAU), .84, distal)); break;
    case 'zebra-shark': out.mix(accent, spotMask(p, distal, chord, 30) * .8); break;
    case 'leopard-shark': out.mix(accent, spotMask(p, distal, chord, 20) * .65); break;
    case 'whale-shark': {
      const u = distal * 10, v = chord * 8;
      out.mix(accent, ellipse(u % 1, v % 1, .5, .5, .12, .12, .15) * .85);
      break;
    }
  }
}

function canvas2D(size: number, speciesId: string, label: string): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error(`Fish textures (${speciesId}): Canvas2D unavailable for ${label}`);
  return { canvas, context };
}

function buildColor(spec: SpeciesSpec): CanvasTexture {
  const size = HIGH_RES[spec.id] ? 512 : 256;
  const { canvas, context } = canvas2D(size, spec.id, 'color atlas');
  const image = context.createImageData(size, size), paint = makePaint(spec, size), pixel = new Paint();
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    const u = (col + .5) / size, v = (row + .5) / size;
    if (v < .75) bodyPixel(paint, u, v / .75, pixel);
    else finPixel(paint, u, (v - .75) * 4, pixel);
    // White face island, sampled at (.984,.984), includes a >2-texel mip/filter guard.
    if (u >= .96 && v >= .96) pixel.set(WHITE);
    const index = (row * size + col) * 4;
    image.data[index] = pixel.r; image.data[index + 1] = pixel.g; image.data[index + 2] = pixel.b; image.data[index + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.name = `fish:${spec.id}:color`; texture.flipY = false; texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  return texture;
}

function skinOf(spec: SpeciesSpec): Skin {
  if (spec.family === 'seahorse') return 'plate';
  if (spec.family === 'shark' || spec.family === 'ray' || spec.family === 'eel' || spec.family === 'puffer') return 'smooth';
  return 'scale';
}

function buildDetails(skin: Skin, speciesId: string): Details {
  const size = 128, seed = fnv(`skin:${skin}`), heights = new Float32Array(size * size);
  const normal = canvas2D(size, speciesId, `${skin} normal`), rough = canvas2D(size, speciesId, `${skin} roughness`);
  const normalImage = normal.context.createImageData(size, size), roughImage = rough.context.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const grain = hash(seed, y * size + x) - .5;
    let height: number;
    if (skin === 'scale') {
      const row = Math.floor(y / 16), u = ((x + (row % 2) * 8) % 16) / 16, v = (y % 16) / 16;
      // Overlapping, staggered lozenge scales; this detail is never used for shark/ray skin.
      const ridge = Math.abs(u - .5) * 1.45 + Math.abs(v - .48) * .9;
      height = .35 * (1 - smooth(.43, .58, ridge)) + .015 * grain;
    } else if (skin === 'plate') {
      const ring = (y % 16) / 16, plate = (x % 32) / 32;
      height = .22 * smooth(.02, .14, ring) * (1 - smooth(.84, .98, ring)) * smooth(.01, .1, plate) * (1 - smooth(.9, .99, plate)) + .025 * grain;
    } else {
      // Fine, nearly smooth denticle grain: no scale scallops on cartilaginous skin.
      height = .012 * grain + .003 * Math.cos(x * .7 + y * .4);
    }
    heights[y * size + x] = height;
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, offset = i * 4;
    const dx = (heights[y * size + (x + 1) % size] - heights[y * size + (x + size - 1) % size]) * 2;
    const dy = (heights[((y + 1) % size) * size + x] - heights[((y + size - 1) % size) * size + x]) * 2;
    const length = Math.hypot(dx, dy, 1);
    normalImage.data[offset] = (1 - dx / length) * 127.5;
    normalImage.data[offset + 1] = (1 - dy / length) * 127.5;
    normalImage.data[offset + 2] = (1 + 1 / length) * 127.5;
    normalImage.data[offset + 3] = 255;
    const r = skin === 'smooth' ? 247 + 6 * hash(seed, i) : 222 + 27 * hash(seed, i) + heights[i] * 12;
    roughImage.data[offset] = roughImage.data[offset + 1] = roughImage.data[offset + 2] = r;
    roughImage.data[offset + 3] = 255;
  }
  normal.context.putImageData(normalImage, 0, 0); rough.context.putImageData(roughImage, 0, 0);
  let normalMap: CanvasTexture | undefined, roughnessMap: CanvasTexture | undefined;
  try {
    normalMap = new CanvasTexture(normal.canvas); roughnessMap = new CanvasTexture(rough.canvas);
    for (const texture of [normalMap, roughnessMap]) {
      texture.flipY = false; texture.colorSpace = NoColorSpace;
      texture.wrapS = texture.wrapT = RepeatWrapping;
      texture.repeat.set(8, 6);
    }
    normalMap.name = `fish:skin:${skin}:normal`; roughnessMap.name = `fish:skin:${skin}:roughness`;
    return Object.freeze({ normalMap, roughnessMap });
  } catch (error) {
    normalMap?.dispose(); roughnessMap?.dispose(); throw error;
  }
}

/** Lazy species atlas plus shared skin details. Failed builds never publish partial cache entries. */
export function getFishTextures(spec: SpeciesSpec): FishTextures {
  const cached = maps.get(spec.id);
  if (cached) return cached;
  const skin = skinOf(spec);
  let map: CanvasTexture | undefined, freshDetails: Details | undefined;
  try {
    map = buildColor(spec);
    const shared = details.get(skin) ?? (freshDetails = buildDetails(skin, spec.id));
    const result: FishTextures = Object.freeze({ map, normalMap: shared.normalMap, roughnessMap: shared.roughnessMap });
    if (freshDetails) details.set(skin, freshDetails);
    maps.set(spec.id, result);
    return result;
  } catch (error) {
    map?.dispose(); freshDetails?.normalMap.dispose(); freshDetails?.roughnessMap.dispose();
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Fish textures (${spec.id}): ${reason}`, { cause: error });
  }
}

/** Shared ownership: instance materials must not dispose these textures. Safe to call again. */
export function disposeFishTextures(): void {
  for (const texture of maps.values()) texture.map.dispose();
  maps.clear();
  for (const texture of details.values()) { texture.normalMap.dispose(); texture.roughnessMap.dispose(); }
  details.clear();
}
