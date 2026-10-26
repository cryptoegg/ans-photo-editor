// Building blocks shared by effects: smaller copies of a picture, a soft (gaussian) blur, and
// seeded random numbers / curves for choices made in JavaScript.
// Wide blurs run on a smaller copy (fast, and just as smooth once blurred).

// A repeatable random number generator (0 - 1) from a seed
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A Wander slider: moves the given settings along smooth random curves as `value` (0 - 100)
// goes, each within its [low, high] range. The same value always gives the same settings.
export function wanderSettings(value, seed, ranges) {
  const random = seeded(seed ^ 0x5eed);
  const t = (value / 100) * Math.PI * 2;
  const changes = {};
  Object.entries(ranges).forEach(([key, [low, high]]) => {
    const a = 1 + Math.floor(random() * 3), b = 3 + Math.floor(random() * 3);
    const p = random() * Math.PI * 2, q = random() * Math.PI * 2;
    const curve = 0.7 * Math.sin(a * t + p) + 0.3 * Math.sin(b * t + q); // -1 to 1
    changes[key] = Math.round(low + (high - low) * (0.5 + 0.5 * curve));
  });
  return changes;
}

// Half-size copy (each pixel the average of four)
export const HALF = `
uniform sampler2D picture;
void main() { colour = texture(picture, here()); }`;

// Gaussian blur in one direction; `reach` is its sigma in this image's pixels
const GAUSSIAN = `
uniform sampler2D picture;
uniform vec2 direction;
uniform float reach;
void main() {
  vec2 stepSize = direction / size;
  int taps = min(int(ceil(reach * 3.0)), 40);
  vec3 sum = vec3(0.0);
  float alpha = 0.0, total = 0.0;
  for (int i = -40; i <= 40; i++) {
    if (i < -taps || i > taps) continue;
    float w = exp(-0.5 * float(i * i) / (reach * reach));
    vec4 c = texture(picture, here() + stepSize * float(i));
    sum += c.rgb * c.a * w;           // weighted by how solid each pixel is, so see-through
    alpha += c.a * w;                 // pixels (around lettering) don't darken the edges
    total += w;
  }
  colour = vec4(alpha > 0.0 ? sum / alpha : vec3(0.0), alpha / total);
}`;

// Smaller and smaller copies of `first` (an image at 1 / firstFactor of the picture), each half
// the size of the one before, down to 1/64. Returns [{ image, factor }], biggest first.
export function smallerCopies(run, first, firstFactor = 1) {
  const levels = [{ image: first, factor: firstFactor }];
  for (let factor = firstFactor * 2; factor <= 64; factor *= 2) {
    const image = run.pass(HALF, { picture: levels[levels.length - 1].image }, {}, { width: run.width / factor, height: run.height / factor });
    levels.push({ image, factor });
  }
  return levels;
}

// A gaussian blur reaching `reach` picture pixels (sigma), done on the smallest copy that still
// has enough detail for it. Returns the blurred image (at that copy's size; read it with
// texture(…, here()) at any size).
export function gaussianBlur(run, levels, reach) {
  const usable = levels.filter((level) => reach / level.factor >= 3);
  const level = usable.length ? usable[usable.length - 1] : levels[0];
  const at = { width: run.width / level.factor, height: run.height / level.factor };
  const sigma = Math.max(0.5, reach / level.factor);
  const across = run.pass(GAUSSIAN, { picture: level.image }, { direction: [1, 0], reach: sigma }, at);
  return run.pass(GAUSSIAN, { picture: across }, { direction: [0, 1], reach: sigma }, at);
}
