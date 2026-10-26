// Effect: Melt — wet ink running down: drips and streaks run down from the lettering (or from
// the dark parts of a picture), longer in some places than others, while the original stays
// where it was. With Speed the drips slowly grow and draw back as the song plays.

const RECIPE = `
uniform sampler2D picture;
uniform float amount;       // 0 - 1
uniform float drip;         // drip width, in short sides
uniform float grow;         // 0 - 1: how far the drips have run right now

void main() {
  vec2 square = size / min(size.x, size.y);
  vec2 p = here() * square;
  // How far the ink runs in this column: mostly a little, now and then a long drip
  float shape = pow(fbm(vec2(p.x / drip, 0.5), 141u), 2.5) * 2.0 + 0.15 * noise(vec2(p.x / drip * 5.0, 2.0), 142u);
  float reach = shape * amount * grow * 0.5;                    // in short sides
  vec4 here_ = sampleAt(picture, p / square);
  vec3 c = here_.rgb * here_.a;                                 // (premultiplied)
  float a = here_.a;
  vec3 darkest = here_.rgb;
  for (int k = 1; k <= 28; k++) {
    float f = float(k) / 28.0;
    vec4 s = sampleAt(picture, (p - vec2(0.0, reach * f)) / square);
    float w = pow(1.0 - f, 1.3);                                // drips thin out as they run
    // Behind see-through areas (around lyrics): the ink that ran down from above
    c += (1.0 - a) * s.rgb * s.a * w;
    a += (1.0 - a) * s.a * w;
    // On a solid picture: its dark parts run down over the lighter parts below
    darkest = min(darkest, mix(vec3(1.0), s.rgb, w * s.a));
  }
  vec3 rgb = a > 0.0 ? c / a : vec3(0.0);
  rgb = mix(rgb, min(rgb, darkest), here_.a);
  colour = vec4(rgb, a);
}`;

export default {
  type: "melt",
  label: "Melt",
  only: ["image"],              // pictures only (not videos / the camera)
  later: true,                  // taken out of the menus (Tom, 2026-10-24); saved ones still draw
  description: "Ink running down in drips and streaks.",
  group: "Warp",
  defaults: () => ({
    amount: 40,                 // 0 (none) - 100 (running right down)
    size: 30,                   // drip width: 0 (thin) - 100 (wide)
    speed: 0                    // 0 (still) - 100 (drips grow and draw back quickly)
  }),
  controls: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "size", label: "Drip width", min: 0, max: 100, step: 1 },
    { key: "speed", label: "Speed (moves as the song plays)", min: 0, max: 100, step: 1 }
  ],
  moves: (settings) => settings.speed > 0,
  apply(settings, run) {
    if (settings.amount <= 0) return run.input;
    const t = (run.time || 0) * (settings.speed / 100) * 1.5;
    return run.pass(RECIPE, { picture: run.input }, {
      amount: settings.amount / 100,
      drip: 0.01 + (settings.size / 100) * 0.15,
      grow: settings.speed > 0 ? 0.5 + 0.5 * Math.sin(t) : 1
    });
  }
};
