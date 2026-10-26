// Effect: Solarise — the brightest tones turn back down towards dark, like a print flashed with
// light while developing (the silver, half-negative look). (Once a Tone slider; its own effect now.)

const RECIPE = `
uniform sampler2D picture;
uniform float amount; // 0 - 1
void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec3 c = clamp(source.rgb, 0.0, 1.0);
  colour = vec4(mix(c, 1.0 - abs(2.0 * c - 1.0), amount), source.a);
}`;

export default {
  type: "solarise",
  label: "Solarise",
  vibe: { light: { amount: 10 }, full: { amount: 100 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "The brightest tones turned back to dark: the silver, half-negative look.",
  group: "Colour",
  later: true,                  // now a Gradient map choice (saved ones are turned into that: js/effects/chain.js)
  defaults: () => ({ amount: 50 }), // 0 - 100
  controls: [{ key: "amount", label: "Amount", min: 0, max: 100, step: 1 }],
  apply: (settings, run) => (settings.amount > 0 ? run.pass(RECIPE, { picture: run.input }, { amount: settings.amount / 100 }) : run.input)
};
