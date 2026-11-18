// Colour presets (2026-11-18, Tom): ready-made grades for the Colour card's Presets menu (js/ui/effectsPanel.js).
// Each one sets the card's parts — Colour, Curves, Colour Grading (the wheels) and LUT — so after picking it
// every slider, curve and wheel can still be moved (unlike a LUT, where the look is baked in). Anything a preset
// leaves out goes back to its starting value. Curves are points [x, y] 0 - 100; wheels hue 0 - 360, amount 0 - 100.
const S_CURVE = [[0, 0], [25, 20], [75, 82], [100, 100]];

export const COLOUR_PRESETS = [
  { name: "Teal & Orange",
    curves: { rgb: S_CURVE },
    colour: { saturation: 10 },
    grade: { shadowsHue: 195, shadowsAmount: 40, highlightsHue: 30, highlightsAmount: 35 } },
  { name: "Warm Film",
    curves: { rgb: [[0, 6], [25, 24], [75, 78], [100, 95]] },
    colour: { temperature: 18, saturation: -8 },
    grade: { shadowsHue: 20, shadowsAmount: 8, highlightsHue: 40, highlightsAmount: 15 } },
  { name: "Cool Night",
    curves: { rgb: [[0, 2], [100, 88]] },
    colour: { temperature: -30, saturation: -25 },
    grade: { shadowsHue: 220, shadowsAmount: 30, midtonesHue: 215, midtonesAmount: 15 } },
  { name: "Bleach Bypass",
    curves: { rgb: [[0, 0], [25, 15], [75, 88], [100, 100]] },
    colour: { saturation: -55 } },
  { name: "Faded Matte",
    curves: { rgb: [[0, 12], [50, 50], [100, 90]] },
    colour: { saturation: -20 } },
  { name: "Cross Process",
    curves: { red: [[0, 0], [25, 18], [75, 85], [100, 100]], green: [[0, 0], [50, 55], [100, 100]], blue: [[0, 15], [100, 80]] },
    colour: { saturation: 10 } },
  { name: "Warm Mono",
    curves: { rgb: [[0, 0], [25, 22], [75, 80], [100, 100]] },
    colour: { mono: true },
    grade: { midtonesHue: 35, midtonesAmount: 40, highlightsHue: 40, highlightsAmount: 15 } },
  { name: "Punchy",
    curves: { rgb: S_CURVE },
    colour: { saturation: 20, vibrance: 20 } },
  { name: "Wash",           // (a coloured gel: what Colour tint's Wash did)
    grade: { shadowsHue: 215, shadowsAmount: 12, midtonesHue: 215, midtonesAmount: 25, highlightsHue: 215, highlightsAmount: 12 } },
  { name: "Monotone",       // (shades of one colour: what Colour tint's Monotone did)
    colour: { mono: true },
    grade: { shadowsHue: 210, shadowsAmount: 9, midtonesHue: 210, midtonesAmount: 90, midtonesLum: 20, highlightsHue: 210, highlightsAmount: 13 } }
];
