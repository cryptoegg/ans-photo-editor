// Skin (Tom, 2026-11-18, the pro list's "skin smoothing"): the slide's own Adjust → Skin, run after its Light and before
// everything else. Skin is found by its colour (a soft range of skin tones, any skin colour, too dark or blown-out left
// alone), the found area softened a little so it has no speckles. There:
//   Smooth       an edge-keeping blur (a bilateral: neighbours only count when their colour is close, so eyes, lips,
//                hair and the face's edges stay sharp, blotches and fine lines go)
//   Keep texture the finest detail (pores) laid back on, so skin doesn't look like plastic
//   Even tone    the skin's colour taken from a wide blur (redness, blotches) while its light and shade stay
import { smallerCopies, gaussianBlur } from './kit.js';

// Half-size copy: how much each pixel looks like skin (0 - 1)
const FIND = `
uniform sampler2D picture;
void main() {
  vec3 c = texture(picture, here()).rgb;
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  vec2 cc = vec2(-0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b);
  vec2 d = (cc - vec2(-0.085, 0.095)) / vec2(0.12, 0.09);
  float k = 1.0 - smoothstep(0.55, 1.15, length(d));
  k *= smoothstep(0.06, 0.18, y) * (1.0 - smoothstep(0.93, 0.995, y));
  colour = vec4(vec3(k), 1.0);
}`;

// The edge-keeping blur (9 x 9 samples across `radius` pixels)
const SMOOTH = `
uniform sampler2D picture;
uniform float radius;
uniform float range;
void main() {
  vec4 src = texelFetch(picture, pixel(), 0);
  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = -4; i <= 4; i++) {
    for (int j = -4; j <= 4; j++) {
      vec2 o = vec2(float(i), float(j)) * radius / 4.0;
      vec3 s = texture(picture, (gl_FragCoord.xy + o) / size).rgb;
      vec3 dd = s - src.rgb;
      float w = exp(-float(i * i + j * j) / 10.0) * exp(-dot(dd, dd) / (2.0 * range * range));
      sum += s * w;
      total += w;
    }
  }
  colour = vec4(sum / max(total, 1e-5), src.a);
}`;

const COMBINE = `
uniform sampler2D picture;
uniform sampler2D smoothed;
uniform sampler2D fine;
uniform sampler2D wide;
uniform sampler2D skin;
uniform float amount;   // 0 - 1
uniform float keep;     // 0 - 1
uniform float even;     // 0 - 1
vec3 toYCC(vec3 c) { return vec3(dot(c, vec3(0.299, 0.587, 0.114)), -0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b); }
vec3 fromYCC(vec3 q) { return vec3(q.x + 1.402 * q.z, q.x - 0.344136 * q.y - 0.714136 * q.z, q.x + 1.772 * q.y); }
void main() {
  vec4 src = texelFetch(picture, pixel(), 0);
  vec3 sm = texelFetch(smoothed, pixel(), 0).rgb;
  vec3 detail = src.rgb - texture(fine, here()).rgb;
  vec3 c = mix(src.rgb, sm + detail * keep, amount);
  vec3 q = toYCC(c), w = toYCC(texture(wide, here()).rgb);
  q.yz = mix(q.yz, w.yz, even);
  c = fromYCC(q);
  float m = texture(skin, here()).r;
  colour = vec4(mix(src.rgb, clamp(c, 0.0, 1.0), m), src.a);
}`;

export default {
  type: "skin",
  label: "Skin",
  description: "Smooths skin and evens its tone.",
  group: "Adjust",
  adjust: true,
  defaults: () => ({ smooth: 0, texture: 40, even: 0 }),
  controls: [
    { key: "smooth", label: "Smooth", min: 0, max: 100, step: 1 },
    { key: "even", label: "Even tone", min: 0, max: 100, step: 1 },
    { key: "texture", label: "Keep texture", min: 0, max: 100, step: 1 }
  ],
  apply(settings, run) {
    if (!(settings.smooth > 0 || settings.even > 0)) return run.input;
    const { width, height } = run;
    const side = Math.min(width, height);
    const found = run.pass(FIND, { picture: run.input }, {}, { width: width / 2, height: height / 2 });
    const skin = gaussianBlur(run, smallerCopies(run, found, 2), Math.max(1, side * 0.003));
    const smoothed = settings.smooth > 0
      ? run.pass(SMOOTH, { picture: run.input }, { radius: Math.max(3, side * (0.006 + 0.012 * settings.smooth / 100)), range: 0.08 + 0.16 * settings.smooth / 100 })
      : run.input;
    const levels = smallerCopies(run, run.input, 1);
    return run.pass(COMBINE, {
      picture: run.input, smoothed, skin,
      fine: gaussianBlur(run, levels, Math.max(0.6, side * 0.0006)),
      wide: gaussianBlur(run, levels, side * 0.02)
    }, { amount: settings.smooth / 100, keep: settings.texture / 100, even: (settings.even / 100) * 0.85 });
  }
};
