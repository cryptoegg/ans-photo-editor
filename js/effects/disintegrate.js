// Effect: Disintegrate (pictures only) — the picture comes apart while it's on screen: it erodes
// from its top edge down, the edge crumbling cell by cell (ragged gaps), loose dots breaking off
// and floating up as they fade. Whole when the picture appears, gone by the end of its time on
// screen (Starts / Gone by move that within it). It's last in the chain, so the finished look
// (a sepia halftone, a print edge…) is what crumbles. All from song time and the layer's seed,
// so preview = export.

const RECIPE = `
uniform sampler2D picture;
uniform float front;     // how far the erosion has come: 0 (not started) - 1 + band (all gone)
uniform float band;      // how ragged the edge is (a fraction of the height)
uniform float cell;      // crumb size, in short sides
uniform float dots;      // 0 - 1: how many crumbs break off as floating dots
uniform float rise;      // how far a dot floats, in cells, per unit of erosion
uniform float progress;  // front / (1 + band)

// When a cell (column x, row y, in cells) crumbles: a point of the erosion (0 - 1 + band)
float goneAt(ivec2 c, float rows) {
  float y = (float(c.y) + 0.5) / rows;                               // 0 top - 1 bottom
  float wave = (noise(vec2(float(c.x) * 0.15, 3.0), 51u) - 0.5) * band; // a ragged contour
  float r = random(c, 52u) * 0.5 + 0.5;                              // cell by cell
  return y + band * r + wave;
}

void main() {
  float shortSide = min(size.x, size.y);
  vec2 p = place();                                   // short sides from the top-left
  float rows = size.y / shortSide / cell;
  ivec2 c = ivec2(floor(p / cell));
  vec4 here_ = texelFetch(picture, pixel(), 0);
  float when = goneAt(c, rows);
  if (front < when) { colour = here_; return; }       // still whole

  // Gone: maybe a crumb from further down is floating up through this cell
  vec2 inCell = fract(p / cell) - 0.5;
  for (int k = 1; k <= 40; k++) {
    ivec2 s = c + ivec2(0, k);
    if (float(s.y) >= rows) break;
    if (random(s, 53u) * 0.5 + 0.5 > dots) continue;
    float sWhen = goneAt(s, rows);
    if (front < sWhen) continue;
    float age = front - sWhen;                          // how long ago it broke off
    float up = age * rise;                              // cells floated so far
    if (abs(up - float(k)) > 0.5) continue;
    float life = clamp(1.0 - up / 18.0, 0.0, 1.0);      // fades as it rises
    float r = 0.18 + 0.2 * (random(s, 54u) * 0.5 + 0.5);
    if (length(inCell) > r || life <= 0.0) continue;
    vec2 from = (vec2(s) + 0.5) * cell * shortSide;     // its colour: where it came from
    vec4 d = texelFetch(picture, ivec2(from), 0);
    colour = vec4(d.rgb, d.a * life);
    return;
  }
  colour = vec4(0.0);
}`;

export default {
  type: "disintegrate",
  label: "Disintegrate",
  vibe: { light: { size: 0, dots: 20, ragged: 0, drift: 30 }, full: { size: 0, dots: 90, ragged: 0, drift: 100 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "The picture crumbles away from the top while it's on screen, dots floating up.",
  group: "Damage & frames",
  later: true,                  // taken out of the menus (Tom, 2026-10-25); saved ones still draw
  only: ["image"],              // offered for pictures only
  defaults: () => ({
    start: 0,                   // when it starts, in % of the picture's time on screen
    end: 100,                   // when it's all gone, in %
    size: 0,                   // crumb size: 0 (fine) - 100 (big)
    ragged: 0,                 // 0 (a clean edge) - 100 (very ragged)
    dots: 50,                   // 0 (none) - 100 (lots of loose dots)
    drift: 100                   // 0 (dots stay) - 100 (they float up fast)
  }),
  controls: [
    { key: "start", label: "Starts (% of its time)", min: 0, max: 100, step: 1 },
    { key: "end", label: "Gone by (% of its time)", min: 0, max: 100, step: 1 },
    { key: "size", label: "Crumb size", min: 0, max: 100, step: 1 },
    { key: "ragged", label: "Ragged edge", min: 0, max: 100, step: 1 },
    { key: "dots", label: "Loose dots", min: 0, max: 100, step: 1 },
    { key: "drift", label: "Drift up", min: 0, max: 100, step: 1 }
  ],
  moves: () => true,
  apply(settings, run) {
    // How far through: the picture's time on screen (run.span), between Starts and Gone by
    const span = run.span && Number.isFinite(run.span.to) && run.span.to > run.span.from ? run.span : null;
    const through = span ? ((run.time || 0) - span.from) / (span.to - span.from) : 0;
    const a = Math.min(settings.start, settings.end - 1) / 100, b = Math.max(settings.end, settings.start + 1) / 100;
    const progress = Math.min(1, Math.max(0, (through - a) / (b - a)));
    if (progress <= 0) return run.input;
    const band = 0.02 + (settings.ragged / 100) * 0.3;
    return run.pass(RECIPE, { picture: run.input }, {
      front: progress * (1 + 1.6 * band) + (progress >= 1 ? 1 : 0), // (at the end: every cell gone)
      band,
      cell: 0.004 + (settings.size / 100) * 0.03,
      dots: settings.dots / 100,
      rise: 2 + (settings.drift / 100) * 60,
      progress
    });
  }
};
