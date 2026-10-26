// Effect: Burn — the picture burnt away to bare paper, the way an overexposed print or a
// bleached photo loses itself: the burnt part is plain paper, with a grainy, speckled edge
// (dots of the picture hanging on past the edge, dots of paper eaten into it) and a slightly
// scorched, darker rim just before it. Burns from the brightest parts (like an overexposed
// print) or the darkest (like a photo eaten from its shadows). Its uneven edge comes from the
// seed (Reroll). (Top and Edges styles were tried and taken out for now.)
import { toRGB } from './colours.js';

const RECIPE = `
uniform sampler2D picture;
uniform float amount;       // 0 - 1: how much burns away
uniform float speckle;      // 0 - 1: how grainy the edge is
uniform vec3 paperColour;
uniform float direction;    // 0 brightest parts first, 1 darkest parts first

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec2 p = place();
  // How readily each spot burns (0 - 1, higher burns first)
  float ready = direction < 0.5 ? luma(source.rgb) : 1.0 - luma(source.rgb);
  ready += (fbm(p * 2.5, 71u) - 0.5) * 0.35;                          // an uneven, wandering edge
  float grainy = (noise(p * 380.0, 72u) - 0.5) * 0.9 + (noise(p * 120.0, 73u) - 0.5) * 0.5;
  float edge = ready + grainy * speckle * 0.22;                       // speckled right at the edge
  float threshold = 1.05 - amount * 1.25;
  float burnt = smoothstep(threshold - 0.004, threshold + 0.004, edge);
  float scorch = smoothstep(threshold - 0.12, threshold, ready) * (1.0 - burnt); // just before it
  vec3 c = source.rgb * mix(vec3(1.0), vec3(0.78, 0.62, 0.48), scorch * 0.55);
  colour = vec4(mix(c, paperColour, burnt), source.a);
}`;

export default {
  type: "burn",
  label: "Burn",
  vibe: { light: { amount: 20.4, speckle: 0 }, full: { amount: 100, speckle: 0 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Burnt away to bare paper with a grainy, speckled edge.",
  group: "Damage & frames",
  defaults: () => ({
    amount: 68,                 // 0 (nothing) - 100 (almost all gone)
    from: "dark",             // bright (brightest parts first) | dark (darkest parts first)
    speckle: 0,                // 0 (clean edge) - 100 (very grainy)
    paper: "#ffffff"            // what's left where it burnt
  }),
  videoDefaults: () => ({ amount: 26 }), // (Tom's video settings, MTNS_stay 2026-10-25)
  controls: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "from", label: "Burns from", kind: "choice", options: [
      { value: "bright", label: "The brightest parts" },
      { value: "dark", label: "The darkest parts" }
    ] },
    { key: "speckle", label: "Speckled edge", min: 0, max: 100, step: 1 },
    { key: "paper", label: "Paper", kind: "colour" }
  ],
  // Older saves could burn from the top or the edges (taken out): those burn from the brightest
  migrate(settings) {
    if (settings.from === "top" || settings.from === "edges") settings.from = "bright";
  },
  apply(settings, run) {
    if (settings.amount <= 0) return run.input;
    return run.pass(RECIPE, { picture: run.input }, {
      amount: settings.amount / 100,
      speckle: settings.speckle / 100,
      paperColour: toRGB(settings.paper),
      direction: settings.from === "dark" ? 1 : 0
    });
  }
};
