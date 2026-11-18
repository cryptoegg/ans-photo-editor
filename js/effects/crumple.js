// Effect: Crumple (Tom, 2026-11-18, from his references: a printed face crumpled over a head) — the picture as a
// crumpled print: sharp creases (ridged noise), the picture pushed along them, lit from the top left with shine on
// the ridges and shade in the folds.
const RECIPE = `
uniform sampler2D picture;
uniform float scale;   // creases per short side
uniform float amount;  // 0 - 1
float height(vec2 p) {
  float h = 0.0, w = 0.55;
  for (int i = 0; i < 4; i++) { h += w * (1.0 - abs(noise(p, 401u + uint(i)) * 2.0 - 1.0)); p = p * 2.07 + vec2(3.1, 1.7); w *= 0.5; }
  return h;
}
void main() {
  vec2 square = size / min(size.x, size.y);
  vec2 p = here() * square;
  vec2 q = p * scale;
  float e = 0.02;
  float h = height(q);
  vec2 g = vec2(height(q + vec2(e, 0.0)) - h, height(q + vec2(0.0, e)) - h) / e;
  vec4 c = sampleAt(picture, (p + g * 0.03 * amount / scale * 6.0) / square);
  vec3 n = normalize(vec3(-g * 0.9 * amount, 1.0));
  float light = dot(n, normalize(vec3(-0.5, -0.6, 0.8)));
  float shine = pow(max(light, 0.0), 12.0) * 0.55 * amount;
  float shade = mix(1.0, 0.35 + 0.85 * light, amount);
  colour = vec4(clamp(c.rgb * shade + shine, 0.0, 1.0), c.a);
}`;

export default {
  type: "crumple",
  label: "Crumple",
  description: "A crumpled print, with creases and shine.",
  group: "Break up",
  defaults: () => ({ amount: 70, size: 45 }),
  controls: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "size", label: "Crease size", min: 0, max: 100, step: 1 }
  ],
  apply(settings, run) {
    if (settings.amount <= 0) return run.input;
    return run.pass(RECIPE, { picture: run.input }, { scale: 9 - (settings.size / 100) * 7, amount: settings.amount / 100 });
  }
};
