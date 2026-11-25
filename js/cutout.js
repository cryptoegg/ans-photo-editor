// Remove background (Tom, 2026-11-18): a photo layer's cut-out. The model runs in js/cutout-worker.js; what it
// finds is kept as a mask (a PNG, white with the subject in its alpha) in the media store, and the layer gets
// `cutout: { maskId, on }`. The photo itself is never changed: switching the cut-out off brings the background
// back, and undo works as for anything else. A mask with `hand: true` was made with the Eraser (js/ui/brush.js), not here. The mask goes on after the look (js/looks.js `cutOut`).
import { dbPut } from './store.js';
import { getPicture, loadPicture } from './media.js';
import { newId, activeSet } from './project.js';
import { state, changed, commit } from './state.js';

const MASK_SIDE = 2048; // (the mask is kept up to this size; the photo's own size when smaller)

// What the cut-out is doing, for the Editor: { busy, layerId, progress (0..1 while the model downloads), error }
export const cutoutStatus = { busy: false, layer: null, progress: null, error: "" };

let worker = null, asked = 0;
const waiting = new Map();
function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./cutout-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const d = e.data;
    if (d.progress !== undefined) {
      const p = Math.floor(d.progress * 100) / 100;
      if (p !== cutoutStatus.progress) { cutoutStatus.progress = p; changed("view"); }
      return;
    }
    const w = waiting.get(d.id);
    if (!w) return;
    waiting.delete(d.id);
    if (d.error) w.reject(new Error(d.error)); else w.resolve(d);
  };
  worker.onerror = (e) => { waiting.forEach((w) => w.reject(new Error(e.message || "The cut-out stopped"))); waiting.clear(); worker = null; };
  return worker;
}

async function findMask(picture, hand = null) {
  const bitmap = await createImageBitmap(picture.full);
  const id = ++asked;
  const done = new Promise((resolve, reject) => waiting.set(id, { resolve, reject }));
  getWorker().postMessage({ id, bitmap }, [bitmap]);
  const { mask, side } = await done;
  // The mask at the photo's shape (smoothly scaled up from the model's square)
  const small = new OffscreenCanvas(side, side);
  const px = new ImageData(side, side);
  for (let i = 0; i < mask.length; i++) { px.data[i * 4] = px.data[i * 4 + 1] = px.data[i * 4 + 2] = 255; px.data[i * 4 + 3] = mask[i]; }
  small.getContext("2d").putImageData(px, 0, 0);
  const scale = Math.min(1, MASK_SIDE / Math.max(picture.width, picture.height));
  const big = new OffscreenCanvas(Math.round(picture.width * scale), Math.round(picture.height * scale));
  const ctx = big.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, big.width, big.height);
  // (a photo already erased by hand: what was erased stays erased)
  if (hand) { ctx.globalCompositeOperation = "destination-in"; ctx.drawImage(hand.full, 0, 0, big.width, big.height); }
  return big.convertToBlob({ type: "image/png" });
}

// Remove the background of a layer (the slide itself or one of its layers). A layer that's been cut out before
// just switches its cut-out back on.
export async function removeBackground(layer) {
  if (!layer || cutoutStatus.busy) return;
  if (layer.cutout && layer.cutout.maskId && !layer.cutout.hand) { layer.cutout.on = true; changed("project"); commit(); return; }
  // (a mask made with the Eraser, js/ui/brush.js, is kept: the cut-out is laid on it)
  const hand = layer.cutout && layer.cutout.hand && layer.cutout.on ? (getPicture(layer.cutout.maskId) || await loadPicture(layer.cutout.maskId)) : null;
  const picture = getPicture(layer.mediaId) || await loadPicture(layer.mediaId);
  if (!picture || picture.kind === "video") return;
  Object.assign(cutoutStatus, { busy: true, layer: layer.id, progress: null, error: "" });
  changed("view");
  try {
    const blob = await findMask(picture, hand);
    const maskId = newId("m");
    await dbPut("media", { id: maskId, projectId: state.project.id, kind: "mask", name: `Cut-out of ${picture.name || "photo"}.png`, type: "image/png", blob, width: picture.width, height: picture.height, added: Date.now() });
    await loadPicture(maskId);
    // (the same layer, found again: undo / redo may have replaced the project's copy meanwhile)
    const now = findLayer(layer.id) || layer;
    now.cutout = { maskId, on: true };
    changed("project");
    commit();
  } catch (err) {
    console.error("Remove background:", err);
    cutoutStatus.error = "The background couldn't be removed on this computer.";
  } finally {
    Object.assign(cutoutStatus, { busy: false, layer: null, progress: null });
    changed("view");
  }
}

function findLayer(id) {
  const lists = [activeSet(state.project).items];
  for (const items of lists) for (const item of items || []) {
    if (item.id === id) return item;
    const l = (item.layers || []).find((x) => x.id === id);
    if (l) return l;
  }
  return null;
}

// The subject of a photo as a mask picture's id, for a Subject mask (js/masks.js): the layer's cut-out when it has
// one from the model, else the model is run (the cut-out itself isn't switched on). null if it couldn't be found.
export async function subjectMask(layer) {
  if (layer.cutout && layer.cutout.maskId && !layer.cutout.hand) return layer.cutout.maskId;
  if (cutoutStatus.busy) return null;
  const picture = getPicture(layer.mediaId) || await loadPicture(layer.mediaId);
  if (!picture || picture.kind === "video") return null;
  Object.assign(cutoutStatus, { busy: true, layer: layer.id, progress: null, error: "" });
  changed("view");
  try {
    const blob = await findMask(picture);
    const maskId = newId("m");
    await dbPut("media", { id: maskId, projectId: state.project.id, kind: "mask", name: `Subject of ${picture.name || "photo"}.png`, type: "image/png", blob, width: picture.width, height: picture.height, added: Date.now() });
    await loadPicture(maskId);
    return maskId;
  } catch (err) {
    console.error("Subject:", err);
    cutoutStatus.error = "The subject couldn't be found on this computer.";
    return null;
  } finally {
    Object.assign(cutoutStatus, { busy: false, layer: null, progress: null });
    changed("view");
  }
}

// Switch a layer's cut-out off (the photo whole again; switching it on needs no new cut-out)
export function restoreBackground(layer) {
  if (!layer || !layer.cutout) return;
  layer.cutout.on = false;
  changed("project");
  commit();
}

// Every mask a project uses (to load with its photos, save in its folder, export)
// (and the touch-ups' pictures, js/ui/brush.js, and the masks' pictures, js/masks.js)
export const maskIdsOf = (layers) => layers.flatMap((l) => [...((l && l.texts) || []).filter((t) => t.kind === "gif").map((t) => t.mediaId), ...((l && l.masks) || []).map((m) => m.maskId), l && l.cutout && l.cutout.maskId, l && l.retouch && l.retouch.patchId, ...((l && l.retouch && l.retouch.tiles) || []).map((t) => t.id)]).filter(Boolean);
