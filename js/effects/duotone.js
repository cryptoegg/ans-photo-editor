// Effect: Gradient map — the picture's light and dark mapped onto a row of colours. Your two
// colours = a duotone (the photo printed in one ink on coloured paper: darks in the Ink colour,
// lights in the Paper colour); or a ready-made map: Thermal (a vintage heat camera: black → purple
// → orange → yellow), Night vision, Infrared, Sunset, X-ray. Balance moves the split: more of the
// dark colours or more of the light ones. Also Negative (colour, or film with its orange cast) and
// Solarise (the brightest tones turned back to dark) — once effects of their own. (Saved as
// "duotone", its old name.)
import { toRGB } from './colours.js';

// The ready-made maps, dark to light
export const MAPS = {
  thermal: ["#000000", "#2a0a5e", "#a1197c", "#f2601f", "#ffd23f", "#fffbe0"],
  night: ["#000a02", "#0c3d12", "#2fa83a", "#9dff8a", "#efffe6"],
  infrared: ["#120018", "#5d0b52", "#e8417a", "#ffb3c8", "#fff4f7"],
  sunset: ["#1b0b3a", "#7a1f5c", "#e5533d", "#ffb547", "#fff1c2"],
  xray: ["#e9f6ff", "#9fc6e6", "#3d6f9e", "#0d2747", "#02060d"]
};
const STOPS = 6;

const RECIPE = `
uniform sampler2D picture;
uniform vec3 c0; uniform vec3 c1; uniform vec3 c2; uniform vec3 c3; uniform vec3 c4; uniform vec3 c5;
uniform float count;      // how many colours (2 - 6)
uniform float balance;    // -1 (more light colours) to 1 (more dark ones)
uniform float strength;   // 0 - 1
uniform float special;    // 0 a colour map · 1 negative · 2 film negative · 3 solarise

vec3 stop(int i) { return i == 0 ? c0 : i == 1 ? c1 : i == 2 ? c2 : i == 3 ? c3 : i == 4 ? c4 : c5; }

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec3 c = clamp(source.rgb, 0.0, 1.0);
  vec3 mapped;
  if (special > 2.5) mapped = 1.0 - abs(2.0 * c - 1.0);                                  // solarise
  else if (special > 1.5) mapped = (1.0 - c) * vec3(0.98, 0.62, 0.36) + vec3(0.02, 0.01, 0.0); // film negative
  else if (special > 0.5) mapped = 1.0 - c;                                               // negative
  else {
    float l = pow(luma(c), exp2(balance * 1.5));
    float at = l * (count - 1.0);
    int i = int(min(floor(at), count - 2.0));
    mapped = mix(stop(i), stop(i + 1), at - float(i));
  }
  colour = vec4(mix(source.rgb, mapped, strength), source.a);
}`;

export default {
  type: "duotone",
  label: "Gradient map",
  vibe: { light: { strength: 20 }, full: { strength: 100 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Light and dark mapped onto colours: duotone, thermal camera, night vision…",
  group: "Colour",
  defaults: () => ({
    map: "duotone",             // duotone (your two colours) | thermal | night | infrared | sunset | xray
    ink: "#d73c3c",             // (your two colours) the darks
    paper: "#00a6ff",           // (your two colours) the lights
    balance: 71,                 // -100 (more light colours) - 100 (more dark ones)
    strength: 100               // 0 (the original) - 100
  }),
  videoDefaults: () => ({ ink: "#dd7e7e", paper: "#0174b2", balance: 29 }), // (Tom's video settings, MTNS_stay 2026-10-25)
  controls: [
    { key: "map", label: "Colours", kind: "choice", options: [
      { value: "duotone", label: "Your two colours (duotone)" },
      { value: "thermal", label: "Thermal camera" },
      { value: "night", label: "Night vision" },
      { value: "infrared", label: "Infrared" },
      { value: "sunset", label: "Sunset" },
      { value: "xray", label: "X-ray" },
      { value: "negative", label: "Negative" },
      { value: "film-negative", label: "Film negative (orange)" },
      { value: "solarise", label: "Solarise" }
    ] },
    { key: "ink", label: "Ink (darks, your two colours)", kind: "colour" },
    { key: "paper", label: "Paper (lights, your two colours)", kind: "colour" },
    { key: "balance", label: "Balance", min: -100, max: 100, step: 1 },
    { key: "strength", label: "Strength", min: 0, max: 100, step: 1 }
  ],
  apply(settings, run) {
    const colours = MAPS[settings.map] || [settings.ink, settings.paper];
    const special = { negative: 1, "film-negative": 2, solarise: 3 }[settings.map] || 0;
    const u = { count: colours.length, balance: settings.balance / 100, strength: settings.strength / 100, special };
    for (let i = 0; i < STOPS; i++) u["c" + i] = toRGB(colours[Math.min(i, colours.length - 1)]);
    return run.pass(RECIPE, { picture: run.input }, u);
  }
};
