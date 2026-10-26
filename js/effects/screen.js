// Effect: Screen — the look of a phone photo of a computer screen: the moiré bands (pastel
// rainbow stripes from the red / green / blue sub-pixels) you get when the camera's grid fights
// the screen's grid. The screen's own pixels are too fine for the phone to show, so mostly you
// see the bands, plus a faint line texture.
//
// The bands come from a pretend phone held up to the screen: its turn, distance, lean and lens
// curve decide their shape (straight stripes when square-on, fans when leaning, rings close
// up), the way they do with a real phone. Phone position moves that phone along a smooth random
// path (Reroll: a new path; 0 and 100 are the same spot), so dragging it is like moving the
// phone around. Movement is how far it wanders. Tilt also turns and leans the picture itself,
// always zoomed in just enough that it fills the whole frame (no empty edges). Wander moves all those sliders at once along
// a random path (the sliders show where it took them; any can then be fine-tuned). Drift moves
// the phone along its path as the song plays (a hand-held phone: the bands ripple and flow). Bands show most on smooth, bright parts (skin, sky) and fade on
// dark or detailed ones (hair), like in a real photo, and (Patchiness) come and go in soft
// patches that drift as the phone moves.
import { smallerCopies, gaussianBlur, seeded, wanderSettings } from './kit.js';

const RECIPE = `
uniform sampler2D picture;
uniform sampler2D soft;       // a softened copy: tells smooth parts from detailed ones
uniform float amount;         // 0 - 1
uniform float bands;          // how many bands across the short side, for this pose
uniform float lineSpace;      // the faint screen lines' spacing, as a fraction of the short side
uniform float rainbow;        // 0 - 1
uniform float grid;           // 0 lines, 1 a grid (lines both ways)
uniform float turn;           // the phone: turned against the screen (radians)
uniform float stretch;        //   closer / further (the two grids' spacing differs by this much)
uniform vec2 lean;            //   leaning (perspective)
uniform float lens;           //   lens curve (rings)
uniform vec2 lensCentre;
uniform vec2 slide;           //   sliding along the screen
uniform float pictureTurn;    // the picture as photographed: turned,
uniform vec2 pictureLean;     //   leaning
uniform float zoom;           //   and zoomed in
uniform float patchy;         // 0 (bands everywhere) - 1 (only in patches)
uniform vec2 patchShift;      // the patches drift as the phone moves

const float TAU = 6.2831853;

vec2 rotate(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

// Where in the picture the camera sees this spot (0-1 across the picture)
vec2 seen(vec2 uv, vec2 square) {
  vec2 d = rotate((uv - 0.5) * square, pictureTurn);
  d /= 1.0 + dot(pictureLean, d);
  return d / zoom / square + 0.5;
}

// How far the screen's grid has drifted against the camera's grid at this spot (u: from the
// middle, in short sides): the phone's turn, distance, lean and lens curve
vec2 drift(vec2 u) {
  vec2 q = rotate(u, turn) * (1.0 + stretch);
  q /= 1.0 + dot(lean, u);
  vec2 r = u - lensCentre;
  q *= 1.0 + lens * dot(r, r);
  return q + slide - u;
}

// Soft, slow random patches (0 - 1) across the picture
float patches(vec2 u) {
  vec2 p = u * 1.7 + patchShift;
  vec2 cell = floor(p);
  vec2 f = p - cell;
  f = f * f * (3.0 - 2.0 * f);
  ivec2 c = ivec2(cell + 64.0);
  float a = random(c, 21u), b = random(c + ivec2(1, 0), 21u);
  float d = random(c + ivec2(0, 1), 21u), e = random(c + ivec2(1, 1), 21u);
  return 0.5 + 0.5 * mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
}

// One set of bands, 1 = no change. The sub-pixels sit side by side, so the colours peak at
// different points across a band: red and blue together against green (pink against green),
// with blue a little behind (orange in between), like photos of real screens
vec3 bandsOf(float phase) {
  vec3 shift = vec3(0.0, 0.5, 0.18) * rainbow;
  return 1.0 - 0.42 * (0.5 - 0.5 * cos(TAU * (phase + shift)));
}

void main() {
  vec2 square = vec2(size.x / size.y, 1.0);
  vec2 q = clamp(seen(here(), square), 0.0, 1.0); // (zoomed in enough that it never runs off)
  vec4 source = texture(picture, q);
  vec3 base = source.rgb;

  // The bands (and a faint line texture): strongest on smooth, bright parts
  vec2 u = (gl_FragCoord.xy - 0.5 * size) / min(size.x, size.y);
  vec2 phase = drift(u) * bands;
  vec3 mask = bandsOf(phase.x);
  if (grid > 0.5) mask *= bandsOf(phase.y);
  mask *= 1.0 - 0.12 * (0.5 - 0.5 * cos(TAU * u.x / lineSpace));
  float average = (grid > 0.5 ? 0.79 * 0.79 : 0.79) * 0.94;          // keep the overall brightness
  float detail = length(base - texture(soft, q).rgb);
  float shows = smoothstep(0.08, 0.6, luma(base)) * (1.0 - smoothstep(0.04, 0.18, detail));
  shows *= mix(1.0, smoothstep(0.48, 0.62, patches(u)), patchy); // about half the picture clear at 100
  vec3 shown = clamp(base * mix(vec3(1.0), mask / average, amount * mix(0.1, 1.0, shows)), 0.0, 1.0);

  colour = vec4(shown, source.a);
}`;

// The pretend phone at this Phone position: each part of its pose drifts along its own smooth
// random curve (whole-number speeds, so position 100 comes back to where 0 started)
export function phonePose(settings, seed) {
  const random = seeded(seed);
  const t = (settings.phone / 100) * Math.PI * 2;
  const drift = () => {
    const a = 1 + Math.floor(random() * 2), b = 2 + Math.floor(random() * 3);
    const p = random() * Math.PI * 2, q = random() * Math.PI * 2;
    return 0.65 * Math.sin(a * t + p) + 0.35 * Math.sin(b * t + q);
  };
  const m = settings.movement / 100;
  const tilt = settings.tilt / 100;
  const degrees = Math.PI / 180;
  const turnDrift = drift(), leanX = drift(), leanY = drift();
  const pose = {
    turn: turnDrift * (0.4 + 6 * m) * degrees,
    stretch: drift() * (0.004 + 0.03 * m) + (random() < 0.5 ? -0.002 : 0.002),
    lean: [leanX * 0.6 * m, leanY * 0.6 * m],
    lens: drift() * 0.25 * m,
    lensCentre: [drift() * 0.4, drift() * 0.4],
    slide: [drift() * 2, drift() * 2],              // in bands
    pictureTurn: turnDrift * 4 * degrees * tilt,
    pictureLean: [leanX * 0.5 * tilt, leanY * 0.5 * tilt],
    zoom: 1 + 0.12 * tilt,
    // (choices a removed reflection used: still drawn, so every phone path stays where it was)
    unused: [drift(), drift(), drift(), random(), random()],
    bandDrift: drift(),
    patchShift: [drift() * 1.5, drift() * 1.5]
  };
  return pose;
}

// How strongly the grids drift apart for this pose (so Band size sets how many bands show,
// whatever the pose; Movement then bends them rather than packing them in)
function driftStrength(pose) {
  return Math.abs(pose.stretch) + Math.abs(pose.turn) + 0.5 * Math.hypot(...pose.lean) + 0.5 * Math.abs(pose.lens) + 0.002;
}

// Wander: one slider that moves the others along a smooth random path (each within a range that
// always looks good; Amount and Pattern stay where they are). The same spot always gives the
// same settings; Reroll gives a new path. Returns the settings to change.
const WANDERS = {
  phone: [0, 100],
  movement: [20, 90],
  tilt: [0, 55],
  patchiness: [20, 85],
  bandSize: [15, 75],
  rainbow: [35, 95]
};
function wanderTo(settings, seed) {
  return wanderSettings(settings.wander, seed, WANDERS);
}

// How far the turned, leaning picture has to be zoomed in to fill the whole frame: where the
// frame's four corners land in the picture (the picture's edges are straight lines, so if the
// corners are inside, everything is)
function coverZoom(pose, square) {
  const [c, s] = [Math.cos(pose.pictureTurn), Math.sin(pose.pictureTurn)];
  let need = 1;
  for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const x0 = (u - 0.5) * square[0], y0 = (v - 0.5) * square[1];
    let x = c * x0 - s * y0, y = s * x0 + c * y0;
    const k = 1 + pose.pictureLean[0] * x + pose.pictureLean[1] * y;
    x /= k; y /= k;
    need = Math.max(need, 2 * Math.abs(x) / square[0], 2 * Math.abs(y) / square[1]);
  }
  return need * 1.002;
}

export default {
  type: "screen",
  label: "Screen",
  vibe: { light: { amount: 11.7, rainbow: 15.3 }, full: { amount: 66.3, rainbow: 86.7 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "A phone photo of a screen: rippling moiré bands.",
  group: "Texture",
  defaults: () => ({
    wander: 78,                  // where Wander last took the sliders below (0 - 100)
    amount: 39,                 // 0 (none) - 100
    phone: 26.5,                  // where the pretend phone is on its path (0 and 100 are the same spot)
    movement: 38,               // 0 (held still, square-on) - 100 (waved about: fans and rings)
    tilt: 0,                    // 0 (the picture flat) - 100 (turned and leaning, zoomed in to fill)
    patchiness: 73,             // 0 (bands everywhere) - 100 (only in drifting patches)
    bandSize: 64,               // 0 (many thin bands) - 100 (a few wide ones)
    rainbow: 51,                // 0 (no colour fringes) - 100
    pattern: "lines",           // lines | grid
    drift: 93                    // 0 (still) - 100 (the phone drifts quickly as the song plays)
  }),
  videoDefaults: () => ({ amount: 9, phone: 54.5, movement: 84, tilt: 14, patchiness: 63 }), // (Tom's video settings, MTNS_stay 2026-10-25)
  controls: [
    { key: "wander", label: "Wander (moves the sliders below)", min: 0, max: 100, step: 0.5, drives: wanderTo },
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "phone", label: "Phone position", min: 0, max: 100, step: 0.5 },
    { key: "movement", label: "Movement", min: 0, max: 100, step: 1 },
    { key: "tilt", label: "Tilt", min: 0, max: 100, step: 1 },
    { key: "patchiness", label: "Patchiness", min: 0, max: 100, step: 1 },
    { key: "bandSize", label: "Band size", min: 0, max: 100, step: 1 },
    { key: "rainbow", label: "Rainbow", min: 0, max: 100, step: 1 },
    { key: "pattern", label: "Pattern", kind: "choice", options: [
      { value: "lines", label: "Lines" },
      { value: "grid", label: "Grid (both ways)" }
    ] },
    { key: "drift", label: "Drift (moves as the song plays)", min: 0, max: 100, step: 1 }
  ],
  moves: (settings) => settings.drift > 0,
  // Older versions had Glare (a window reflection, removed), Waves (how many and how curvy the bands were: now Movement) and
  // Line size (now Band size)
  migrate(settings) {
    delete settings.glare;
    if (settings.waves !== undefined) {
      if (settings.movement === undefined) settings.movement = settings.waves;
      delete settings.waves;
    }
    if (settings.lineSize !== undefined) {
      if (settings.bandSize === undefined) settings.bandSize = settings.lineSize;
      delete settings.lineSize;
    }
  },
  apply(settings, run) {
    if (settings.amount <= 0 && settings.tilt <= 0) return run.input;
    const shortSide = Math.min(run.width, run.height);
    const spacing = Math.max(3, shortSide / 260);                 // the faint screen lines (at least 3 pixels)
    const lineSpace = spacing / shortSide;
    // Drift: the phone moves along its path with song time (at 100, once round in 20 seconds)
    const phone = settings.phone + (settings.drift > 0 ? (run.time || 0) * (settings.drift / 100) * 5 : 0);
    const pose = phonePose({ ...settings, phone }, run.seed);
    const square = [run.width / shortSide, run.height / shortSide];
    const zoom = Math.max(pose.zoom, coverZoom(pose, square));
    const across = (120 - (settings.bandSize / 100) * 110) * (1 + 0.3 * pose.bandDrift); // 120 (thin) - 10 (wide), varying a little as the phone moves
    const bands = across / driftStrength(pose);
    const soft = gaussianBlur(run, smallerCopies(run, run.input, 1), Math.max(2, spacing * 1.5));
    return run.pass(RECIPE, { picture: run.input, soft }, {
      amount: settings.amount / 100,
      bands,
      lineSpace,
      rainbow: settings.rainbow / 100,
      grid: settings.pattern === "grid" ? 1 : 0,
      turn: pose.turn,
      stretch: pose.stretch,
      lean: pose.lean,
      lens: pose.lens,
      lensCentre: pose.lensCentre,
      slide: pose.slide.map((v) => v / bands),
      pictureTurn: pose.pictureTurn,
      pictureLean: pose.pictureLean,
      zoom,
      patchy: settings.patchiness / 100,
      patchShift: pose.patchShift
    });
  }
};
