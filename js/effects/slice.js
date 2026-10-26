// Effect: Slice — thin strips of the picture (or lyrics) slid sideways, some flipped, like a
// glitch or a torn, re-taped print. Which strips, how far and which way come from the seed;
// with Speed they change as the song plays.

const RECIPE = `
uniform sampler2D picture;
uniform float amount;       // 0 - 1: how many strips move
uniform float strip;        // average strip height, in short sides
uniform float shift;        // how far they move, in short sides
uniform float flip;         // 0 - 1: chance a moved strip is mirrored
uniform float step_;        // which moment (0 when still)

float rnd(float a, float b, uint salt) { return 0.5 + 0.5 * random(ivec2(int(a), int(b)), salt); }

void main() {
  vec2 square = size / min(size.x, size.y);
  vec2 p = here() * square;
  // Uneven strips: the strip grid itself is warped a little
  float y = p.y / strip + (noise(vec2(p.y / strip * 0.5, step_), 131u) - 0.5) * 1.5;
  float s = floor(y);
  vec2 from = p;
  if (rnd(s, step_, 132u) < amount) {
    from.x += (rnd(s, step_ + 1.0, 132u) - 0.5) * 2.0 * shift;
    if (rnd(s, step_ + 2.0, 132u) < flip) from.x = square.x - from.x;
  }
  colour = sampleAt(picture, from / square);
}`;

export default {
  type: "slice",
  label: "Slice",
  vibe: { light: { amount: 30, shift: 24.3, flip: 30 }, full: { amount: 100, shift: 100, flip: 100 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Thin strips slid sideways, some flipped.",
  group: "Warp",
  defaults: () => ({
    amount: 100,                 // 0 (none) - 100 (every strip)
    size: 100,                   // 0 (hairline strips) - 100 (thick)
    shift: 81,                  // how far they slide
    flip: 100,                   // 0 (never) - 100: strips mirrored
    speed: 0                    // 0 (still) - 100 (changes many times a second)
  }),
  controls: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "size", label: "Strip size", min: 0, max: 100, step: 1 },
    { key: "shift", label: "Shift", min: 0, max: 100, step: 1 },
    { key: "flip", label: "Flipped strips", min: 0, max: 100, step: 1 },
    { key: "speed", label: "Speed (changes as the song plays)", min: 0, max: 100, step: 1 }
  ],
  moves: (settings) => settings.speed > 0,
  apply(settings, run) {
    if (settings.amount <= 0) return run.input;
    const perSecond = (settings.speed / 100) * 15;
    return run.pass(RECIPE, { picture: run.input }, {
      amount: settings.amount / 100,
      strip: 0.006 + (settings.size / 100) * 0.12,
      shift: (settings.shift / 100) * 0.3,
      flip: settings.flip / 100,
      step_: perSecond > 0 ? Math.floor((run.time || 0) * perSecond) % 9973 : 0
    });
  }
};
