// Effect: LUT (2026-11-17, step 3 of the pro features) — a colour look from a 3D table: a .cube file (js/effects/lutStore.js). Strength mixes it with the picture as it was. A look this
// browser doesn't have (a session from another computer) leaves the picture as it is. It sits inside Colour
// (always on, like Colour tint), so it starts on None.
import { listLuts, getLut, atlasOf } from './lutStore.js';

const RECIPE = `
uniform sampler2D picture;
uniform sampler2D table;
uniform float points;       // points along each side of the table
uniform float strength;   // 0 - 1

// The table's colour for c, between its two nearest blue squares
vec3 look(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  float b = c.b * (points - 1.0), b0 = floor(b), b1 = min(b0 + 1.0, points - 1.0);
  float x = c.r * (points - 1.0) + 0.5, y = (c.g * (points - 1.0) + 0.5) / points;
  vec3 lo = texture(table, vec2((b0 * points + x) / (points * points), y)).rgb;
  vec3 hi = texture(table, vec2((b1 * points + x) / (points * points), y)).rgb;
  return mix(lo, hi, b - b0);
}

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  colour = vec4(mix(source.rgb, look(source.rgb), strength), source.a);
}`;

export default {
  type: "lut",
  label: "LUT",
  group: "Colour",
  inside: "colour",             // shown in the Adjust section, in the Colour card, under its own tab (js/ui/effectsPanel.js)
  description: "A colour look: a built-in one, or your own .cube file.",
  defaults: () => ({
    look: "none",
    strength: 100
  }),
  controls: [
    { key: "look", label: "Look", kind: "choice", lut: true, get options() { return [{ value: "none", label: "None" }, ...listLuts().map((l) => ({ value: l.id, label: l.name }))]; } }, // (your own .cube files; the ready-made looks are Colour presets)
    { key: "strength", label: "Strength", min: 0, max: 100, step: 1 }
  ],
  apply: (settings, run) => {
    const look = getLut(settings.look);
    if (!look || !(settings.strength > 0)) return run.input;
    const table = run.texture(`lut|${look.id}`, () => atlasOf(look));
    return run.pass(RECIPE, { picture: run.input, table }, { points: look.size, strength: settings.strength / 100 });
  }
};
