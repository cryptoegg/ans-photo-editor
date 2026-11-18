// Effect: RGB stripes (Tom, 2026-11-18, from his references: a face on a close-up screen) — the picture in tall
// columns, each split into red, green and blue stripes like a screen's sub-pixels, the colours pushed and the
// columns' pixels a little blocky.
const RECIPE = `
uniform sampler2D picture;
uniform float column;   // a column's width, in short sides
uniform float amount;   // 0 - 1
void main() {
  vec2 square = size / min(size.x, size.y);
  vec2 p = here() * square;
  float cx = (floor(p.x / column) + 0.5) * column;
  float cy = (floor(p.y / (column * 1.5)) + 0.5) * column * 1.5;
  vec4 c = sampleAt(picture, vec2(cx, mix(p.y, cy, 0.6)) / square);
  float f = fract(p.x / column) * 3.0;
  vec3 sub = f < 1.0 ? vec3(1.0, 0.18, 0.18) : f < 2.0 ? vec3(0.18, 1.0, 0.18) : vec3(0.18, 0.18, 1.0);
  float edge = smoothstep(0.0, 0.15, fract(f)) * smoothstep(1.0, 0.85, fract(f));
  vec3 lit = clamp(c.rgb * sub * 1.9 * mix(0.6, 1.0, edge), 0.0, 1.0);
  colour = vec4(mix(c.rgb, lit, amount), c.a);
}`;

export default {
  type: "stripes",
  label: "RGB stripes",
  description: "A close-up screen: red, green and blue stripes.",
  group: "Break up",
  defaults: () => ({ size: 30, amount: 85 }),
  controls: [
    { key: "size", label: "Size", min: 0, max: 100, step: 1 },
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 }
  ],
  apply(settings, run) {
    return run.pass(RECIPE, { picture: run.input }, { column: 0.004 + (settings.size / 100) * 0.03, amount: settings.amount / 100 });
  }
};
