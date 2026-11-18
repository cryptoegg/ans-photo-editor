// What the buttons and keys do to the set: add photos, duplicate, remove, reset, panoramas,
// copy / paste a look. Each is one undo step.
import { state, changed, commit, undo, currentItem, currentLayer, selectedItems, items, setItems, tidySelection } from './state.js';
import { newItem, slideCount, cropDefaults, lookDefaults, clone, newId, activeSet, aspectOf, SHAPES, STAGES, isVideo, newLayer, layersOf, LAYOUTS, isGrid } from './project.js';
import { addMediaFile, isMediaFile, getPicture } from './media.js';
import { photoSize, shownBox, fillCrop, fitCrop, cellRects } from './render.js';
import { toast } from './ui/toast.js';

const set = () => activeSet(state.project);
const room = () => set().max - slideCount(state.project);
const MAX = () => set().max;
const fullNote = () => `A set takes up to ${MAX()} slides.`;
const undoAction = { label: "Undo", run: () => undo() };

// Photos and videos dropped or picked: added after the current slide (or at the end)
export async function addFiles(fileList) {
  const files = [...fileList].filter(isMediaFile);
  if (!files.length) { toast("Those aren't photos or videos this app can open."); return; }
  const usable = files;
  const free = room();
  if (free <= 0) { toast(`The set is full: ${fullNote()}`); return; }
  const taking = usable.slice(0, free);
  const list = items();
  const at = state.current ? list.findIndex((i) => i.id === state.current) + 1 : list.length;
  const added = [];
  for (const file of taking) {
    try {
      const media = await addMediaFile(file, state.project.id);
      added.push(newItem(media.id, media.kind, media.duration));
    } catch (err) {
      console.error(err);
      toast(`${file.name} couldn't be opened.`);
    }
  }
  if (!added.length) return;
  list.splice(at, 0, ...added);

  state.selected = new Set([added[0].id]);
  state.current = added[0].id;
  changed("project");
  commit();
  const left = files.length - taking.length;
  if (left > 0) toast(`${left} didn't fit: the set is full at ${MAX()}`);
}

export function duplicateSelected() {
  const chosen = selectedItems();
  if (!chosen.length) return;
  const needed = chosen.reduce((n, i) => n + i.span, 0);
  if (needed > room()) { toast(`No room: the set can hold ${MAX()} slides.`); return; }
  const list = items();
  const copies = [];
  chosen.forEach((item) => {
    const copy = clone(item);
    copy.id = newId("s");
    copy.texts.forEach((t) => { t.id = newId("t"); });
    list.splice(list.indexOf(item) + 1, 0, copy);
    copies.push(copy);
  });
  state.selected = new Set(copies.map((c) => c.id));
  state.current = copies[0].id;
  changed("project");
  commit();
  toast(copies.length === 1 ? "Duplicated" : `Duplicated ${copies.length} slides`, undoAction);
}

export function removeSelected() {
  const chosen = selectedItems();
  if (!chosen.length) return;
  const list = items();
  const firstIndex = list.indexOf(chosen[0]);
  setItems(list.filter((i) => !state.selected.has(i.id)));
  const next = items()[Math.min(firstIndex, items().length - 1)];
  state.selected = new Set(next ? [next.id] : []);
  state.current = next ? next.id : null;
  state.textId = null;
  changed("project");
  commit();
  toast(chosen.length === 1 ? "Removed 1 slide" : `Removed ${chosen.length} slides`, undoAction);
}

// Back to the photo as it came in: crop, look and text
export function resetSelected() {
  const chosen = selectedItems();
  chosen.forEach((item) => { item.crop = cropDefaults(); item.look = lookDefaults(); item.texts = []; });
  state.textId = null;
  changed("project");
  commit();
  toast(chosen.length === 1 ? "Slide reset" : `${chosen.length} slides reset`, undoAction);
}

// Reorder: move the items with these ids to before the item `beforeId` (null: the end)
export function moveItems(ids, beforeId) {
  const list = items();
  const moving = list.filter((i) => ids.includes(i.id));
  if (!moving.length || ids.includes(beforeId)) return;
  const rest = list.filter((i) => !ids.includes(i.id));
  const at = beforeId ? rest.findIndex((i) => i.id === beforeId) : rest.length;
  rest.splice(at < 0 ? rest.length : at, 0, ...moving);
  setItems(rest);
  changed("project");
  commit();
}

// ---- Panoramas

// One selected slide: it becomes a panorama of 2. Several: they join into one panorama with the
// first one's photo (the others' photos leave the set; Undo brings them back).
export function makePanorama() {
  const chosen = selectedItems();
  if (!chosen.length) return;
  if (chosen.some(isVideo)) { toast("Videos can't be panoramas (Instagram plays each slide's video by itself)."); return; }
  if (chosen.length === 1) {
    if (room() < 1) { toast(`No room for another slide: the set can hold ${MAX()}.`); return; }
    setSpan(chosen[0], chosen[0].span + 1);
    commit();
    toast(`${chosen[0].span} slides now share one photo. Drag it to place it across them.`, undoAction);
    return;
  }
  const [first, ...others] = chosen;
  const span = chosen.reduce((n, i) => n + i.span, 0);
  setItems(items().filter((i) => !others.includes(i)));
  setSpan(first, span);
  state.selected = new Set([first.id]);
  state.current = first.id;
  changed("project");
  commit();
  toast(`Joined into one panorama across ${span} slides, using the first photo.`, undoAction);
}

// A panorama's number of slides (texts keep their place from the left; the photo fills the new
// width, Fill)
// The most slides a panorama can take: 10, or fewer when the set is nearly full
export const panoMost = (item) => Math.min(10, item.span + room());

// A layer's crop for a frame of another width (frame heights 1): the photo the same size and in the same place, the new
// frame's left edge `from` along the old one (changing a panorama's slides, splitting it)
function reframe(layer, oldW, newW, from = 0) {
  const pic = getPicture(layer.mediaId);
  if (!pic) return;
  const c = layer.crop;
  const before = photoSize(c, pic.width, pic.height, oldW, 1), after = photoSize(c, pic.width, pic.height, newW, 1);
  c.zoom *= before.dh / after.dh;
  c.x = (oldW / 2 + c.x * oldW - from - newW / 2) / newW;
}

export function setSpan(item, span) {
  span = Math.max(1, Math.min(span, item.span + room()));
  if (span === item.span) return;
  const a = aspectOf(set().ratio), oldW = item.span * a, newW = span * a;
  item.texts.forEach((t) => { t.x = (t.x * item.span) / span; });
  // (the extra photos stay where they are: slides come and go at the right)
  (item.layers || []).forEach((l) => reframe(l, oldW, newW));
  item.span = span;
  const pic = getPicture(item.mediaId);
  if (pic) fillCrop(item.crop, pic.width, pic.height, newW, 1);
  changed("project");
}

// A panorama back into separate slides, each showing its own part of the photo
export function splitPanorama() {
  const item = currentItem();
  if (!item || item.span < 2) { toast("Pick a panorama to split it apart."); return; }
  const pic = getPicture(item.mediaId);
  const N = item.span, a = aspectOf(set().ratio);
  const pieces = [];
  for (let k = 0; k < N; k++) {
    const piece = clone(item);
    piece.id = newId("s");
    piece.span = 1;
    // (the same photos, the same size and place: each square just shows its own part; an extra photo goes with each
    // slide it shows on, as its own copy)
    if (pic) reframe(piece, N * a, a, k * a);
    piece.layers = (piece.layers || []).filter((l) => {
      const lp = getPicture(l.mediaId);
      if (!lp) return false;
      const b = shownBox(l.crop, lp.width, lp.height, N * a, 1);
      const r = (b.rotation * Math.PI) / 180, half = (Math.abs(Math.cos(r)) * b.w + Math.abs(Math.sin(r)) * b.h) / 2;
      return b.cx + half > k * a && b.cx - half < (k + 1) * a;
    });
    piece.layers.forEach((l, i) => { if (k > 0) l.id = newId("l"); reframe(l, N * a, a, k * a); });
    piece.texts = item.texts
      .filter((t) => Math.min(N - 1, Math.floor(t.x * N)) === k)
      .map((t) => ({ ...t, id: newId("t"), x: t.x * N - k }));
    pieces.push(piece);
  }
  const list = items();
  list.splice(list.indexOf(item), 1, ...pieces);
  state.selected = new Set([pieces[0].id]);
  state.current = pieces[0].id;
  state.textId = null;
  changed("project");
  commit();
  toast(`Split into ${N} slides`, undoAction);
}

// ---- Copy / paste a look (⌘C / ⌘V)

let copiedLook = null;
export function copyLook() {
  const item = currentLayer();
  if (!item) return;
  copiedLook = clone(item.look);
  toast("Look copied: ⌘V puts it on the selected slides");
}
export function pasteLook() {
  if (!copiedLook) { toast("Copy a slide's look first (⌘C)"); return; }
  const chosen = selectedItems();
  chosen.forEach((item) => { item.look = clone(copiedLook); });
  changed("project");
  commit();
  toast(chosen.length === 1 ? "Look pasted" : `Look pasted on ${chosen.length} slides`, undoAction);
}


// ---- The app the set is shown as, and the set's shape

// Instagram | TikTok | YouTube: only how the set is shown (Phone view); there's one set to edit
export function setStage(platform) {
  const p = state.project;
  if (!STAGES[platform] || p.stage === platform) return;
  p.stage = platform;
  state.phonePlatform = platform;
  state.phoneSlide = Math.min(state.phoneSlide, slideCount(p) - 1);
  changed("view");
}

// The set's shape (its slides keep their places; the photos' crops are kept as shares of the frame)
export function setRatio(ratio) {
  const p = state.project;
  if (!SHAPES.includes(ratio) || p.set.ratio === ratio) return;
  p.set.ratio = ratio;
  changed("project");
  commit();
}

// ---- Layers: several photos on one slide

const LAYER_KEYS = ["mediaId", "crop", "look", "style", "masks", "cutout", "retouch"]; // (what a photo takes with it)
const frameOf = (item) => ({ W: item.span * aspectOf(set().ratio), H: 1 });

// Photos onto the slide on the canvas, as layers (a video slide too: the video stays at the bottom): in a grid they fill the next empty cells; free,
// each comes in smaller and a little apart from the last
export async function addLayerFiles(fileList) {
  const item = currentItem();
  if (!item) return;
  const files = [...fileList].filter((f) => isMediaFile(f) && !/^video\//.test(f.type) && !/\.(mp4|mov|m4v|webm)$/i.test(f.name));
  if (!files.length) { toast("Layers take photos."); return; }
  if (!isGrid(item)) item.layout.kind = "free";
  const { W, H } = frameOf(item);
  const added = [];
  for (const file of files) {
    try {
      const media = await addMediaFile(file, state.project.id);
      const layer = newLayer(media.id);
      const pic = getPicture(media.id);
      if (!isGrid(item) && pic) {
        fitCrop(layer.crop, pic.width, pic.height, W, H);
        const n = item.layers.length + added.length + 1;
        layer.crop.zoom *= 0.55;
        layer.crop.x = ((n % 4) - 1.5) * 0.12;
        layer.crop.y = ((n % 3) - 1) * 0.1;
      }
      added.push(layer);
    } catch (err) { console.error(err); toast(`${file.name} couldn't be opened.`); }
  }
  if (!added.length) return;
  item.layers.push(...added);
  state.photoPicked = true;
  state.textId = null;
  state.layerId = added[added.length - 1].id;
  changed("project");
  commit();
  toast(added.length === 1 ? "Added a photo to this slide" : `Added ${added.length} photos to this slide`, undoAction);
}

// Free, or a grid. Into a grid: each photo fills its cell. Out of a grid: each photo stays over
// the cell it was in, now free to move.
export function setLayout(kind) {
  const item = currentItem();
  if (!item || isVideo(item) || item.span > 1) return;
  const was = item.layout.kind;
  if (kind === was || (kind === "free" && was === "single")) return;
  const { W, H } = frameOf(item);
  if (LAYOUTS[kind]) {
    layersOf(item).forEach((l) => { l.crop = cropDefaults(); });
  } else if (LAYOUTS[was]) {
    const cells = cellRects(item, W, H);
    layersOf(item).forEach((l, i) => {
      const pic = getPicture(l.mediaId), c = cells[i];
      if (!pic || !c) return;
      const inCell = photoSize(l.crop, pic.width, pic.height, c.w, c.h);
      const plain = photoSize({ zoom: 1, stretch: 1 }, pic.width, pic.height, W, H);
      const cx = c.x + c.w / 2 + l.crop.x * c.w, cy = c.y + c.h / 2 + l.crop.y * c.h;
      l.crop = { ...l.crop, zoom: inCell.dh / plain.dh, x: (cx - W / 2) / W, y: (cy - H / 2) / H };
    });
  }
  item.layout.kind = kind;
  changed("project");
  commit();
  const cells = LAYOUTS[kind] ? LAYOUTS[kind].cells.length : 0;
  const count = layersOf(item).length;
  if (cells && count > cells) toast(`${count - cells} photo${count - cells === 1 ? " doesn't" : "s don't"} fit this layout: they wait in Layers`);
}

// Up (+1, towards the top / a later cell) or down (-1)
export const moveLayer = (layer, dir) => placeLayer(layer, layersOf(currentItem()).indexOf(layer) + dir);

// Put a photo at place `to` in the stack (0 = the bottom / the first cell): dragging in Layers
export function placeLayer(layer, to) {
  const item = currentItem();
  const all = layersOf(item);
  const from = all.indexOf(layer);
  if (from < 0 || to < 0 || to >= all.length || to === from) return;
  if (isVideo(item)) { if (from === 0) return; to = Math.max(1, to); if (to === from) { changed("project"); return; } } // (a video slide's video stays at the bottom: the photos go over it)
  // (the slide's own photo is the first layer: lift each layer's contents out, reorder, put back)
  const parts = all.map((l) => ({ ...(l === item ? { id: newId("l"), kind: "photo" } : l), ...Object.fromEntries(LAYER_KEYS.map((k) => [k, l[k]])) }));
  const [moved] = parts.splice(from, 1);
  parts.splice(to, 0, moved);
  LAYER_KEYS.forEach((k) => { item[k] = parts[0][k]; });
  item.layers = parts.slice(1);
  state.layerId = to === 0 ? null : moved.id; // (the pick follows the photo)
  changed("project");
  commit();
}

// A copy of a photo on the slide, just above it (⌘D or right-click → Duplicate on a picked photo);
// free, it sits a little down and right of the original so both show
// (false: nothing to copy, e.g. a video slide's video)
export function duplicateLayer(layer = currentLayer()) {
  const item = currentItem();
  if (!item || !layer || (layer === item && isVideo(item))) return false;
  const copy = { id: newId("l"), kind: "photo", ...Object.fromEntries(LAYER_KEYS.filter((k) => layer[k] !== undefined).map((k) => [k, clone(layer[k])])) };
  if (!isGrid(item)) {
    item.layout.kind = "free";
    copy.crop.x += 0.04;
    copy.crop.y += 0.04;
  }
  item.layers.splice(layersOf(item).indexOf(layer), 0, copy); // (just above it: layers come after the slide's own photo)
  state.photoPicked = true;
  state.textId = null;
  state.layerId = copy.id;
  changed("project");
  commit();
  toast("Photo duplicated", undoAction);
  return true;
}

// Take a photo off the slide (the slide always keeps one)
export function removeLayer(layer) {
  const item = currentItem();
  if (!item || !item.layers.length || (layer === item && isVideo(item))) return;
  if (layer === item) {
    const next = item.layers.shift();
    LAYER_KEYS.forEach((k) => { item[k] = next[k]; });
  } else item.layers = item.layers.filter((l) => l !== layer);
  if (!item.layers.length && !isGrid(item)) item.layout.kind = "single";
  state.layerId = null;
  changed("project");
  commit();
  toast("Photo taken off the slide", undoAction);
}
