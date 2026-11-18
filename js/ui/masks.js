// Masks on the canvas (js/masks.js has the record and the drawing): adding, picking and removing them, the handles of a
// Fade (its full and none lines) and a Round mask (its middle, its edge, the feather inside dashed), and the red
// overlay showing where the picked mask is while it's being shaped or painted.
import { state, changed, commit, currentItem, currentLayer } from '../state.js';
import { newMask, maskCanvas } from '../masks.js';
import { subjectMask, cutoutStatus } from '../cutout.js';
import { getPicture } from '../media.js';
import { drawPlaced, layerFrame } from '../render.js';
import { toPhoto, toFrame, setTool, brushStroking } from './brush.js';
import { toast } from './toast.js';

// The picked mask on the photo being edited (null when none)
export function pickedMask() {
  const layer = currentLayer();
  return (layer && (layer.masks || []).find((m) => m.id === state.maskId)) || null;
}
const ready = () => {
  const item = currentItem(), layer = currentLayer();
  const pic = layer && getPicture(layer.mediaId);
  return item && layer && pic ? { item, layer, pic } : null;
};

export async function addMask(kind) {
  const r = ready();
  if (!r) { toast("Pick a photo first"); return; }
  const m = newMask(kind);
  if (kind === "subject") {
    const id = await subjectMask(r.layer);
    if (!id) { toast(cutoutStatus.error || "The subject couldn't be found"); return; }
    m.maskId = id;
  }
  const layer = currentLayer() || r.layer; // (found again: the project may have changed while the subject was found)
  layer.masks = [...(layer.masks || []), m];
  state.maskId = m.id;
  state.photoPicked = true;
  changed("project");
  commit();
  if (kind === "brush") setTool("mask");
}
export function pickMask(id) {
  state.maskId = state.maskId === id ? null : id;
  const m = pickedMask();
  if (state.tool === "mask" && !(m && m.kind === "brush")) setTool(null);
  changed("view");
}
export function removeMask(layer, id) {
  layer.masks = (layer.masks || []).filter((m) => m.id !== id);
  if (state.maskId === id) { state.maskId = null; if (state.tool === "mask") state.tool = null; }
  changed("project");
  commit();
}

// ---- Handles

let drag = null; // { m, part, start, line / round as they were }
const HIT = 9;
const shown = () => state.tab === "adjust" && !state.tool && pickedMask() && ["linear", "radial"].includes(pickedMask().kind);
const frac = (r, f, p) => { const q = toPhoto(r, f, p); return { x: q.x / r.pic.width, y: q.y / r.pic.height }; };
const at = (r, f, x, y) => toFrame(r, f, { x: x * r.pic.width, y: y * r.pic.height });

function handles(r, f, m) {
  if (m.kind === "linear") {
    const { x0, y0, x1, y1 } = m.line;
    return [["a", at(r, f, x0, y0)], ["b", at(r, f, x1, y1)], ["mid", at(r, f, (x0 + x1) / 2, (y0 + y1) / 2)]];
  }
  const { cx, cy, rx, ry } = m.round;
  return [["c", at(r, f, cx, cy)], ["rx", at(r, f, cx + rx, cy)], ["rx-", at(r, f, cx - rx, cy)], ["ry", at(r, f, cx, cy + ry)], ["ry-", at(r, f, cx, cy - ry)]];
}

// Pressed on the canvas: a handle of the picked mask (true: taken)
export function maskDown(e, f, p) {
  if (!shown() || e.button !== 0) return false;
  const r = ready(), m = pickedMask();
  if (!r) return false;
  const hit = handles(r, f, m).find(([, q]) => Math.hypot(q.x - p.x, q.y - p.y) < HIT);
  if (!hit) return false;
  drag = { m, part: hit[0], start: frac(r, f, p), was: JSON.parse(JSON.stringify(m.kind === "linear" ? m.line : m.round)), r, f };
  return true;
}
export function maskMove(e, f, p) {
  if (!drag) {
    // (the pointer over a handle: a hand)
    if (!shown()) return false;
    const r = ready();
    if (!r) return false;
    const over = handles(r, f, pickedMask()).some(([, q]) => Math.hypot(q.x - p.x, q.y - p.y) < HIT);
    return over ? "grab" : false;
  }
  const { m, part, start, was, r } = drag;
  const now = frac(r, drag.f, p), dx = now.x - start.x, dy = now.y - start.y;
  if (m.kind === "linear") {
    const L = m.line;
    if (part === "a" || part === "mid") { L.x0 = was.x0 + dx; L.y0 = was.y0 + dy; }
    if (part === "b" || part === "mid") { L.x1 = was.x1 + dx; L.y1 = was.y1 + dy; }
  } else {
    const R = m.round;
    if (part === "c") { R.cx = was.cx + dx; R.cy = was.cy + dy; }
    if (part === "rx" || part === "rx-") R.rx = Math.max(0.01, Math.abs(now.x - R.cx));
    if (part === "ry" || part === "ry-") R.ry = Math.max(0.01, Math.abs(now.y - R.cy));
  }
  changed("look");
  return "grabbing";
}
export function maskUp() {
  if (!drag) return false;
  drag = null;
  changed("project");
  commit();
  return true;
}

// ---- Drawing: the overlay while shaping / painting, and the handles

export function drawMasks(ctx, f) {
  const m = pickedMask(), r = ready();
  if (!m || !r || state.tab !== "adjust") return;
  // Red where the mask is, while it's dragged or painted
  if (drag || (state.tool === "mask" && brushStroking() && !m.effect)) { // (an effect shows itself as it's painted)
    const side = 600, k = side / Math.max(r.pic.width, r.pic.height);
    const mask = maskCanvas(m, Math.max(1, Math.round(r.pic.width * k)), Math.max(1, Math.round(r.pic.height * k)));
    if (mask) {
      const red = mask.getContext("2d");
      red.globalCompositeOperation = "source-in";
      red.fillStyle = "rgba(230, 40, 70, 1)";
      red.fillRect(0, 0, mask.width, mask.height);
      const rect = layerFrame(r.item, r.layer, f.w, f.h);
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, f.w, f.h); ctx.clip();
      ctx.globalAlpha = 0.45;
      ctx.translate(rect.x, rect.y);
      drawPlaced(ctx, mask, r.layer.crop, rect.w, rect.h);
      ctx.restore();
    }
  }
  if (!shown()) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(-12, -12, f.w + 24, f.h + 24); ctx.clip(); // (the lines stop just past the slide)
  const line = (pts, dash = []) => {
    for (const [colour, w] of [["rgba(0,0,0,0.55)", 3], ["#fff", 1.5]]) {
      ctx.strokeStyle = colour; ctx.lineWidth = w; ctx.setLineDash(dash);
      ctx.beginPath(); pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke();
    }
    ctx.setLineDash([]);
  };
  if (m.kind === "linear") {
    const { x0, y0, x1, y1 } = m.line;
    // the full and none lines, across the photo (at right angles to the fade), and the fade between them
    const dx = x1 - x0, dy = (y1 - y0) * (r.pic.height / r.pic.width), n = Math.hypot(dx, dy) || 1;
    const px = (-dy / n) * 2, py = ((dx / n) * 2) * (r.pic.width / r.pic.height);
    [[x0, y0], [x1, y1]].forEach(([x, y], i) => line([at(r, f, x - px, y - py), at(r, f, x + px, y + py)], i ? [5, 4] : []));
    line([at(r, f, x0, y0), at(r, f, x1, y1)], [2, 3]);
  } else {
    const { cx, cy, rx, ry, feather } = m.round;
    const ring = (k) => Array.from({ length: 65 }, (_, i) => { const a = (i / 64) * Math.PI * 2; return at(r, f, cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k); });
    line(ring(1));
    if (feather > 0) line(ring(Math.max(0.02, 1 - feather / 100)), [4, 4]);
  }
  handles(r, f, m).forEach(([part, q]) => {
    ctx.beginPath(); ctx.arc(q.x, q.y, part === "mid" || part === "c" ? 6 : 5, 0, Math.PI * 2);
    ctx.fillStyle = part === "b" ? "rgba(0,0,0,0.55)" : "#fff"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = part === "b" ? "#fff" : "rgba(0,0,0,0.6)"; ctx.stroke();
  });
  ctx.restore();
}
