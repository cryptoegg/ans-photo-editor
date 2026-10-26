// The one slider on each effect's line (js/ui/effectsPanel.js), like a one-knob compressor: 0 = off,
// then from a light touch up to the full look, moving several of the effect's settings at once.
// An effect says how in its `vibe`:
//   { light: { key: value, … }, full: { key: value, … },   numbers slide from light (just above 0)
//     choose: { key: [[from, value], …] } }                 to full (100); a choice takes the value
//                                                            of the last step at or below the slider
// Settings it doesn't name stay as they are (so hand-tweaked colours, styles etc. are kept). The
// slider's place is kept on the effect as `vibe` (0 - 100).

export const VIBE_DEFAULT = 50; // (where the slider shows for an effect switched on by its tick box)

export function vibeSettings(effect, v) {
  const vibe = effect && effect.vibe;
  if (!vibe) return {};
  const t = Math.max(0, Math.min(1, v / 100));
  const out = {};
  const light = vibe.light || {}, full = vibe.full || {};
  Object.keys({ ...light, ...full }).forEach((key) => {
    const a = light[key] ?? full[key], b = full[key] ?? light[key];
    out[key] = Math.round((a + (b - a) * t) * 1000) / 1000;
  });
  Object.entries(vibe.choose || {}).forEach(([key, steps]) => {
    let pick = steps[0][1];
    steps.forEach(([from, value]) => { if (v >= from) pick = value; });
    out[key] = pick;
  });
  return out;
}
