// What the buttons and keys do to the set: add photos, duplicate, remove, reset, panoramas,
// copy / paste a look. Each is one undo step.
import { state, changed, commit, undo, currentItem, selectedItems, items, setItems, tidySelection } from './state.js';
import { newItem, slideCount, cropDefaults, lookDefaults, clone, newId, activeSet, aspectOf, STAGES, PLATFORMS, LINKED_RATIOS } from './project.js';
import { addPhotoFile, isPhotoFile, getPicture } from './media.js';
import { photoSize, fillCrop } from './render.js';
import { toast } from './ui/toast.js';

const set = () => activeSet(state.project);
const room = () => set().max - slideCount(state.project);
const MAX = () => set().max;
const fullNote = () => (set().platform ? `${PLATFORMS.find((x) => x.id === set().platform).label} takes up to ${MAX()} slides.` : `${MAX()} slides is the most that suits all three platforms.`);
const undoAction = { label: "Undo", run: () => undo() };

// Photos dropped or picked: added after the current slide (or at the end), up to 10 slides
export async function addFiles(fileList) {
  const files = [...fileList].filter(isPhotoFile);
  if (!files.length) { toast("Those aren't photos this app can open."); return; }
  const free = room();
  if (free <= 0) { toast(`The set is full: ${fullNote()}`); return; }
  const taking = files.slice(0, free);
  toast(taking.length === 1 ? "Adding 1 photo…" : `Adding ${taking.length} photos…`);
  const list = items();
  const at = state.current ? list.findIndex((i) => i.id === state.current) + 1 : list.length;
  const added = [];
  for (const file of taking) {
    try {
      const mediaId = await addPhotoFile(file, state.project.id);
      added.push(newItem(mediaId));
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
  if (files.length > taking.length) toast(`Added ${taking.length}. The set is full at ${MAX()} slides, so ${files.length - taking.length} weren't added.`);
  else toast(added.length === 1 ? "Added 1 photo" : `Added ${added.length} photos`);
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
  const item = currentItem();
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


// ---- Platforms: Linked (one square set) or a stage each

// Linked off: each platform gets its own set. The first time they're made from the square set,
// each crop re-fitted (Fill) to that platform's shape; after that they're kept as you left them.
export function setLinked(linked) {
  const p = state.project;
  if (p.linked === linked) return;
  if (!linked && !p.stages) {
    p.stages = {};
    Object.entries(STAGES).forEach(([platform, info]) => {
      p.stages[platform] = { ratio: info.ratio, items: p.items.map((item) => refit(clone(item), info.ratio)) };
    });
    toast("Each platform now has its own set, copied from your linked set and re-fitted to its shape. Check the crops.");
  } else if (!linked) {
    toast("Back to each platform's own set, as you left it.");
  } else {
    toast("One linked set for all three again. Each platform's own set is kept for when you switch back.");
  }
  p.linked = linked;
  if (!linked) p.stage = state.phonePlatform || p.stage;
  state.textId = null;
  state.photoPicked = false;
  tidySelection();
  changed("project");
  commit();
}

function refit(item, ratio) {
  const pic = getPicture(item.mediaId);
  if (pic) fillCrop(item.crop, pic.width, pic.height, item.span * aspectOf(ratio), 1);
  item.texts.forEach((t) => { t.y = 0.5 + (t.y - 0.5) * Math.min(1, aspectOf(ratio)); }); // (kept in from the edges of a taller shape)
  return item;
}

// Which platform's set is being edited (Linked off)
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
  if (p.linked || !p.stages) {
    if (!LINKED_RATIOS.includes(ratio) || p.linkedRatio === ratio) return;
    p.linkedRatio = ratio; // (Linked: 1:1 or 4:5, shown in full on all three)
    changed("project");
    commit();
    return;
  }
  const stage = p.stages[p.stage];
  if (!STAGES[p.stage].ratios.includes(ratio) || stage.ratio === ratio) return;
  stage.ratio = ratio;
  changed("project");
  commit();
}

// This slide's look: shared with the same slide on the other platforms, or its own
export function setOwnLook(own) {
  const chosen = selectedItems();
  chosen.forEach((item) => { item.ownLook = own; });
  changed("project");
  commit();
  toast(own ? "These slides now have their own look on this platform" : "Look shared with the other platforms again");
}
