// Effect: Fisheye — the picture bulged out from its middle like a fisheye lens. Low amounts: a gentle
// bulge that still fills the frame. Towards 100: the real fisheye look — a round picture, strongly
// bent, darker towards the rim with a touch of colour fringing, black outside the circle (Round
// lens off: it keeps filling the frame instead).
const RECIPE = `
uniform sampler2D picture;
uniform float k;          // the bend
uniform float zoom;       // how far it's zoomed in to keep the frame (or the circle) filled
uniform float round_;     // 0 - 1: how much of the round lens shows (black outside the circle)
uniform float radius;     // the circle's radius, in short sides
uniform float rim;        // 0 - 1: darkening and colour fringing at the rim

vec2 bend(vec2 d, float scale) { return d * (1.0 + k * dot(d, d)) / zoom * scale; }

void main() {
  vec2 square = size / min(size.x, size.y);
  vec2 d = (here() - 0.5) * square;               // from the middle, in short sides
  float r = length(d) / radius;                   // 1 at the circle's edge
  // a touch of colour fringing towards the rim (red bent a little more, blue a little less)
  float fringe = rim * 0.012 * pow(clamp(r, 0.0, 1.2), 3.0);
  vec4 g = sampleAt(picture, bend(d, 1.0) / square + 0.5);
  float red = sampleAt(picture, bend(d, 1.0 + fringe) / square + 0.5).r;
  float blue = sampleAt(picture, bend(d, 1.0 - fringe) / square + 0.5).b;
  vec3 c = vec3(red, g.g, blue);
  c *= 1.0 - rim * 0.55 * pow(clamp(r, 0.0, 1.0), 3.0);             // darker towards the rim
  float inside = 1.0 - smoothstep(0.985, 1.0, r);                   // the circle, with a soft edge
  float keep = mix(1.0, inside, round_);
  colour = vec4(c * keep, mix(g.a, 1.0, round_ * (1.0 - inside)) * max(keep, round_)); // (black outside)
}`;

export default {
  type: "fisheye",
  label: "Fisheye",
  vibe: { light: { amount: 2 }, full: { amount: 100 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Bulged out from the middle; towards 100, a round fisheye lens.",
  group: "Warp",
  defaults: () => ({
    amount: 4.9,                 // 0 (flat) - 100 (a full round fisheye)
    fill: false                  // Round lens: towards 100 the picture becomes a circle (off: keeps filling the frame)
  }),
  controls: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "fill", label: "Round lens (towards 100)", kind: "toggle" }
  ],
  migrate(settings) { if (settings.amount < 0) settings.amount = 0; }, // (no more pinching in)
  apply(settings, run) {
    const a = Math.max(0, Math.min(1, (settings.amount || 0) / 100));
    if (!a) return run.input;
    const w = run.width, h = run.height, s = Math.min(w, h);
    const corner2 = (Math.pow(w / s, 2) + Math.pow(h / s, 2)) / 4;
    const round = settings.fill === false ? 0 : Math.pow(Math.max(0, (a - 0.5) / 0.5), 1.5); // (from halfway up)
    const radius = 0.49 + (Math.sqrt(corner2) - 0.49) * (1 - round);                       // the circle closes in
    const k = a * (2.2 + 1.4 * round); // (bent harder as it becomes a round lens)
    // zoomed so the frame stays filled; as the lens rounds, so the circle is (more of the picture in it)
    const fillFrame = 1 + k * corner2, fillCircle = 1 + k * radius * radius;
    const zoom = fillFrame + (fillCircle - fillFrame) * round;
    if (settings.plain) return run.pass(RECIPE, { picture: run.input }, { k: a * 1.6, zoom: 1, round_: 0, radius: Math.sqrt(corner2), rim: 0 }); // (a bare bulge: Focus mode's lettering)
    return run.pass(RECIPE, { picture: run.input }, { k, zoom, round_: round, radius, rim: a });
  }
};
