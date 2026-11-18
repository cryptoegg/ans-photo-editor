// Adjust → Colour Grading (2026-11-17, step 3 of the pro features, like Lightroom's): three colour wheels —
// Shadows, Midtones, Highlights — each pushing its part of the picture toward a colour (the wheel: angle = hue,
// distance from the middle = amount), with a Luminance slider under each (part of the wheels control); Blending = how much the three parts overlap,
// Balance = where shadows end and highlights begin. The wheels are drawn by the editor (kind "wheels",
// js/ui/colourControls.js).

const RECIPE = `
uniform sampler2D picture;
uniform vec3 shadows;      // hue (0 - 1), amount (0 - 1), luminance (-1 - 1)
uniform vec3 midtones;
uniform vec3 highlights;
uniform float blending;    // 0 - 1
uniform float balance;     // -1 (more highlights) - 1 (more shadows)

vec3 hueColour(float h) {
  vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return k - vec3(luma(k)); // (the colour's lean only: no lighter or darker)
}
vec3 push(vec3 c, vec3 wheel, float weight) {
  return c + (hueColour(wheel.x) * wheel.y * 0.45 + vec3(wheel.z * 0.25)) * weight;
}

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec3 c = source.rgb;
  float l = clamp(luma(c) + balance * 0.25, 0.0, 1.0);
  float w = 0.2 + blending * 0.3;                         // how far each part reaches
  float sW = 1.0 - smoothstep(0.0, 0.5 + w, l);
  float hW = smoothstep(0.5 - w, 1.0, l);
  float mW = clamp(1.0 - abs(l - 0.5) / (0.25 + w), 0.0, 1.0);
  mW = mW * mW * (3.0 - 2.0 * mW);
  c = push(c, shadows, sW);
  c = push(c, midtones, mW);
  c = push(c, highlights, hW);
  colour = vec4(clamp(c, 0.0, 1.0), source.a);
}`;

const DEFAULTS = () => ({
    shadowsHue: 210, shadowsAmount: 0, shadowsLum: 0,
    midtonesHue: 30, midtonesAmount: 0, midtonesLum: 0,
    highlightsHue: 40, highlightsAmount: 0, highlightsLum: 0,
    blending: 50, balance: 0
  });
const PARTS = [["shadows", "Shadows"], ["midtones", "Midtones"], ["highlights", "Highlights"]];

export default {
  type: "grade",
  label: "Colour Grading",
  adjust: true,                 // in the Adjust section (always on; amounts 0 = no change)
  inside: "colour",             // shown in the Colour card, under its own tab (js/ui/effectsPanel.js)
  description: "Colour wheels for the shadows, midtones and highlights.",
  group: "Adjust",
  defaults: () => DEFAULTS(),
  controls: [
    { key: "wheels", label: "Wheels", kind: "wheels", parts: PARTS },
    { key: "blending", label: "Blending", min: 0, max: 100, step: 1 },
    { key: "balance", label: "Balance", min: -100, max: 100, step: 1 }
  ],
  apply(settings, run) {
    const s = { ...DEFAULTS(), ...settings };
    if (PARTS.every(([k]) => !s[k + "Amount"] && !s[k + "Lum"])) return run.input;
    const wheel = (k) => [((s[k + "Hue"] % 360) + 360) % 360 / 360, s[k + "Amount"] / 100, s[k + "Lum"] / 100];
    return run.pass(RECIPE, { picture: run.input }, {
      shadows: wheel("shadows"), midtones: wheel("midtones"), highlights: wheel("highlights"),
      blending: s.blending / 100, balance: s.balance / 100
    });
  }
};
