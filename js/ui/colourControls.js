// The editor's two drawn colour controls (2026-11-17, step 3 of the pro features):
//   curveControl   Adjust → Curves: RGB · Red · Green · Blue, and a square to draw the curve in, like Lightroom's
//                  point curve: click the line to add a point, drag it, double-click (or drag it off the square) to
//                  take it away; the end points slide up and down only.
//   wheelsControl  Adjust → Colour Grading: Shadows · Midtones · Highlights wheels; drag in a wheel: the angle is
//                  the colour, the distance from the middle how much; double-click: back to none. Under each, its
//                  Luminance slider (darker ↔ lighter).
// Each is handed `values()` (the effect's settings now) and `set(patch, done)` (writes them; done = one undo step)
// and has `paint(values)`, called by the panel whenever the record changes (js/ui/effectsPanel.js showValues).
import { curveFn, CURVE_KEYS } from '../effects/curves.js';
import { uiColour } from './skin.js';

const CHANNELS = [["rgb", "RGB"], ["red", "Red"], ["green", "Green"], ["blue", "Blue"]];
const INK = { red: "#e0453a", green: "#3aa655", blue: "#3a6fe0" };
const ink = (key) => INK[key] || uiColour("--text");

// A canvas sized to its box on screen (sharp on any display)
function fit(canvas, height) {
  const w = canvas.clientWidth || 200, h = height(w), dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  }
  canvas.style.height = `${h}px`;
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}
// The mouse in the canvas's own pixels (the editor is drawn smaller, --ui-zoom, so screen sizes are scaled back)
function at(canvas, e) {
  const r = canvas.getBoundingClientRect(), k = (canvas.clientWidth || r.width) / r.width;
  return [(e.clientX - r.left) * k, (e.clientY - r.top) * k];
}

export function curveControl({ values, set }) {
  const root = Object.assign(document.createElement("div"), { className: "curve-control" });
  root.dataset.custom = "curve";
  const tabs = Object.assign(document.createElement("div"), { className: "effect-segment curve-tabs" });
  CHANNELS.forEach(([key, label]) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "fmt-btn", textContent: label });
    b.dataset.channel = key;
    b.onclick = () => set({ channel: key }, true);
    tabs.appendChild(b);
  });
  const canvas = Object.assign(document.createElement("canvas"), { className: "curve-square", title: "Click the line to add a point; drag; double-click a point to take it away" });
  root.append(tabs, canvas);
  const PAD = 6;

  let shown = null;
  const channel = () => (shown && shown.channel) || "rgb";
  const pointsOf = (v, key) => (v[key] && v[key].length >= 2 ? v[key] : [[0, 0], [100, 100]]).map((p) => [...p]);
  const toXY = (p, w, h) => [PAD + (p[0] / 100) * (w - 2 * PAD), h - PAD - (p[1] / 100) * (h - 2 * PAD)];
  const fromXY = (x, y, w, h) => [((x - PAD) / (w - 2 * PAD)) * 100, ((h - PAD - y) / (h - 2 * PAD)) * 100];

  function paint(v) {
    shown = v;
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.channel === channel()));
    const { g, w, h } = fit(canvas, (w) => Math.round(w * 0.75));
    g.clearRect(0, 0, w, h);
    g.strokeStyle = uiColour("--line"); g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { // quarters
      const x = Math.round(PAD + (i / 4) * (w - 2 * PAD)) + 0.5, y = Math.round(PAD + (i / 4) * (h - 2 * PAD)) + 0.5;
      g.beginPath(); g.moveTo(x, PAD); g.lineTo(x, h - PAD); g.moveTo(PAD, y); g.lineTo(w - PAD, y); g.stroke();
    }
    g.strokeRect(PAD + 0.5, PAD + 0.5, w - 2 * PAD - 1, h - 2 * PAD - 1);
    const line = (key, alpha, width) => {
      const f = curveFn(pointsOf(v, key));
      g.globalAlpha = alpha; g.strokeStyle = ink(key); g.lineWidth = width;
      g.beginPath();
      for (let i = 0; i <= 100; i++) { const [x, y] = toXY([i, f(i / 100) * 100], w, h); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); g.globalAlpha = 1;
    };
    CURVE_KEYS.filter((k) => k !== channel()).forEach((k) => line(k, 0.25, 1)); // (the others, faint)
    line(channel(), 1, 1.5);
    g.fillStyle = uiColour("--panel"); g.strokeStyle = ink(channel()); g.lineWidth = 1.5;
    pointsOf(v, channel()).forEach((p) => { const [x, y] = toXY(p, w, h); g.beginPath(); g.arc(x, y, 3.5, 0, Math.PI * 2); g.fill(); g.stroke(); });
  }

  // Dragging a point (a new one if the press isn't on one)
  canvas.addEventListener("pointerdown", (e) => {
    if (!shown || e.button !== 0) return;
    const key = channel(), w = canvas.clientWidth, h = parseFloat(canvas.style.height) || w * 0.75;
    let pts = pointsOf(shown, key);
    const [mx, my] = at(canvas, e);
    let i = pts.findIndex((p) => { const [x, y] = toXY(p, w, h); return Math.hypot(x - mx, y - my) < 8; });
    if (i < 0) {
      const [px, py] = fromXY(mx, my, w, h);
      if (px <= 1 || px >= 99) return;
      pts.push([Math.round(px), Math.round(Math.max(0, Math.min(100, py)))]);
      pts.sort((a, b) => a[0] - b[0]);
      i = pts.findIndex((p) => p[0] === Math.round(px));
      set({ [key]: pts.map((p) => [...p]) }, false);
    }
    canvas.setPointerCapture(e.pointerId);
    const end = i === 0 || i === pts.length - 1;
    let gone = false;
    const move = (ev) => {
      const [x, y] = at(canvas, ev);
      const [px, py] = fromXY(x, y, w, h);
      gone = !end && (py < -15 || py > 115); // (dragged off the square: taken away)
      const next = pts.map((p) => [...p]);
      const lo = end ? next[i][0] : next[i - 1][0] + 1, hi = end ? next[i][0] : next[i + 1][0] - 1;
      next[i] = [Math.round(Math.max(lo, Math.min(hi, px))), Math.round(Math.max(0, Math.min(100, py)))];
      if (gone) next.splice(i, 1);
      set({ [key]: next }, false);
      if (!gone) pts = next;
    };
    const up = (ev) => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      if (gone) { const next = pts.map((p) => [...p]); next.splice(i, 1); set({ [key]: next }, true); }
      else set({ [key]: pts.map((p) => [...p]) }, true);
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
  });
  canvas.addEventListener("dblclick", (e) => { // a point: taken away
    if (!shown) return;
    const key = channel(), w = canvas.clientWidth, h = parseFloat(canvas.style.height) || w * 0.75;
    const pts = pointsOf(shown, key), [mx, my] = at(canvas, e);
    const i = pts.findIndex((p) => { const [x, y] = toXY(p, w, h); return Math.hypot(x - mx, y - my) < 8; });
    if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); set({ [key]: pts }, true); }
  });
  new ResizeObserver(() => shown && paint(shown)).observe(canvas);
  root.paint = paint;
  paint(values());
  return root;
}

export function wheelsControl({ values, set }, parts) {
  const root = Object.assign(document.createElement("div"), { className: "wheels-control" });
  root.dataset.custom = "wheels";
  let shown = null;
  const wheels = parts.map(([key, label]) => {
    const box = Object.assign(document.createElement("div"), { className: "wheel" });
    const canvas = Object.assign(document.createElement("canvas"), { className: "wheel-disc", title: `${label}: drag for a colour (further out = more); double-click: none` });
    const name = Object.assign(document.createElement("div"), { className: "wheel-name", textContent: label });
    const lum = Object.assign(document.createElement("input"), { type: "range", min: -100, max: 100, step: 1, className: "wheel-lum", title: `${label}: darker ↔ lighter (double-click: back to the middle)` });
    lum.addEventListener("input", () => set({ [key + "Lum"]: parseFloat(lum.value) }, false));
    lum.addEventListener("change", () => set({ [key + "Lum"]: parseFloat(lum.value) }, true));
    lum.addEventListener("dblclick", () => { lum.value = "0"; set({ [key + "Lum"]: 0 }, true); });
    box.append(canvas, name, lum);
    root.appendChild(box);

    const paint = (v) => {
      const { g, w } = fit(canvas, (w) => w);
      const c = w / 2, r = w / 2 - 4;
      g.clearRect(0, 0, w, w);
      const hues = g.createConicGradient(0, c, c); // (clockwise on screen from the right; hue counts the other way)
      for (let f = 0; f <= 12; f++) hues.addColorStop(f / 12, `hsl(${(360 - f * 30) % 360} 80% 55%)`);
      g.fillStyle = hues; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
      const middle = g.createRadialGradient(c, c, 0, c, c, r);
      middle.addColorStop(0, "rgba(128,128,128,1)"); middle.addColorStop(1, "rgba(128,128,128,0)");
      g.fillStyle = middle; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = uiColour("--line"); g.lineWidth = 1; g.stroke();
      const hue = (v[key + "Hue"] || 0) * Math.PI / 180, amount = (v[key + "Amount"] || 0) / 100;
      const x = c + Math.cos(hue) * amount * r, y = c - Math.sin(hue) * amount * r;
      g.lineWidth = 2; g.strokeStyle = "#fff"; g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 1; g.strokeStyle = "#000"; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.stroke();
      name.textContent = amount > 0 ? `${label} ${Math.round(amount * 100)}` : label;
      if (document.activeElement !== lum) lum.value = String(v[key + "Lum"] || 0);
    };
    const pick = (e) => {
      const [mx, my] = at(canvas, e), w = canvas.clientWidth, c = w / 2, r = w / 2 - 4;
      const dx = mx - c, dy = c - my;
      const hue = Math.round(((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360);
      const amount = Math.round(Math.min(1, Math.hypot(dx, dy) / r) * 100);
      return { [key + "Hue"]: hue, [key + "Amount"]: amount };
    };
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      canvas.setPointerCapture(e.pointerId);
      set(pick(e), false);
      const move = (ev) => set(pick(ev), false);
      const up = (ev) => { canvas.removeEventListener("pointermove", move); canvas.removeEventListener("pointerup", up); set(pick(ev), true); };
      canvas.addEventListener("pointermove", move);
      canvas.addEventListener("pointerup", up);
    });
    canvas.addEventListener("dblclick", () => set({ [key + "Amount"]: 0 }, true));
    new ResizeObserver(() => shown && paint(shown)).observe(canvas);
    return paint;
  });
  root.paint = (v) => { shown = v; wheels.forEach((paint) => paint(v)); };
  root.paint(values());
  return root;
}
