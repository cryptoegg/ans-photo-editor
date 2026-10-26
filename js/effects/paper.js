// Effect: Paper — the photo printed on paper (or canvas): the whites become the paper's colour,
// and the paper's own surface shows through: fibres and uneven tone (or a woven canvas),
// creases where it's been folded, and stains where it's been soaked. Where the creases and
// stains fall comes from the seed (Reroll for another sheet).
import { seeded } from './kit.js';
import { toRGB } from './colours.js';

const RECIPE = `
uniform sampler2D picture;
uniform float amount;       // 0 - 1: how much the paper shows
uniform vec3 paperColour;
uniform float texture_;     // 0 - 1: fibres and uneven tone
uniform float canvas;       // 0 paper, 1 woven canvas
uniform float creases;      // 0 - 1
uniform vec4 fold[3];       // each crease: a point on it (xy) and its direction (zw)
uniform float stains;       // 0 - 1

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec2 p = place();

  // The sheet: its colour, uneven tone and fibres (or the weave of a canvas)
  float tone = (fbm(p * 3.0, 31u) - 0.5) * 0.35 + (fbm(p * 40.0, 32u) - 0.5) * 0.25;
  float fibres = (noise(vec2(p.x * 700.0, p.y * 40.0), 33u) - 0.5) + (noise(p * 500.0, 38u) - 0.5) * 0.6;
  float weave = 0.0;
  if (canvas > 0.5) {
    // linen: threads running both ways, each a little thicker or thinner than the next
    vec2 w = p * 230.0;
    float warp = sin(w.x * 3.14159) * (0.7 + 0.6 * noise(vec2(floor(w.x), w.y * 0.05), 34u));
    float weft = sin(w.y * 3.14159) * (0.7 + 0.6 * noise(vec2(w.x * 0.05, floor(w.y)), 39u));
    weave = (abs(warp) + abs(weft) - 1.27) * 0.12 + (noise(w * 0.35, 40u) - 0.5) * 0.08;
  }
  vec3 sheet = paperColour * (1.0 + texture_ * (tone + fibres * 0.12 + weave));

  // Stains: soaked patches, darker and browner at their dried edges
  float wet = fbm(p * 1.8 + 3.0, 35u);
  float soak = smoothstep(0.5, 0.6, wet);
  float rim = smoothstep(0.48, 0.5, wet) - smoothstep(0.5, 0.53, wet);       // the dried tide mark
  vec3 stain = mix(vec3(1.0), vec3(0.8, 0.66, 0.45), clamp(soak * 0.55 + rim * 1.2, 0.0, 1.0));
  sheet *= mix(vec3(1.0), stain, stains);

  // The photo printed on it (multiplied: the whites become the sheet)
  vec3 printed = source.rgb * sheet;

  // Creases: a thin pale crack along each fold, one side a little lighter, the other darker
  for (int i = 0; i < 3; i++) {
    vec2 d = normalize(fold[i].zw);
    float side = dot(p - fold[i].xy, vec2(-d.y, d.x));
    float wobble = (noise(vec2(dot(p, d) * 30.0, float(i)), 36u) - 0.5) * 0.004;
    float s = side + wobble;
    // a fold: the lit side lighter, the far side in shadow, fading over a few percent of the picture
    float shade = s > 0.0 ? 1.0 + 0.2 * exp(-s * 35.0) : 1.0 - 0.3 * exp(s * 28.0);
    float crack = 1.0 - smoothstep(0.0008, 0.0025, abs(s));
    float broken = smoothstep(0.3, 0.55, noise(vec2(dot(p, d) * 14.0, float(i) + 9.0), 37u));
    vec3 creased = printed * shade;
    creased = mix(creased, sheet * 1.04, crack * broken);
    float on = clamp(creases * 3.0 - float(i), 0.0, 1.0); // more creases as the slider goes up
    printed = mix(printed, creased, on);
  }

  colour = vec4(mix(source.rgb, clamp(printed, 0.0, 1.0), amount), source.a);
}`;

export default {
  type: "paper",
  label: "Paper",
  only: ["image"],              // pictures only (not videos / the camera)
  later: true,                  // taken out of the menus (Tom, 2026-10-24); saved ones still draw
  description: "Printed on paper or canvas: texture, creases, stains.",
  group: "Texture",
  defaults: () => ({
    amount: 100,                // 0 (none) - 100
    colour: "#efe8d8",          // the paper
    surface: "paper",           // paper | canvas
    texture: 50,                // 0 (smooth) - 100 (rough, uneven)
    creases: 0,                 // 0 (none) - 100 (folded several times)
    stains: 0                   // 0 (clean) - 100 (soaked)
  }),
  controls: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "colour", label: "Paper colour", kind: "colour" },
    { key: "surface", label: "Surface", kind: "choice", options: [
      { value: "paper", label: "Paper" },
      { value: "canvas", label: "Canvas (woven)" }
    ] },
    { key: "texture", label: "Texture", min: 0, max: 100, step: 1 },
    { key: "creases", label: "Creases", min: 0, max: 100, step: 1 },
    { key: "stains", label: "Stains", min: 0, max: 100, step: 1 }
  ],
  apply(settings, run) {
    if (settings.amount <= 0) return run.input;
    const random = seeded(run.seed);
    const aspect = run.width / run.height;
    const across = Math.max(1, aspect);          // the picture in short sides
    const down = Math.max(1, 1 / aspect);
    const fold = [];
    for (let i = 0; i < 3; i++) {
      const angle = (random() < 0.5 ? 0 : Math.PI / 2) + (random() - 0.5) * 0.25; // mostly across or down
      fold.push(across * (0.2 + random() * 0.6), down * (0.2 + random() * 0.6), Math.cos(angle), Math.sin(angle));
    }
    return run.pass(RECIPE, { picture: run.input }, {
      amount: settings.amount / 100,
      paperColour: toRGB(settings.colour),
      texture_: settings.texture / 100,
      canvas: settings.surface === "canvas" ? 1 : 0,
      creases: settings.creases / 100,
      "fold[0]": fold.slice(0, 4), "fold[1]": fold.slice(4, 8), "fold[2]": fold.slice(8, 12),
      stains: settings.stains / 100
    });
  }
};
