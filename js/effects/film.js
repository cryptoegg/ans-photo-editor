// Effect: Film (2026-11-22) — a film camera's look, as good as the camera apps': the look's colour as a 3D table
// (worked out from its numbers in js/effects/filmLooks.js, or a film table brought in: js/effects/filmTables.js), then
// its layers: the phone's sharpening softened, Fade (how matte the blacks and how creamy the whites), glow round bright
// things (Halation), darker corners, and fine grain strongest in the mid tones, with a little randomness per photo.
// The engine knows nothing about any one film: a look is only data, so looks made from real film can replace them.
// Strength is the filter's own (it mixes the whole thing with the photo as it was). Grain, Glow and Fade: 50 = the look
// as written, 0 = none, 100 = double.
import { FILM_LOOKS, FILM_LAYERS } from './filmLooks.js';
import { filmTable, filmInfo } from './filmTables.js';
import { smallerCopies, gaussianBlur, seeded } from './kit.js';
import halation from './halation.js';
import grain from './grain.js';

const clamp = (x) => Math.max(0, Math.min(1, x));
const HUES = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "pink"];
const HUE_AT = [0, 30, 60, 120, 180, 240, 270, 315]; // (degrees: where each colour sits)

// The look's numbers → { size, data } (33 points, red changing fastest: the .cube order)
export function bakeLook(look, size = 33) {
  const tone = look.tone || [0, .1, .2, .3, .4, .5, .6, .7, .8, .9, 1];
  const curve = (v) => { const x = clamp(v) * (tone.length - 1), i = Math.min(tone.length - 2, Math.floor(x)); return tone[i] + (tone[i + 1] - tone[i]) * (x - i); };
  const sat = look.saturation || {};
  const satAt = (h) => {
    // (the two colours the hue sits between, shared by how close it is to each)
    for (let k = 0; k < HUES.length; k++) {
      const a = HUE_AT[k], b = k + 1 < HUES.length ? HUE_AT[k + 1] : 360;
      if (h >= a && h < b) { const t = (h - a) / (b - a), s0 = sat[HUES[k]] ?? 1, s1 = sat[HUES[(k + 1) % HUES.length]] ?? 1; return s0 + (s1 - s0) * t; }
    }
    return 1;
  };
  const sh = look.shadows || [0, 0, 0], mi = look.mids || [0, 0, 0], hi = look.highlights || [0, 0, 0];
  const data = new Float32Array(size * size * size * 3);
  let i = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    let c = [r, g, b].map((x) => curve(x / (size - 1)));
    // saturation, overall and by colour (greys untouched)
    const mx = Math.max(...c), mn = Math.min(...c), l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
    if (mx - mn > 1e-4) {
      let h;
      if (mx === c[0]) h = ((c[1] - c[2]) / (mx - mn) + 6) % 6; else if (mx === c[1]) h = (c[2] - c[0]) / (mx - mn) + 2; else h = (c[0] - c[1]) / (mx - mn) + 4;
      const k = (sat.all ?? 1) * satAt(h * 60);
      c = c.map((x) => l + (x - l) * k);
    }
    // split tone: shadows, mids and highlights pushed by their brightness
    const ws = (1 - l) * (1 - l), wh = l * l, wm = 4 * l * (1 - l);
    c = c.map((x, k) => clamp(x + sh[k] * ws + mi[k] * wm + hi[k] * wh));
    data[i++] = c[0]; data[i++] = c[1]; data[i++] = c[2];
  }
  return { size, data };
}

// The table as a picture for the graphics card: size² wide (one square per blue step), size tall
function atlas({ size, data }) {
  const canvas = document.createElement("canvas");
  canvas.width = size * size; canvas.height = size;
  const g = canvas.getContext("2d"), img = g.createImageData(canvas.width, canvas.height);
  for (let b = 0; b < size; b++) for (let gg = 0; gg < size; gg++) for (let r = 0; r < size; r++) {
    const s = ((b * size + gg) * size + r) * 3, d = (gg * canvas.width + b * size + r) * 4;
    img.data[d] = Math.round(data[s] * 255); img.data[d + 1] = Math.round(data[s + 1] * 255); img.data[d + 2] = Math.round(data[s + 2] * 255); img.data[d + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvas;
}
// Its black and white (what Fade stretches from or lifts further)
function ends({ size, data }) {
  const last = (size * size * size - 1) * 3;
  return { lo: [data[0], data[1], data[2]], hi: [data[last], data[last + 1], data[last + 2]] };
}

const baked = new Map(); // id → { table, lo, hi }
function lookTable(id) {
  if (baked.has(id)) return baked.get(id);
  const own = FILM_LOOKS[id];
  const table = own ? bakeLook(own) : filmTable(id); // (a film brought in: null until it's loaded)
  if (!table) return null;
  const out = { table, ...ends(table) };
  baked.set(id, out);
  return out;
}
// Each film its own texture (2026-11-23, Tom: the films felt the same apart from their colours), worked out from what
// the film is, the same as the Lyric Visualiser's (ans-visual-text-generator/js/effects/film.js), so a film looks the
// same in both apps. Grain from its speed (50 very fine … 3200 coarse); slide films crisper with less glow; instant
// films soft, darker corners, more glow, each photo a little different; black and white grey grain and a white glow;
// infrared a big bloom; expired uneven; Lomography / cross-processed heavy corners; the Creative looks colour only.
// Our own looks keep their written numbers.
const LAYERS = new Map();
function layersOf(id) {
  if (FILM_LOOKS[id]) return FILM_LOOKS[id];
  if (LAYERS.has(id)) return LAYERS.get(id);
  const f = filmInfo(id);
  if (!f) return FILM_LAYERS;
  const name = `${f.film} ${f.variant}`.toLowerCase(), bw = f.kind !== "Colour";
  if (f.brand === "Creative") { const out = { soften: 0, vignette: 0, wobble: 0 }; LAYERS.set(id, out); return out; }
  const iso = Number((name.match(/(?:^|\D)(25|50|64|80|100|125|160|200|400|664|665|667|669|672|690|800|1600|3000|3200)(?:\D|$)/) || [])[1]) || 200;
  const speed = Math.min(3200, iso > 600 && iso < 700 ? 100 : iso); // (Polaroid's numbers are names, not speeds)
  const stops = Math.log2(speed / 50); // 0 (ISO 50) … 6 (ISO 3200)
  const slide = /velvia|provia|astia|sensia|ektachrome|e-100|kodachrome|elite chrome|polachrome|slide/.test(name);
  const instant = f.brand === "Polaroid" || /fp-/.test(name);
  const infra = /infra|hie| ir /.test(` ${name} `);
  const expired = /expired/.test(name);
  const lomo = f.brand === "Lomography" || /xpro|redscale/.test(name);
  const tungsten = /800t|tungsten/.test(name); // (cinema film without its anti-halation layer: red halos round lights)
  const L = {
    soften: slide ? 0.3 : instant ? 0.85 : 0.5,
    vignette: lomo ? 0.38 : expired ? 0.36 : instant ? 0.3 : slide ? 0.24 : 0.18,
    wobble: expired ? 1 : instant ? 0.8 : 0.5,
    glow: {
      amount: infra ? 62 : tungsten ? 45 : bw ? 18 : slide ? 20 : instant ? 38 : 30,
      size: infra ? 75 : tungsten ? 55 : instant ? 55 : 45,
      highlights: infra ? 60 : tungsten ? 78 : 72,
      colour: bw || infra ? "#f2f2f2" : tungsten ? "#ff3a1a" : instant ? "#ff8a4a" : "#ff6a2a"
    },
    grain: {
      amount: Math.round(Math.min(34, (slide ? 5 : 7) + stops * (bw ? 4.5 : 3.6) + (expired ? 6 : 0) + (instant ? 3 : 0))),
      size: Math.round(Math.min(9, 2 + stops * (bw ? 1.1 : 0.9))),
      colour: bw ? 0 : slide ? 8 : 15
    }
  };
  LAYERS.set(id, L);
  return L;
}

// Soften, the table, Fade and the corners, in one pass
const RECIPE = `
uniform sampler2D picture;
uniform sampler2D soft;
uniform sampler2D table;
uniform float points;
uniform float soften;     // 0 - 1
uniform vec3 lo;          // the table's black
uniform vec3 hi;          // and white
uniform float fade;       // 0 none (true black, white) - 1 the look's own - 2 twice as matte
uniform float vignette;   // 0 - 1
uniform vec2 middle;      // the vignette's middle (a little off for each photo)
uniform vec3 warmth;      // a tiny shift per photo

vec3 look(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  float b = c.b * (points - 1.0), b0 = floor(b), b1 = min(b0 + 1.0, points - 1.0);
  float x = c.r * (points - 1.0) + 0.5, y = (c.g * (points - 1.0) + 0.5) / points;
  vec3 l0 = texture(table, vec2((b0 * points + x) / (points * points), y)).rgb;
  vec3 l1 = texture(table, vec2((b1 * points + x) / (points * points), y)).rgb;
  return mix(l0, l1, b - b0);
}

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec3 c = mix(source.rgb, texture(soft, here()).rgb, soften);
  c = look(c);
  vec3 stretched = clamp((c - lo) / max(hi - lo, vec3(0.05)), 0.0, 1.0);
  c = clamp(stretched + (c - stretched) * fade, 0.0, 1.0);
  c = clamp(c + warmth, 0.0, 1.0);
  vec2 p = (here() - middle) * vec2(size.x / max(size.x, size.y), size.y / max(size.x, size.y)) * 1.42;
  float v = 1.0 - vignette * smoothstep(0.5, 1.15, length(p));
  colour = vec4(c * v, source.a);
}`;

export default {
  type: "film",
  label: "Film",
  description: "A film camera's look: its colour, glow, darker corners and grain.",
  group: "Colour",
  later: true, // (put on by the film filters, not from the Effects list)
  defaults: () => ({ look: "snapshot", grain: 50, glow: 50, fade: 50 }),
  controls: [
    { key: "grain", label: "Grain", min: 0, max: 100, step: 1 },
    { key: "glow", label: "Glow", min: 0, max: 100, step: 1 },
    { key: "fade", label: "Fade", min: 0, max: 100, step: 1 }
  ],
  name: (settings) => (FILM_LOOKS[settings.look] ? FILM_LOOKS[settings.look].name : filmInfo(settings.look)?.name || "Film"),
  apply(settings, run) {
    const t = lookTable(settings.look);
    if (!t) return run.input;
    const L = layersOf(settings.look);
    const { width, height } = run;
    const side = Math.min(width, height);
    const rand = seeded(run.seed), w = L.wobble ?? 0;
    const wob = () => (rand() * 2 - 1) * w;
    const soft = L.soften > 0 ? gaussianBlur(run, smallerCopies(run, run.input, 1), Math.max(0.8, side * 0.0016)) : run.input;
    const table = run.texture(`film|${settings.look}`, () => atlas(t.table));
    let out = run.pass(RECIPE, { picture: run.input, soft, table }, {
      points: t.table.size, soften: L.soften || 0, lo: t.lo, hi: t.hi, fade: settings.fade / 50,
      vignette: clamp((L.vignette || 0) * (1 + 0.25 * wob())), middle: [0.5 + 0.03 * wob(), 0.5 + 0.03 * wob()],
      warmth: [0.008 * wob(), 0, -0.008 * wob()]
    });
    const k = (x) => Math.max(0, x);
    if (L.glow && settings.glow > 0) {
      out = halation.apply({ ...L.glow, amount: Math.min(100, L.glow.amount * settings.glow / 50 * (1 + 0.2 * wob())) }, { ...run, input: out });
    }
    if (L.grain && settings.grain > 0) {
      out = grain.apply({ amount: Math.min(100, k(L.grain.amount * settings.grain / 50)), size: L.grain.size, roughness: 15, colour: L.grain.colour, moving: false }, { ...run, input: out });
    }
    return out;
  }
};
