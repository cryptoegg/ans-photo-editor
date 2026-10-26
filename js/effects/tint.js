// Effect: Colour tint — two ways to colour a photo:
//   Wash      like a coloured gel in front of the lens: the photo leans toward the colour but
//             keeps its own colours underneath (a soft-light blend)
//   Monotone  the photo becomes shades of one colour: black stays black, the mid-tones become
//             the colour, and highlights go to white (e.g. a blue stage, or sepia)
// Strength 0 is the original photo.
import { toRGB } from './colours.js';

const RECIPE = `
uniform sampler2D picture;
uniform vec3 tint;
uniform float strength;   // 0 - 1
uniform float monotone;   // 0 Wash, 1 Monotone

// Soft light (the W3C blend): darkens where the tint is dark, lightens where it's light
vec3 softLight(vec3 base, vec3 blend) {
  vec3 d = mix(sqrt(base), ((16.0 * base - 12.0) * base + 4.0) * base, step(base, vec3(0.25)));
  return mix(base - (1.0 - 2.0 * blend) * base * (1.0 - base),
             base + (2.0 * blend - 1.0) * (d - base),
             step(0.5, blend));
}

// Black -> the tint (at the mid-tones) -> white
vec3 shadesOf(float l) {
  return l < 0.5 ? mix(vec3(0.0), tint, l * 2.0) : mix(tint, vec3(1.0), l * 2.0 - 1.0);
}

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec3 tinted = monotone > 0.5 ? shadesOf(luma(source.rgb)) : softLight(source.rgb, tint);
  colour = vec4(mix(source.rgb, tinted, strength), source.a);
}`;

export default {
  type: "tint",
  label: "Colour tint",
  inside: "colour",             // shown in the Adjust section, inside Colour (js/ui/effectsPanel.js)
  description: "Colour wash like a gel, or shades of one colour (monotone).",
  group: "Colour",
  defaults: () => ({
    colour: "#0062ff",          // the tint
    strength: 0,               // 0 (the original) - 100
    style: "wash"               // wash | monotone
  }),
  controls: [
    { key: "colour", label: "Colour", kind: "colour" },
    { key: "strength", label: "Strength", min: 0, max: 100, step: 1 },
    { key: "style", label: "Style", kind: "choice", options: [
      { value: "wash", label: "Wash (coloured gel)" },
      { value: "monotone", label: "Monotone (shades of one colour)" }
    ] }
  ],
  apply: (settings, run) => run.pass(RECIPE, { picture: run.input }, {
    tint: toRGB(settings.colour),
    strength: settings.strength / 100,
    monotone: settings.style === "monotone" ? 1 : 0
  })
};
