// Effect: Stretch — bands of the picture (or lyrics) pulled tall, or squashed: inside a band,
// a thin slice is stretched to fill it, like a scan where the paper stuck for a moment.
// Rows: bands across (letters stretched tall); Columns: bands down (stretched wide).
// Which bands, and how much, comes from the seed; with Speed they change as the song plays.

const RECIPE = `
uniform sampler2D picture;
uniform float amount;       // 0 - 1: how many bands are stretched
uniform float band;         // band size, in short sides
uniform float strength;     // 0 - 1
uniform float columns;      // 0 rows, 1 columns
uniform float step_;        // which moment (changes with Speed; 0 when still)

float rnd(float a, float b, uint salt) { return 0.5 + 0.5 * random(ivec2(int(a), int(b)), salt); }

void main() {
  vec2 square = size / min(size.x, size.y);
  vec2 p = here() * square;
  float along = columns > 0.5 ? p.x : p.y;
  float b = floor(along / band);
  vec2 from = p;
  if (rnd(b, step_, 121u) < amount) {
    float centre = (b + 0.2 + 0.6 * rnd(b, step_ + 1.0, 121u)) * band;
    float squash = rnd(b, step_ + 2.0, 121u) < 0.8
      ? mix(1.0, 0.04, strength * (0.4 + 0.6 * rnd(b, step_ + 3.0, 121u)))   // stretched (mostly)
      : mix(1.0, 2.5, strength);                                           // or squashed
    float a2 = centre + (along - centre) * squash;
    if (columns > 0.5) from.x = a2; else from.y = a2;
  }
  colour = sampleAt(picture, from / square);
}`;

export default {
  type: "stretch",
  label: "Stretch",
  vibe: { light: { amount: 30, strength: 30 }, full: { amount: 100, strength: 100 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Bands pulled tall (or squashed), like a stuck scan.",
  group: "Warp",
  defaults: () => ({
    amount: 100,                 // 0 (no bands) - 100 (every band)
    strength: 100,               // 0 (barely) - 100 (pulled very tall)
    size: 17,                   // 0 (thin bands) - 100 (tall bands)
    direction: "rows",          // rows | columns
    speed: 0                    // 0 (still) - 100 (changes many times a second)
  }),
  controls: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "strength", label: "Strength", min: 0, max: 100, step: 1 },
    { key: "size", label: "Band size", min: 0, max: 100, step: 1 },
    { key: "direction", label: "Direction", kind: "choice", options: [
      { value: "rows", label: "Rows (stretched tall)" },
      { value: "columns", label: "Columns (stretched wide)" }
    ] },
    { key: "speed", label: "Speed (changes as the song plays)", min: 0, max: 100, step: 1 }
  ],
  moves: (settings) => settings.speed > 0,
  apply(settings, run) {
    if (settings.amount <= 0 || settings.strength <= 0) return run.input;
    const perSecond = (settings.speed / 100) * 12;
    return run.pass(RECIPE, { picture: run.input }, {
      amount: settings.amount / 100,
      band: 0.02 + (settings.size / 100) * 0.3,
      strength: settings.strength / 100,
      columns: settings.direction === "columns" ? 1 : 0,
      step_: perSecond > 0 ? Math.floor((run.time || 0) * perSecond) % 9973 : 0
    });
  }
};
