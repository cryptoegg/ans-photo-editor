// Adjust → Colour → Per colour (Tom, 2026-11-18, like Lightroom's Colour Mixer): eight colours (Red, Orange, Yellow,
// Green, Aqua, Blue, Purple, Pink), each with Hue (turn it toward its neighbours), Saturation (less ↔ more of it) and
// Luminance (darker ↔ lighter). A pixel belongs to the two colours its hue sits between, shared out by how near it is
// to each, so the changes run smoothly into each other; greys (no colour) are left alone. The editor draws the eight
// colour dots and three sliders for the picked one (`perColourControl` in js/ui/colourControls.js).
export const HSL_COLOURS = [
  ["red", "Red", 0, "#e0453a"], ["orange", "Orange", 30, "#f08a24"], ["yellow", "Yellow", 60, "#e8c524"], ["green", "Green", 120, "#3aa655"],
  ["aqua", "Aqua", 180, "#2fb8b8"], ["blue", "Blue", 225, "#3a6fe0"], ["purple", "Purple", 270, "#8a4ad8"], ["pink", "Pink", 315, "#d84aa8"]
];

const RECIPE = `
uniform sampler2D picture;
uniform vec4 hueA; uniform vec4 hueB;   // -1 - 1 per colour (red … green, aqua … pink)
uniform vec4 satA; uniform vec4 satB;
uniform vec4 lumA; uniform vec4 lumB;

const float CENTRE[8] = float[8](0.0, 30.0, 60.0, 120.0, 180.0, 225.0, 270.0, 315.0);

vec3 toHsv(vec3 c) {
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn;
  float h = 0.0;
  if (d > 1e-5) {
    if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
  }
  return vec3(h * 60.0, mx > 0.0 ? d / mx : 0.0, mx);
}
vec3 fromHsv(vec3 c) {
  vec3 k = clamp(abs(mod(c.x / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z * mix(vec3(1.0), k, c.y);
}
float pick(vec4 a, vec4 b, int i) { return i < 4 ? a[i] : b[i - 4]; }

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec3 hsv = toHsv(source.rgb);
  float chroma = hsv.y * hsv.z;
  float k = smoothstep(0.02, 0.2, chroma);   // (greys: no colour to change)
  float H = 0.0, S = 0.0, L = 0.0;
  for (int i = 0; i < 8; i++) {
    float c = CENTRE[i], prev = CENTRE[(i + 7) % 8], next = CENTRE[(i + 1) % 8];
    float toPrev = mod(c - prev + 360.0, 360.0), toNext = mod(next - c + 360.0, 360.0);
    float d = mod(hsv.x - c + 540.0, 360.0) - 180.0;     // -180 - 180
    float w = d >= 0.0 ? max(0.0, 1.0 - d / toNext) : max(0.0, 1.0 + d / toPrev);
    H += w * pick(hueA, hueB, i); S += w * pick(satA, satB, i); L += w * pick(lumA, lumB, i);
  }
  hsv.x = mod(hsv.x + H * 30.0 * k + 360.0, 360.0);
  hsv.y = clamp(hsv.y * (1.0 + S * k), 0.0, 1.0);
  vec3 c = fromHsv(hsv);
  // Luminance: darker toward black, lighter half brighter, half toward white (so the colour holds without burning out)
  float lum = L * k;
  c = lum < 0.0 ? c * (1.0 + lum * 0.6) : mix(c * (1.0 + lum * 0.6), c + (1.0 - c) * lum * 0.6, 0.5);
  colour = vec4(clamp(c, 0.0, 1.0), source.a);
}`;

const DEFAULTS = () => Object.fromEntries(HSL_COLOURS.flatMap(([k]) => [[k + "Hue", 0], [k + "Sat", 0], [k + "Lum", 0]]));

export default {
  type: "hsl",
  label: "Per colour",
  adjust: true,                 // in the Adjust section (always on; all 0 = no change)
  inside: "colour",             // shown in the Colour card, under its own tab (js/ui/panel.js)
  description: "Hue, saturation and luminance for each of eight colours.",
  group: "Adjust",
  defaults: () => DEFAULTS(),
  controls: [{ key: "perColour", label: "Per colour", kind: "perColour" }],
  apply(settings, run) {
    const s = { ...DEFAULTS(), ...settings };
    const vals = (what) => HSL_COLOURS.map(([k]) => (Number(s[k + what]) || 0) / 100);
    const hue = vals("Hue"), sat = vals("Sat"), lum = vals("Lum");
    if ([...hue, ...sat, ...lum].every((v) => !v)) return run.input;
    return run.pass(RECIPE, { picture: run.input }, {
      hueA: hue.slice(0, 4), hueB: hue.slice(4), satA: sat.slice(0, 4), satB: sat.slice(4), lumA: lum.slice(0, 4), lumB: lum.slice(4)
    });
  }
};
