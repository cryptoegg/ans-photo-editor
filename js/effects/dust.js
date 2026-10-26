// Effect: Dust & scratches — specks of dust and long thin scratches, like an old print or a
// scanned negative. Dust: little specks of different sizes scattered at random; Scratches:
// thin lines running mostly up and down, breaking up along their length. Light (a scanned
// negative: white specks) or dark (a print: dark specks). Where they fall comes from the seed.
// Moving: new dust and scratches 24 times a second, like a film being projected.

const RECIPE = `
uniform sampler2D picture;
uniform float dust;         // 0 - 1
uniform float scratches;    // 0 - 1
uniform float light;        // 1 light specks, 0 dark, 0.5 both
uniform float frameNo;      // moving: which film frame (0 when still)

// The dust specks covering this spot (0 - 1)
float specks(vec2 p) {
  float cellSize = 0.025;                         // in short sides
  vec2 g = p / cellSize + frameNo * vec2(17.0, 29.0);
  vec2 base = floor(g);
  float cover = 0.0;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 cell = ivec2(base) + ivec2(dx, dy) + ivec2(4096);
      if (0.5 + 0.5 * random(cell, 41u) > dust * 0.6) continue;      // most cells have no speck
      vec2 at = vec2(cell - ivec2(4096)) + 0.5 + 0.45 * vec2(random(cell, 42u), random(cell, 43u));
      float r = mix(0.04, 0.22, pow(0.5 + 0.5 * random(cell, 44u), 3.0)); // mostly tiny, a few bigger
      float stretch = 1.0 + 1.5 * (0.5 + 0.5 * random(cell, 45u));         // some are fibres, not dots
      vec2 d = g - at;
      float a = random(cell, 46u) * 3.14159;
      d = vec2(cos(a) * d.x - sin(a) * d.y, sin(a) * d.x + cos(a) * d.y) * vec2(1.0, stretch);
      float edge = length(d) - r;
      cover = max(cover, 1.0 - smoothstep(-0.03, 0.03, edge));
    }
  }
  return cover;
}

// The scratches covering this spot (0 - 1)
float scratched(vec2 p) {
  float cover = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= scratches * 8.0) break;      // more scratches as the slider goes up
    float x0 = fract(0.5 + 0.5 * random(ivec2(i, 1), 47u) + frameNo * 0.618);
    float slope = random(ivec2(i, 2), 47u) * 0.06;
    float x = x0 * max(1.0, size.x / size.y) + slope * p.y + (noise(vec2(p.y * 6.0, float(i)), 48u) - 0.5) * 0.01;
    float width = 0.0004 + 0.0008 * (0.5 + 0.5 * random(ivec2(i, 3), 47u));
    float line = 1.0 - smoothstep(width, width * 2.0, abs(p.x - x));
    float pieces = smoothstep(0.45, 0.6, noise(vec2(p.y * 4.0 + frameNo * 3.1, float(i) + 20.0), 49u)); // broken up
    cover = max(cover, line * pieces);
  }
  return cover;
}

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec2 p = place();
  float d = dust > 0.0 ? specks(p) : 0.0;
  float s = scratches > 0.0 ? scratched(p) : 0.0;
  // Light or dark: each speck / scratch picks one when Both is chosen
  float lightness = light;
  if (light > 0.25 && light < 0.75) lightness = step(0.0, random(ivec2(floor(p / 0.025)), 50u));
  vec3 mark = mix(vec3(0.06), vec3(0.97), lightness);
  vec3 c = mix(source.rgb, mark, d * 0.9);
  c = mix(c, mix(vec3(0.1), vec3(0.95), light > 0.25 ? 1.0 : 0.0), s * 0.8);
  colour = vec4(c, source.a);
}`;

export default {
  type: "dust",
  label: "Dust & scratches",
  description: "Specks of dust and long scratches.",
  later: true,                  // needs more work: not in the + Add effect menu for now (saved ones still draw)
  group: "Texture",
  defaults: () => ({
    dust: 40,                   // 0 (clean) - 100 (filthy)
    scratches: 25,              // 0 (none) - 100 (eight long scratches)
    tone: "light",              // light (a scanned negative) | dark (a print) | both
    moving: false               // new dust every frame as the song plays
  }),
  controls: [
    { key: "dust", label: "Dust", min: 0, max: 100, step: 1 },
    { key: "scratches", label: "Scratches", min: 0, max: 100, step: 1 },
    { key: "tone", label: "Specks", kind: "choice", options: [
      { value: "light", label: "Light (scanned negative)" },
      { value: "dark", label: "Dark (old print)" },
      { value: "both", label: "Both" }
    ] },
    { key: "moving", label: "Moving (new dust every frame)", kind: "toggle" }
  ],
  moves: (settings) => !!settings.moving,
  apply(settings, run) {
    if (settings.dust <= 0 && settings.scratches <= 0) return run.input;
    return run.pass(RECIPE, { picture: run.input }, {
      dust: settings.dust / 100,
      scratches: settings.scratches / 100,
      light: settings.tone === "dark" ? 0 : settings.tone === "both" ? 0.5 : 1,
      frameNo: settings.moving ? Math.floor((run.time || 0) * 24) % 997 : 0
    });
  }
};
