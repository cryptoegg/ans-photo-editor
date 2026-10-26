// Effect: Halftone — the photo printed as a grid of dots (or lines) on paper: bigger dots where
// it's darker, like a newspaper or a screen print. The dots are one ink colour, or each takes
// the picture's own colour there (like the "You felt like you disappeared" poster).
// Where the dots sit is dotGrid() — shared, so other parts of the app (e.g. a mode that pulls
// the dots off the picture) can find each dot.
import { smallerCopies } from './kit.js';
import { toRGB } from './colours.js';

// The dot grid for these settings on a picture of this size (in picture pixels):
// cell = the distance between dots, angle = the grid's turn (radians).
// Dot i, j sits at rotate([(i + 0.5) * cell, (j + 0.5) * cell], angle).
export function dotGrid(settings, width, height) {
  const cellsAcross = 200 - (settings.size / 100) * 180; // across the short side: 200 (fine) - 20 (big)
  return { cell: Math.min(width, height) / cellsAcross, angle: (settings.angle * Math.PI) / 180 };
}

const RECIPE = `
uniform sampler2D picture;
uniform sampler2D averaged; // a smaller copy: each dot's colour is the average around it
uniform float cell;
uniform float angle;
uniform float lines;        // 0 dots, 1 lines
uniform float ownColours;   // 0 the ink colour, 1 the picture's own colours
uniform vec3 ink;
uniform vec3 paper;

vec2 turn(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

void main() {
  vec2 p = vec2(pixel()) + 0.5;
  vec2 g = turn(p, -angle) / cell;            // where this pixel is on the grid
  vec2 base = floor(g);
  float cover = 0.0;
  vec3 dotColour = ink;
  // This cell and its neighbours (a big dark dot reaches into the next cell)
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 centre = base + vec2(float(dx), float(dy)) + 0.5;
      vec3 c = texture(averaged, turn(centre * cell, angle) / size).rgb;
      float dark = 1.0 - luma(c);
      float away = lines > 0.5 ? abs(g.y - centre.y) * cell : length(g - centre) * cell;
      // A dot covers as much of its cell as the picture is dark there, and joins its neighbours
      // into solid ink only in the deepest blacks
      float reach = lines > 0.5 ? 0.5 * cell * dark : cell * (0.564 * sqrt(dark) + 0.15 * smoothstep(0.7, 1.0, dark));
      float k = clamp(reach - away + 0.5, 0.0, 1.0); // soft by one pixel
      if (k > cover) { cover = k; dotColour = c; }
    }
  }
  vec3 inkColour = ownColours > 0.5 ? dotColour : ink;
  colour = vec4(mix(paper, inkColour, cover), texelFetch(picture, pixel(), 0).a);
}`;

export default {
  type: "halftone",
  label: "Halftone",
  vibe: { light: { size: 12 }, full: { size: 68 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "A grid of printed dots (or lines), in ink or the picture's own colours.",
  group: "Texture",
  only: ["image"],             // pictures only (Tom, 2026-10-25)
  defaults: () => ({
    size: 40,                   // 0 (fine) - 100 (big dots)
    angle: 45,                  // the grid's turn, in degrees
    shape: "dots",              // dots | lines
    inkFrom: "ink",             // ink (one colour) | picture (each dot the picture's colour)
    ink: "#1a1a1a",
    paper: "#f4efe4"
  }),
  controls: [
    { key: "size", label: "Size", min: 0, max: 100, step: 1 },
    { key: "angle", label: "Angle", min: 0, max: 90, step: 1 },
    { key: "shape", label: "Shape", kind: "choice", options: [
      { value: "dots", label: "Dots" },
      { value: "lines", label: "Lines" }
    ] },
    { key: "inkFrom", label: "Dot colour", kind: "choice", options: [
      { value: "ink", label: "Ink colour" },
      { value: "picture", label: "The picture's own colours" }
    ] },
    { key: "ink", label: "Ink", kind: "colour" },
    { key: "paper", label: "Paper", kind: "colour" }
  ],
  apply(settings, run) {
    const { cell, angle } = dotGrid(settings, run.width, run.height);
    // The smaller copy closest to (not bigger than) one dot cell
    const levels = smallerCopies(run, run.input, 1).filter((level) => level.factor <= Math.max(1, cell));
    return run.pass(RECIPE, { picture: run.input, averaged: levels[levels.length - 1].image }, {
      cell, angle,
      lines: settings.shape === "lines" ? 1 : 0,
      ownColours: settings.inkFrom === "picture" ? 1 : 0,
      ink: toRGB(settings.ink),
      paper: toRGB(settings.paper)
    });
  }
};
