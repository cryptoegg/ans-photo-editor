// Effect: VHS — a worn videotape. What real tape does:
//   Scan lines      dark lines across the picture (Line size: fine to coarse)
//   Tracking tears  bands of the picture torn sideways, jagged, with a bright noisy streak: they
//                   come and go at random, at random heights and strengths
//   Head switching  the jagged, noisy strip along the bottom of every frame of a VHS picture
//   Colour bleed    colour smeared to the right of edges (tape keeps colour blurrier than brightness)
//   Wobble          lines slipping sideways a little, and the whole picture swaying
//   Noise           tape noise is horizontal: streaky grey "snow" along the lines, blotchy colour
//                   noise (strongest in reds), and now and then a white dropout line
// Still: one frozen frame of all that (Reroll for another). Moving: the tape plays, everything
// changes every frame and the tears come and go. Wander moves Tracking, Bleed, Wobble and Noise.
import { wanderSettings } from './kit.js';

const RECIPE = `
uniform sampler2D picture;
uniform float lines;        // 0 - 1: scan lines
uniform float linesAcross;  // scan lines per short side
uniform float tracking;     // 0 - 1: tears (and the head-switching strip)
uniform float bleed;        // 0 - 1: colour bleeding sideways
uniform float wobble;       // 0 - 1
uniform float noisy;        // 0 - 1
uniform float t;            // moving: seconds of song (0 when still)
uniform float frameNo;      // moving: which video frame (0 when still)

const float TAU = 6.2831853;

// Brightness and colour (YIQ, as tape stores it)
vec3 toYIQ(vec3 c) { return mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * c; }
vec3 toRGB(vec3 y) { return mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * y; }
float rnd(int a, int b, uint salt) { return 0.5 + 0.5 * random(ivec2(a, b), salt); } // 0 - 1

void main() {
  vec2 p = place();
  float tall = size.y / min(size.x, size.y);        // the picture's height, in short sides
  float row = p.y;
  int f = int(frameNo);

  // Wobble: each line slips a little; the whole picture sways slowly
  float shift = (noise(vec2(row * 220.0, frameNo * 0.7), 81u) - 0.5) * 0.004 * wobble;
  shift += sin(t * 1.3) * 0.002 * wobble + sin(t * 3.7 + 1.0) * 0.001 * wobble;

  // Tracking tears: up to six, each on its own clock: every so often it rolls the dice to show
  // (or not), somewhere new, a new height and strength. Mostly thin, now and then a big one.
  float tear = 0.0;
  for (int i = 0; i < 6; i++) {
    if (float(i) >= tracking * 6.0) break;
    float rate = 0.7 + 2.5 * rnd(i, 0, 82u);                  // how often it changes (per second)
    int e = int(floor(t * rate + 10.0 * rnd(i, 1, 82u)));     // which "event" we're in
    if (t > 0.0 && rnd(i, e, 83u) > 0.25 + 0.5 * tracking) continue; // this time: no tear
    float y = rnd(i, e + 7, 84u) * tall;
    float h = 0.004 + 0.09 * pow(rnd(i, e + 13, 84u), 2.0);
    float inside = smoothstep(y - h, y - h * 0.6, row) * (1.0 - smoothstep(y, y + 0.002, row));
    if (inside <= 0.0) continue;
    float strength = (0.02 + 0.14 * pow(rnd(i, e + 19, 84u), 1.5)) * (rnd(i, e + 23, 84u) < 0.3 ? -1.0 : 1.0);
    float jag = 0.4 + 0.9 * noise(vec2(row * 400.0, float(i * 31 + e) + frameNo * 0.5), 85u);
    shift += inside * strength * jag;
    tear = max(tear, inside);
  }
  // Head switching: the bottom strip, torn hard to the side and noisy
  float strip = (0.006 + 0.02 * tracking) * step(0.001, tracking);
  float head = smoothstep(tall - strip, tall - strip * 0.6, row);
  shift += head * (0.02 + 0.04 * noise(vec2(row * 900.0, frameNo), 86u));

  vec2 at = vec2(here().x - shift * min(size.x, size.y) / size.x, here().y);
  vec3 sharp = toYIQ(texture(picture, at).rgb);

  // Colour from a blurred, right-shifted smear of the line
  vec2 colourAcc = vec2(0.0);
  // (the top end goes much further: long smears, colour pushed, a colour ghost trailing off)
  float spread = (0.002 + 0.012 * bleed + 0.03 * bleed * bleed) * min(size.x, size.y) / size.x;
  for (int k = 0; k < 8; k++) colourAcc += toYIQ(texture(picture, at - vec2(spread * (float(k) + 1.0) * 0.6, 0.0)).rgb).yz;
  vec2 ghost = toYIQ(texture(picture, at - vec2(spread * 9.0, 0.0)).rgb).yz;
  vec2 smeared = mix(colourAcc / 8.0, ghost, 0.35 * bleed * bleed);
  vec3 yiq = vec3(sharp.x, mix(sharp.yz, smeared, min(1.0, bleed * 1.6)) * (1.0 + 0.3 * bleed + 0.8 * bleed * bleed));

  // Tape noise: streaky grey snow along the lines, blotchy colour, rare white dropout lines
  vec2 px = vec2(pixel());
  float snow = noise(vec2(px.x / 7.0, px.y) + frameNo * vec2(37.0, 91.0), 87u) - 0.5;
  yiq.x += snow * noisy * 0.22;
  yiq.y += (noise(p * vec2(30.0, 140.0) + frameNo * 1.7, 88u) - 0.5) * noisy * 0.22;
  yiq.z += (noise(p * vec2(30.0, 140.0) + frameNo * 1.7 + 50.0, 89u) - 0.5) * noisy * 0.12;
  int line = int(px.y / 2.0);
  float dropout = 0.0;
  if (rnd(line, f, 90u) < noisy * 0.015) {
    float start = rnd(line, f + 1, 90u) * size.x, len = (0.03 + 0.25 * rnd(line, f + 2, 90u)) * min(size.x, size.y);
    dropout = step(start, px.x) * step(px.x, start + len);
  }
  vec3 c = clamp(toRGB(yiq), 0.0, 1.0);

  // A bright, noisy streak along each tear's edge and through the head-switching strip
  float streak = smoothstep(0.55, 0.9, noise(vec2(p.x * 40.0, row * 400.0 + frameNo), 91u));
  c = mix(c, vec3(0.92), max(tear * 0.35, head * 0.5) * streak);
  c = mix(c, vec3(0.97), dropout * 0.85);

  // Scan lines
  float scan = 0.5 + 0.5 * cos(TAU * row * linesAcross);
  c *= 1.0 - lines * 0.45 * scan;
  colour = vec4(c / (1.0 - lines * 0.225), texture(picture, at).a);
}`;

const WANDERS = { tracking: [0, 80], bleed: [20, 85], wobble: [10, 80], noise: [5, 65] };

export default {
  type: "vhs",
  label: "VHS",
  vibe: { light: { lines: 0, tracking: 0.3, bleed: 13.8, wobble: 7.2, noise: 1.2 }, full: { lines: 0, tracking: 1.7, bleed: 78.2, wobble: 40.8, noise: 6.8 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Worn videotape: scan lines, tracking tears, bleeding colour, noise.",
  group: "Damage & frames",
  defaults: () => ({
    wander: 100,                  // where Wander last took the sliders below
    lines: 0,                  // 0 (none) - 100: scan lines
    lineSize: 4,               // 0 (fine) - 100 (coarse, thick lines)
    tracking: 1,               // 0 (none) - 100 (lots of tears)
    bleed: 46,                  // 0 (sharp colour) - 100 (smeared)
    wobble: 24,                 // 0 (steady) - 100
    noise: 4,                  // 0 (clean) - 100
    moving: true               // the tape plays: tears come and go, noise changes every frame
  }),
  videoDefaults: () => ({ bleed: 58, wobble: 0, noise: 1 }), // (Tom's video settings, MTNS_stay 2026-10-25)
  controls: [
    { key: "wander", label: "Wander (moves the sliders below)", min: 0, max: 100, step: 0.5,
      drives: (settings, seed) => wanderSettings(settings.wander, seed, WANDERS) },
    { key: "lines", label: "Scan lines", min: 0, max: 100, step: 1 },
    { key: "lineSize", label: "Line size", min: 0, max: 100, step: 1 },
    { key: "tracking", label: "Tracking tears", min: 0, max: 100, step: 1 },
    { key: "bleed", label: "Colour bleed", min: 0, max: 100, step: 1 },
    { key: "wobble", label: "Wobble", min: 0, max: 100, step: 1 },
    { key: "noise", label: "Noise", min: 0, max: 100, step: 1 },
    { key: "moving", label: "Moving (the tape plays)", kind: "toggle" }
  ],
  moves: (settings) => !!settings.moving,
  apply: (settings, run) => run.pass(RECIPE, { picture: run.input }, {
    lines: settings.lines / 100,
    linesAcross: 380 - (settings.lineSize / 100) * 300,   // 380 (fine) - 80 (coarse) per short side
    tracking: settings.tracking / 100,
    bleed: settings.bleed / 100,
    wobble: settings.wobble / 100,
    noisy: settings.noise / 100,
    t: settings.moving ? (run.time || 0) % 600 : 0,
    frameNo: settings.moving ? Math.floor((run.time || 0) * 30) % 997 : 0
  })
};
