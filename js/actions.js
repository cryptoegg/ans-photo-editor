// What the buttons and keys do to the set: add photos, duplicate, remove, reset, panoramas,
// copy / paste a look. Each is one undo step.
import { state, changed, commit, undo, currentItem, selectedItems, items, setItems, tidySelection } from './state.js';
import { newItem, slideCount, cropDefaults, lookDefaults, clone, newId, activeSet, aspectOf, STAGES, PLATFORMS, LINKED_RATIOS, MAX_SLIDES, linkedRatio, isVideo, takesVideo } from './project.js';
import { addMediaFile, isMediaFile, getPicture } from './media.js';
import { photoSize, fillCrop } from './render.js';
import { toast } from './ui/toast.js';

const set = () => activeSet(state.project);
const room = () => set().max - slideCount(state.project);
const MAX = () => set().max;
const fullNote = () => (set().platform ? `${PLATFORMS.find((x) => x.id === set().platform).label} takes up to ${MAX()} slides.` : `${MAX()} slides is the most that suits all three platforms.`);
const undoAction = { label: "Undo", run: () => undo() };

// Every set in the record with what it takes: [{ platform (null = Linked), label, list, max, ratio }]
function allSets() {
  const p = state.project;
  const out = [{ platform: null, label: "Linked", list: p.items, max: MAX_SLIDES, ratio: linkedRatio(p) }];
  if (p.stages) Object.entries(p.stages).forEach(([k, st]) => out.push({ platform: k, label: PLATFORMS.find((x) => x.id === k).label, list: st.items, max: STAGES[k].max, ratio: st.ratio }));
  return out;
}
const countOf = (list) => list.reduce((n, i) => n + i.span, 0);

// Photos and videos dropped or picked: added after the current slide (or at the end). With a set
// per platform, they go into every platform's set too (each fitted to its shape, as far as it has
// room; videos only where they're taken: Instagram and Linked).
export async function addFiles(fileList) {
  const files = [...fileList].filter(isMediaFile);
  if (!files.length) { toast("Those aren't photos or videos this app can open."); return; }
  const here = set();
  const usable = takesVideo(here.platform) ? files : files.filter((f) => !/^video\//.test(f.type) && !/\.(mp4|mov|m4v|webm)$/i.test(f.name));
  if (!usable.length) { toast(`${PLATFORMS.find((x) => x.id === here.platform).label} posts take photos only. Videos go in Instagram (or Linked).`); return; }
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
  const reached = [here.platform ? PLATFORMS.find((x) => x.id === here.platform).label : "Linked"];
  if (state.project.stages) {
    allSets().forEach((target) => {
      if (target.list === list) return;
      const fits = added.filter((i) => takesVideo(target.platform) || !isVideo(i));
      const roomThere = target.max - countOf(target.list);
      const copies = fits.slice(0, Math.max(0, roomThere)).map((i) => refit(clone(i), target.ratio));
      target.list.push(...copies);
      if (copies.length) reached.push(target.label);
      if (copies.length < fits.length) notes.push(`${target.label} took ${copies.length} (it's full at ${target.max})`);
      if (fits.length < added.length && target.platform) notes.push(`${target.label} posts don't take video`);
    });
  }
  state.selected = new Set([added[0].id]);
  state.current = added[0].id;
  changed("project");
  commit();
  const what = added.length === 1 ? (isVideo(added[0]) ? "1 video" : "1 photo") : `${added.length} files`;
  const where = state.project.stages ? ` to ${reached.filter((x) => x !== "Linked" || !state.project.stages || state.project.linked).join(", ")}` : "";
  const left = files.length - taking.length;
  toast(`Added ${what}${where}${notes.length ? `. ${notes.join("; ")}` : ""}${left > 0 ? `. ${left} didn't fit (the set is full at ${MAX()})` : ""}`);
}

// Copy the selected slides into another platform's set (Linked off): "all" = every other one.
// A slide already there (the same one) is skipped; videos only go where they're taken.
export function copySelectedTo(target) {
  const chosen = selectedItems();
  if (!chosen.length) return;
  const here = items();
  const targets = allSets().filter((t) => t.platform && t.list !== here && (target === "all" || t.platform === target));
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
      p.stages[platform] = { ratio: info.ratio, items: p.items.filter((item) => takesVideo(platform) || !isVideo(item)).map((item) => refit(clone(item), info.ratio)) };
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
