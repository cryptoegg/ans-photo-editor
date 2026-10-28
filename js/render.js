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

// One layer's picture (with its look) placed in its frame; in a grid clipped to its (rounded)
// cell, else with its own style: rounded corners, a border, a soft shadow
function drawLayer(ctx, item, layer, picture, rect, grid) {
  ctx.save();
  ctx.translate(rect.x, rect.y);
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
  if (!st.radius && !st.border && !st.shadow) { drawPlaced(ctx, picture, layer.crop, rect.w, rect.h); ctx.restore(); return; }
  const box = photoBox(layer.crop, picture.width, picture.height, rect.w, rect.h);
  const r = Math.min(box.w, box.h) * (st.radius || 0);
  const shape = () => { ctx.beginPath(); ctx.roundRect(-box.w / 2, -box.h / 2, box.w, box.h, r); };
  ctx.translate(box.cx, box.cy);
  ctx.rotate((box.rotation * Math.PI) / 180);
  if (st.shadow) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = Math.min(rect.w, rect.h) * 0.04;
    ctx.shadowOffsetY = Math.min(rect.w, rect.h) * 0.015;
    shape();
    ctx.fillStyle = "#000";
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  shape();
  ctx.clip();
  ctx.scale(layer.crop.flipH ? -1 : 1, layer.crop.flipV ? -1 : 1);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(picture, -box.w / 2, -box.h / 2, box.w, box.h);
  ctx.restore();
  if (st.border) {
    shape();
    ctx.lineWidth = st.border * Math.min(rect.w, rect.h) * 0.01;
    ctx.strokeStyle = st.borderColour || "#ffffff";
    ctx.stroke();
  }
  ctx.restore();
}

// The whole item into (0, 0, W, H): its background, its layers (bottom first), its texts.
// options: quality "preview" | "full", before (no look), texts (default true), seed, frame (a
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
  layersOf(item).forEach((layer, i) => {
    const rect = cells ? cells[i] : { x: 0, y: 0, w: W, h: H };
    if (!rect) return; // (more layers than cells: the rest wait off the grid)
    const pic = getPicture(layer.mediaId);
    if (!pic) return;
    const picture = layer === item && frame ? (before || frameLooked ? frame : lookedFrame(item, frame, quality, seed))
      : before ? (quality === "full" ? pic.full : pic.preview) : lookedPicture(layer, quality, seed);
    if (picture) drawLayer(ctx, item, layer, picture, rect, grid);
  });
  if (texts) item.texts.forEach((t) => drawText(ctx, t, W, H));
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
  title: { label: "Title", content: "Your title", font: "Archivo Black", weight: 400, size: 0.1, colour: "#ffffff", align: "center", bubble: "none", bubbleColour: "#111111", stroke: 0, strokeColour: "#000000", rotation: 0, x: 0.5, y: 0.5 },
  caption: { label: "Caption", content: "A short caption\nover two lines", font: "Inter Tight", weight: 500, size: 0.045, colour: "#111111", align: "left", bubble: "lines", bubbleColour: "#ffffff", stroke: 0, strokeColour: "#000000", rotation: 0, x: 0.5, y: 0.84 },
  swipe: { label: "Swipe →", content: "Swipe →", font: "Inter Tight", weight: 700, size: 0.04, colour: "#ffffff", align: "center", bubble: "pill", bubbleColour: "#1f4fbf", stroke: 0, strokeColour: "#000000", rotation: 0, x: 0.82, y: 0.92 }
};

// Where a text's lines go (frame W x H): its font, lines, size and box (frame pixels; the box
// unturned, about its middle cx / cy, turned by `rotation`)
export function layoutText(ctx, t, W, H) {
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
  const width = textW + padX * 2, height = textH + padY * 2;
  const cx = t.x * W, cy = t.y * H;
  return { font, px, lines, widths, space, lineH, textW, textH, padX, padY, cx, cy, width, height, left: cx - width / 2, top: cy - height / 2, rotation: t.rotation || 0 };
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

export function drawText(ctx, t, W, H) {
  const L = layoutText(ctx, t, W, H);
  ctx.save();
  ctx.translate(L.cx, L.cy);
  if (L.rotation) ctx.rotate((L.rotation * Math.PI) / 180);
  ctx.translate(-L.width / 2, -L.height / 2); // (now 0, 0 is the box's top-left)
  const places = linePlaces(t, L);
  if (t.bubble === "lines") {
    // A background round each line's own words, hugging the shape of the text
    ctx.fillStyle = t.bubbleColour;
    const r = L.px * 0.22;
    places.forEach((p, i) => {
      if (!p.line.trim()) return;
      ctx.beginPath();
      ctx.roundRect(p.x - L.padX, L.padY + i * L.lineH - L.px * 0.04, p.drawn + L.padX * 2, L.lineH + L.px * 0.08, r);
      ctx.fill();
    });
  } else if (t.bubble && t.bubble !== "none") {
    const r = t.bubble === "pill" ? L.height / 2 : t.bubble === "rounded" || t.bubble === "outline" ? L.px * 0.3 : 0;
    ctx.beginPath();
    ctx.roundRect(0, 0, L.width, L.height, r);
    if (t.bubble === "outline") { ctx.lineWidth = Math.max(1, L.px * 0.07); ctx.strokeStyle = t.bubbleColour; ctx.stroke(); }
    else { ctx.fillStyle = t.bubbleColour; ctx.fill(); }
  }
  ctx.font = L.font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const stroke = Math.max(0, Number(t.stroke) || 0) / 100 * L.px * 2; // (half of it falls inside the letters)
  const paint = (text, x, y) => {
    if (stroke) { ctx.lineJoin = "round"; ctx.miterLimit = 2; ctx.lineWidth = stroke; ctx.strokeStyle = t.strokeColour; ctx.strokeText(text, x, y); }
    ctx.fillStyle = t.colour;
    ctx.fillText(text, x, y);
  };
  places.forEach((p, i) => {
    const y = L.padY + L.lineH * (i + 0.5);
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

// A TikTok slide: the slide (1:1 or 4:5) across the middle of a 9:16 frame W x H, the fill
// around it, and the project's title above (if it has one)
export function composeTikTok(square, project, W, H) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const fill = project.tiktok;
  if (fill.fill === "blur") {
    const s = Math.max(W / square.width, H / square.height) * 1.1;
    ctx.save();
    ctx.filter = `blur(${Math.round(W * 0.045)}px)`;
    ctx.drawImage(square, (W - square.width * s) / 2, (H - square.height * s) / 2, square.width * s, square.height * s);
    ctx.restore();
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = fill.colour;
    ctx.fillRect(0, 0, W, H);
  }
  const h = Math.round((W * square.height) / square.width);
  const top = Math.round((H - h) / 2);
  ctx.drawImage(square, 0, top, W, h);
  if (fill.title && fill.title.trim()) {
    const t = { content: wrap(ctx, fill.title.trim(), `700 ${W * 0.068}px ${fontCss("Inter Tight")}`, W * 0.84), font: "Inter Tight", weight: 700, size: 0.068 * W / H, colour: fill.titleColour, align: "center", bubble: "none", stroke: 0, rotation: 0, x: 0.5, y: (top / 2) / H };
    drawText(ctx, t, W, H);
  }
  return c;
}

// Text broken into lines that fit `width`
function wrap(ctx, text, font, width) {
  ctx.save();
  ctx.font = font;
  const lines = [];
  text.split("\n").forEach((para) => {
    let line = "";
    para.split(/\s+/).forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
    });
    lines.push(line);
  });
  ctx.restore();
  return lines.slice(0, 3).join("\n");
}
