// Effect: Screen lines — the photo as if shown on an LED wall or an old monitor and photographed:
// fine, bright lines over the picture (up and down, across, or both), with the gaps between them
// a little darker. The picture stays clear between the lines (unlike Halftone, which redraws it
// as lines). Bright lines catch more light on bright parts of the picture, like real screen
// lines. Colour fringes split each line into red / green / blue sub-pixels. The spacing is
// relative to the picture, so it looks the same at any export size.

const RECIPE = `
uniform sampler2D picture;
uniform float amount;    // 0 - 1
uniform float cell;      // the distance between lines, in pixels
uniform float width;     // a line's width, as a fraction of the cell
uniform float bright;    // 0 - 1: how much the lines lift the picture
uniform float dark;      // 0 - 1: how much the gaps darken it
uniform float fringe;    // 0 - 1: red / green / blue sub-pixels
uniform float across;    // 1: lines across
uniform float upDown;    // 1: lines up and down

// How much of a line covers this spot (0 - 1), for a position along the lines' cross direction
float line(float x) {
  float d = abs(fract(x / cell) - 0.5) * cell;  // pixels from the nearest line's middle
  float hw = max(0.5, width * cell * 0.5);
  return 1.0 - smoothstep(hw - 0.75, hw + 0.75, d);
}

void main() {
  vec2 p = vec2(pixel()) + 0.5;
  vec4 source = texelFetch(picture, pixel(), 0);
  float l = luma(source.rgb);
  // The line cover per channel (fringes: each channel's line shifted a third of a cell)
  vec3 cover = vec3(0.0);
  float shift = cell / 3.0 * fringe;
  if (upDown > 0.5) cover = max(cover, vec3(line(p.x - shift), line(p.x), line(p.x + shift)));
  if (across > 0.5) cover = max(cover, vec3(line(p.y - shift), line(p.y), line(p.y + shift)));
  float lit = max(cover.r, max(cover.g, cover.b));
  vec3 lifted = source.rgb + (1.0 - source.rgb) * cover * bright * (0.35 + 0.65 * l);
  vec3 c = lifted * (1.0 - dark * 0.6 * (1.0 - lit));
  colour = vec4(clamp(mix(source.rgb, c, amount), 0.0, 1.0), source.a);
}`;

export default {
  type: "lines",
  label: "Screen lines",
  vibe: { light: { amount: 30, bright: 40, dark: 20 }, full: { amount: 100, bright: 75, dark: 55 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Fine bright lines over the photo, like an LED wall or an old monitor photographed.",
  group: "Texture",
  defaults: () => ({
    amount: 70,          // how strong (0 - 100)
    size: 30,            // the spacing: fine (0) - wide (100)
    width: 30,           // a line's width, as % of the spacing
    bright: 60,          // how much the lines light the picture
    dark: 35,            // how much the gaps darken it
    fringe: 0,           // red / green / blue sub-pixels
    direction: "updown"  // "updown", "across" or "grid"
  }),
  controls: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "direction", label: "Lines", kind: "choice", options: [
      { value: "updown", label: "Up and down" },
      { value: "across", label: "Across" },
      { value: "grid", label: "Grid (both ways)" }
    ] },
    { key: "size", label: "Spacing", min: 0, max: 100, step: 1 },
    { key: "width", label: "Line width", min: 5, max: 80, step: 1 },
    { key: "bright", label: "Bright lines", min: 0, max: 100, step: 1 },
    { key: "dark", label: "Dark gaps", min: 0, max: 100, step: 1 },
    { key: "fringe", label: "Colour fringes", min: 0, max: 100, step: 1 }
  ],
  apply: (settings, run) => run.pass(RECIPE, { picture: run.input }, {
    amount: settings.amount / 100,
    // 260 lines across the short side (fine) - 40 (wide)
    cell: Math.min(run.width, run.height) / (260 - (settings.size / 100) * 220),
    width: settings.width / 100,
    bright: settings.bright / 100,
    dark: settings.dark / 100,
    fringe: settings.fringe / 100,
    across: settings.direction === "updown" ? 0 : 1,
    upDown: settings.direction === "across" ? 0 : 1
  })
};
