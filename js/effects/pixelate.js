// Effect: Pixelate (Tom, 2026-11-18, for the Effect brush) — the picture as big square pixels, each the average of
// what's under it.
const RECIPE = `
uniform sampler2D picture;
uniform float cell;   // a pixel's side, in short sides
void main() {
  vec2 square = size / min(size.x, size.y);
  vec2 p = here() * square;
  vec2 c = (floor(p / cell) + 0.5) * cell;
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) sum += sampleAt(picture, (c + (vec2(i, j) - 1.5) * cell / 4.0) / square);
  colour = sum / 16.0;
}`;

export default {
  type: "pixelate",
  label: "Pixelate",
  description: "Big square pixels.",
  group: "Break up",
  defaults: () => ({ size: 35 }),
  controls: [{ key: "size", label: "Size", min: 0, max: 100, step: 1 }],
  apply(settings, run) {
    return run.pass(RECIPE, { picture: run.input }, { cell: 0.006 + (settings.size / 100) * 0.09 });
  }
};
