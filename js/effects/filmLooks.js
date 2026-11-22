// Film looks (2026-11-22): the data only, kept apart from the engine (js/effects/film.js) so the Lyric Visualiser
// can use the same looks, and so looks made later from real film Tom shoots can simply replace these.
// Plain numbers, no code: copy this file as it is.
//
// A look:
//   name, note        what it's called and one line about it
//   tone              brightness in → out at 0, .1, .2 … 1 (11 points, 0 - 1), applied to each of red, green, blue
//   shadows / mids / highlights   colour pushed in, as [red, green, blue] (-1 - 1), weighted by brightness
//   saturation        overall (1 = as it was) and by colour: red, orange, yellow, green, aqua, blue, purple, pink
//   soften            0 - 1: how much of the phone's own sharpening is taken off (a fine blur mixed in)
//   vignette          0 - 1: how much darker the corners get
//   glow              halation round bright things: { amount, size, highlights } 0 - 100, colour
//   grain             { amount, size, colour } 0 - 100 (fine, strongest in the mid tones)
//   wobble            0 - 1: a little randomness per photo (vignette, glow, warmth), as each frame of film differs
// Strength, Grain, Glow and Fade (the sliders) scale these; 50 on a slider = the look as written.

export const FILM_LAYERS = {
  // (the layers a film table brought in from outside gets: the same as Snapshot's)
  soften: 0.5, vignette: 0.18, wobble: 0.5,
  glow: { amount: 30, size: 45, highlights: 72, colour: "#ff6a2a" },
  grain: { amount: 12, size: 4, colour: 15 }
};

export const FILM_LOOKS = {
  // Our own look in the spirit of a pocket film camera's: measured from 10 photo pairs (ans-idently/research/dazz/
  // FXN-LOOK.md), then rounded to our own numbers. Matte blacks, airy upper mids, a soft cream top; cool-green
  // shadows, warm highlights, a touch of blue in the mids; reds kept, yellows and greens toned down.
  snapshot: {
    name: "Snapshot",
    note: "A pocket film camera: matte blacks, airy mids, cream highlights, soft green shadows",
    tone: [0.06, 0.13, 0.22, 0.32, 0.43, 0.55, 0.68, 0.80, 0.90, 0.93, 0.94],
    shadows: [-0.02, 0.012, 0.010],
    mids: [-0.004, 0.002, 0.022],
    highlights: [0.030, 0.008, -0.030],
    saturation: { all: 0.86, red: 1.18, orange: 1.02, yellow: 0.8, green: 0.8, aqua: 0.88, blue: 1.0, purple: 0.95, pink: 1.05 },
    soften: 0.6,
    vignette: 0.2,
    glow: { amount: 32, size: 50, highlights: 70, colour: "#ff7438" },
    grain: { amount: 13, size: 4, colour: 15 },
    wobble: 0.5
  }
};
