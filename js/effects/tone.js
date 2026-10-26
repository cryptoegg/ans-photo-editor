// Adjust → Light (saved as "tone"): the basic photo controls, every slider 0 in the middle (no
// change), more or less either way, like a photo editor:
//   Exposure     brighter / darker, like opening up the lens (way up: the night-flash blow-out)
//   Contrast     harder or softer
//   Highlights   the bright parts brighter, or pulled back
//   Shadows      the dark parts lifted, or deepened
//   Fade         lifts the blacks to grey, like an old print (left: deeper blacks)
//   Blur ↔ Sharpen  left softens the picture, right sharpens it
// (Colour is its own section, js/effects/colour.js; Solarise is an effect, js/effects/solarise.js.)
import { smallerCopies, gaussianBlur } from './kit.js';

const RECIPE = `
uniform sampler2D picture;
uniform float exposure;   // stops: -2 to 2
uniform float contrast;   // -1 to 1
uniform float highlights; // -1 to 1
uniform float shadows;    // -1 to 1
uniform float fade;       // -1 to 1

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  vec3 c = source.rgb;
  if (exposure != 0.0) c = pow(pow(c, vec3(2.2)) * exp2(exposure), vec3(1.0 / 2.2)); // in light, not in screen values
  if (contrast != 0.0) c = (c - 0.5) * (contrast > 0.0 ? 1.0 + contrast * 1.5 : 1.0 + contrast) + 0.5;
  c = clamp(c, 0.0, 1.0);
  float l = luma(c);
  if (highlights != 0.0) c += highlights * 0.35 * smoothstep(0.35, 1.0, l) * (highlights > 0.0 ? 1.0 - l * 0.5 : 1.0);
  if (shadows != 0.0) c += shadows * 0.35 * smoothstep(0.65, 0.0, l) * (shadows > 0.0 ? 1.0 : l + 0.3);
  c = clamp(c, 0.0, 1.0);
  if (fade > 0.0) c = fade * 0.35 + c * (1.0 - fade * 0.35);
  if (fade < 0.0) c = clamp((c + fade * 0.12) / (1.0 + fade * 0.12), 0.0, 1.0); // (deeper blacks)
  colour = vec4(c, source.a);
}`;

// Sharpen: the picture pushed away from a slightly blurred copy of itself (an unsharp mask)
const SHARPEN = `
uniform sampler2D picture;
uniform sampler2D soft;
uniform float amount;
void main() {
  vec4 c = texelFetch(picture, pixel(), 0);
  vec4 s = texture(soft, here());
  colour = vec4(clamp(c.rgb + (c.rgb - s.rgb) * amount, 0.0, 1.0), c.a);
}`;

// A blurred copy, back at full size
const FULL = `
uniform sampler2D picture;
void main() { colour = texture(picture, here()); }`;

export default {
  type: "tone",
  label: "Light",
  adjust: true,                 // in the Adjust section (always on; every slider 0 = no change)
  description: "Exposure, contrast, highlights, shadows, fade, blur ↔ sharpen.",
  group: "Adjust",
  defaults: () => ({
    exposure: 0,                // -100 (2 stops darker) - 100 (2 stops brighter)
    contrast: 0,                // -100 (flat) - 100 (hard)
    highlights: 0,              // -100 (pulled back) - 100 (brighter)
    shadows: -10,                 // -100 (deeper) - 100 (lifted)
    fade: -10,                    // -100 (deeper blacks) - 100 (blacks lifted to grey)
    detail: 20                   // -100 (blurred) - 100 (sharpened)
  }),
  controls: [
    { key: "exposure", label: "Exposure", min: -100, max: 100, step: 1 },
    { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1 },
    { key: "highlights", label: "Highlights", min: -100, max: 100, step: 1 },
    { key: "shadows", label: "Shadows", min: -100, max: 100, step: 1 },
    { key: "fade", label: "Fade", min: -100, max: 100, step: 1 },
    { key: "detail", label: "Blur ↔ Sharpen", min: -100, max: 100, step: 1 }
  ],
  apply(settings, run) {
    const s = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, fade: 0, detail: 0, ...settings };
    let image = run.input;
    if (s.exposure || s.contrast || s.highlights || s.shadows || s.fade) {
      image = run.pass(RECIPE, { picture: image }, {
        exposure: (s.exposure / 100) * 2, contrast: s.contrast / 100, highlights: s.highlights / 100, shadows: s.shadows / 100, fade: s.fade / 100
      });
    }
    const shortSide = Math.min(run.width, run.height);
    if (s.detail < 0) {
      const reach = (-s.detail / 100) * 0.012 * shortSide; // sigma, up to 1.2% of the picture
      image = run.pass(FULL, { picture: gaussianBlur(run, smallerCopies(run, image, 1), reach) });
    } else if (s.detail > 0) {
      const soft = gaussianBlur(run, [{ image, factor: 1 }], Math.max(1, (shortSide / 1080) * 1.4));
      image = run.pass(SHARPEN, { picture: image, soft }, { amount: (s.detail / 100) * 1.6 });
    }
    return image;
  }
};
