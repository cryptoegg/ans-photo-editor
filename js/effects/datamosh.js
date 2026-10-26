// Effect: Datamosh — the picture broken into blocks like a damaged video file: blocks smeared out
// into lines, blocks moved and melted, blocks gone chunky, their colours pushed and slipping apart
// with fine screen lines, and thin streaks where a colour bleeds down the picture. Which blocks, and how, come from the seed; with Speed they
// change as the song plays.

const RECIPE = `
uniform sampler2D picture;
uniform float amount;       // 0 - 1: how many blocks break
uniform float block;        // block size, in short sides
uniform float smear;        // 0 - 1: how far blocks drag / streak
uniform float chunky;       // 0 - 1: how chunky the pixelated blocks are
uniform float bars;         // 0 - 1: bleeding streaks down the picture
uniform float step_;        // which moment (0 when still)

float rnd(float a, float b, uint salt) { return 0.5 + 0.5 * random(ivec2(int(a), int(b)), salt); }
vec3 punch(vec3 c) { float l = luma(c); return clamp(mix(vec3(l), c, 1.45) * 1.05, 0.0, 1.0); } // (colours pushed, like a bad encode)

// One size of block: broken (streaked, moved or chunky) or left alone
bool breakBlock(vec2 p, vec2 square, float bs, float share, uint salt, inout vec4 c) {
  vec2 cell = floor(p / bs);
  if (rnd(cell.x + step_ * 17.0, cell.y, salt) >= amount * share) return false;
  float kind = rnd(cell.x, cell.y + step_ * 13.0, salt + 1u);
  vec2 from = p;
  vec2 inCell = p - cell * bs;
  if (kind < 0.45) {
    // streaked: one row (or column) of the block dragged out into lines, like motion smeared
    // across a broken frame
    bool down = rnd(cell.y, cell.x, salt + 2u) < 0.65;
    float edge = rnd(cell.x, cell.y, salt + 3u) * (1.0 - smear * 0.8);
    if (down) from.y = cell.y * bs + edge * bs; else from.x = cell.x * bs + edge * bs;
    from += (down ? vec2(0.0, -1.0) : vec2(-1.0, 0.0)) * smear * bs * 2.0 * rnd(cell.x, cell.y, salt + 4u);
  } else if (kind < 0.8) {
    // moved: a block from nearby, a little stretched (melting)
    vec2 jump = (vec2(rnd(cell.x, cell.y, salt + 5u), rnd(cell.y, cell.x, salt + 6u)) - 0.5) * 2.0 * smear * bs * 3.0;
    from = cell * bs + jump + inCell * vec2(1.0, 1.0 - 0.5 * smear * rnd(cell.x, cell.y, salt + 7u));
  } else {
    // chunky: big pixels
    float px = bs / (1.5 + 8.0 * (1.0 - chunky));
    from = (floor(p / px) + 0.5) * px;
  }
  vec2 uv = clamp(from / square, 0.0, 1.0);
  // the colours slip a little apart inside a broken block
  vec2 slip = vec2(0.004 + 0.01 * smear, 0.0) * (rnd(cell.y, cell.x, salt + 8u) - 0.5) * 2.0;
  c = vec4(sampleAt(picture, uv + slip).r, sampleAt(picture, uv).g, sampleAt(picture, uv - slip).b, sampleAt(picture, uv).a);
  c.rgb = punch(c.rgb);
  c.rgb = mix(c.rgb, floor(c.rgb * 6.0 + 0.5) / 6.0, 0.35);
  c.rgb *= 0.88 + 0.12 * step(0.5, fract(float(pixel().y) / 3.0)); // (fine lines in the block, like a screen)
  return true;
}

void main() {
  vec2 square = size / min(size.x, size.y);
  vec2 p = here() * square;
  vec4 c = sampleAt(picture, here());
  // bleeding streaks: thin columns where the colour at one point runs down the picture
  float colW = block * (0.03 + 0.05 * rnd(floor(p.x / (block * 0.04)), 1.0, 171u));
  float col = floor(p.x / colW);
  if (rnd(col, step_ + 3.0, 172u) < bars * 0.3) {
    float y0 = rnd(col, step_ + 1.0, 173u) * square.y, len = (0.1 + rnd(col, step_ + 2.0, 174u) * 0.9) * square.y;
    if (p.y > y0 && p.y < y0 + len) c = vec4(punch(sampleAt(picture, vec2(p.x, y0) / square).rgb), c.a);
  }
  if (!breakBlock(p, square, block, 0.55, 151u, c)) breakBlock(p, square, block * 0.5, 0.45, 161u, c);
  colour = c;
}`;

export default {
  type: "datamosh",
  label: "Datamosh",
  vibe: { light: { amount: 30, smear: 26.7, bars: 0 }, full: { amount: 100, smear: 100, bars: 0 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Blocks smeared into lines, moved and melted, gone chunky, colours bleeding down: a broken video file.",
  group: "Warp",
  defaults: () => ({
    amount: 100,                 // 0 (none) - 100 (most blocks)
    size: 69,                   // 0 (small blocks) - 100 (big)
    smear: 89,                  // how far blocks drag / jump
    chunky: 100,                 // how big the pixelated blocks' pixels are
    bars: 0,                   // rainbow pixel bars
    speed: 0                    // 0 (still) - 100 (changes many times a second)
  }),
  controls: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "size", label: "Block size", min: 0, max: 100, step: 1 },
    { key: "smear", label: "Smear", min: 0, max: 100, step: 1 },
    { key: "chunky", label: "Chunky", min: 0, max: 100, step: 1 },
    { key: "bars", label: "Bleeding streaks", min: 0, max: 100, step: 1 },
    { key: "speed", label: "Speed (changes as the song plays)", min: 0, max: 100, step: 1 }
  ],
  moves: (settings) => settings.speed > 0,
  apply(settings, run) {
    if (settings.amount <= 0 && settings.bars <= 0) return run.input;
    const perSecond = (settings.speed / 100) * 12;
    return run.pass(RECIPE, { picture: run.input }, {
      amount: settings.amount / 100,
      block: 0.03 + (settings.size / 100) * 0.15,
      smear: settings.smear / 100,
      chunky: settings.chunky / 100,
      bars: settings.bars / 100,
      step_: (perSecond > 0 ? Math.floor((run.time || 0) * perSecond) % 9973 : 0) + ((run.seed || 0) % 997)
    });
  }
};
