// Colour tint is gone (Tom, 2026-11-18, as in the Lyric Visualiser): its two ways are the Colour card's wheels now.
// Its Wash (a coloured gel) = the wheels pushed toward its colour, the midtones most; its Monotone (shades of one
// colour) = B&W + the wheels. The numbers were fitted side by side to the old look in the Visualiser (average
// difference 3 - 7 out of 255). Turns a chain's tint, in place, into Colour Grading (+ Colour's B&W). Returns the chain.
// Used on the ready-made filters, Your filters and saved projects (js/filters.js freshChain, js/project.js tidyProject).
import { getEffect } from './registry.js';

export function tintIntoGrade(chain) {
  if (!Array.isArray(chain)) return chain;
  const i = chain.findIndex((fx) => fx.type === "tint");
  if (i < 0) return chain;
  const fx = chain[i];
  chain.splice(i, 1);
  const s = Math.max(0, Math.min(1, (fx.strength ?? 0) / 100));
  if (fx.on === false || !(s > 0)) return chain;
  const hex = /^#?([0-9a-f]{6})$/i.exec(fx.colour || "") ? fx.colour.replace("#", "") : "0062ff";
  const [r, g, b] = [0, 2, 4].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);
  const max = Math.max(r, g, b), chroma = max - Math.min(r, g, b), L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let hue = 0;
  if (chroma > 0) hue = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  hue = Math.round(((hue * 60) + 360) % 360);
  const find = (type) => { // (a new one goes where the tint was)
    let it = chain.find((other) => other.type === type);
    if (!it) { it = { id: `${fx.id || "fx"}-${type}`, type, on: true, ...getEffect(type).defaults() }; chain.splice(i, 0, it); }
    return it;
  };
  const grade = find("grade");
  const clamp = (v, lo, hi) => Math.round(Math.max(lo, Math.min(hi, v)));
  const monotone = fx.style === "monotone";
  const amount = clamp((monotone ? 2 : 0.92) * chroma * s * 100, 0, 100);
  const lum = clamp((monotone ? 1.4 : 0.83) * (2 * L - 1) * s * 100, -100, 100);
  [["midtones", 1], ["shadows", monotone ? 0.1 : 0.5], ["highlights", monotone ? 0.15 : 0.5]].forEach(([part, k]) => {
    if (grade[`${part}Amount`] > 0) return; // (a wheel already set keeps its own)
    grade[`${part}Hue`] = hue;
    grade[`${part}Amount`] = clamp(amount * k, 0, 100);
  });
  if (!grade.midtonesLum) grade.midtonesLum = lum;
  if (monotone) {
    const colour = find("colour");
    if (s >= 0.5) colour.mono = true; else colour.saturation = clamp((colour.saturation || 0) - s * 100, -100, 100);
  }
  return chain;
}
