// Effect: ASCII — the picture redrawn as characters on a grid, like ASCII art / a terminal.
// Style: Tone — each cell's brightness picks a character from a set sorted by how much ink it has
// (sparse "." to dense "@"); Shapes — each cell's little pattern of light and dark (3 x 5) is
// matched against every character's shape, so outlines come out as / \ | _ ( ) like hand-made
// ASCII art. With Your own text / The lyrics, the text runs through the grid and the picture
// shows in how strongly (Fade) or how big (Size) each letter is. Edges (Tone): outlines get line
// characters. Show from: darker cells get no character. Behind: a colour, the picture (Picture
// strength) or nothing; Blend: Normal, or Glow (characters added as light, with a soft bloom).
// Movement (from song time, so preview = export): Flicker or Matrix rain, free or on the beat.
// Works on pictures, videos and the live camera.
// Passes: each cell's average colour (one pixel per cell); for Shapes, the 3 x 5 detail of each
// cell and the best-matching character per cell; then the characters, drawn from a sheet of
// characters made here (run.texture); for Glow, a blur of them added back.
import { toRGB } from './colours.js';
import { smallerCopies, gaussianBlur } from './kit.js';
import { getProject, lyricData } from './standalone.js';

// The character sets (sorted by ink when used, so any order works)
const SETS = {
  normal: " .:-=+*#%@",
  normal2: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  lineart: " .,'`:;-_~^\"=+*!|/\\()[]<>{}icoveCOVUDAd%#@",
  minimal: " .-+*#",
  alphabetic: " abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  alphanumeric: " abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  numerical: " 0123456789",
  math: " +-×÷=≠≈<>±∞√∑∫πΔ%",
  arrows: " ←↑→↓↔↕↖↗↘↙⇐⇑⇒⇓",
  blocks: " ░▒▓█",
  bw: " █",
  binary: " 01",
  matrix: " ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789"
};
const EDGE_CHARS = ["-", "\\", "|", "/"]; // lines at 0°, 45°, 90°, 135° (screen: y down)
const MONO = '"Courier New", Courier, monospace';
const MAX_SHEET = 8192;     // the sheet of characters is at most this wide, in pixels
const SUB_X = 3, SUB_Y = 5; // Shapes: each cell's detail
const MAX_SHAPES = 128;     // Shapes: at most this many characters are compared

// Average colours: one pixel per cell (or per part of a cell, for Shapes' detail)
const CELLS = `
uniform sampler2D picture;
uniform vec2 source;      // the picture's size, in pixels

void main() {
  vec2 cell = source / size;
  vec4 sum = vec4(0.0);
  for (int j = 0; j < 6; j++) for (int i = 0; i < 6; i++) {
    vec2 p = (vec2(pixel()) + (vec2(float(i), float(j)) + 0.5) / 6.0) * cell;
    vec4 s = texelFetch(picture, clamp(ivec2(p), ivec2(0), ivec2(source) - 1), 0);
    sum += vec4(s.rgb * s.a, s.a);
  }
  colour = sum.a > 0.0 ? vec4(sum.rgb / sum.a, sum.a / 36.0) : vec4(0.0);
}`;

// Brightness -> how much ink (shared by the passes)
const TONE = `
uniform float bright;
uniform float contrast;
uniform float invert;
float tone(float l) {
  l = (l - 0.5) * contrast + 0.5 + bright;
  return clamp(invert > 0.5 ? 1.0 - l : l, 0.0, 1.0);
}`;

// Shapes: the character whose shape best matches each cell (its number, in the red channel)
const CHOOSE = TONE + `
uniform sampler2D detail;     // ${SUB_X} x ${SUB_Y} pixels per cell
uniform sampler2D patterns;   // each character's ink in ${SUB_X} x ${SUB_Y} parts, side by side
uniform float glyphs;
uniform float showFrom;
uniform float inkScale;       // full ink in a cell = the inkiest character's average ink

void main() {
  ivec2 c = pixel();
  float p[${SUB_X * SUB_Y}];
  float mean = 0.0;
  for (int j = 0; j < ${SUB_Y}; j++) for (int i = 0; i < ${SUB_X}; i++) {
    vec4 d = texelFetch(detail, c * ivec2(${SUB_X}, ${SUB_Y}) + ivec2(i, j), 0);
    float v = tone(luma(d.rgb)) * d.a;
    p[j * ${SUB_X} + i] = v * inkScale;
    mean += v;
  }
  mean /= ${SUB_X * SUB_Y}.0;
  float best = 0.0;
  if (mean >= showFrom) {
    float bestDist = 1e9;
    for (int g = 0; g < ${MAX_SHAPES}; g++) {
      if (float(g) >= glyphs) break;
      float dist = 0.0;
      for (int j = 0; j < ${SUB_Y}; j++) for (int i = 0; i < ${SUB_X}; i++) {
        float q = texelFetch(patterns, ivec2(g * ${SUB_X} + i, j), 0).r;
        float e = p[j * ${SUB_X} + i] - q;
        dist += e * e;
      }
      if (dist < bestDist) { bestDist = dist; best = float(g); }
    }
  }
  colour = vec4((best + 0.5) / 256.0, 0.0, 0.0, 1.0);
}`;

// The characters
const DRAW = TONE + `
uniform sampler2D picture;
uniform sampler2D cells;
uniform sampler2D chosen;     // (Shapes) each cell's character
uniform sampler2D sheet;
uniform vec2 grid;        // columns, rows
uniform float glyphs;     // characters in the set (sorted by ink)
uniform float total;      // characters on the sheet (the set, then the 4 edge lines)
uniform float shapes;     // 1: the characters were matched by shape
uniform float textMode;   // 1: the text runs through the grid
uniform float shade;      // (text) 0 fade, 1 size, 2 both
uniform float scale;      // a character's size in its cell (Spacing)
uniform float showFrom;   // cells with less ink than this get no character
uniform float threshold;  // 0 off
uniform float sharp;
uniform float edges;      // 0 off
uniform float dither;     // 0 off, 1 ordered, 2 noise
uniform vec3 ink;
uniform vec3 back;
uniform float ownColours; // 1: each character in its cell's colour
uniform float backMode;   // 0 solid, 1 the picture, 2 see-through
uniform float pictureMix; // (the picture behind) how strongly it shows
uniform float flicker;    // 0 - 1 of the cells
uniform float fstep;      // changes each flicker step
uniform float rain;       // 0 - 1 of the columns
uniform float rainPos;    // how far the rain has fallen, in rows
uniform float tail;       // a drop's trail, in rows

float r01(ivec2 c, uint salt) { return random(c, salt) * 0.5 + 0.5; }
float L(ivec2 c) { return luma(texelFetch(cells, clamp(c, ivec2(0), ivec2(grid) - 1), 0).rgb); }
float bayer(ivec2 c) {
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[(c.y & 3) * 4 + (c.x & 3)]) + 0.5) / 16.0;
}

void main() {
  vec2 cellPx = size / grid;
  vec2 p = vec2(pixel()) + 0.5;
  ivec2 cell = min(ivec2(floor(p / cellPx)), ivec2(grid) - 1);
  vec2 local = p / cellPx - vec2(cell);
  vec4 cc = texelFetch(cells, cell, 0);

  float raw = luma(cc.rgb);
  if (sharp > 0.0) {
    float around = (L(cell + ivec2(1, 0)) + L(cell - ivec2(1, 0)) + L(cell + ivec2(0, 1)) + L(cell - ivec2(0, 1))) * 0.25;
    raw += sharp * 2.0 * (raw - around);
  }
  float l = tone(raw);
  float steps = textMode > 0.5 ? 8.0 : glyphs;
  if (dither > 1.5) l += random(cell, 7u) * 0.5 / steps;
  else if (dither > 0.5) l += (bayer(cell) - 0.5) / steps;
  l = clamp(l, 0.0, 1.0);
  if (threshold > 0.0) l = l >= threshold ? 1.0 : 0.0;

  float g;
  float shown = 1.0;
  float size1 = 1.0;
  if (textMode > 0.5) {
    g = mod(float(cell.y) * grid.x + float(cell.x), glyphs);
    if (shade > 0.5) size1 = sqrt(l);
    shown = shade > 0.5 && shade < 1.5 ? step(0.04, l) : l;
    if (l < showFrom) shown = 0.0;
  } else if (shapes > 0.5) {
    g = floor(texelFetch(chosen, cell, 0).r * 256.0);
  } else {
    g = l < showFrom ? 0.0 : min(floor(l * glyphs), glyphs - 1.0);
    if (edges > 0.0 && g > 0.0) {
      float gx = (L(cell + ivec2(1, -1)) + 2.0 * L(cell + ivec2(1, 0)) + L(cell + ivec2(1, 1)))
               - (L(cell + ivec2(-1, -1)) + 2.0 * L(cell + ivec2(-1, 0)) + L(cell + ivec2(-1, 1)));
      float gy = (L(cell + ivec2(-1, 1)) + 2.0 * L(cell + ivec2(0, 1)) + L(cell + ivec2(1, 1)))
               - (L(cell + ivec2(-1, -1)) + 2.0 * L(cell + ivec2(0, -1)) + L(cell + ivec2(1, -1)));
      if (length(vec2(gx, gy)) > mix(2.0, 0.25, edges)) {
        float a = mod(degrees(atan(gx, -gy)), 180.0); // the line runs across the change
        g = glyphs + mod(floor(a / 45.0 + 0.5), 4.0);
      }
    }
  }
  // Flicker: some cells swap to another character for a moment
  if (flicker > 0.0 && r01(cell, uint(fstep) * 7u + 11u) < flicker && (g > 0.0 || textMode > 0.5)) {
    float r = r01(cell, uint(fstep) * 7u + 12u);
    g = textMode > 0.5 ? floor(r * glyphs) : 1.0 + floor(r * max(1.0, glyphs - 1.0));
  }
  // Matrix rain: bright trails falling down some columns
  float trail = 0.0;
  if (rain > 0.0 && r01(ivec2(cell.x, 0), 21u) < rain) {
    float period = grid.y + tail * 2.0;
    float pace = 0.6 + 0.8 * r01(ivec2(cell.x, 0), 22u);
    float head = mod(rainPos * pace + r01(ivec2(cell.x, 0), 23u) * period, period);
    float dist = head - float(cell.y);
    if (dist >= 0.0 && dist < tail) {
      trail = 1.0 - dist / tail;
      float r = r01(ivec2(cell.x, cell.y + int(floor(rainPos * pace * 2.0))), 24u);
      g = textMode > 0.5 ? floor(r * glyphs) : 1.0 + floor(r * max(1.0, glyphs - 1.0));
      size1 = 1.0;
    }
  }

  // The character's ink in this pixel
  vec2 q = (local - 0.5) / (scale * max(size1, 0.05)) + 0.5;
  float inked = 0.0;
  if (q.x >= 0.0 && q.y >= 0.0 && q.x <= 1.0 && q.y <= 1.0) inked = texture(sheet, vec2((g + q.x) / total, q.y)).a;
  float amount = inked * max(shown * cc.a, trail);

  vec3 chr = ownColours > 0.5 ? cc.rgb : ink;
  chr = mix(chr, vec3(1.0), trail * trail * 0.85); // the drop's head glows white
  vec4 behind = vec4(back, 1.0);
  if (backMode > 1.5) behind = vec4(chr, 0.0);
  else if (backMode > 0.5) behind = vec4(mix(back, texelFetch(picture, pixel(), 0).rgb, pictureMix), 1.0);
  colour = vec4(mix(behind.rgb, chr, amount), max(behind.a, amount));
}`;

// Glow: what's behind, the characters added as light, and their soft bloom
const GLOW = `
uniform sampler2D picture;
uniform sampler2D chars;      // the characters alone (see-through around them)
uniform sampler2D glowNear;
uniform sampler2D glowFar;
uniform vec3 back;
uniform float backMode;       // 0 solid, 1 the picture, 2 see-through
uniform float pictureMix;
uniform float glow;           // 0 - 2

void main() {
  vec4 c = texelFetch(chars, pixel(), 0);
  vec4 n = texture(glowNear, here()), f = texture(glowFar, here());
  vec3 light = clamp(c.rgb * c.a * 1.15 + (n.rgb * n.a * 0.65 + f.rgb * f.a * 0.45) * glow, 0.0, 1.0);
  float lightA = clamp(c.a + (n.a * 0.65 + f.a * 0.45) * glow * 0.8, 0.0, 1.0);
  if (backMode > 1.5) {
    colour = lightA > 0.0 ? vec4(min(light / lightA, 1.0), lightA) : vec4(0.0);
    return;
  }
  vec3 behind = backMode > 0.5 ? mix(back, texelFetch(picture, pixel(), 0).rgb, pictureMix) : back;
  colour = vec4(1.0 - (1.0 - behind) * (1.0 - light), 1.0); // (screen: light adds up, never past white)
}`;

const SET_OPTIONS = [
  { value: "normal", label: "Normal  .:-=+*#%@" },
  { value: "normal2", label: "Normal 2 (high greyscale)" },
  { value: "lineart", label: "Line art  / \\ | _ ( ) C D" },
  { value: "minimal", label: "Minimalist  .-+*#" },
  { value: "alphabetic", label: "Alphabetic" },
  { value: "alphanumeric", label: "Alphanumeric" },
  { value: "numerical", label: "Numerical" },
  { value: "math", label: "Math symbols" },
  { value: "arrows", label: "Arrows" },
  { value: "blocks", label: "Blocks ░▒▓█ (Code Page 437)" },
  { value: "bw", label: "Black and white █" },
  { value: "binary", label: "Binary 0 1" },
  { value: "matrix", label: "Matrix (katakana)" },
  { value: "text", label: "Your own text (below)" },
  { value: "lyrics", label: "The lyrics (the line being sung)" }
];

export default {
  type: "ascii",
  label: "ASCII",
  vibe: { light: { across: 220, pictureStrength: 60 }, full: { across: 50, pictureStrength: 0 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "The picture as characters, like ASCII art or a terminal — even the lyrics.",
  group: "Texture",
  defaults: () => ({
    style: "tone",              // tone (brightness picks the character) | shapes (the character matches the cell's shape)
    across: 268,                // characters across: 20 - 300
    lineHeight: 147,            // a row's height, in % of a character's width: 100 - 250
    set: "text",              // a SETS name, or "text" (Your own text) / "lyrics" (the lyric being sung)
    text: "anewsong",               // (Your own text)
    shade: "fade",              // (text) the picture shows in: fade | size | both
    font: "mono",               // mono | lyrics (the lyrics' font)
    brightness: 0,              // -100 - 100
    contrast: 100,                // -100 - 100
    showFrom: 0,                // 0 - 100: cells with less ink than this get no character
    threshold: 0,               // 0 (off) - 100: each cell a full character or nothing
    sharpness: 7,               // 0 - 100
    edges: 0,                   // 0 (off) - 100: (Tone) outlines drawn with line characters
    invert: false,
    spacing: 0,                // 0 (characters fill their cells, touching) - 100 (small, far apart)
    dither: "off",              // off | ordered | noise
    colour: "two",         // original (each cell's colour) | two (Ink on Background) | terminal (green on black)
    ink: "#000000",
    background: "#ffffff",
    backMode: "picture",          // solid | picture | clear (see-through)
    pictureStrength: 0,        // (the picture behind) 0 - 100
    blend: "normal",            // normal | glow (the characters added as light, with a bloom)
    glow: 50,                   // (Glow) 0 - 100
    movement: "off",            // off | flicker | rain
    sync: "free",               // free | beat
    speed: 0,                  // 0 - 100
    amount: 0                  // 0 - 100: how many cells flicker / columns rain
  }),
  videoDefaults: () => ({ lineHeight: 152, brightness: 58, threshold: 51, spacing: 12, backMode: "clear" }), // (Tom's video settings, MTNS_stay 2026-10-25)
  controls: [
    { key: "style", label: "Style", kind: "choice", options: [
      { value: "tone", label: "Tone (brightness picks the character)" },
      { value: "shapes", label: "Shapes (characters follow the outlines)" }
    ] },
    { key: "across", label: "Characters across", min: 20, max: 300, step: 1 },
    { key: "lineHeight", label: "Line height", min: 100, max: 250, step: 1 },
    { key: "set", label: "Characters", kind: "choice", options: SET_OPTIONS },
    { key: "text", label: "Your own text", kind: "text" },
    { key: "shade", label: "Text shows the picture by", kind: "choice", options: [
      { value: "fade", label: "Fading" },
      { value: "size", label: "Size" },
      { value: "both", label: "Size and fading" }
    ] },
    { key: "font", label: "Font", kind: "choice", options: [
      { value: "mono", label: "Typewriter (monospace)" },
      { value: "lyrics", label: "The lyrics' font" }
    ] },
    { key: "brightness", label: "Brightness", min: -100, max: 100, step: 1 },
    { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1 },
    { key: "showFrom", label: "Show from (darker: no character)", min: 0, max: 100, step: 1 },
    { key: "threshold", label: "Threshold (0 = off)", min: 0, max: 100, step: 1 },
    { key: "sharpness", label: "Sharpness", min: 0, max: 100, step: 1 },
    { key: "edges", label: "Edges (Tone: outlines as lines)", min: 0, max: 100, step: 1 },
    { key: "invert", label: "Invert", kind: "toggle" },
    { key: "spacing", label: "Spacing", min: 0, max: 100, step: 1 },
    { key: "dither", label: "Dither", kind: "choice", options: [
      { value: "off", label: "Off" },
      { value: "ordered", label: "Ordered (pattern)" },
      { value: "noise", label: "Noise" }
    ] },
    { key: "colour", label: "Colour", kind: "choice", options: [
      { value: "original", label: "The picture's colours" },
      { value: "two", label: "Two colours (Ink on Background)" },
      { value: "terminal", label: "Green terminal" }
    ] },
    { key: "ink", label: "Ink", kind: "colour" },
    { key: "background", label: "Background", kind: "colour" },
    { key: "backMode", label: "Behind the characters", kind: "choice", options: [
      { value: "solid", label: "The Background colour" },
      { value: "picture", label: "The picture (Picture strength)" },
      { value: "clear", label: "See-through" }
    ] },
    { key: "pictureStrength", label: "Picture strength", min: 0, max: 100, step: 1 },
    { key: "blend", label: "Blend", kind: "choice", options: [
      { value: "normal", label: "Normal" },
      { value: "glow", label: "Glow (characters as light)" }
    ] },
    { key: "glow", label: "Glow", min: 0, max: 100, step: 1 },
    { key: "movement", label: "Movement", kind: "choice", options: [
      { value: "off", label: "Still" },
      { value: "flicker", label: "Flicker (characters swap)" },
      { value: "rain", label: "Matrix rain" }
    ] },
    { key: "sync", label: "Timing", kind: "choice", options: [
      { value: "free", label: "Free (Speed)" },
      { value: "beat", label: "On the beat" }
    ] },
    { key: "speed", label: "Speed", min: 0, max: 100, step: 1 },
    { key: "amount", label: "Amount (flicker / rain)", min: 0, max: 100, step: 1 }
  ],
  moves: (s) => s.set === "lyrics" || (s.movement && s.movement !== "off"),

  apply(s, run) {
    const { width, height } = run;
    const aspect = Math.max(1, Math.min(2.5, (Number(s.lineHeight) || 175) / 100));
    const cols = Math.max(4, Math.min(400, Math.round(Number(s.across) || 100)));
    const cellW = width / cols;
    const rows = Math.max(1, Math.round(height / (cellW * aspect)));
    const textMode = s.set === "text" || s.set === "lyrics";
    const shapes = s.style === "shapes" && !textMode;
    const font = s.font === "lyrics" ? lyricsFont() : MONO;
    const text = textMode ? textFor(s, run.time) : null;
    let chars = textMode ? (text.length ? text : ["·"]) : densityOrder(SETS[s.set] || SETS.normal, font);
    if (shapes) chars = chars.slice(0, MAX_SHAPES);
    const all = [...chars, ...EDGE_CHARS];

    // The sheet of characters, about the size they're drawn at (crisp)
    const glyph = 1 - (Math.max(0, Math.min(100, Number(s.spacing) || 0)) / 100) * 0.6; // a character's size in its cell
    const cw = Math.max(4, Math.min(Math.round(cellW * glyph), Math.floor(MAX_SHEET / all.length)));
    const ch = Math.max(6, Math.round(cw * aspect));
    const sheet = run.texture(`ascii|${font}|${cw}x${ch}|${all.join("")}`, () => drawSheet(all, font, cw, ch));

    const cells = run.pass(CELLS, { picture: run.input }, { source: [width, height] }, { width: cols, height: rows });

    const terminal = s.colour === "terminal";
    const ink = terminal ? "#33ff66" : s.ink;
    const back = terminal ? "#000000" : s.background;
    // On a background lighter than the characters, dark places get the dense characters
    const glowing = s.blend === "glow";
    const lightBack = !glowing && (s.colour === "original" ? lum(back) > 0.5 : lum(back) > lum(ink));
    const tone = {
      bright: (Number(s.brightness) || 0) / 100,
      contrast: Math.max(0, 1 + ((Number(s.contrast) || 0) / 100) * (s.contrast > 0 ? 2 : 1)),
      invert: (!!s.invert !== lightBack) ? 1 : 0
    };
    const showFrom = Math.max(0, Math.min(100, Number(s.showFrom) || 0)) / 100;

    // Shapes: the best-matching character for each cell
    let chosen = cells;
    if (shapes) {
      const detail = run.pass(CELLS, { picture: run.input }, { source: [width, height] }, { width: cols * SUB_X, height: rows * SUB_Y });
      const shapesOf = shapePatterns(chars, font, aspect);
      const patterns = run.texture(`ascii-shapes|${font}|${aspect}|${chars.join("")}`, () => shapesOf.canvas);
      chosen = run.pass(CHOOSE, { detail, patterns }, { ...tone, glyphs: chars.length, showFrom, inkScale: shapesOf.inkScale }, { width: cols, height: rows });
    }

    // Movement, from song time (free: seconds; on the beat: quarter notes)
    const speed = Math.max(0, Math.min(100, Number(s.speed) || 0)) / 100;
    const tempo = getProject().canvas.tempo || {};
    const quarter = 60 / Math.min(300, Math.max(20, Number(tempo.bpm) || 120));
    const beat = s.sync === "beat";
    const t = beat ? ((run.time || 0) - (Number(tempo.offset) || 0)) / quarter : (run.time || 0);
    const flickerRate = beat ? [1, 2, 4, 8][Math.round(speed * 3)] : 1 + speed * 24;
    const rainRate = beat ? 1 + speed * 15 : 2 + speed * 40;
    const amount = Math.max(0, Math.min(100, Number(s.amount) || 0)) / 100;
    const backMode = s.backMode === "clear" ? 2 : s.backMode === "picture" ? 1 : 0;
    const pictureMix = Math.max(0, Math.min(100, Number(s.pictureStrength ?? 30))) / 100;

    const drawn = run.pass(DRAW, { picture: run.input, cells, chosen, sheet }, {
      ...tone,
      grid: [cols, rows],
      glyphs: chars.length,
      total: all.length,
      shapes: shapes ? 1 : 0,
      textMode: textMode ? 1 : 0,
      shade: s.shade === "size" ? 1 : s.shade === "both" ? 2 : 0,
      scale: glyph,
      showFrom,
      threshold: (Number(s.threshold) || 0) / 100,
      sharp: (Number(s.sharpness) || 0) / 100,
      edges: (Number(s.edges) || 0) / 100,
      dither: s.dither === "noise" ? 2 : s.dither === "ordered" ? 1 : 0,
      ink: toRGB(ink),
      back: toRGB(back),
      ownColours: s.colour === "original" ? 1 : 0,
      backMode: glowing ? 2 : backMode, // (Glow: the characters alone first)
      pictureMix,
      flicker: s.movement === "flicker" ? amount * 0.5 : 0,
      fstep: s.movement === "flicker" ? Math.floor(t * flickerRate) % 100000 : 0,
      rain: s.movement === "rain" ? amount : 0,
      rainPos: s.movement === "rain" ? (t * rainRate) % 100000 : 0,
      tail: Math.max(3, rows * 0.3)
    });
    if (!glowing) return drawn;

    // Glow: the characters blurred at two widths, added as light over what's behind
    const levels = smallerCopies(run, drawn, 1);
    const reach = Math.max(1, cellW * 0.6);
    return run.pass(GLOW, {
      picture: run.input, chars: drawn, glowNear: gaussianBlur(run, levels, reach), glowFar: gaussianBlur(run, levels, reach * 4)
    }, { back: toRGB(back), backMode, pictureMix, glow: (Math.max(0, Math.min(100, Number(s.glow) || 0)) / 100) * 2 });
  }
};

const lum = (hex) => { const [r, g, b] = toRGB(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };

function lyricsFont() {
  const lyrics = getProject().layers.find((l) => l.type === "lyrics");
  return (lyrics && lyrics.text && lyrics.text.font) || MONO;
}

// Your own text, or the lyric line being sung (the first line before the lyrics start), without
// its spaces, as a list of characters (at most 300)
function textFor(s, time = 0) {
  let text = s.text || "";
  if (s.set === "lyrics") {
    const i = lyricData.findLastIndex((line) => line.time <= time);
    const line = lyricData[Math.max(0, i)];
    text = line ? line.text : "";
  }
  return Array.from(String(text).replace(/\s+/g, "")).slice(0, 300);
}

// A set's characters from least to most ink (measured once per set and font)
const orders = new Map();
function densityOrder(set, font) {
  const key = set + "|" + font;
  if (orders.has(key)) return orders.get(key);
  const chars = [...new Set(Array.from(set))];
  if (!chars.includes(" ")) chars.unshift(" ");
  const w = 24, h = 42;
  const canvas = drawSheet(chars, font, w, h);
  const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, h).data;
  const ink = chars.map((_, i) => {
    let sum = 0;
    for (let y = 0; y < h; y++) for (let x = i * w; x < (i + 1) * w; x++) sum += data[(y * canvas.width + x) * 4 + 3];
    return sum;
  });
  const sorted = chars.map((c, i) => [c, ink[i], i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).map((e) => e[0]);
  orders.set(key, sorted);
  return sorted;
}

// Shapes: each character's ink in SUB_X x SUB_Y parts (0 - 255, scaled so the inkiest part of
// any character is full), side by side: a sheet SUB_X wide per character, SUB_Y tall; and
// inkScale: the inkiest character's average on that scale (a fully inked cell of the picture
// matches it). Worked out once per set, font and line height.
const shapeSheets = new Map();
function shapePatterns(chars, font, aspect) {
  const key = `${font}|${aspect}|${chars.join("")}`;
  if (!shapeSheets.has(key)) {
    if (shapeSheets.size > 16) shapeSheets.clear();
    shapeSheets.set(key, makeShapePatterns(chars, font, aspect));
  }
  return shapeSheets.get(key);
}
function makeShapePatterns(chars, font, aspect) {
  const w = 30, h = Math.round(30 * aspect);
  const sheet = drawSheet(chars, font, w, h);
  const data = sheet.getContext("2d").getImageData(0, 0, sheet.width, h).data;
  const parts = chars.map((_, g) => {
    const out = [];
    for (let j = 0; j < SUB_Y; j++) for (let i = 0; i < SUB_X; i++) {
      const x0 = g * w + Math.floor((i * w) / SUB_X), x1 = g * w + Math.floor(((i + 1) * w) / SUB_X);
      const y0 = Math.floor((j * h) / SUB_Y), y1 = Math.floor(((j + 1) * h) / SUB_Y);
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += data[(y * sheet.width + x) * 4 + 3];
      out.push(sum / (255 * (x1 - x0) * (y1 - y0)));
    }
    return out;
  });
  const most = Math.max(0.01, ...parts.flat());
  const canvas = document.createElement("canvas");
  canvas.width = chars.length * SUB_X;
  canvas.height = SUB_Y;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(canvas.width, SUB_Y);
  parts.forEach((p, g) => p.forEach((v, k) => {
    const x = g * SUB_X + (k % SUB_X), y = Math.floor(k / SUB_X);
    const at = (y * canvas.width + x) * 4;
    image.data[at] = image.data[at + 1] = image.data[at + 2] = Math.round(Math.min(1, v / most) * 255);
    image.data[at + 3] = 255;
  }));
  ctx.putImageData(image, 0, 0);
  const inkScale = Math.max(...parts.map((p) => p.reduce((a, b) => a + b, 0) / p.length)) / most;
  return { canvas, inkScale };
}

// The characters side by side, white, each centred in its own w x h box, as big as fits (squeezed
// if a character is too wide)
function drawSheet(chars, font, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, chars.length * w);
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const weight = font === MONO ? "bold " : ""; // (the typewriter font is thin: bold)
  ctx.font = `${weight}100px ${font}`;
  const em = Math.max(1, ctx.measureText("M").width) / 100; // a wide character's width, per pixel of font size
  ctx.font = `${weight}${Math.max(4, Math.round(Math.min(h * 0.86, (w * 0.98) / em)))}px ${font}`;
  chars.forEach((c, i) => {
    const wide = ctx.measureText(c).width;
    const squeeze = wide > w * 0.98 ? (w * 0.98) / wide : 1;
    ctx.save();
    ctx.translate(i * w + w / 2, h * 0.53);
    ctx.scale(squeeze, 1);
    ctx.fillText(c, 0, 0);
    ctx.restore();
  });
  return canvas;
}
