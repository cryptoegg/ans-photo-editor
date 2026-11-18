// Adjust → Curves (2026-11-17, step 3 of the pro features, like Lightroom's point curve): a curve for the light
// (RGB) and one each for Red, Green and Blue. Each is a list of points [x, y] (0 - 100) from the dark end to the
// light; a smooth line passes through them without overshooting (monotone cubic). The four are worked into one
// small table (256 steps per channel) that the graphics card reads: each channel = its own curve of the RGB curve.
// The editor draws and edits them (kind "curve", js/ui/colourControls.js).

const RECIPE = `
uniform sampler2D picture;
uniform sampler2D table;   // 256 x 1: r, g, b = each channel's curve

float through(float v, int channel) {
  vec3 t = texture(table, vec2((clamp(v, 0.0, 1.0) * 255.0 + 0.5) / 256.0, 0.5)).rgb;
  return channel == 0 ? t.r : channel == 1 ? t.g : t.b;
}

void main() {
  vec4 source = texelFetch(picture, pixel(), 0);
  colour = vec4(through(source.r, 0), through(source.g, 1), through(source.b, 2), source.a);
}`;

const STRAIGHT = () => [[0, 0], [100, 100]];
export const CURVE_KEYS = ["rgb", "red", "green", "blue"];

// The curve through `points` as a function 0 - 1 → 0 - 1 (Fritsch–Carlson: smooth, never past its points)
export function curveFn(points) {
  const p = (points && points.length >= 2 ? points : STRAIGHT()).map(([x, y]) => [x / 100, y / 100]).sort((a, b) => a[0] - b[0]);
  const n = p.length, d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / Math.max(1e-6, p[i + 1][0] - p[i][0]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= p[0][0]) return p[0][1];
    if (x >= p[n - 1][0]) return p[n - 1][1];
    let i = 0;
    while (i < n - 2 && x > p[i + 1][0]) i++;
    const h = p[i + 1][0] - p[i][0], t = (x - p[i][0]) / h, t2 = t * t, t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
    return Math.max(0, Math.min(1, y));
  };
}

const isStraight = (points) => !points || points.length < 2 || (points.length === 2 && points[0][0] === 0 && points[0][1] === 0 && points[1][0] === 100 && points[1][1] === 100);

function tableOf(settings) {
  const all = curveFn(settings.rgb), chan = [curveFn(settings.red), curveFn(settings.green), curveFn(settings.blue)];
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 1;
  const g = canvas.getContext("2d"), img = g.createImageData(256, 1);
  for (let i = 0; i < 256; i++) {
    const v = all(i / 255);
    for (let c = 0; c < 3; c++) img.data[i * 4 + c] = Math.round(chan[c](v) * 255);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

export default {
  type: "curves",
  label: "Curves",
  adjust: true,                 // in the Adjust section (always on; a straight line = no change)
  inside: "colour",             // shown in the Colour card, under its own tab (js/ui/effectsPanel.js)
  description: "A curve for the light, and for red, green and blue.",
  group: "Adjust",
  defaults: () => ({ channel: "rgb", rgb: STRAIGHT(), red: STRAIGHT(), green: STRAIGHT(), blue: STRAIGHT() }),
  controls: [
    { key: "curve", label: "Curve", kind: "curve" } // (edits rgb / red / green / blue; `channel` = the one being drawn)
  ],
  apply(settings, run) {
    if (CURVE_KEYS.every((k) => isStraight(settings[k]))) return run.input;
    const key = "curves|" + JSON.stringify(CURVE_KEYS.map((k) => settings[k]));
    const table = run.texture(key, () => tableOf(settings));
    return run.pass(RECIPE, { picture: run.input, table }, {});
  }
};
