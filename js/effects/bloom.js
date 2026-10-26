// Effect: Bloom — the hazy glow that spills around the bright parts of a photo, like a
// camcorder or a soft lens. Glow says how much of the picture glows (0 nothing, 100 even the
// mid-tones). The bright parts are picked out, blurred at three widths (stacked,
// so the glow is soft near the light and reaches out faintly) and added back with a screen
// blend, so highlights bloom out instead of clipping into flat white. The blurs run on
// smaller copies of the picture (fast), and the reach is relative to the picture's size.
import { smallerCopies, gaussianBlur } from './kit.js';
import { toRGB } from './colours.js';

// Half-size copy of the parts brighter than the threshold
const BRIGHT = `
uniform sampler2D picture;
uniform float threshold;  // 0 - 1 (1: nothing glows, 0: everything does)
void main() {
  vec4 c = texture(picture, here());
  float k = clamp((luma(c.rgb) - threshold) / max(1.0 - threshold, 0.05), 0.0, 1.0);
  colour = vec4(c.rgb * k, 1.0);
}`;

// The photo with the three glows added (screen blend)
const COMBINE = `
uniform sampler2D picture;
uniform sampler2D glowNear;
uniform sampler2D glowMid;
uniform sampler2D glowFar;
uniform float strength;   // 0 - 2
uniform vec3 glowColour;  // white: the light's own colour; red-orange: film halation
void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec3 glow = (texture(glowNear, here()).rgb * 0.5 + texture(glowMid, here()).rgb * 0.3 + texture(glowFar, here()).rgb * 0.2) * strength * glowColour;
  glow = clamp(glow, 0.0, 1.0);
  // see-through areas (around lyrics) glow too, so the light shows past the letters
  float a = clamp(source.a + max(glow.r, max(glow.g, glow.b)) * (1.0 - source.a), 0.0, 1.0);
  vec3 lit = 1.0 - (1.0 - source.rgb * source.a) * (1.0 - glow);
  colour = vec4(a > 0.0 ? min(lit / a, 1.0) : vec3(0.0), a);
}`;

export default {
  type: "bloom",
  label: "Bloom",
  vibe: { light: { glow: 30, spread: 21, strength: 9.2 }, full: { glow: 100, spread: 100, strength: 52.2 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "A hazy glow spilling around the bright parts.",
  group: "Light & blur",
  defaults: () => ({
    glow: 100,                   // how much of the picture glows (0: nothing, 100: even the mid-tones)
    spread: 70,                 // how far the glow reaches
    strength: 30.7,               // how bright the glow is
    colour: "#ffffff"           // the glow's colour (white: the light's own; red-orange: film halation)
  }),
  controls: [
    { key: "glow", label: "Glow", min: 0, max: 100, step: 1 },
    { key: "spread", label: "Spread", min: 0, max: 100, step: 1 },
    { key: "strength", label: "Strength", min: 0, max: 100, step: 1 },
    { key: "colour", label: "Glow colour", kind: "colour" }
  ],
  // Older saves had Threshold, the other way round (100: nothing glows)
  migrate(settings) {
    if (settings.threshold === undefined) return;
    if (settings.glow === undefined) settings.glow = 100 - settings.threshold;
    delete settings.threshold;
  },
  apply(settings, run) {
    const { width, height } = run;
    // The bright parts at half size, then smaller copies of them for the wide glows
    const bright = run.pass(BRIGHT, { picture: run.input }, { threshold: 1 - settings.glow / 100 }, { width: width / 2, height: height / 2 });
    const levels = smallerCopies(run, bright, 2);
    // Three glows, stacked: near, middle and far
    const base = Math.max(0.5, (settings.spread / 100) * 0.025 * Math.min(width, height)); // in picture pixels
    const glow = (reach) => gaussianBlur(run, levels, reach);
    return run.pass(COMBINE, {
      picture: run.input, glowNear: glow(base), glowMid: glow(base * 2.5), glowFar: glow(base * 6)
    }, { strength: (settings.strength / 100) * 2, glowColour: toRGB(settings.colour) });
  }
};
