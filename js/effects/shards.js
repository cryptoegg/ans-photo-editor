// Effect: Shards (Tom, 2026-11-18, from his references: a face broken into rectangles, each slipped a little) — rows
// of uneven height, each cut into pieces of uneven width; most pieces slide a little off where they came from.
const RECIPE = `
uniform sampler2D picture;
uniform float cell;    // a piece's height, in short sides
uniform float shift;   // how far pieces slip, in short sides
uniform float amount;  // 0 - 1: how many pieces slip
void main() {
  vec2 square = size / min(size.x, size.y);
  vec2 p = here() * square;
  float y = p.y / cell + (noise(vec2(p.y / cell * 0.6, 3.0), 301u) - 0.5) * 1.6;
  float r = floor(y);
  float w = cell * (0.35 + 1.1 * (0.5 + 0.5 * random(ivec2(int(r), 7), 302u)));
  float x = p.x / w + (0.5 + 0.5 * random(ivec2(int(r), 8), 303u));
  ivec2 id = ivec2(int(floor(x)), int(r));
  vec2 off = vec2(0.0);
  if (0.5 + 0.5 * random(id, 306u) < amount) off = vec2(random(id, 304u), random(id, 305u) * 0.6) * shift;
  colour = sampleAt(picture, (p + off) / square);
}`;

export default {
  type: "shards",
  label: "Shards",
  description: "Broken into rectangles that slip.",
  group: "Break up",
  defaults: () => ({ size: 35, shift: 40, amount: 75 }),
  controls: [
    { key: "size", label: "Size", min: 0, max: 100, step: 1 },
    { key: "shift", label: "Shift", min: 0, max: 100, step: 1 },
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 }
  ],
  apply(settings, run) {
    return run.pass(RECIPE, { picture: run.input }, { cell: 0.012 + (settings.size / 100) * 0.1, shift: (settings.shift / 100) * 0.12, amount: settings.amount / 100 });
  }
};
