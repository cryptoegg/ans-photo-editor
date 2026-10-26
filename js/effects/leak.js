// Effect: Light leak — light spilling in where a camera wasn't sealed: a soft, uneven glow of
// colour coming in from the edge of the frame, hottest (near white-yellow) at its core.
// Position moves it around the edge (0 - 100 goes once round the frame); its exact shape comes
// from the seed (Reroll). Wander moves Position, Size, Amount and Spread at once. Breathe makes
// it live as the song plays: it flickers and slowly drifts along the edge.
import { wanderSettings } from './kit.js';
import { toRGB } from './colours.js';

const RECIPE = `
uniform sampler2D picture;
uniform float amount;       // 0 - 1
uniform vec3 tint;          // the leak's colour (its core runs hotter, towards yellow-white)
uniform vec2 from;          // where it comes in (0 - 1 across the picture)
uniform vec2 inward;        // the direction it spreads into the picture
uniform float reach;        // how far in it reaches, in short sides
uniform float spread;       // 0 - 1: how wide it fans out along the edge

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec2 p = here();
  vec2 d = (p - from) * vec2(size.x, size.y) / min(size.x, size.y);   // in short sides
  float along = dot(d, inward);                                       // into the picture
  float across = dot(d, vec2(-inward.y, inward.x));                   // along the edge
  float width = reach * (0.6 + 1.6 * spread) * (1.0 + 0.8 * max(along, 0.0) / max(reach, 0.01));
  float shape = exp(-pow(max(along, 0.0) / reach, 1.6)) * exp(-(across / width) * (across / width));
  shape *= smoothstep(-0.05, 0.02, along);                            // nothing behind the edge
  shape *= 0.55 + 0.9 * fbm(place() * 2.5, 61u);                      // uneven, like real light
  float glow = clamp(shape * amount * 1.6, 0.0, 1.0);
  vec3 hot = mix(tint, vec3(1.0, 0.96, 0.82), smoothstep(0.55, 1.0, glow)); // the core runs hot
  vec3 c = 1.0 - (1.0 - source.rgb) * (1.0 - hot * glow);            // light adds (screen)
  colour = vec4(c, source.a);
}`;

const WANDERS = { position: [0, 100], size: [25, 80], amount: [35, 85], spread: [20, 80] };

export default {
  type: "leak",
  label: "Light leak",
  vibe: { light: { amount: 21.6, size: 23.1, spread: 19.2 }, full: { amount: 100, size: 100, spread: 100 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Coloured light spilling in from the edge of the frame.",
  group: "Light & blur",
  defaults: () => ({
    wander: 47,                  // where Wander last took the sliders below
    amount: 72,                 // 0 (none) - 100
    colour: "#dba08a",          // the leak's colour (warm orange-red, like most film leaks)
    position: 10,               // 0 - 100: once round the edge of the frame, from the top-left
    size: 77,                   // how far into the picture it reaches
    spread: 64,                 // how wide it fans out along the edge
    breathe: 71                  // 0 (still) - 100 (flickers and drifts as the song plays)
  }),
  controls: [
    { key: "wander", label: "Wander (moves the sliders below)", min: 0, max: 100, step: 0.5,
      drives: (settings, seed) => wanderSettings(settings.wander, seed, WANDERS) },
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "colour", label: "Colour", kind: "colour" },
    { key: "position", label: "Position (round the edge)", min: 0, max: 100, step: 0.5 },
    { key: "size", label: "Size", min: 0, max: 100, step: 1 },
    { key: "spread", label: "Spread", min: 0, max: 100, step: 1 },
    { key: "breathe", label: "Breathe (moves as the song plays)", min: 0, max: 100, step: 1 }
  ],
  moves: (settings) => settings.breathe > 0,
  apply(settings, run) {
    if (settings.amount <= 0) return run.input;
    // Breathe: drift along the edge and flicker, smoothly, from song time
    const b = settings.breathe / 100, t = run.time || 0;
    const position = settings.position + b * 6 * (Math.sin(t * 0.37) + 0.5 * Math.sin(t * 0.91 + 2));
    const flicker = 1 - b * 0.45 * (0.5 + 0.5 * (0.6 * Math.sin(t * 2.3) + 0.4 * Math.sin(t * 5.7 + 1)));
    // Round the edge: top (left to right), right (down), bottom (right to left), left (up)
    const round = (((position % 100) + 100) % 100) / 25;
    const side = Math.floor(round), f = round - side;
    const [from, inward] = [
      [[f, 0], [0, 1]], [[1, f], [-1, 0]], [[1 - f, 1], [0, -1]], [[0, 1 - f], [1, 0]]
    ][side];
    return run.pass(RECIPE, { picture: run.input }, {
      amount: (settings.amount / 100) * flicker,
      tint: toRGB(settings.colour),
      from,
      inward,
      reach: 0.08 + (settings.size / 100) * 0.7,
      spread: settings.spread / 100
    });
  }
};
