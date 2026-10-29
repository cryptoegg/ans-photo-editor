// What the buttons and keys do to the set: add photos, duplicate, remove, reset, panoramas,
// copy / paste a look. Each is one undo step.
import { SAME_SHAPE_KEYS, state, changed, commit, undo, currentItem, currentLayer, selectedItems, items, setItems, tidySelection } from './state.js';
import { newItem, slideCount, cropDefaults, lookDefaults, clone, newId, activeSet, aspectOf, STAGES, PLATFORMS, isVideo, takesVideo, newLayer, layersOf, LAYOUTS, isGrid } from './project.js';
import { addMediaFile, isMediaFile, getPicture } from './media.js';
import { photoSize, fillCrop, fitCrop, cellRects } from './render.js';
import { toast } from './ui/toast.js';

const set = () => activeSet(state.project);
const room = () => set().max - slideCount(state.project);
const MAX = () => set().max;
const fullNote = () => `${PLATFORMS.find((x) => x.id === set().platform).label} takes up to ${MAX()} slides.`;
const undoAction = { label: "Undo", run: () => undo() };

// Every platform's set with what it takes: [{ platform, label, list, max, ratio }]
const allSets = () => Object.entries(state.project.stages).map(([k, st]) => ({ platform: k, label: PLATFORMS.find((x) => x.id === k).label, list: st.items, max: STAGES[k].max, ratio: st.ratio }));
const countOf = (list) => list.reduce((n, i) => n + i.span, 0);

// Photos and videos dropped or picked: added after the current slide (or at the end), and into
// every other platform's set too (each fitted to its shape, as far as it has room; videos only
// where they're taken: Instagram).
export async function addFiles(fileList) {
  const files = [...fileList].filter(isMediaFile);
  if (!files.length) { toast("Those aren't photos or videos this app can open."); return; }
  const here = set();
  const usable = takesVideo(here.platform) ? files : files.filter((f) => !/^video\//.test(f.type) && !/\.(mp4|mov|m4v|webm)$/i.test(f.name));
  if (!usable.length) { toast(`${PLATFORMS.find((x) => x.id === here.platform).label} posts take photos only. Videos go in Instagram.`); return; }
  const free = room();
  if (free <= 0) { toast(`The set is full: ${fullNote()}`); return; }
  const taking = usable.slice(0, free);
  toast(taking.length === 1 ? "Adding 1 file…" : `Adding ${taking.length} files…`);
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

  // …and into the other platforms' sets
  const notes = [];
  const reached = [PLATFORMS.find((x) => x.id === here.platform).label];
  {
    allSets().forEach((target) => {
      if (target.list === list) return;
      const fits = added.filter((i) => takesVideo(target.platform) || !isVideo(i));
      const roomThere = target.max - countOf(target.list);
      const copies = fits.slice(0, Math.max(0, roomThere)).map((i) => refit(clone(i), target.ratio));
      target.list.push(...copies);
      if (copies.length) reached.push(target.label);
      if (copies.length < fits.length) notes.push(`${target.label} took ${copies.length} (it's full at ${target.max})`);
      if (fits.length < added.length) notes.push(`${target.label} posts don't take video`);
    });
  }
  state.selected = new Set([added[0].id]);
  state.current = added[0].id;
  changed("project");
  commit();
  const what = added.length === 1 ? (isVideo(added[0]) ? "1 video" : "1 photo") : `${added.length} files`;
  const where = ` to ${reached.join(", ")}`;
  const left = files.length - taking.length;
  toast(`Added ${what}${where}${notes.length ? `. ${notes.join("; ")}` : ""}${left > 0 ? `. ${left} didn't fit (the set is full at ${MAX()})` : ""}`);
}

// Copy the selected slides into another platform's set: "all" = every other one.
// A slide already there (the same one) is skipped; videos only go where they're taken.
export function copySelectedTo(target) {
  const chosen = selectedItems();
  if (!chosen.length) return;
  const here = items();
  const targets = allSets().filter((t) => t.list !== here && (target === "all" || t.platform === target));
  const notes = [];
  targets.forEach((t) => {
    let copied = 0, skipped = 0;
    chosen.forEach((item) => {
      if (t.list.some((x) => x.id === item.id)) { skipped++; return; }
      if (isVideo(item) && !takesVideo(t.platform)) { skipped++; return; }
      if (countOf(t.list) + item.span > t.max) { skipped++; return; }
      t.list.push(refit(clone(item), t.ratio));
      copied++;
    });
    notes.push(`${t.label}: ${copied ? `${copied} copied` : "nothing new"}${skipped ? ` (${skipped} already there, full or a video)` : ""}`);
  });
  changed("project");
  commit();
  toast(notes.join(" · "), undoAction);
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
    copy.lookGroup = copy.id; // (its own look from here on)
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
  const only = set().platform ? ` from ${PLATFORMS.find((x) => x.id === set().platform).label} only` : "";
  toast(`${chosen.length === 1 ? "Removed 1 slide" : `Removed ${chosen.length} slides`}${only}`, undoAction);
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
export function setSpan(item, span) {
  span = Math.max(1, Math.min(span, item.span + room()));
  if (span === item.span) return;
  item.texts.forEach((t) => { t.x = (t.x * item.span) / span; });
  item.span = span;
  const pic = getPicture(item.mediaId);
  if (pic) fillCrop(item.crop, pic.width, pic.height, span * aspectOf(set().ratio), 1);
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
    piece.lookGroup = piece.id;
    piece.span = 1;
    if (pic) {
      // (the same photo, the same size and place: each square just shows its own part)
      const whole = photoSize(item.crop, pic.width, pic.height, N * a, 1);
      const plain = photoSize({ zoom: 1, stretch: 1 }, pic.width, pic.height, a, 1);
      piece.crop.zoom = whole.dh / plain.dh;
      piece.crop.x = (N * a / 2 + item.crop.x * N * a - (k + 0.5) * a) / a;
    }
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


// ---- Platforms: a stage each

function refit(item, ratio) {
  const pic = getPicture(item.mediaId);
  if (pic) fillCrop(item.crop, pic.width, pic.height, item.span * aspectOf(ratio), 1);
  item.texts.forEach((t) => { t.y = 0.5 + (t.y - 0.5) * Math.min(1, aspectOf(ratio)); }); // (kept in from the edges of a taller shape)
  return item;
}

// Which platform's set is being edited
export function setStage(platform) {
  const p = state.project;
  if (!STAGES[platform] || p.stage === platform) return;
  p.stage = platform;
  state.phonePlatform = platform;
  state.textId = null;
  state.photoPicked = false;
  tidySelection();
  changed("project");
  commit();
}

// A stage's shape (its slides keep their places; Fill puts a photo back to covering the new shape)
export function setRatio(ratio) {
  const p = state.project;
  const stage = p.stages[p.stage];
  if (!STAGES[p.stage].ratios.includes(ratio) || stage.ratio === ratio) return;
  stage.ratio = ratio;
  // Onto a shape another platform has: its slides join that platform's (their crops, texts and
  // layers come from there, so the two are edited together from now on)
  const twin = Object.entries(p.stages).find(([k, st]) => k !== p.stage && st.ratio === ratio);
  let joined = 0;
  if (twin) {
    const there = new Map(twin[1].items.filter((i) => !i.ownLook).map((i) => [i.lookGroup, i]));
    stage.items.forEach((item) => {
      const other = there.get(item.lookGroup);
      if (!other || item.ownLook || other.span !== item.span || other.kind !== item.kind) return;
      SAME_SHAPE_KEYS.forEach((k) => { item[k] = clone(other[k]); });
      joined++;
    });
  }
  changed("project");
  commit();
  const twins = Object.keys(p.stages).filter((k) => k !== p.stage && p.stages[k].ratio === ratio).map((k) => PLATFORMS.find((x) => x.id === k).label);
  if (joined) toast(`Same shape as ${twins.join(" and ")}: crops and text now match, and edits go to ${twins.length > 1 ? "all three" : "both"}`, undoAction);
}

// This slide's look: shared with the same slide on the other platforms, or its own
export function setOwnLook(own) {
  const chosen = selectedItems();
  chosen.forEach((item) => { item.ownLook = own; });
  changed("project");
  commit();
  toast(own ? "These slides now stand alone on this platform" : "Shared with the other platforms again");
}

// ---- Layers: several photos on one slide

const LAYER_KEYS = ["mediaId", "crop", "look", "style"];
const frameOf = (item) => ({ W: item.span * aspectOf(set().ratio), H: 1 });

// Photos onto the slide on the canvas, as layers: in a grid they fill the next empty cells; free,
// each comes in smaller and a little apart from the last
export async function addLayerFiles(fileList) {
  const item = currentItem();
  if (!item) return;
  if (isVideo(item) || item.span > 1) { toast(isVideo(item) ? "A video slide holds just the video." : "A panorama holds one photo."); return; }
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
  if (cells && count < cells) toast(`Click an empty cell (or ＋ Add photo) to fill it: ${cells - count} to go`);
  else if (cells && count > cells) toast(`${count - cells} photo${count - cells === 1 ? " doesn't" : "s don't"} fit this layout: they wait in Layers`);
}

// Up (+1, towards the top / a later cell) or down (-1)
export const moveLayer = (layer, dir) => placeLayer(layer, layersOf(currentItem()).indexOf(layer) + dir);

// Put a photo at place `to` in the stack (0 = the bottom / the first cell): dragging in Layers
export function placeLayer(layer, to) {
  const item = currentItem();
  const all = layersOf(item);
  const from = all.indexOf(layer);
  if (from < 0 || to < 0 || to >= all.length || to === from) return;
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

// Take a photo off the slide (the slide always keeps one)
export function removeLayer(layer) {
  const item = currentItem();
  if (!item || !item.layers.length) return;
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
