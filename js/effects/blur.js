// Effect: Blur — two kinds of soft:
//   Soft focus  blurred all round, like an out-of-focus lens or a soft print
//   Smear       dragged in one direction (Angle), like a moving camera or a long exposure
// Amount is relative to the picture, so it looks the same at any size.
import { HALF, smallerCopies, gaussianBlur } from './kit.js';

// Dragged along `direction`, `streak` pixels (of this image) long: an even streak
const SMEAR = `
uniform sampler2D picture;
uniform vec2 direction;
uniform float streak;
void main() {
  int taps = clamp(int(ceil(streak)), 1, 60);
  vec2 stepSize = direction * (streak / float(taps)) / size;
  vec4 sum = vec4(0.0);
  for (int i = 0; i <= 60; i++) {
    if (i > taps) break;
    sum += texture(picture, here() + stepSize * (float(i) - float(taps) * 0.5));
  }
  colour = sum / float(taps + 1);
}`;

// Back to the picture's size
const FULL = `
uniform sampler2D picture;
void main() { colour = texture(picture, here()); }`;

export default {
  type: "blur",
  label: "Blur",
  vibe: { light: { amount: 5.1 }, full: { amount: 28.9 } }, // the one slider: light touch → full look (js/effects/vibe.js)
  description: "Soft focus, or a smear in one direction.",
  group: "Light & blur",
  defaults: () => ({
    amount: 17,                 // 0 (sharp) - 100
    style: "smear",              // soft | smear
    angle: 0                    // the smear's direction, in degrees (0: sideways, 90: up and down)
  }),
  controls: [
    { key: "amount", label: "Amount", min: 0, max: 100, step: 1 },
    { key: "style", label: "Style", kind: "choice", options: [
      { value: "soft", label: "Soft focus (all round)" },
      { value: "smear", label: "Smear (one direction)" }
    ] },
    { key: "angle", label: "Angle (smear)", min: 0, max: 180, step: 1 }
  ],
  apply(settings, run) {
    const { width, height } = run;
    const shortSide = Math.min(width, height);
    if (settings.amount <= 0) return run.input;
    if (settings.style === "smear") {
      // A streak up to a fifth of the picture long, drawn on a smaller copy if it's long
      const length = (settings.amount / 100) * 0.2 * shortSide;
      let factor = 1;
      let image = run.input;
      while (length / factor > 40 && factor < 16) {
        factor *= 2;
        image = run.pass(HALF, { picture: image }, {}, { width: width / factor, height: height / factor });
      }
      const angle = (settings.angle * Math.PI) / 180;
      const at = { width: width / factor, height: height / factor };
      const smeared = run.pass(SMEAR, { picture: image }, { direction: [Math.cos(angle), Math.sin(angle)], streak: length / factor }, at);
      return factor === 1 ? smeared : run.pass(FULL, { picture: smeared });
    }
    const reach = (settings.amount / 100) * 0.03 * shortSide; // sigma, up to 3% of the picture
    const blurred = gaussianBlur(run, smallerCopies(run, run.input, 1), reach);
    return run.pass(FULL, { picture: blurred });
  }
};
