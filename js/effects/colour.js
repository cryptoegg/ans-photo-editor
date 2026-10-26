// Adjust → Colour: Colour or B&W, and the usual colour controls, every slider 0 in the middle:
//   Temperature  bluer ↔ warmer (yellow)
//   Tint         greener ↔ more magenta
//   Saturation   less ↔ more colour
//   Vibrance     more colour where there's little (skin and bright colours spared)
// B&W turns the result to greys (Temperature and Tint still shape which colours go lighter or
// darker, like a colour filter on black-and-white film). The Colour tint wash sits in here too
// (js/effects/tint.js).

const RECIPE = `
uniform sampler2D picture;
uniform float warm;       // -1 to 1
uniform float magenta;    // -1 to 1
uniform float saturation; // -1 to 1
uniform float vibrance;   // -1 to 1
uniform float mono;       // 0 colour, 1 B&W

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec3 c = source.rgb;
  c += vec3(warm * 0.1 + magenta * 0.04, warm * 0.02 - magenta * 0.09, -warm * 0.12 + magenta * 0.04);
  c = clamp(c, 0.0, 1.0);
  if (vibrance != 0.0) {
    float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
    c = mix(vec3(luma(c)), c, 1.0 + vibrance * (1.0 - sat) * 1.2);
  }
  if (saturation != 0.0) c = mix(vec3(luma(c)), c, 1.0 + saturation);
  if (mono > 0.5) c = vec3(luma(c));
  colour = vec4(clamp(c, 0.0, 1.0), source.a);
}`;

export default {
  type: "colour",
  label: "Colour",
  adjust: true,                 // in the Adjust section (always on; every slider 0 = no change)
  description: "Colour or B&W, temperature, tint, saturation, vibrance.",
  group: "Adjust",
  defaults: () => ({
    mono: false,                // true: black and white
    temperature: 0,             // -100 (blue) - 100 (yellow)
    tint: 0,                    // -100 (green) - 100 (magenta)
    saturation: 0,              // -100 (no colour) - 100 (double)
    vibrance: 0                 // -100 - 100
  }),
  controls: [
    { key: "mono", label: "", kind: "segment", options: [{ value: false, label: "Colour" }, { value: true, label: "B&W" }] },
    { key: "temperature", label: "Temperature", min: -100, max: 100, step: 1 },
    { key: "tint", label: "Tint", min: -100, max: 100, step: 1 },
    { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1 },
    { key: "vibrance", label: "Vibrance", min: -100, max: 100, step: 1 }
  ],
  apply(settings, run) {
    const s = { temperature: 0, tint: 0, saturation: 0, vibrance: 0, ...settings };
    if (!s.mono && !s.temperature && !s.tint && !s.saturation && !s.vibrance) return run.input;
    return run.pass(RECIPE, { picture: run.input }, {
      warm: s.temperature / 100, magenta: s.tint / 100, saturation: s.saturation / 100, vibrance: s.vibrance / 100, mono: s.mono ? 1 : 0
    });
  }
};
