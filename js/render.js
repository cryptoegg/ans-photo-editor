// Drawing a slide: the photo (with its look) placed by its crop in the item's frame (span x 1:
// a square, or a panorama of squares), then its texts. The screen, the phone view and the
// export all draw through here, so what you see is what's exported.
import { lookedPicture, lookedFrame } from './looks.js';
import { getPicture } from './media.js';
import { LAYOUTS, layersOf } from './project.js';

// ---- Where the photo sits in a frame W x H (free, like the lyric app's pictures)
// zoom 1 = the photo upright just fills the frame ("Fill"); bigger or smaller from there (smaller:
// the slide's background shows around it). stretch widens it (Lock ratio off). x / y move its
// middle, in frame widths / heights; rotation turns it about its middle.

// The photo's drawn size (before turning), for a picture iw x ih
export function photoSize(crop, iw, ih, W, H) {
  const base = Math.max(W / iw, H / ih);
  return { dw: iw * base * crop.zoom * (crop.stretch || 1), dh: ih * base * crop.zoom };
}

export const turn = (x, y, degrees) => {
  const a = (degrees * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
};

// The photo's box on the frame: middle, size (unturned) and angle, in frame pixels
export function photoBox(crop, iw, ih, W, H) {
  const { dw, dh } = photoSize(crop, iw, ih, W, H);
  return { cx: W / 2 + crop.x * W, cy: H / 2 + crop.y * H, w: dw, h: dh, rotation: crop.rotation || 0 };
}

// Trimmed edges (Tom, 2026-11-18, like Canva's side handles): crop.trim = { l, t, r, b }, shares of the photo's box
// cut off each side. The part left is what shows (in its shape) and what's picked, moved and sized.
export const trimOf = (crop) => ({ l: 0, t: 0, r: 0, b: 0, ...(crop.trim || {}) });
export const isTrimmed = (crop) => { const t = trimOf(crop); return !!(t.l || t.t || t.r || t.b); };
// The part of the photo that shows: its box on the frame (middle, size, angle), like photoBox
export function shownBox(crop, iw, ih, W, H) {
  const b = photoBox(crop, iw, ih, W, H), t = trimOf(crop);
  const [u, v] = turn(((t.l - t.r) * b.w) / 2, ((t.t - t.b) * b.h) / 2, b.rotation);
  return { cx: b.cx + u, cy: b.cy + v, w: Math.max(1, b.w * (1 - t.l - t.r)), h: Math.max(1, b.h * (1 - t.t - t.b)), rotation: b.rotation };
}

// ---- A photo's shape (Tom, 2026-11-18): style.shape, drawn to fill the part that shows
export const PHOTO_SHAPES = [
  ["rect", "Rectangle"], ["circle", "Circle"], ["triangle", "Triangle"], ["diamond", "Diamond"],
  ["hexagon", "Hexagon"], ["star", "Star"], ["heart", "Heart"], ["arch", "Arch"]
];
// The shape's path in the box (x, y, w, h); r: the rectangle's rounded corners (px)
export function shapePath(ctx, shape, x, y, w, h, r = 0) {
  const cx = x + w / 2, cy = y + h / 2;
  const poly = (pts) => { pts.forEach(([u, v], i) => (i ? ctx.lineTo(x + u * w, y + v * h) : ctx.moveTo(x + u * w, y + v * h))); ctx.closePath(); };
  ctx.beginPath();
  if (shape === "circle") ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (shape === "triangle") poly([[0.5, 0], [1, 1], [0, 1]]);
  else if (shape === "diamond") poly([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]);
  else if (shape === "hexagon") poly([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]);
  else if (shape === "star") poly(Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? 0.4 : 1; return [0.5 + Math.cos(a) * 0.5 * k, 0.53 + Math.sin(a) * 0.5 * k / 0.95]; }));
  else if (shape === "heart") {
    ctx.moveTo(cx, y + h);
    ctx.bezierCurveTo(x - w * 0.05, y + h * 0.6, x - w * 0.02, y + h * 0.02, x + w * 0.27, y);
    ctx.bezierCurveTo(x + w * 0.42, y - h * 0.01, cx, y + h * 0.12, cx, y + h * 0.22);
    ctx.bezierCurveTo(cx, y + h * 0.12, x + w * 0.58, y - h * 0.01, x + w * 0.73, y);
    ctx.bezierCurveTo(x + w * 1.02, y + h * 0.02, x + w * 1.05, y + h * 0.6, cx, y + h);
    ctx.closePath();
  } else if (shape === "arch") {
    const rr = Math.min(w / 2, h);
    ctx.moveTo(x, y + h); ctx.lineTo(x, y + rr); ctx.ellipse(cx, y + rr, w / 2, rr, 0, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.closePath();
  } else ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

// Fill: in the middle, upright-or-turned, just covering the frame. Fit: the whole photo showing.
export function fillCrop(crop, iw, ih, W, H) {
  const a = (crop.rotation * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const base = Math.max(W / iw, H / ih);
  const need = Math.max((W * c + H * s) / iw, (W * s + H * c) / ih); // (cover the turned frame)
  Object.assign(crop, { x: 0, y: 0, stretch: 1, zoom: need / base });
  return crop;
}
export function fitCrop(crop, iw, ih, W, H) {
  const base = Math.max(W / iw, H / ih);
  Object.assign(crop, { x: 0, y: 0, stretch: 1, rotation: 0, zoom: Math.min(W / iw, H / ih) / base });
  return crop;
}

// Draw a picture placed by a crop into the frame (0, 0, W, H) of ctx
export function drawPlaced(ctx, picture, crop, W, H) {
  const { dw, dh } = photoSize(crop, picture.width, picture.height, W, H);
  ctx.save();
  ctx.translate(W / 2 + crop.x * W, H / 2 + crop.y * H);
  ctx.rotate((crop.rotation * Math.PI) / 180);
  ctx.scale(crop.flipH ? -1 : 1, crop.flipV ? -1 : 1);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(picture, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

// ---- Layers and layouts

// A grid's cells on a frame W x H: [{ x, y, w, h }] (frame pixels), the gap round and between
// them (the slide's background shows in it)
export function cellRects(item, W, H) {
  const grid = LAYOUTS[item.layout && item.layout.kind];
  if (!grid) return null;
  const gap = (item.layout.gap || 0) * Math.min(W, H);
  return grid.cells.map(([fx, fy, fw, fh]) => {
    const l = fx === 0 ? gap : gap / 2, t = fy === 0 ? gap : gap / 2;
    const r = fx + fw >= 0.999 ? gap : gap / 2, b = fy + fh >= 0.999 ? gap : gap / 2;
    return { x: fx * W + l, y: fy * H + t, w: Math.max(1, fw * W - l - r), h: Math.max(1, fh * H - t - b) };
  });
}

// The frame a layer's crop is placed in (frame pixels): its cell in a grid, else the whole slide.
// null: a layer with no cell left in the grid (not shown).
export function layerFrame(item, layer, W, H) {
  const cells = cellRects(item, W, H);
  if (!cells) return { x: 0, y: 0, w: W, h: H };
  const i = layersOf(item).indexOf(layer);
  return i >= 0 && i < cells.length ? cells[i] : null;
}

// How a layer mixes with the layers under it (canvas blend modes; "normal" draws over them)
export const BLENDS = { normal: "Normal", multiply: "Multiply", screen: "Screen", overlay: "Overlay", "soft-light": "Soft light", lighten: "Lighten", darken: "Darken", difference: "Difference" };

// One layer's picture (with its look) placed in its frame; in a grid clipped to its (rounded)
// cell, else with its own style: rounded corners, a border, a soft shadow
function drawLayer(ctx, item, layer, picture, rect, grid) {
  ctx.save();
  ctx.translate(rect.x, rect.y);
  const look = layer.style || {};
  ctx.globalAlpha = look.opacity ?? 1;
  ctx.globalCompositeOperation = BLENDS[look.blend] && look.blend !== "normal" ? look.blend : "source-over";
  if (grid) {
    const r = (item.layout.radius || 0) * Math.min(rect.w, rect.h) * 2;
    ctx.beginPath();
    ctx.roundRect(0, 0, rect.w, rect.h, Math.min(r, rect.w / 2, rect.h / 2));
    ctx.clip();
    drawPlaced(ctx, picture, layer.crop, rect.w, rect.h);
    ctx.restore();
    return;
  }
  const st = layer.style || {};
  const shape = st.shape && st.shape !== "rect" ? st.shape : null;
  if (!st.radius && !st.border && !st.shadow && !shape && !isTrimmed(layer.crop)) { drawPlaced(ctx, picture, layer.crop, rect.w, rect.h); ctx.restore(); return; }
  const box = photoBox(layer.crop, picture.width, picture.height, rect.w, rect.h);
  const t = trimOf(layer.crop);
  const sx = -box.w / 2 + t.l * box.w, sy = -box.h / 2 + t.t * box.h, sw = box.w * (1 - t.l - t.r), sh = box.h * (1 - t.t - t.b);
  const r = Math.min(sw, sh) * (st.radius || 0);
  const outline = () => shapePath(ctx, shape || "rect", sx, sy, sw, sh, r);
  ctx.translate(box.cx, box.cy);
  ctx.rotate((box.rotation * Math.PI) / 180);
  if (st.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = Math.min(rect.w, rect.h) * 0.04;
    ctx.shadowOffsetY = Math.min(rect.w, rect.h) * 0.015;
    outline();
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  outline();
  ctx.clip();
  ctx.scale(layer.crop.flipH ? -1 : 1, layer.crop.flipV ? -1 : 1);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(picture, -box.w / 2, -box.h / 2, box.w, box.h);
  ctx.restore();
  if (st.border) {
    outline();
    ctx.lineWidth = st.border * Math.min(rect.w, rect.h) * 0.01;
    ctx.strokeStyle = st.borderColour || "#ffffff";
    ctx.stroke();
  }
  ctx.restore();
}

// The whole item into (0, 0, W, H): its background, its layers (bottom first), its texts.
// options: quality "preview" | "full", before (no look: true = every layer, or one layer = just that one), texts (default true), seed, frame (a
// video's frame for this moment, a canvas the video's size: playing, exporting; else its still)
export function drawItem(ctx, item, W, H, options = {}) {
  const { quality = "preview", before = false, texts = true, seed = 0, frame = null, frameLooked = false } = options;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  ctx.fillStyle = item.background || "#ffffff";
  ctx.fillRect(0, 0, W, H);
  const grid = !!LAYOUTS[item.layout && item.layout.kind];
  const cells = grid ? cellRects(item, W, H) : null;
  // Photo inside the words (Tom, 2026-11-23): with a caption set to it, the photos show only through its letters, on the
  // slide's background; the other captions and shapes are drawn as usual over them
  const inside = texts ? item.texts.filter((t) => t.photoFill && !t.hidden && t.kind !== "shape") : [];
  const into = inside.length ? (() => { const m = ctx.getTransform(), k = Math.max(1, Math.hypot(m.a, m.b)); const c = document.createElement("canvas"); c.width = Math.ceil(W * k); c.height = Math.ceil(H * k); const g = c.getContext("2d"); g.scale(k, k); return { c, g }; })() : null;
  const main = ctx;
  if (into) ctx = into.g;
  layersOf(item).forEach((layer, i) => {
    const rect = cells ? cells[i] : { x: 0, y: 0, w: W, h: H };
    if (!rect) return; // (more layers than cells: the rest wait off the grid)
    if (layer.hidden) return; // (its eye shut in Layers)
    const pic = getPicture(layer.mediaId);
    if (!pic) return;
    const bare = before === true || before === layer;
    const picture = layer === item && frame ? (bare || frameLooked ? frame : lookedFrame(item, frame, quality, seed))
      : bare ? (quality === "full" ? pic.full : pic.preview) : lookedPicture(layer, quality, seed);
    if (picture) drawLayer(ctx, item, layer, picture, rect, grid);
  });
  if (into) {
    ctx = main;
    const mask = document.createElement("canvas");
    mask.width = into.c.width; mask.height = into.c.height;
    const mg = mask.getContext("2d");
    mg.scale(into.c.width / W, into.c.height / H);
    inside.forEach((t) => paintText(mg, { ...t, bubble: "none", stroke: 0, colour: "#000", gradient: null }, layoutText(mg, t, W, H)));
    into.g.setTransform(1, 0, 0, 1, 0, 0);
    into.g.globalCompositeOperation = "destination-in";
    into.g.drawImage(mask, 0, 0);
    ctx.drawImage(into.c, 0, 0, W, H);
  }
  if (texts) item.texts.forEach((t) => { if (!t.hidden && !(t.photoFill && t.kind !== "shape")) drawText(ctx, t, W, H); });
  ctx.restore();
}

// ---- Text

export const FONTS = [
  { id: "Helvetica", css: "Helvetica, Arial, sans-serif" },
  { id: "Inter Tight", css: "'Inter Tight', Helvetica, sans-serif" },
  { id: "Archivo Black", css: "'Archivo Black', Helvetica, sans-serif" },
  { id: "Bebas Neue", css: "'Bebas Neue', Impact, sans-serif" },
  { id: "Playfair Display", css: "'Playfair Display', Georgia, serif" },
  { id: "DM Serif Display", css: "'DM Serif Display', Georgia, serif" },
  { id: "Space Mono", css: "'Space Mono', Menlo, monospace" },
  { id: "Caveat", css: "Caveat, cursive" }
];
const fontCss = (id) => (FONTS.find((f) => f.id === id) || FONTS[0]).css;

// Ready-made text styles (Text → + Add)
export const TEXT_STYLES = {
  title: { label: "Title", content: "Your title", font: "Archivo Black", weight: 400, size: 0.1, colour: "#ffffff", align: "center", bubble: "none", bubbleColour: "#111111", stroke: 1, strokeColour: "#000000", rotation: 0, x: 0.5, y: 0.5 },
  caption: { label: "Caption", content: "A short caption\nover two lines", font: "Inter Tight", weight: 500, size: 0.045, colour: "#111111", align: "left", bubble: "lines", bubbleColour: "#ffffff", stroke: 1, strokeColour: "#000000", rotation: 0, x: 0.5, y: 0.84 },
  swipe: { label: "Swipe →", content: "Swipe →", font: "Inter Tight", weight: 700, size: 0.04, colour: "#ffffff", align: "center", bubble: "pill", bubbleColour: "#1f4fbf", stroke: 1, strokeColour: "#000000", rotation: 0, x: 0.82, y: 0.92 }
};

// Where a text's lines go (frame W x H): its font, lines, size and box (frame pixels; the box
// unturned, about its middle cx / cy, turned by `rotation`)
export function layoutText(ctx, t, W, H) {
  if (t.kind === "shape") {
    // (a shape: its box is size × the slide's height tall and aspect × that wide)
    const h = Math.max(2, t.size * H), w = Math.max(2, h * (t.aspect || 1)), cx = t.x * W, cy = t.y * H;
    return { shape: true, px: h, lines: [], widths: [], lineH: h, textW: w, textH: h, padX: 0, padY: 0, cx, cy, width: w, height: h, left: cx - w / 2, top: cy - h / 2, rotation: t.rotation || 0 };
  }
  const px = Math.max(4, t.size * H);
  const font = `${t.weight || 400} ${px}px ${fontCss(t.font)}`;
  ctx.save();
  ctx.font = font;
  const lines = String(t.content || " ").split("\n");
  const widths = lines.map((line) => ctx.measureText(line || " ").width);
  const space = ctx.measureText(" ").width;
  ctx.restore();
  const lineH = px * 1.18;
  const textW = Math.max(...widths), textH = lineH * lines.length;
  const bubble = t.bubble && t.bubble !== "none";
  const padX = bubble ? px * (t.bubble === "pill" ? 0.75 : t.bubble === "lines" ? 0.3 : 0.45) : 0;
  const padY = bubble ? px * (t.bubble === "lines" ? 0.06 : 0.3) : 0;
  let width = textW + padX * 2, height = textH + padY * 2;
  // (curved, Tom 2026-11-25: up to a full circle at ±200; the box grows to hold the arc, so picking it matches)
  const curve = Math.max(-200, Math.min(200, Number(t.curve) || 0));
  let arc = 0;
  if (curve) {
    const theta = (Math.abs(curve) / 100) * Math.PI, R = Math.max(1, textW / theta);
    arc = theta >= Math.PI ? 2 * R : R * (1 - Math.cos(theta / 2));
    width = Math.max(width, (theta >= Math.PI ? 2 * R : 2 * R * Math.sin(theta / 2)) + px * 1.2 + padX * 2);
    height += arc;
  }
  const cx = t.x * W, cy = t.y * H;
  return { font, px, lines, widths, space, lineH, textW, textH, padX, padY, cx, cy, width, height, arc, left: cx - width / 2, top: cy - height / 2, rotation: t.rotation || 0 };
}

// Where each line starts and how wide it's drawn (box pixels, from the box's left)
function linePlaces(t, L) {
  const last = L.lines.length - 1;
  return L.lines.map((line, i) => {
    const w = L.widths[i];
    const justified = t.align === "justify" && i < last && line.trim().includes(" ");
    const drawn = justified ? L.textW : w;
    const x = t.align === "right" ? L.width - L.padX - drawn
      : t.align === "center" ? (L.width - drawn) / 2
      : L.padX;
    return { line, x, drawn, justified };
  });
}

// ---- Shapes (Tom, 2026-11-23, as Canva's elements): they live with the captions (item.texts, kind "shape"), so they're
// picked, moved, sized and turned the same way, and listed in Layers. { shape, x, y, size, aspect, fill ("none" = no
// fill), outline (0 - 20: % of the shorter side), outlineColour, radius (a rectangle's corners, 0 - 50 %), opacity, rotation }
export const SHAPE_KINDS = [
  ["rect", "Rectangle"], ["circle", "Circle"], ["triangle", "Triangle"], ["diamond", "Diamond"], ["hexagon", "Hexagon"],
  ["star", "Star"], ["heart", "Heart"], ["arch", "Arch"], ["line", "Line"], ["arrow", "Arrow"]
];
export const SHAPE_DEFAULTS = () => ({ kind: "shape", shape: "rect", x: 0.5, y: 0.5, size: 0.25, aspect: 1, fill: "#ffffff", outline: 0, outlineColour: "#111111", radius: 0, opacity: 1, rotation: 0 });
function drawShape(ctx, t, L) {
  const w = L.width, h = L.height, side = Math.min(w, h);
  ctx.save();
  ctx.translate(L.cx, L.cy);
  if (L.rotation) ctx.rotate((L.rotation * Math.PI) / 180);
  ctx.globalAlpha *= t.opacity ?? 1;
  const fill = t.fill && t.fill !== "none" ? t.fill : null;
  const line = Math.max(0, Number(t.outline) || 0) / 100 * side;
  if (t.shape === "line" || t.shape === "arrow") {
    // (a line runs the box's length; its thickness is the box's height, an arrow's shaft a third of it)
    const colour = fill || t.outlineColour || "#111111";
    ctx.fillStyle = colour;
    if (t.shape === "line") { ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, h / 2); ctx.fill(); }
    else {
      const head = Math.min(w * 0.45, h * 1.2), shaft = h / 3;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -shaft / 2); ctx.lineTo(w / 2 - head, -shaft / 2); ctx.lineTo(w / 2 - head, -h / 2); ctx.lineTo(w / 2, 0);
      ctx.lineTo(w / 2 - head, h / 2); ctx.lineTo(w / 2 - head, shaft / 2); ctx.lineTo(-w / 2, shaft / 2); ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  // (the outline sits inside the box, so a frame never grows past it)
  const inset = line / 2;
  shapePath(ctx, t.shape, -w / 2 + inset, -h / 2 + inset, w - line, h - line, (t.radius || 0) / 100 * side);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (line) { ctx.lineWidth = line; ctx.lineJoin = "round"; ctx.strokeStyle = t.outlineColour || "#111111"; ctx.stroke(); }
  ctx.restore();
}

// Text effects (Tom, 2026-11-23, as Photoshop's layer styles / Canva's): shadow { on, colour, blur, distance }, glow { on,
// colour, size }, gradient { on, colour } (from the text's colour to this one, top to bottom), curve (-200 - 200: an arc
// up or down, ±100 a half circle, ±200 a full one). With a shadow or glow the words are drawn on their own first, then laid on with it, so the outline and
// the fill share one shadow.
const fxOn = (t) => (t.shadow && t.shadow.on) || (t.glow && t.glow.on);
export function drawText(ctx, t, W, H) {
  const L = layoutText(ctx, t, W, H);
  if (L.shape) { drawShape(ctx, t, L); return; }
  if (!fxOn(t)) { paintText(ctx, t, L); return; }
  const m = ctx.getTransform(), k = Math.max(1, Math.hypot(m.a, m.b));
  const off = document.createElement("canvas");
  off.width = Math.ceil(W * k); off.height = Math.ceil(H * k);
  const g = off.getContext("2d");
  g.scale(k, k);
  paintText(g, t, L);
  const side = Math.min(W, H);
  ctx.save();
  if (t.glow && t.glow.on) {
    ctx.shadowColor = t.glow.colour || "#ffffff";
    ctx.shadowBlur = (t.glow.size ?? 30) / 100 * side * 0.08 * k;
    for (let i = 0; i < 2; i++) ctx.drawImage(off, 0, 0, W, H); // (twice: a fuller glow)
  }
  if (t.shadow && t.shadow.on) {
    const d = (t.shadow.distance ?? 30) / 100 * side * 0.03 * k;
    ctx.shadowColor = t.shadow.colour || "rgba(0,0,0,0.6)";
    ctx.shadowBlur = (t.shadow.blur ?? 30) / 100 * side * 0.05 * k;
    ctx.shadowOffsetX = d * 0.7; ctx.shadowOffsetY = d;
  } else ctx.shadowColor = "transparent";
  ctx.drawImage(off, 0, 0, W, H);
  ctx.restore();
}

function paintText(ctx, t, L) {
  ctx.save();
  ctx.translate(L.cx, L.cy);
  if (L.rotation) ctx.rotate((L.rotation * Math.PI) / 180);
  ctx.translate(-L.width / 2, -L.height / 2); // (now 0, 0 is the box's top-left)
  const places = linePlaces(t, L);
  const curve = Math.max(-200, Math.min(200, Number(t.curve) || 0));
  if (t.bubble === "lines" && !curve) {
    // A background round each line's own words, hugging the shape of the text
    ctx.fillStyle = t.bubbleColour;
    const r = L.px * 0.22;
    places.forEach((p, i) => {
      if (!p.line.trim()) return;
      ctx.beginPath();
      ctx.roundRect(p.x - L.padX, L.padY + i * L.lineH - L.px * 0.04, p.drawn + L.padX * 2, L.lineH + L.px * 0.08, r);
      ctx.fill();
    });
  } else if (t.bubble && t.bubble !== "none" && t.bubble !== "lines") {
    const r = t.bubble === "pill" ? L.height / 2 : t.bubble === "rounded" || t.bubble === "outline" ? L.px * 0.3 : 0;
    ctx.beginPath();
    ctx.roundRect(0, 0, L.width, L.height, r);
    if (t.bubble === "outline") { ctx.lineWidth = Math.max(1, L.px * 0.07); ctx.strokeStyle = t.bubbleColour; ctx.stroke(); }
    else { ctx.fillStyle = t.bubbleColour; ctx.fill(); }
  }
  ctx.font = L.font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  // (a gradient runs from the text's colour at the top of the words to the second colour at the bottom)
  const gradient = (y0, y1) => { const gr = ctx.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, t.colour); gr.addColorStop(1, t.gradient.colour || "#ff3d7f"); return gr; };
  const graded = !!(t.gradient && t.gradient.on);
  let fill = graded ? gradient(L.padY, L.padY + L.textH) : t.colour;
  const stroke = Math.max(0, Number(t.stroke) || 0) / 100 * L.px * 2; // (half of it falls inside the letters)
  const paint = (text, x, y) => {
    if (stroke) { ctx.lineJoin = "round"; ctx.miterLimit = 2; ctx.lineWidth = stroke; ctx.strokeStyle = t.strokeColour; ctx.strokeText(text, x, y); }
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  };
  places.forEach((p, i) => {
    const y = L.padY + L.lineH * (i + 0.5) + (curve < 0 ? L.arc : 0); // (the arc grows away from the line: room for it)
    if (curve) {
      // Curved: each letter along an arc through the line's middle (up = a rainbow, down = a smile)
      const theta = (Math.abs(curve) / 100) * Math.PI, R = Math.max(1, p.drawn / theta), dir = curve > 0 ? 1 : -1;
      const chars = [...p.line], widths = chars.map((c) => ctx.measureText(c).width);
      let run = -p.drawn / 2;
      const mid = L.width / 2;
      chars.forEach((c, j) => {
        const a = (run + widths[j] / 2) / R;
        ctx.save();
        ctx.translate(mid + R * Math.sin(a), y + dir * R * (1 - Math.cos(a)));
        ctx.rotate(dir * a);
        if (graded) fill = gradient(-L.px / 2, L.px / 2); // (each letter turned on its own: its own top to bottom)
        paint(c, -widths[j] / 2, 0);
        ctx.restore();
        run += widths[j];
      });
      return;
    }
    if (!p.justified) { paint(p.line, p.x, y); return; }
    // Justify: the words spread so the line runs the full width (the last line stays as it is)
    const words = p.line.trim().split(/\s+/);
    const wordWidths = words.map((w) => ctx.measureText(w).width);
    const gap = (L.textW - wordWidths.reduce((a, b) => a + b, 0)) / (words.length - 1);
    let x = p.x;
    words.forEach((w, k) => { paint(w, x, y); x += wordWidths[k] + gap; });
  });
  ctx.restore();
}

// Whether a point (frame pixels) is on a turned box { cx, cy, w, h, rotation } (m: extra margin)
export function onBox(box, x, y, m = 0) {
  const [u, v] = turn(x - box.cx, y - box.cy, -(box.rotation || 0));
  return Math.abs(u) <= box.w / 2 + m && Math.abs(v) <= box.h / 2 + m;
}
export const textBox = (L) => ({ cx: L.cx, cy: L.cy, w: L.width, h: L.height, rotation: L.rotation });

// The text under a point (frame pixels), topmost first, or null
export function textAt(ctx, item, W, H, x, y) {
  for (let i = item.texts.length - 1; i >= 0; i--) {
    if (item.texts[i].hidden || item.texts[i].locked) continue; // (hidden or locked in Layers: not picked on the canvas)
    const L = layoutText(ctx, item.texts[i], W, H);
    if (onBox(textBox(L), x, y, Math.max(6, L.px * 0.15))) return item.texts[i];
  }
  return null;
}

// ---- Slides

// Every slide of a set drawn as its own canvas pw x ph (the set's shape), in swipe order:
// [{ canvas, item, piece }]. options: as drawItem's, seed.
export function drawSlides(set, pw, ph, options = {}) {
  const out = [];
  set.items.forEach((item) => {
    const whole = document.createElement("canvas");
    whole.width = Math.round(pw * item.span);
    whole.height = Math.round(ph);
    drawItem(whole.getContext("2d"), item, whole.width, whole.height, options);
    for (let piece = 0; piece < item.span; piece++) {
      if (item.span === 1) { out.push({ canvas: whole, item, piece }); continue; }
      const c = document.createElement("canvas");
      c.width = Math.round(pw);
      c.height = Math.round(ph);
      c.getContext("2d").drawImage(whole, Math.round(piece * pw), 0, c.width, c.height, 0, 0, c.width, c.height);
      out.push({ canvas: c, item, piece });
    }
  });
  return out;
}

// A TikTok slide in the Phone view: TikTok shows a photo that isn't 9:16 across the middle of its tall screen, on black
export function composeTikTok(square, W, H) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const k = Math.min(W / square.width, H / square.height), w = square.width * k, h = square.height * k;
  ctx.drawImage(square, (W - w) / 2, (H - h) / 2, w, h);
  return c;
}
