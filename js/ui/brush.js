// The touch-up brushes (Tom, 2026-11-18), picked in the Editor's Tools fold, painted on the canvas over the picked photo:
// - Edge brush: tidies a cut-out (js/cutout.js). Erase takes more away, Restore brings the photo back. While it's in
//   hand the whole photo shows faintly under the cut-out, so you can see what to bring back.
// - Spot heal: brush over a spot (a pimple, a crumb, dust) and on letting go it's filled from the photo nearby: the
//   best-matching patch close by is copied in, then its colour is blended into the edges (like a healing brush).
// Neither changes the photo itself: the cut-out is a mask, and the touch-ups are a picture the photo's size laid over
// it before the look (item.retouch = { patchId }). Each stroke is one undo step and is saved as a new picture in the
// media store (so undo just points back at the last one).
// Size (on screen) and Softness are this browser's (localStorage). Esc puts the brush down.
import { state, changed, commit, currentItem, currentLayer } from '../state.js';
import { getPicture, loadPicture, putPicture } from '../media.js';
import { dbPut } from '../store.js';
import { newId } from '../project.js';
import { photoBox, turn, layerFrame } from '../render.js';

const PREFS_KEY = "ans_photo_brush";
export const brush = { size: 40, softness: 50, edge: "erase" }; // edge: "erase" | "restore"
try { Object.assign(brush, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}")); } catch (e) { /* defaults */ }
export function setBrush(key, value) {
  brush[key] = value;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(brush)); } catch (e) {}
  changed("view");
}

let pointer = null;   // where the pointer is over the canvas (frame pixels), for the brush's circle
let stroke = null;    // the stroke being painted

// Whether a brush is in hand and can be used on the picked photo now (else it's put down)
export function brushReady() {
  if (!state.tool) return null;
  const item = currentItem(), layer = currentLayer();
  if (!item || !layer || !state.photoPicked || item.span > 1 || (item.kind === "video" && layer === item)) return null;
  if (state.tool === "edge" && !(layer.cutout && layer.cutout.on && layer.cutout.maskId)) return null;
  const pic = getPicture(layer.mediaId);
  return pic ? { item, layer, pic } : null;
}

export function pickTool(tool) {
  state.tool = state.tool === tool ? null : tool;
  if (state.tool) state.photoPicked = true;
  changed("view");
}
// Esc puts the brush down; [ and ] make it smaller and bigger
document.addEventListener("keydown", (e) => {
  if (!state.tool || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")) return;
  if (e.key === "Escape") { state.tool = null; changed("view"); }
  else if (e.key === "[" || e.key === "]") { e.preventDefault(); setBrush("size", Math.max(4, Math.min(300, Math.round(brush.size * (e.key === "]" ? 1.2 : 1 / 1.2))))); }
});

// A point on the frame (frame pixels) to the photo's own pixels, and the brush's radius there
function toPhoto(ready, f, p) {
  const { item, layer, pic } = ready;
  const rect = layerFrame(item, layer, f.w, f.h);
  const box = photoBox(layer.crop, pic.width, pic.height, rect.w, rect.h);
  let [x, y] = turn(p.x - rect.x - box.cx, p.y - rect.y - box.cy, -box.rotation);
  if (layer.crop.flipH) x = -x;
  if (layer.crop.flipV) y = -y;
  const scale = pic.width / box.w;
  return { x: (x / box.w + 0.5) * pic.width, y: (y / box.h + 0.5) * pic.height, r: (brush.size / 2) * scale };
}

// A soft round dab: full in the middle, fading over the outer `softness` part
function dab(ctx, x, y, r, colour) {
  const inner = Math.max(0, Math.min(0.99, 1 - brush.softness / 100));
  const g = ctx.createRadialGradient(x, y, r * inner, x, y, r);
  g.addColorStop(0, colour);
  g.addColorStop(1, colour.replace(/[\d.]+\)$/, "0)"));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// Dabs from the last point to this one, spaced a quarter of the brush apart
function along(from, to, r, fn) {
  const d = Math.hypot(to.x - from.x, to.y - from.y), step = Math.max(1, r * 0.25), n = Math.max(1, Math.ceil(d / step));
  for (let i = 1; i <= n; i++) fn(from.x + ((to.x - from.x) * i) / n, from.y + ((to.y - from.y) * i) / n);
}

// ---- The pointer (called by js/ui/stage.js while a brush is in hand: true = handled)

export function brushDown(e, f, p) {
  const ready = brushReady();
  if (!ready || e.button !== 0) return false;
  pointer = p;
  const at = toPhoto(ready, f, p);
  if (state.tool === "edge") {
    const mask = getPicture(ready.layer.cutout.maskId);
    if (!mask) { loadPicture(ready.layer.cutout.maskId); return true; }
    // A copy of the mask to paint on, shown as it's painted (a new picture: undo keeps the old one)
    const canvas = document.createElement("canvas");
    canvas.width = mask.full.width;
    canvas.height = mask.full.height;
    canvas.getContext("2d").drawImage(mask.full, 0, 0);
    const id = newId("m");
    const picture = { full: canvas, preview: canvas, width: mask.width, height: mask.height, name: mask.name, rev: 0 };
    putPicture(id, picture);
    ready.layer.cutout = { maskId: id, on: true };
    stroke = { tool: "edge", ready, f, last: at, canvas, picture, id, sx: canvas.width / ready.pic.width };
    edgeDab(at);
  } else {
    // Spot heal: the brushed part is marked as you go, and healed on letting go
    const marks = document.createElement("canvas");
    marks.width = ready.pic.width;
    marks.height = ready.pic.height;
    stroke = { tool: "heal", ready, f, last: at, marks, x0: at.x, y0: at.y, x1: at.x, y1: at.y, r: at.r, path: [p] };
    healDab(at);
  }
  changed("look");
  return true;
}

export function brushMove(e, f, p) {
  if (!state.tool) return false;
  pointer = p;
  if (stroke) {
    const at = toPhoto(stroke.ready, stroke.f, p);
    if (stroke.tool === "edge") edgeLine(stroke.last, at);
    else { along(stroke.last, at, at.r, (x, y) => healDab({ x, y, r: at.r })); stroke.path.push(p); }
    stroke.last = at;
    changed("look");
  } else changed("look"); // (the brush's circle follows the pointer)
  return true;
}

export async function brushUp() {
  if (!stroke) return !!state.tool;
  const s = stroke;
  stroke = null;
  if (s.tool === "edge") {
    const blob = await new Promise((res) => s.canvas.toBlob(res, "image/png"));
    await dbPut("media", { id: s.id, projectId: state.project.id, kind: "mask", name: s.picture.name || "Cut-out.png", type: "image/png", blob, width: s.picture.width, height: s.picture.height, added: Date.now() });
    changed("project");
    commit();
  } else {
    await heal(s);
  }
  return true;
}

export function brushLeave() { if (!stroke && pointer) { pointer = null; changed("look"); } }

// ---- Edge brush

function edgeDab(at) {
  const ctx = stroke.canvas.getContext("2d");
  ctx.globalCompositeOperation = brush.edge === "erase" ? "destination-out" : "source-over";
  dab(ctx, at.x * stroke.sx, at.y * stroke.sx, at.r * stroke.sx, "rgba(255,255,255,1)");
  ctx.globalCompositeOperation = "source-over";
  stroke.picture.rev++;
}
function edgeLine(from, to) {
  along({ x: from.x, y: from.y }, { x: to.x, y: to.y }, to.r, (x, y) => edgeDab({ x, y, r: to.r }));
}

// ---- Spot heal

function healDab(at) {
  dab(stroke.marks.getContext("2d"), at.x, at.y, at.r, "rgba(0,0,0,1)");
  stroke.x0 = Math.min(stroke.x0, at.x - at.r); stroke.y0 = Math.min(stroke.y0, at.y - at.r);
  stroke.x1 = Math.max(stroke.x1, at.x + at.r); stroke.y1 = Math.max(stroke.y1, at.y + at.r);
}

// Fill the brushed part from nearby: (1) the patch close by whose surroundings match best, (2) copied in, (3) the
// difference along the edge spread smoothly over it (so its colour and light blend in), (4) laid in softly.
async function heal(s) {
  const { layer, pic } = s.ready;
  const W = pic.width, H = pic.height;
  const pad = Math.ceil(s.r * 0.6) + 2;
  const x0 = Math.max(0, Math.floor(s.x0) - pad), y0 = Math.max(0, Math.floor(s.y0) - pad);
  const x1 = Math.min(W, Math.ceil(s.x1) + pad), y1 = Math.min(H, Math.ceil(s.y1) + pad);
  const w = x1 - x0, h = y1 - y0;
  if (w < 2 || h < 2) { changed("look"); return; }
  // The photo as it is now (with earlier touch-ups), around the spot and far enough out to find a patch
  const old = layer.retouch && layer.retouch.patchId && getPicture(layer.retouch.patchId);
  const reach = Math.max(w, h) * 3;
  const ax = Math.max(0, x0 - reach), ay = Math.max(0, y0 - reach), aw = Math.min(W, x1 + reach) - ax, ah = Math.min(H, y1 + reach) - ay;
  const area = document.createElement("canvas");
  area.width = aw; area.height = ah;
  const actx = area.getContext("2d", { willReadFrequently: true });
  actx.drawImage(pic.full, -ax, -ay);
  if (old) actx.drawImage(old.full, -ax, -ay, W, H);
  const img = actx.getImageData(0, 0, aw, ah).data;
  const m = s.marks.getContext("2d").getImageData(x0, y0, w, h).data;
  const M = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) M[i] = m[i * 4 + 3] / 255;
  const ox = x0 - ax, oy = y0 - ay; // (the spot's place in the area)
  const px = (x, y, k) => img[((y + oy) * aw + (x + ox)) * 4 + k];
  const pxAt = (x, y, k) => img[(y * aw + x) * 4 + k];

  // The band just round the brushed part (what the patch's surroundings must match)
  const band = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (M[y * w + x] > 0.02) continue;
    let near = false;
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && M[yy * w + xx] > 0.02) { near = true; break; }
    }
    if (near) band.push(x, y);
  }
  // (1) The best patch: tried in 24 directions at three distances
  let best = null;
  const step = Math.max(1, Math.floor(band.length / 2 / 400)) * 2; // (up to ~400 band points compared)
  for (const dist of [1.1, 1.6, 2.3]) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const dx = Math.round(Math.cos(a) * Math.max(w, h) * dist), dy = Math.round(Math.sin(a) * Math.max(w, h) * dist);
    if (x0 + dx - ax < 0 || y0 + dy - ay < 0 || x0 + dx + w - ax > aw || y0 + dy + h - ay > ah) continue;
    let cost = 0;
    for (let i = 0; i < band.length; i += step) {
      const x = band[i], y = band[i + 1];
      for (let c = 0; c < 3; c++) { const d = px(x, y, c) - pxAt(x + ox + dx, y + oy + dy, c); cost += d * d; }
    }
    if (!best || cost < best.cost) best = { dx, dy, cost };
  }
  if (!best) best = { dx: 0, dy: 0 };
  // (2) + (3) The patch, and the colour difference along the edge spread over it (worked out on a small grid, then
  // smoothly scaled up: it's a gentle change)
  const out = new ImageData(w, h);
  const G = Math.max(1, Math.ceil(Math.max(w, h) / 96)); // (grid step)
  const gw = Math.ceil(w / G), gh = Math.ceil(h / G);
  for (let c = 0; c < 3; c++) {
    const diff = new Float32Array(gw * gh), fixed = new Uint8Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
      const x = Math.min(w - 1, gx * G), y = Math.min(h - 1, gy * G);
      const edge = x === 0 || y === 0 || x >= w - G || y >= h - G || M[y * w + x] < 0.02;
      if (edge) { fixed[gy * gw + gx] = 1; diff[gy * gw + gx] = px(x, y, c) - pxAt(x + ox + best.dx, y + oy + best.dy, c); }
    }
    for (let it = 0; it < 400; it++) {
      for (let gy = 1; gy < gh - 1; gy++) for (let gx = 1; gx < gw - 1; gx++) {
        const i = gy * gw + gx;
        if (!fixed[i]) diff[i] = (diff[i - 1] + diff[i + 1] + diff[i - gw] + diff[i + gw]) / 4;
      }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1.001, x / G), fy = Math.min(gh - 1.001, y / G), ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
      const i = iy * gw + ix, j = Math.min(gw * gh - 1, i + gw);
      const d = (diff[i] * (1 - tx) + diff[Math.min(i + 1, gw * gh - 1)] * tx) * (1 - ty) + (diff[j] * (1 - tx) + diff[Math.min(j + 1, gw * gh - 1)] * tx) * ty;
      out.data[(y * w + x) * 4 + c] = pxAt(x + ox + best.dx, y + oy + best.dy, c) + d;
    }
  }
  // (4) Laid in where it was brushed, softly at the edges
  for (let i = 0; i < w * h; i++) out.data[i * 4 + 3] = Math.round(M[i] * 255);

  // The touch-ups picture: the last one plus this (a new picture, so undo keeps the old)
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (old) ctx.drawImage(old.full, 0, 0, W, H);
  const piece = document.createElement("canvas");
  piece.width = w; piece.height = h;
  piece.getContext("2d").putImageData(out, 0, 0);
  ctx.drawImage(piece, x0, y0);
  const id = newId("m");
  putPicture(id, { full: canvas, preview: canvas, width: W, height: H, name: "Touch-ups.png", rev: 0 });
  layer.retouch = { patchId: id };
  changed("project");
  commit();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
  await dbPut("media", { id, projectId: state.project.id, kind: "touch-ups", name: "Touch-ups.png", type: "image/png", blob, width: W, height: H, added: Date.now() });
}

// Take every touch-up off the picked photo (one undo step)
export function clearTouchUps(layer) {
  if (!layer || !layer.retouch) return;
  layer.retouch = null;
  changed("project");
  commit();
}

// ---- What the brush shows on the canvas (called by js/ui/stage.js after the slide is drawn, frame pixels)

export function drawBrush(ctx, f, ratio) {
  if (!brushReady() || !pointer) return;
  // Spot heal: the part brushed so far, lit while it's being painted
  if (stroke && stroke.tool === "heal") {
    ctx.save();
    ctx.strokeStyle = "rgba(220, 60, 90, 0.45)";
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = brush.size;
    ctx.beginPath();
    stroke.path.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    if (stroke.path.length === 1) ctx.lineTo(stroke.path[0].x + 0.1, stroke.path[0].y);
    ctx.stroke();
    ctx.restore();
  }
  // The brush's circle (its soft part inside a second, fainter ring)
  ctx.save();
  ctx.lineWidth = 1 / ratio;
  const r = brush.size / 2;
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath(); ctx.arc(pointer.x, pointer.y, r + 0.5, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath(); ctx.arc(pointer.x, pointer.y, r - 0.5, 0, Math.PI * 2); ctx.stroke();
  if (brush.softness > 5) {
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath(); ctx.arc(pointer.x, pointer.y, Math.max(1, r * (1 - brush.softness / 100)), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}
