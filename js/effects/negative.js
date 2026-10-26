// Effect: Negative — the picture's colours turned inside out, like a photo negative. Plain: a
// straight invert. Film: a colour film negative, with the orange cast of the film's base.
const RECIPE = `
uniform sampler2D picture;
uniform float film;       // 0 plain, 1 colour film (orange base)
uniform float strength;   // 0 - 1

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec3 neg = 1.0 - source.rgb;
  // film: the orange mask over it, a little flat (the base never quite goes black)
  vec3 filmLook = mix(vec3(0.16, 0.07, 0.03), vec3(1.0, 0.66, 0.42), neg);
  colour = vec4(mix(source.rgb, mix(neg, filmLook, film), strength), source.a);
}`;

export default {
  type: "negative",
  label: "Negative",
  vibe: { light: { strength: 15 }, full: { strength: 100 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Colours turned inside out, like a photo negative (plain, or colour film's orange).",
  group: "Colour",
  later: true,                  // now a Gradient map choice (saved ones are turned into that: js/effects/chain.js)
  defaults: () => ({
    style: "plain",             // plain | film
    strength: 100               // 0 (the original) - 100
  }),
  controls: [
    { key: "style", label: "Style", kind: "choice", options: [
      { value: "plain", label: "Plain invert" },
      { value: "film", label: "Colour film negative (orange)" }
    ] },
    { key: "strength", label: "Strength", min: 0, max: 100, step: 1 }
  ],
  apply(settings, run) {
    if (settings.strength <= 0) return run.input;
    return run.pass(RECIPE, { picture: run.input }, { film: settings.style === "film" ? 1 : 0, strength: settings.strength / 100 });
  }
};
