// Effect: Halation (2026-11-18, step 3 of the pro features) — the red-orange glow film gives around bright
// things: light goes through the film, bounces off its back and comes up again in the red layer, so a halo
// sits around the edges of highlights (lamps, windows, white shirts against dark) rather than over them.
// The bright parts are picked out, blurred near and far (like Bloom, on smaller copies: fast, relative to
// the picture's size), the highlight itself mostly taken back out of its own glow (so the halo hugs the
// edges), tinted and added with a screen blend.
import { smallerCopies, gaussianBlur } from './kit.js';
import { toRGB } from './colours.js';

// Half-size copy of the parts brighter than Highlights
const BRIGHT = `
uniform sampler2D picture;
uniform float threshold;  // 0 - 1 (1: only pure white glows)
void main() {
  vec4 c = texture(picture, here());
  float k = smoothstep(threshold, min(threshold + 0.2, 1.0), luma(c.rgb)) * c.a;
  colour = vec4(vec3(k), 1.0);
}`;

// The picture with its halo
const COMBINE = `
uniform sampler2D picture;
uniform sampler2D bright;
uniform sampler2D near;
uniform sampler2D far;
uniform float strength;   // 0 - 4
uniform float hug;        // 0 - 1: how much of the glow over the highlight itself is taken out
uniform vec3 tint;        // the halo's colour
void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  float glow = texture(near, here()).r * 0.65 + texture(far, here()).r * 0.35;
  float core = texture(bright, here()).r;
  float halo = clamp((glow - core * hug) * strength, 0.0, 1.0);
  vec3 add = tint * halo;
  float a = clamp(source.a + halo * (1.0 - source.a), 0.0, 1.0);
  vec3 lit = 1.0 - (1.0 - source.rgb * source.a) * (1.0 - add);
  colour = vec4(a > 0.0 ? min(lit / a, 1.0) : vec3(0.0), a);
}`;

export default {
  type: "halation",
  label: "Halation",
  description: "Film's red-orange glow around bright things.",
  group: "Light & blur",
  vibe: { light: { amount: 20, size: 25 }, full: { amount: 85, size: 60 } }, // the one slider (js/effects/vibe.js)
  defaults: () => ({
    amount: 55,          // how strong the halo is
    highlights: 70,      // how bright a part must be to glow (100: only pure white)
    size: 45,            // how far the halo reaches
    colour: "#ff4a1c"    // the halo's colour (film's red-orange)
  }),
  controls: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "size", label: "Size", min: 0, max: 100, step: 1 },
    { key: "highlights", label: "Highlights", min: 0, max: 100, step: 1 },
    { key: "colour", label: "Colour", kind: "colour" }
  ],
  apply(settings, run) {
    if (!(settings.amount > 0)) return run.input;
    const { width, height } = run;
    const bright = run.pass(BRIGHT, { picture: run.input }, { threshold: settings.highlights / 100 }, { width: width / 2, height: height / 2 });
    const levels = smallerCopies(run, bright, 2);
    const reach = Math.max(0.5, (0.15 + settings.size / 100) * 0.022 * Math.min(width, height)); // in picture pixels
    return run.pass(COMBINE, {
      picture: run.input, bright, near: gaussianBlur(run, levels, reach), far: gaussianBlur(run, levels, reach * 4)
    }, { strength: (settings.amount / 100) * 4, hug: 0.75, tint: toRGB(settings.colour) });
  }
};
