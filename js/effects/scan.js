// Effect: Scan — the picture (or lyrics) as if someone dragged the page along a scanner while
// it was scanning. A scanner bar sweeps across (top to bottom, or left to right); behind it the
// page has been dragged: rows wander sideways, the scan speeds up and slows down, and where
// the page stuck for a moment a single row is stretched into streaks. Ahead of the bar: the
// page as it is, or nothing yet. Sweep time: how long one pass takes (it loops); 0 = still: the
// whole page already scanned. Each pass drags differently (and Reroll gives new drags).
import { toRGB } from './colours.js';

const RECIPE = `
uniform sampler2D picture;
uniform float amount;       // 0 - 1: how much the page was dragged
uniform float wobble;       // 0 - 1: sideways wander
uniform float head;         // where the bar is, 0 - 1 along the sweep (above 1: all scanned, no bar)
uniform float across;       // 0 top to bottom, 1 left to right
uniform float ahead;        // 0 show the page ahead of the bar, 1 nothing yet
uniform float pass;         // which pass (each one drags differently)
uniform float bar;          // 0 - 1: how bright the scanner bar is
uniform vec3 barColour;

float rnd(float a, float b, uint salt) { return 0.5 + 0.5 * random(ivec2(int(a), int(b)), salt); }

void main() {
  vec2 square = size / min(size.x, size.y);
  vec2 p = here() * square;
  float L = across > 0.5 ? square.x : square.y;       // the sweep's length
  float a = across > 0.5 ? p.x : p.y;                 // along the sweep
  float c = across > 0.5 ? p.y : p.x;                 // across it
  float h = head * L;
  vec4 col;
  if (a > h && head <= 1.0) {
    // Not scanned yet
    col = ahead > 0.5 ? vec4(0.0) : sampleAt(picture, p / square);
  } else {
    // Scanned: where on the page this row really came from
    float a2 = a + amount * 0.1 * (fbm(vec2(a * 1.2, pass * 3.7), 151u) - 0.5);
    for (int i = 0; i < 9; i++) {                     // where the page stuck: one row stretched
      float z = rnd(float(i), pass, 152u) * L;
      float len = amount * (0.01 + 0.22 * pow(rnd(float(i), pass + 1.0, 152u), 2.0));
      if (rnd(float(i), pass + 2.0, 152u) < 0.8 && a > z && a < z + len) a2 = z + amount * 0.1 * (fbm(vec2(z * 1.2, pass * 3.7), 151u) - 0.5);
    }
    float c2 = c + wobble * (0.16 * (noise(vec2(a * 3.0, pass), 153u) - 0.5) + 0.02 * (noise(vec2(a * 70.0, pass), 154u) - 0.5));
    // Right behind the bar, the row under it is smeared a little (the page moving under the light)
    if (head <= 1.0 && a > h - 0.015 * amount) a2 = mix(a2, h, 0.7);
    vec2 from = across > 0.5 ? vec2(a2, c2) : vec2(c2, a2);
    col = sampleAt(picture, from / square);
  }
  // The scanner bar: a bright line with a soft glow, just ahead of what's scanned
  if (head <= 1.0 && bar > 0.0) {
    float d = abs(a - h);
    float glow = bar * (exp(-d * 900.0) + 0.35 * exp(-d * 60.0));
    vec3 lit = mix(col.rgb * col.a, barColour, clamp(glow, 0.0, 1.0));
    float al = clamp(col.a + glow * (1.0 - col.a), 0.0, 1.0);
    col = vec4(al > 0.0 ? lit / max(al, 0.001) : vec3(0.0), al);
    col.rgb = min(col.rgb, 1.0);
  }
  colour = col;
}`;

export default {
  type: "scan",
  label: "Scan",
  vibe: { light: { amount: 6.9, wobble: 0.6 }, full: { amount: 39.1, wobble: 3.4 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Dragged on a scanner: a bar sweeps across, smearing and stretching.",
  group: "Warp",
  defaults: () => ({
    amount: 23,                 // 0 (held still) - 100 (dragged about a lot)
    wobble: 2,                 // 0 (straight) - 100 (wanders sideways)
    direction: "right",          // down (top to bottom) | right (left to right)
    sweep: 7.5,                   // seconds for one pass (0: still, the whole page scanned)
    ahead: "hide",              // show (the page as it is) | hide (nothing yet)
    bar: 0,                    // 0 (no bar) - 100 (bright)
    barColour: "#007cf0"        // the scanner light
  }),
  controls: [
    { key: "amount", label: "Drag", min: 0, max: 100, step: 1 },
    { key: "wobble", label: "Wobble", min: 0, max: 100, step: 1 },
    { key: "direction", label: "Direction", kind: "choice", options: [
      { value: "down", label: "Top to bottom" },
      { value: "right", label: "Left to right" }
    ] },
    { key: "sweep", label: "Sweep time (seconds, 0 = still)", min: 0, max: 20, step: 0.5 },
    { key: "ahead", label: "Ahead of the bar", kind: "choice", options: [
      { value: "show", label: "The page as it is" },
      { value: "hide", label: "Nothing yet (it appears as it's scanned)" }
    ] },
    { key: "bar", label: "Scanner bar", min: 0, max: 100, step: 1 },
    { key: "barColour", label: "Bar colour", kind: "colour" }
  ],
  moves: (settings) => settings.sweep > 0,
  apply(settings, run) {
    const sweeping = settings.sweep > 0;
    const t = run.time || 0;
    const progress = sweeping ? t / settings.sweep : 0;
    return run.pass(RECIPE, { picture: run.input }, {
      amount: settings.amount / 100,
      wobble: settings.wobble / 100,
      head: sweeping ? progress - Math.floor(progress) : 2,
      across: settings.direction === "right" ? 1 : 0,
      ahead: settings.ahead === "hide" ? 1 : 0,
      pass: sweeping ? Math.floor(progress) % 9973 : 0,
      bar: settings.bar / 100,
      barColour: toRGB(settings.barColour)
    });
  }
};
