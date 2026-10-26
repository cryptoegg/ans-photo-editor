// Effect: Frame — the picture as a print on paper: a paper border with a rough, torn-ish inner
// edge and a faint shadow just inside it. Size is how thick the border is. Its uneven edge
// comes from the seed (Reroll). (TV screen and film border styles were tried and taken out for
// now; more frame styles may come back later.)
import { toRGB } from './colours.js';

const RECIPE = `
uniform sampler2D picture;
uniform float border;       // the border's thickness, in short sides
uniform vec3 borderColour;

// How far inside a rounded rectangle this point is (negative = outside), in short sides
float insideBox(vec2 p, vec2 halfSize, float corner) {
  vec2 q = abs(p) - (halfSize - corner);
  return -(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner);
}

void main() {
  vec2 square = size / min(size.x, size.y);        // the picture's size in short sides
  vec2 p = (here() - 0.5) * square;                 // from the middle, in short sides
  vec2 halfSize = 0.5 * square - border;
  vec4 source = texelFetch(picture, pixel(), 0);
  vec3 c = source.rgb;
  // A rough, torn-ish inner edge and a faint shadow just inside it
  float rough = (fbm(p * 18.0, 93u) - 0.5) * 0.012 + (noise(p * 220.0, 94u) - 0.5) * 0.0025;
  float inside = insideBox(p, halfSize, 0.004) + rough;
  c *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.02, inside));
  vec3 sheet = borderColour * (0.96 + 0.06 * fbm(p * 20.0, 95u));
  c = mix(sheet, c, smoothstep(0.0, 0.0015, inside));
  colour = vec4(c, source.a);
}`;

export default {
  type: "frame",
  label: "Frame (print edge)",
  later: true,                  // taken out of the menus (2026-10-19); saved ones still draw
  description: "A rough paper border, like a print.",
  group: "Damage & frames",
  defaults: () => ({
    size: 30,                   // 0 (thin) - 100 (thick)
    colour: "#f4f0e6"           // the paper border
  }),
  controls: [
    { key: "size", label: "Size", min: 0, max: 100, step: 1 },
    { key: "colour", label: "Border colour", kind: "colour" }
  ],
  // Older saves had a Style (TV screen / film border / print edge): all are print edges now
  migrate(settings) {
    if (settings.style === undefined) return;
    if (settings.style !== "print") settings.colour = "#f4f0e6"; // their dark border wouldn't suit paper
    delete settings.style;
  },
  apply: (settings, run) => run.pass(RECIPE, { picture: run.input }, {
    border: 0.005 + (settings.size / 100) * 0.12,
    borderColour: toRGB(settings.colour)
  })
};
