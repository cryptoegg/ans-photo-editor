// Auto-crop to the subject (Tom, 2026-11-26): Crop → Subject. The Remove background model finds the person (or the
// thing the photo is of: `subjectMask` in cutout.js, kept, so a second time is instant), then the photo is zoomed and
// moved so the subject sits in the middle at about four fifths of the frame's height (narrower subjects never wider
// than nine tenths of it), never so far that the slide's edges show. Straight and untrimmed afterwards.
import { getPicture, loadPicture } from './media.js';
import { subjectMask } from './cutout.js';
import { photoSize } from './render.js';

const TALL = 0.8, WIDE = 0.9, MOST = 5;

// The subject's box in the photo, as shares of its width and height { x0, y0, x1, y1 }, or null (nothing found)
const found = new Map(); // mediaId → maskId (this session: the second time is instant)
async function subjectBox(layer) {
  const maskId = found.get(layer.mediaId) || await subjectMask(layer);
  if (maskId) found.set(layer.mediaId, maskId);
  if (!maskId) return null;
  const mask = getPicture(maskId) || await loadPicture(maskId);
  if (!mask) return null;
  const side = 256, k = side / Math.max(mask.width, mask.height);
  const w = Math.max(1, Math.round(mask.width * k)), h = Math.max(1, Math.round(mask.height * k));
  const c = new OffscreenCanvas(w, h), g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(mask.full || mask.preview, 0, 0, w, h);
  const a = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (a[(y * w + x) * 4 + 3] < 128) continue;
    n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (n < w * h * 0.004) return null; // (a speck: nothing really there)
  return { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
}

// Frame `layer` (the slide's own photo or a layer) round its subject in a frame W x H. True when it moved.
export async function cropToSubject(layer, W, H) {
  const pic = getPicture(layer.mediaId) || await loadPicture(layer.mediaId);
  if (!pic || pic.kind === "video") return false;
  const box = await subjectBox(layer);
  if (!box) return false;
  const iw = pic.width, ih = pic.height;
  const base = Math.max(W / iw, H / ih);
  const bw = (box.x1 - box.x0) * iw, bh = (box.y1 - box.y0) * ih;
  const want = Math.min((TALL * H) / bh, (WIDE * W) / bw); // (frame px per photo px)
  const crop = layer.crop;
  crop.rotation = 0; crop.stretch = 1; crop.lockRatio = true;
  delete crop.trim;
  crop.zoom = Math.min(MOST, Math.max(1, want / base));
  const { dw, dh } = photoSize(crop, iw, ih, W, H), s = dw / iw;
  // the subject's middle to the frame's middle, held so the photo still covers the frame
  const uc = ((box.x0 + box.x1) / 2) * iw, vc = ((box.y0 + box.y1) / 2) * ih;
  const room = (d, F) => Math.max(0, (d - F) / 2);
  const x = Math.max(-room(dw, W), Math.min(room(dw, W), -(uc - iw / 2) * s));
  const y = Math.max(-room(dh, H), Math.min(room(dh, H), -(vc - ih / 2) * s));
  crop.x = x / W; crop.y = y / H;
  return true;
}
