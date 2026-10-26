// Effect: Grain — film grain that works like Lightroom's: Amount, Size and Roughness. The grains
// are crisp and irregular (not soft blobs laid on top), black-and-white, and part of the picture:
// strongest in the mid-tones, fading out in deep blacks and bright whites so colours and
// brightness stay true; bigger grain also softens the picture a little, like real film. Roughness
// goes from even, fine grain to irregular clumps. Its size is relative to the picture, so it looks
// the same at any export size. Colour (0 = black-and-white) adds coloured speckle; Moving: a new
// grain pattern 24 times a second, like real film playing. It's in the picture's own pixels (each
// pixel's brightness is changed), not a layer on top; changing Size re-grains in place.

const RECIPE = `
uniform sampler2D picture;
uniform float amount;     // 0 - 1
uniform float cellUnits;  // a grain's size, in pixels of a 1080-pixel picture
uniform float rough;      // 0 even - 1 clumped
uniform float colourMix;  // 0 black-and-white grain - 1 coloured speckle
uniform float frameShift; // moving grain: a different patch of grain for each film frame
uniform float sizeStep;   // each Size has its own grains (so changing it re-grains in place, never slides)

// One layer of grains: a random value per grain, its grid turned so no squares show, blended
// linearly (crisp, not smoothed into blobs) and sharpened
float grains(vec2 p, float s, float turn, uint salt) {
  vec2 q = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * (p - size * 0.5) / s; // (from the middle)
  vec2 c = floor(q), f = q - c;
  ivec2 i = ivec2(c);
  float a = random(i, salt), b = random(i + ivec2(1, 0), salt);
  float d = random(i + ivec2(0, 1), salt), e = random(i + ivec2(1, 1), salt);
  float v = mix(mix(a, b, f.x), mix(d, e, f.x), f.y);
  return sign(v) * pow(abs(v), 0.7);
}

// A grain's size here, in pixels (relative to the picture: the same look at any size)
float cellPx() { return cellUnits * min(size.x, size.y) / 1080.0; }

// The grain at p (about -1 - 1): fine grains, with coarser clumps mixed in by Roughness
float grain(vec2 p, uint salt) {
  float cell = cellPx();
  salt += uint(sizeStep) * 97u;
  float fine = grains(p, cell, 0.5, salt);
  float clump = grains(p, cell * 2.3, 1.1, salt + 11u);
  float big = grains(p, cell * 5.0, 2.0, salt + 23u);
  float g = fine * (1.0 - 0.55 * rough) + clump * 0.75 * rough + big * 0.35 * rough * rough;
  return g / (1.0 - 0.55 * rough + 0.75 * rough + 0.35 * rough * rough) * 1.6;
}

void main() {
  vec2 p = vec2(pixel()) + 0.5;
  vec2 q = p + frameShift * vec2(173.0, 251.0);
  // Bigger grain softens the picture a little (four nearby samples)
  float r = amount > 0.0 ? cellPx() * 0.4 : 0.0;
  vec4 source = (sampleAt(picture, (p + vec2(r, r * 0.4)) / size) + sampleAt(picture, (p + vec2(-r * 0.4, r)) / size)
    + sampleAt(picture, (p + vec2(-r, -r * 0.4)) / size) + sampleAt(picture, (p + vec2(r * 0.4, -r)) / size)) * 0.25;
  float l = luma(source.rgb);
  // Mid-tones most, fading out in deep blacks and bright whites
  float weight = smoothstep(0.0, 0.1, l) * smoothstep(1.0, 0.88, l) * (0.35 + 0.65 * 4.0 * l * (1.0 - l));
  vec3 g = vec3(grain(q, 0u));
  if (colourMix > 0.0) g = mix(g, vec3(grain(q, 1u), grain(q, 2u), grain(q, 3u)), colourMix);
  vec3 grained = source.rgb + g * amount * 0.32 * weight;
  colour = vec4(clamp(grained, 0.0, 1.0), source.a);
}`;

export default {
  type: "grain",
  label: "Grain",
  vibe: { light: { amount: 9, size: 0, roughness: 0 }, full: { amount: 51, size: 0, roughness: 0 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Film grain, like Lightroom's: amount, size and roughness.",
  group: "Texture",
  defaults: () => ({
    amount: 30,                 // how strong (0 - 100)
    size: 0,                   // fine (0) - coarse (100)
    roughness: 0,              // even (0) - clumped (100)
    colour: 100,                  // 0 black-and-white grain - 100 coloured speckle
    moving: false               // a new pattern every frame as the song plays
  }),
  controls: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "size", label: "Size", min: 0, max: 100, step: 1 },
    { key: "roughness", label: "Roughness", min: 0, max: 100, step: 1 },
    { key: "colour", label: "Colour", min: 0, max: 100, step: 1 },
    { key: "moving", label: "Moving (new grain every frame)", kind: "toggle" }
  ],
  // (older saves: Size was 0.5 - 3, and there was no Roughness)
  migrate(settings) {
    if (settings.roughness === undefined) {
      settings.roughness = 50;
      if (settings.size !== undefined && settings.size <= 3) settings.size = Math.round(((settings.size - 0.5) / 2.5) * 100);
    }
  },
  moves: (settings) => !!settings.moving,
  apply: (settings, run) => run.pass(RECIPE, { picture: run.input }, {
    amount: settings.amount / 100,
    cellUnits: 0.6 + ((settings.size ?? 25) / 100) * 3.4,
    sizeStep: Math.round(settings.size ?? 25),
    rough: (settings.roughness ?? 50) / 100,
    colourMix: settings.colour / 100,
    frameShift: settings.moving ? Math.floor((run.time || 0) * 24) % 997 : 0
  })
};
