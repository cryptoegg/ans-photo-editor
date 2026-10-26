// Effect: Liquify — the picture (or lyrics) bent like liquid: soft, bulging, stretching waves
// travel through it, so letters pinch, swell and melt into blobs and then come back clean.
// Patches: the warp only takes hold in some areas at a time (one part mangled, another clean),
// and with Speed those areas and the waves move as the song plays.

const RECIPE = `
uniform sampler2D picture;
uniform float amount;       // 0 - 1
uniform float blob;         // the size of the waves, in short sides
uniform float t;            // seconds of song x speed (0 when still)
uniform float direction;    // 0 both ways, 1 up and down (letters stretch tall), 2 sideways
uniform float patchy;       // 0 everywhere - 1 only in patches

void main() {
  vec2 square = size / min(size.x, size.y);
  vec2 p = here() * square;
  vec2 q = p / blob;
  vec2 d = vec2(fbm(q + vec2(3.1, t * 0.35), 101u), fbm(q + vec2(-t * 0.3, 8.7), 102u)) - 0.5;
  if (direction > 0.5 && direction < 1.5) d = vec2(d.x * 0.15, d.y * 1.6);
  if (direction > 1.5) d = vec2(d.x * 1.6, d.y * 0.15);
  float where = mix(1.0, smoothstep(0.42, 0.62, noise(p * 1.3 + vec2(t * 0.25, -t * 0.1), 103u)), patchy);
  vec2 from = p + d * blob * 1.2 * amount * where;
  colour = sampleAt(picture, from / square);
}`;

export default {
  type: "liquify",
  label: "Liquify",
  vibe: { light: { amount: 30, size: 29.4 }, full: { amount: 100, size: 100 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Bulging, stretching liquid waves travelling through it.",
  group: "Warp",
  defaults: () => ({
    amount: 100,                 // 0 (none) - 100
    size: 98,                   // 0 (small ripples) - 100 (big slow bulges)
    direction: "both",      // both | vertical | sideways
    patches: 83,                // 0 (everywhere) - 100 (only in patches)
    speed: 42                   // 0 (still) - 100 (fast)
  }),
  videoDefaults: () => ({ amount: 32, size: 100, direction: "vertical", patches: 0, speed: 17 }), // (Tom's video settings, MTNS_stay 2026-10-25)
  controls: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "size", label: "Size", min: 0, max: 100, step: 1 },
    { key: "direction", label: "Direction", kind: "choice", options: [
      { value: "vertical", label: "Up and down (stretch tall)" },
      { value: "sideways", label: "Sideways" },
      { value: "both", label: "Both ways" }
    ] },
    { key: "patches", label: "Patches", min: 0, max: 100, step: 1 },
    { key: "speed", label: "Speed (moves as the song plays)", min: 0, max: 100, step: 1 }
  ],
  moves: (settings) => settings.speed > 0,
  apply(settings, run) {
    if (settings.amount <= 0) return run.input;
    return run.pass(RECIPE, { picture: run.input }, {
      amount: settings.amount / 100,
      blob: 0.04 + (settings.size / 100) * 0.4,
      t: ((run.time || 0) * (settings.speed / 100) * 2) % 1000,
      direction: settings.direction === "vertical" ? 1 : settings.direction === "sideways" ? 2 : 0,
      patchy: settings.patches / 100
    });
  }
};
