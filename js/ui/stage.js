// The Edit view: the current slide big, at its fixed shape (1:1, or a row of squares for a
// panorama). Photos and texts behave like pictures in the lyric video app (its mediaFrame.js):
// click one to pick it and a dashed frame with corner squares shows while the pointer is over
// it; drag inside to move it, drag a corner to size it (around its middle; a photo keeps its
// shape unless Lock ratio is off, a text's corner sizes its font), and drag just outside a
// corner (or the ↻ under it) to turn it (Shift: 15° steps; it settles on upright and the
// quarter turns, ⌘ = free; double-click ↻: upright). Click the grey to let go (then only the slide
// shows). The part of a picked photo past the slide's edges shows faintly (never exported).
// Scroll / pinch over the photo zooms it; pinch / ⌘-scroll over the grey zooms the view.
//
// Guides (▦: thirds → grid → fine grid → off, per square) and snapping (🧲, on by default): a
// moved photo or text clicks onto the centre lines, the frame's edges, the guides and a
// panorama's seams (by its edges or middle), the line lights pink, and dragging on pulls it free.
// ⌘ held = no snapping. Guides are never exported.
import { state, changed, commit, currentItem, onChange, items } from '../state.js';
import { activeSet, aspectOf, isVideo } from '../project.js';
import { drawItem, drawPlaced, layoutText, textAt, photoBox, onBox, textBox, turn } from '../render.js';
import { lookedPicture, lookedFrame } from '../looks.js';
import { initVideoBar, videoFrame } from './videoBar.js';
import { getPicture, loadPicture } from '../media.js';
import { uiColour, onSkinChange } from './skin.js';

const PREFS_KEY = "ans_photo_guides";
const SNAP = 7;         // screen pixels before something clicks onto a line
const SNAP_MIDDLE = 11; // ...a little further for the exact middle (the line people want most)
const PAD = 48;         // room around the frame
const HANDLE = 8;       // a corner square's reach
const TURN_REACH = 24;  // how far outside a corner turning works
const KNOB = 30;        // the ↻ knob, under the bottom edge
const ROTATE_CURSOR = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M19 12a7 7 0 1 1-2.05-4.95' fill='none' stroke='white' stroke-width='4' stroke-linecap='round'/><path d='M19 12a7 7 0 1 1-2.05-4.95' fill='none' stroke='black' stroke-width='2' stroke-linecap='round'/><path d='M20 3v6h-6z' fill='black' stroke='white' stroke-width='1'/></svg>") 12 12, alias`;

let canvas, ctx, area;
let prefs = { grid: 1, magnet: true };
let viewZoom = 1;       // 1 = fit
let lit = [];           // lines something is snapped to: [{ axis, at }] (frame pixels)
let drag = null;
let hovering = false;   // the pointer is over the picked thing's frame (so its frame shows)
let wheelTimer = null;

export function initStage() {
  canvas = document.getElementById("stage-canvas");
  area = document.getElementById("edit-view");
  ctx = canvas.getContext("2d");
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") }; } catch (err) { /* defaults */ }
  new ResizeObserver(draw).observe(area);
  onChange(() => draw());
  onSkinChange(draw);
  document.fonts && document.fonts.addEventListener("loadingdone", draw);

  const guidesBtn = document.getElementById("btn-guides");
  const magnetBtn = document.getElementById("btn-magnet");
  const showPrefs = () => {
    const names = ["Guides: off", "Guides: thirds", "Guides: grid", "Guides: fine grid"];
    guidesBtn.classList.toggle("on", prefs.grid > 0);
    guidesBtn.title = `${names[prefs.grid]} (click: thirds → grid → fine grid → off)`;
    magnetBtn.classList.toggle("on", prefs.magnet);
    magnetBtn.title = prefs.magnet ? "Snapping on: things click onto the middle, edges and guides (hold ⌘ to move freely)" : "Snapping off";
  };
  const savePrefs = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (err) { /* not kept */ } showPrefs(); draw(); };
  guidesBtn.onclick = () => { prefs.grid = (prefs.grid + 1) % 4; savePrefs(); };
  magnetBtn.onclick = () => { prefs.magnet = !prefs.magnet; savePrefs(); };
  showPrefs();
  document.getElementById("btn-zoom-in").onclick = () => { viewZoom = Math.min(4, viewZoom * 1.25); draw(); };
  document.getElementById("btn-zoom-out").onclick = () => { viewZoom = Math.max(0.3, viewZoom / 1.25); draw(); };
  document.getElementById("btn-zoom-fit").onclick = () => { viewZoom = 1; draw(); };

  initVideoBar(draw);
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("pointerleave", () => { if (!drag && hovering) { hovering = false; draw(); } });
  canvas.addEventListener("wheel", wheel, { passive: false });
  canvas.addEventListener("dblclick", (e) => {
    const item = currentItem();
    if (!item) return;
    const f = frameRect(item), p = local(e, f);
    const picked = pickedBox(item, f);
    if (picked && zoneAt(picked.box, p) === "rotate") { setAngle(picked, 0); changed("project"); commit(); return; }
    const hit = textAt(ctx, item, f.w, f.h, p.x, p.y);
    if (hit) { pick("text", hit.id); state.tab = "text"; changed("view"); document.dispatchEvent(new CustomEvent("focus-text")); }
  });
}

// Where the frame sits on screen (CSS pixels): { x, y, w, h, pw } (pw: one slide's width; the
// set's shape, e.g. 4:5, times the panorama's slides)
function frameRect(item) {
  const W = area.clientWidth, H = area.clientHeight;
  const span = item ? item.span : 1;
  const a = aspectOf(activeSet(state.project).ratio);
  const fit = Math.min((W - PAD * 2) / (span * a), H - PAD * 2 - 30);
  const h = Math.max(40, fit * viewZoom), w = h * a * span;
  return { x: Math.round((W - w) / 2), y: Math.round((H - 30 - h) / 2), w, h, pw: h * a };
}

// ---- What's picked: the photo, a text, or nothing

function pick(kind, id = null) {
  state.photoPicked = kind === "photo";
  state.textId = kind === "text" ? id : null;
}

// The picked thing's box on the frame: { kind, box, text? } or null
function pickedBox(item, f) {
  if (state.textId) {
    const t = item.texts.find((x) => x.id === state.textId);
    return t ? { kind: "text", text: t, box: textBox(layoutText(ctx, t, f.w, f.h)) } : null;
  }
  if (state.photoPicked) {
    const pic = getPicture(item.mediaId);
    return pic ? { kind: "photo", box: photoBox(item.crop, pic.width, pic.height, f.w, f.h) } : null;
  }
  return null;
}

function setAngle(picked, degrees) {
  const a = Math.round((((degrees + 180) % 360 + 360) % 360 - 180) * 10) / 10; // (-180 … 180)
  if (picked.kind === "text") picked.text.rotation = a; else currentItem().crop.rotation = a;
}

// The corners of a turned box, on the frame: [[x, y] ×4] (tl, tr, bl, br)
function corners(box) {
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => {
    const [u, v] = turn((sx * box.w) / 2, (sy * box.h) / 2, box.rotation);
    return [box.cx + u, box.cy + v];
  });
}
const CORNER_NAMES = ["tl", "tr", "bl", "br"];
function knobAt(box) { const [u, v] = turn(0, box.h / 2 + KNOB, box.rotation); return [box.cx + u, box.cy + v]; }

// What part of the picked box a point is on: a corner name, "rotate", "inside" or null
function zoneAt(box, p) {
  const cs = corners(box);
  for (let i = 0; i < 4; i++) if (Math.hypot(p.x - cs[i][0], p.y - cs[i][1]) <= HANDLE) return CORNER_NAMES[i];
  const [kx, ky] = knobAt(box);
  if (Math.hypot(p.x - kx, p.y - ky) <= 11) return "rotate";
  if (onBox(box, p.x, p.y)) return "inside";
  if (cs.some(([x, y]) => Math.hypot(p.x - x, p.y - y) <= TURN_REACH)) return "rotate";
  return null;
}

// ---- Lines to snap to and to draw, along one side of the frame (frame pixels)

function guideLines(axis, item, f) {
  const lines = [];
  const squares = axis === "x" ? item.span : 1;
  for (let k = 0; k < squares; k++) {
    const o = axis === "x" ? k * f.pw : 0, s = axis === "x" ? f.pw : f.h;
    if (prefs.grid === 1) lines.push(o + s / 3, o + (2 * s) / 3);
    if (prefs.grid >= 2) {
      const cell = Math.min(f.pw, f.h) / (prefs.grid === 2 ? 6 : 12); // (square cells, out from the middle)
      for (let at = s / 2; at > 0.5; at -= cell) lines.push(o + at);
      for (let at = s / 2 + cell; at < s - 0.5; at += cell) lines.push(o + at);
    }
  }
  return lines;
}

function snapLines(axis, item, f) {
  const size = axis === "x" ? f.w : f.h;
  const middles = axis === "x" ? Array.from({ length: item.span }, (_, k) => (k + 0.5) * f.pw) : [f.h / 2];
  const seams = axis === "x" ? Array.from({ length: item.span - 1 }, (_, k) => (k + 1) * f.pw) : [];
  if (axis === "x" && item.span > 1) middles.push(f.w / 2);
  return { middles, others: [0, size, ...seams, ...guideLines(axis, item, f)] };
}

// The shift that snaps a box's edges or middle (its bounding box, frame pixels) onto the nearest
// line on each side; lights the lines it lands on
function snapBox(box, item, f, free) {
  if (!prefs.magnet || free) return { dx: 0, dy: 0 };
  const cs = corners(box);
  const xs = cs.map((c) => c[0]), ys = cs.map((c) => c[1]);
  const along = (axis, lo, hi) => {
    const { middles, others } = snapLines(axis, item, f);
    const points = [lo, (lo + hi) / 2, hi];
    let best = null;
    const tryLine = (line, reach) => points.forEach((p) => {
      const d = line - p;
      if (Math.abs(d) <= reach && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line };
    });
    middles.forEach((line) => tryLine(line, SNAP_MIDDLE));
    others.forEach((line) => tryLine(line, SNAP));
    if (best) lit.push({ axis, at: best.line });
    return best ? best.d : 0;
  };
  return { dx: along("x", Math.min(...xs), Math.max(...xs)), dy: along("y", Math.min(...ys), Math.max(...ys)) };
}

// ---- Pointer

const local = (e, f) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left - f.x, y: e.clientY - r.top - f.y }; };

function down(e) {
  const item = currentItem();
  if (!item || !getPicture(item.mediaId)) return;
  const f = frameRect(item);
  const p = local(e, f);
  canvas.setPointerCapture(e.pointerId);
  const picked = pickedBox(item, f);
  const zone = picked ? zoneAt(picked.box, p) : null;
  if (picked && zone && zone !== "inside") { startDrag(picked, zone, p, f); return; }

  // Otherwise: what's under the pointer (texts sit above the photo), picked and ready to move
  const hitText = textAt(ctx, item, f.w, f.h, p.x, p.y);
  const pic = getPicture(item.mediaId);
  const photo = photoBox(item.crop, pic.width, pic.height, f.w, f.h);
  if (hitText) {
    if (state.textId !== hitText.id) { pick("text", hitText.id); state.tab = "text"; changed("view"); }
  } else if (onBox(photo, p.x, p.y) && (state.photoPicked || (p.x >= 0 && p.y >= 0 && p.x <= f.w && p.y <= f.h))) {
    if (!state.photoPicked) { pick("photo"); changed("view"); }
  } else {
    if (state.textId || state.photoPicked) { pick(null); changed("view"); }
    return;
  }
  startDrag(pickedBox(item, f), "inside", p, f);
}

function startDrag(picked, zone, p, f) {
  const item = currentItem();
  hovering = true;
  drag = { kind: picked.kind, text: picked.text, zone, f, start: p, box: { ...picked.box }, crop: { ...item.crop }, textStart: picked.text ? { ...picked.text } : null, moved: false };
  if (zone === "rotate") drag.from = Math.atan2(p.y - picked.box.cy, p.x - picked.box.cx);
  canvas.style.cursor = zone === "inside" ? "grabbing" : zone === "rotate" ? ROTATE_CURSOR : canvas.style.cursor;
}

function move(e) {
  if (!drag) { hover(e); return; }
  const { f, box, zone } = drag;
  const item = currentItem();
  const p = local(e, f);
  let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
  if (!dx && !dy && !drag.moved) return;
  drag.moved = true;
  lit = [];
  const crop = item.crop, t = drag.text;

  if (zone === "rotate") {
    let a = (drag.kind === "text" ? drag.textStart.rotation : drag.crop.rotation) + ((Math.atan2(p.y - box.cy, p.x - box.cx) - drag.from) * 180) / Math.PI;
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    else if (!e.metaKey) { const q = Math.round(a / 90) * 90; if (Math.abs(a - q) < 3) a = q; } // (settles on upright / quarter turns)
    setAngle(drag, a);
    drag.angle = drag.kind === "text" ? t.rotation : crop.rotation;
  } else if (zone === "inside") {
    // Move: the middle follows the pointer, snapping its edges or middle to the lines
    const moved = { ...box, cx: box.cx + dx, cy: box.cy + dy };
    const snap = snapBox(moved, item, f, e.metaKey);
    const cx = moved.cx + snap.dx, cy = moved.cy + snap.dy;
    if (drag.kind === "text") { t.x = cx / f.w; t.y = cy / f.h; }
    else { crop.x = (cx - f.w / 2) / f.w; crop.y = (cy - f.h / 2) / f.h; }
  } else {
    // A corner: size around the middle (the pointer's move along the box's own sides)
    [dx, dy] = turn(dx, dy, -box.rotation);
    const sx = zone.endsWith("r") ? 1 : -1, sy = zone.startsWith("b") ? 1 : -1;
    const fx = Math.max(0.02, (box.w + 2 * sx * dx) / box.w), fy = Math.max(0.02, (box.h + 2 * sy * dy) / box.h);
    const even = Math.abs(fx - 1) > Math.abs(fy - 1) ? fx : fy;
    if (drag.kind === "text") t.size = Math.min(0.8, Math.max(0.01, drag.textStart.size * even));
    else if (crop.lockRatio !== false) crop.zoom = Math.min(12, Math.max(0.03, drag.crop.zoom * even));
    else {
      crop.zoom = Math.min(12, Math.max(0.03, drag.crop.zoom * fy));
      crop.stretch = Math.min(8, Math.max(0.1, ((drag.crop.stretch || 1) * fx) / fy));
    }
  }
  changed("look");
}

function up() {
  if (!drag) return;
  const moved = drag.moved;
  drag = null;
  lit = [];
  canvas.style.cursor = "";
  if (moved) commit(); // (one drag = one undo step)
  draw();
}

function hover(e) {
  const item = currentItem();
  if (!item) { canvas.style.cursor = ""; return; }
  const f = frameRect(item);
  const p = local(e, f);
  const picked = pickedBox(item, f);
  const zone = picked ? zoneAt(picked.box, p) : null;
  const over = !!zone;
  if (over !== hovering) { hovering = over; draw(); }
  if (zone === "rotate") canvas.style.cursor = ROTATE_CURSOR;
  else if (zone === "tl" || zone === "br") canvas.style.cursor = "nwse-resize";
  else if (zone === "tr" || zone === "bl") canvas.style.cursor = "nesw-resize";
  else if (zone === "inside" || textAt(ctx, item, f.w, f.h, p.x, p.y)) canvas.style.cursor = "move";
  else {
    const pic = getPicture(item.mediaId);
    const onSlide = p.x >= 0 && p.y >= 0 && p.x <= f.w && p.y <= f.h;
    canvas.style.cursor = pic && onSlide && onBox(photoBox(item.crop, pic.width, pic.height, f.w, f.h), p.x, p.y) ? "move" : "";
  }
}

// Scroll / pinch over the photo: zoom the photo around the pointer. Pinch (or ⌘-scroll) over the
// grey around the slide: zoom the view.
function wheel(e) {
  const item = currentItem();
  if (!item || !getPicture(item.mediaId)) return;
  const f = frameRect(item);
  const p = local(e, f);
  const pic = getPicture(item.mediaId);
  const onPhoto = onBox(photoBox(item.crop, pic.width, pic.height, f.w, f.h), p.x, p.y) && p.x >= 0 && p.y >= 0 && p.x <= f.w && p.y <= f.h;
  if (e.metaKey || !onPhoto) {
    if (!e.metaKey && !e.ctrlKey) return; // (a plain scroll over the grey does nothing)
    e.preventDefault();
    viewZoom = Math.min(4, Math.max(0.3, viewZoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))));
    draw();
    return;
  }
  e.preventDefault();
  const crop = item.crop;
  const before = crop.zoom;
  crop.zoom = Math.min(12, Math.max(0.03, before * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025))));
  const k = crop.zoom / before;
  const cx = f.w / 2 + crop.x * f.w, cy = f.h / 2 + crop.y * f.h;
  crop.x = (p.x + (cx - p.x) * k - f.w / 2) / f.w;
  crop.y = (p.y + (cy - p.y) * k - f.h / 2) / f.h;
  changed("look");
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(commit, 350);
}

// ---- Drawing

let queued = false;
export function draw() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; paint(); });
}

function paint() {
  const ratio = window.devicePixelRatio || 1;
  const W = area.clientWidth, H = area.clientHeight;
  if (canvas.width !== Math.round(W * ratio) || canvas.height !== Math.round(H * ratio)) {
    canvas.width = Math.round(W * ratio);
    canvas.height = Math.round(H * ratio);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const item = currentItem();
  document.getElementById("empty-state").hidden = items().length > 0;
  document.getElementById("before-hint").hidden = !state.before;
  if (!item) return;
  const pic = getPicture(item.mediaId);
  if (!pic) { loadPicture(item.mediaId).then(draw); return; }
  const f = frameRect(item);
  ctx.setTransform(ratio, 0, 0, ratio, f.x * ratio, f.y * ratio);

  // A video: the frame at the playhead, with its look (worked out once for both draws below)
  const raw = isVideo(item) ? videoFrame(item) : null;
  const frame = raw && !state.before ? lookedFrame(item, raw, "preview", state.project.seed) : raw;

  // The photo past the frame's edges, faint: only while the photo is picked (click the grey to
  // see just the slide)
  if (state.photoPicked) {
    const looked = frame || (state.before ? pic.preview : lookedPicture(item, "preview", state.project.seed));
    ctx.save();
    ctx.globalAlpha = 0.3;
    drawPlaced(ctx, looked, item.crop, f.w, f.h);
    ctx.restore();
  }

  drawItem(ctx, item, f.w, f.h, { before: state.before, seed: state.project.seed, frame, frameLooked: true });

  // Guides, seams, the frame
  const hair = 1 / ratio;
  const line = (axis, at, colour, width = hair, dash = null) => {
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    if (axis === "x") { ctx.moveTo(at, 0); ctx.lineTo(at, f.h); } else { ctx.moveTo(0, at); ctx.lineTo(f.w, at); }
    ctx.stroke();
    ctx.restore();
  };
  const guide = "rgba(128, 128, 128, 0.55)";
  guideLines("x", item, f).forEach((at) => line("x", at, guide));
  guideLines("y", item, f).forEach((at) => line("y", at, guide));
  for (let k = 1; k < item.span; k++) line("x", k * f.pw, "rgba(120,120,120,0.95)", 1.5, [6, 5]);
  ctx.strokeStyle = uiColour("--stage-edge") || "#000";
  ctx.lineWidth = 1;
  ctx.strokeRect(-0.5, -0.5, f.w + 1, f.h + 1);
  lit.forEach((l) => line(l.axis, l.at, uiColour("--snap") || "#ff2d8a", 1.5));

  // Slide numbers on a panorama
  if (item.span > 1) {
    const list = items();
    const first = list.slice(0, list.indexOf(item)).reduce((n, i) => n + i.span, 1);
    ctx.font = "700 11px Helvetica, Arial, sans-serif";
    for (let k = 0; k < item.span; k++) {
      const label = String(first + k);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.beginPath();
      ctx.roundRect(k * f.pw + 6, 6, ctx.measureText(label).width + 10, 16, 8);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, k * f.pw + 11, 18);
    }
  }

  // The picked photo / text: its dashed frame, corner squares and ↻ (while the pointer is on it)
  const picked = pickedBox(item, f);
  if (picked && (hovering || drag)) {
    const { box } = picked;
    const accent = uiColour("--accent-ink") || "#1f4fbf";
    ctx.save();
    ctx.translate(box.cx, box.cy);
    ctx.rotate((box.rotation * Math.PI) / 180);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(-box.w / 2, -box.h / 2, box.w, box.h);
    ctx.setLineDash([]);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect((sx * box.w) / 2 - 5, (sy * box.h) / 2 - 5, 10, 10);
      ctx.strokeRect((sx * box.w) / 2 - 5, (sy * box.h) / 2 - 5, 10, 10);
    });
    // the ↻ knob under the middle
    ctx.beginPath();
    ctx.moveTo(0, box.h / 2);
    ctx.lineTo(0, box.h / 2 + KNOB - 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, box.h / 2 + KNOB, 10, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.stroke();
    ctx.rotate((-box.rotation * Math.PI) / 180);
    const [kx, ky] = turn(0, box.h / 2 + KNOB, box.rotation);
    ctx.fillStyle = accent;
    ctx.font = "700 13px Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("↻", kx, ky + 1);
    // the angle, while turning
    if (drag && drag.zone === "rotate") {
      const label = `${Math.round(box.rotation)}°`;
      ctx.font = "700 12px Helvetica, Arial, sans-serif";
      const w = ctx.measureText(label).width + 12;
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.beginPath();
      ctx.roundRect(kx - w / 2, ky + 16, w, 20, 10);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(label, kx, ky + 26);
    }
    ctx.restore();
  }
}
