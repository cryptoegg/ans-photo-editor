// Ready-made looks: each is a whole effects chain to start from (picking one replaces the
// layer's chain, as one undo step; everything stays editable). Settings left out use the
// effect's defaults. Each look comes from one of the style references the app was tuned on.
// To add a preset: add an entry here.

export const PRESETS = [
  // ---- Tom's favourites (2026-10-24): first in the menu
  {
    id: "ans-flash-blowout", group: "Favourites", name: "Flash Blowout", note: "On-camera flash at night: faces blown to white, a cold blue glow",
    chain: [
      { type: "tone", exposure: 20, contrast: 30 },
      { type: "colour", saturation: -15 },
      { type: "tint", colour: "#9cc8ff", strength: 20, style: "wash" },
      { type: "bloom", glow: 75, spread: 70, strength: 90, colour: "#eaf4ff" },
      { type: "grain", amount: 30, moving: true }
    ]
  },
  {
    id: "ans-cyanotype", group: "Favourites", name: "Cyanotype", note: "The A New Song blue: print blue on cream paper, with grain",
    chain: [
      { type: "tone", contrast: 10 },
      { type: "duotone", map: "duotone", ink: "#1f5fbf", paper: "#efe9d8", balance: 5, strength: 100 },
      { type: "grain", amount: 30, size: 36 }
    ]
  },
  {
    id: "photocopy", group: "Favourites", name: "Photocopy", note: "Black-and-white xerox: hard contrast, washed greys, toner grain",
    chain: [
      { type: "tone", exposure: 35, contrast: 60, fade: 12 },
      { type: "colour", mono: true },
      { type: "grain", amount: 45, size: 44 }
    ]
  },
  {
    id: "red-smear", group: "Favourites", name: "Red Smear", note: "Black ink on red, dragged sideways",
    chain: [
      { type: "tone", exposure: 20, contrast: 45 },
      { type: "duotone", ink: "#1a1210", paper: "#d77052", balance: -35 },
      { type: "blur", amount: 30, style: "smear", angle: 0 },
      { type: "grain", amount: 30, size: 28 }
    ]
  },
  {
    id: "crt-screen", group: "Favourites", name: "CRT Screen", note: "Old TV: cyan glow, soft and noisy",
    chain: [
      { type: "tint", colour: "#5fb4ff", strength: 100, style: "monotone" },
      { type: "tone", contrast: 20 },
      { type: "blur", amount: 5 },
      { type: "bloom", glow: 45, spread: 35, strength: 80 },
      { type: "grain", amount: 35, size: 12 }
    ]
  },
  {
    id: "expired-35mm", group: "Favourites", name: "Expired 35mm", note: "Old film: faded, green-cyan shift, heavy colour grain",
    chain: [
      { type: "tone", contrast: 15, fade: 30 },
      { type: "colour", saturation: -15 },
      { type: "tint", colour: "#3fa08a", strength: 45, style: "wash" },
      { type: "grain", amount: 50, size: 32, colour: 45 }
    ]
  },
  {
    id: "painted-blur", group: "Favourites", name: "Painted Blur", note: "Soft, out-of-focus and saturated: like a painting of a photo",
    chain: [
      { type: "blur", amount: 30 },
      { type: "tone", contrast: 20 },
      { type: "colour", saturation: 60 },
      { type: "grain", amount: 15 }
    ]
  },
  {
    id: "film-scan", group: "Favourites", name: "Film Scan", note: "A scanned negative: a little blue light at the edge, fine grain",
    chain: [
      { type: "tone", contrast: 10 },
      { type: "colour", saturation: -5 },
      { type: "leak", colour: "#3a6bff", amount: 35, position: 12, size: 20, spread: 80 },
      { type: "grain", amount: 20, size: 16 }
    ]
  },
  {
    id: "ans-35mm-800-night", group: "Favourites", name: "35mm 800 Night", note: "Pushed film at night: deeper shadows, cool cast, glowing lights, heavy grain",
    chain: [
      { type: "tone", exposure: -8, contrast: 25, fade: 8 },
      { type: "colour", saturation: -10 },
      { type: "tint", colour: "#4a7bd1", strength: 14, style: "wash" },
      { type: "bloom", glow: 35, spread: 50, strength: 55 },
      { type: "grain", amount: 50, size: 40, colour: 20, moving: true }
    ]
  },
  {
    id: "ans-photocopy-grunge", group: "Favourites", name: "Photocopy Grunge", note: "A dirty xerox: black and white, crushed contrast, heavy toner grain",
    chain: [
      { type: "tone", exposure: 10, contrast: 70 },
      { type: "colour", mono: true },
      { type: "blur", amount: 5 },
      { type: "grain", amount: 85, size: 44, colour: 0 }
    ]
  },
  {
    id: "ans-vhs-diary", group: "Favourites", name: "VHS Diary", note: "A home camcorder tape: pink cast, soft, bleeding colour, rolling noise",
    chain: [
      { type: "tone", fade: 15 },
      { type: "colour", saturation: -10 },
      { type: "tint", colour: "#ff9ad5", strength: 18, style: "wash" },
      { type: "blur", amount: 6 },
      { type: "vhs", lines: 45, tracking: 20, bleed: 60, wobble: 30, noise: 35, moving: true }
    ]
  },
  {
    id: "vhs-tape", group: "Favourites", name: "VHS Tape", note: "A worn videotape: scan lines, tracking tears, bleeding colour, a cold cast",
    chain: [
      { type: "tone", fade: 10 },
      { type: "colour", saturation: -10 },
      { type: "tint", colour: "#6a8cff", strength: 20, style: "wash" },
      { type: "blur", amount: 4 },
      { type: "vhs" }
    ]
  },
  {
    id: "faded-bw", group: "Favourites", name: "Faded B&W", note: "An old black-and-white print: soft greys, heavy grain",
    chain: [
      { type: "tone", exposure: 10, contrast: -10, fade: 30 },
      { type: "colour", mono: true },
      { type: "grain", amount: 40, size: 32 }
    ]
  },
  {
    id: "ascii-line-art", group: "Favourites", name: "ASCII Line Art", note: "Hand-made ASCII art: outlines in / \\ | _ ( ), fills of letters, on white",
    chain: [
      { type: "tone", contrast: 20 },
      { type: "colour", mono: true },
      { type: "ascii", style: "shapes", across: 70, set: "lineart", colour: "two", ink: "#1a1a1a", background: "#ffffff", spacing: 5, showFrom: 6 }
    ]
  },
  // ---- A New Song looks (2026-10-24, from Tom's references in references/looks/2026-10-24/):
  // film 35mm 400 - 800, light leaks, nostalgia; dirty / grunge, blown-out colour; clean editorial
  {
    id: "ans-35mm-400", group: "A New Song", name: "35mm 400", note: "Everyday film: soft warm fade, a little glow, fine moving grain",
    chain: [
      { type: "tone", exposure: 3, contrast: 10, fade: 10 },
      { type: "colour", saturation: -5 },
      { type: "tint", colour: "#ffb36b", strength: 12, style: "wash" },
      { type: "bloom", glow: 15, spread: 40, strength: 30 },
      { type: "grain", amount: 28, size: 24, colour: 10, moving: true }
    ]
  },
  {
    id: "ans-expired-polaroid", group: "A New Song", name: "Expired Polaroid", note: "Washed-out instant film with an orange light leak and a soft focus",
    chain: [
      { type: "tone", exposure: 8, contrast: -15, fade: 35 },
      { type: "colour", saturation: -20 },
      { type: "tint", colour: "#ff8a3c", strength: 30, style: "wash" },
      { type: "blur", amount: 6 },
      { type: "leak", amount: 70, colour: "#ff6a2a", position: 10, size: 60, spread: 70 },
      { type: "grain", amount: 25, moving: true }
    ]
  },
  {
    id: "ans-magazine-print", group: "A New Song", name: "Magazine Print", note: "Printed in a magazine: colour halftone dots on paper",
    chain: [
      { type: "tone", contrast: 15 },
      { type: "colour", saturation: 10 },
      { type: "halftone", size: 25, angle: 15, shape: "dots", inkFrom: "picture", paper: "#f4efe4" },
      { type: "grain", amount: 15 }
    ]
  },
  {
    id: "ans-clean-editorial", group: "A New Song", name: "Clean Editorial", note: "Clean fashion film: true colour, a hint of warmth, the finest grain",
    chain: [
      { type: "tone", contrast: 8, fade: 4 },
      { type: "colour", saturation: -5 },
      { type: "tint", colour: "#ffcf9e", strength: 8, style: "wash" },
      { type: "grain", amount: 10, size: 12 }
    ]
  },
  {
    id: "ans-blown-grunge", group: "A New Song", name: "Blown Grunge", note: "Rough and loud: blown-out colour, hard contrast, glow and big grain",
    chain: [
      { type: "tone", exposure: 15, contrast: 55, fade: 5 },
      { type: "colour", saturation: 45 },
      { type: "bloom", glow: 45, spread: 55, strength: 70 },
      { type: "grain", amount: 60, size: 52, colour: 30, moving: true }
    ]
  },
  {
    id: "ans-datamosh", group: "A New Song", name: "Datamosh", note: "A broken video file: dragged blocks, chunky pixels, rainbow bars",
    chain: [
      { type: "tone", contrast: 15 },
      { type: "colour", saturation: 25 },
      { type: "datamosh", amount: 60, smear: 70, bars: 50 }
    ]
  },
  // ---- The earlier looks
  {
    id: "burnt-paper", name: "Burnt Paper", note: "Warm photo burnt away from its brightest parts to bare paper, with a grainy speckled edge",
    chain: [
      { type: "tone", exposure: 10, contrast: 25 },
      { type: "tint", colour: "#c98a4a", strength: 35, style: "wash" },
      { type: "burn", amount: 45, from: "bright", speckle: 70, paper: "#fbf7ef" },
      { type: "grain", amount: 25 }
    ]
  },
  {
    id: "screen-photo", name: "Screen Photo", note: "A phone photo of a screen: fine lines, rainbow moiré bands, bright and soft",
    chain: [
      { type: "tone", exposure: 20, contrast: 10 },
      { type: "colour", saturation: 15 },
      { type: "screen", amount: 75, phone: 35, movement: 60, tilt: 35, patchiness: 60, bandSize: 40, rainbow: 70 },
      { type: "blur", amount: 4 },
      { type: "bloom", glow: 35, spread: 30, strength: 45 },
      { type: "grain", amount: 20 }
    ]
  },
  {
    id: "flash-at-night", name: "Flash at Night", note: "Direct flash in the dark: faces blown out, warm, deep blacks",
    chain: [
      { type: "tone", exposure: 55, contrast: 70 },
      { type: "colour", saturation: 30 },
      { type: "tint", colour: "#ff5a1a", strength: 40, style: "wash" },
      { type: "bloom", glow: 30, spread: 25, strength: 50, colour: "#ffd2a0" },
      { type: "grain", amount: 25 }
    ]
  },
  {
    id: "magazine-print", name: "Magazine Print", note: "A page from an old magazine: faded colour, grain",
    chain: [
      { type: "tone", contrast: 5, fade: 18 },
      { type: "colour", saturation: -25 },
      { type: "grain", amount: 20 }
    ]
  },
  {
    id: "hard-light", name: "Hard Light", note: "Deep shadows, bright skin, a red film glow at the edge of the light",
    chain: [
      { type: "tone", exposure: -10, contrast: 60 },
      { type: "colour", saturation: -10 },
      { type: "bloom", glow: 30, spread: 35, strength: 70, colour: "#ff3a12" },
      { type: "grain", amount: 30, size: 28 }
    ]
  },
  {
    id: "solarised", name: "Solarised", note: "Silver, half-negative black and white: highlights turned back to dark",
    chain: [
      { type: "tone", contrast: 20 },
      { type: "colour", mono: true },
      { type: "duotone", map: "solarise", strength: 65 },
      { type: "blur", amount: 6 },
      { type: "grain", amount: 30 }
    ]
  },
  {
    id: "grainy-bw", name: "Grainy B&W", note: "Dark, grainy black and white, soft, with faint scan lines",
    chain: [
      { type: "tone", exposure: -20, contrast: 35 },
      { type: "colour", mono: true },
      { type: "blur", amount: 10 },
      { type: "vhs", lines: 30, tracking: 0, bleed: 0, wobble: 20, noise: 15 },
      { type: "grain", amount: 48, size: 36 }
    ]
  },
  {
    id: "soft-bw", name: "Soft B&W", note: "Soft, very grainy black and white, like a silhouette in fog",
    chain: [
      { type: "tone", contrast: -25, fade: 15 },
      { type: "colour", mono: true },
      { type: "blur", amount: 25 },
      { type: "grain", amount: 65, size: 52 }
    ]
  },
  {
    id: "thermal", name: "Thermal Camera", note: "A vintage heat camera: black to purple to orange to yellow, soft and noisy",
    chain: [
      { type: "tone", contrast: 25 },
      { type: "duotone", map: "thermal" },
      { type: "blur", amount: 8 },
      { type: "grain", amount: 25, size: 28 }
    ]
  },
  {
    id: "night-vision", name: "Night Vision", note: "Green night-vision goggles: bright, grainy, with scan lines",
    chain: [
      { type: "tone", exposure: 25, contrast: 30 },
      { type: "duotone", map: "night" },
      { type: "bloom", glow: 35, spread: 30, strength: 50 },
      { type: "vhs", lines: 40, tracking: 0, bleed: 0, wobble: 10, noise: 20 },
      { type: "grain", amount: 50, size: 28 }
    ]
  },
  {
    id: "ascii-portrait", name: "ASCII Portrait", note: "Tiny packed characters in black on white; the light parts left blank",
    chain: [
      { type: "tone", contrast: 15 },
      { type: "colour", mono: true },
      { type: "ascii", across: 120, lineHeight: 140, set: "normal2", colour: "two", ink: "#141414", background: "#f6f5f2", spacing: 0, showFrom: 14 }
    ]
  },
  {
    id: "ascii-grey", name: "ASCII Grey", note: "A film still in grey characters on charcoal, every tone a character",
    chain: [
      { type: "tone", contrast: 30 },
      { type: "colour", mono: true },
      { type: "ascii", across: 95, lineHeight: 165, set: "normal2", colour: "original", background: "#1f1f1f", spacing: 5, contrast: 10 }
    ]
  },
  {
    id: "ascii-glow", name: "ASCII Glow", note: "The picture stays; characters glow in its bright parts",
    chain: [
      { type: "ascii", across: 75, set: "normal", colour: "original", backMode: "picture", pictureStrength: 85, blend: "glow", glow: 60, showFrom: 55, spacing: 5, contrast: 20 }
    ]
  },
  {
    id: "text-portrait", name: "Text Portrait", note: "A line of text repeated, the picture made by how big each letter is",
    chain: [
      { type: "tone", contrast: 25 },
      { type: "colour", mono: true },
      { type: "ascii", across: 55, lineHeight: 120, set: "text", text: "All work and no play makes Jack a dull boy.", shade: "size", colour: "two", ink: "#f4f4f4", background: "#000000", spacing: 0, contrast: 10 }
    ]
  },
];

export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) || null;
}
