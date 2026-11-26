// The panel on the right. At the top, what you're editing, in words ("Editing slide 3",
// "Editing all 7 slides") and a This slide / All switch: Filters and Adjust change every slide
// outlined in the filmstrip; Crop and Text always change the one on the canvas. Changing
// several slides at once says so in a note with Undo.
import { removeBackground, restoreBackground, cutoutStatus } from '../cutout.js';
import { brush, setBrush, setTool, clearTouchUps, brushStatus, cloneHasSource, sizeToSlider, sliderToSize, toolIcons, fxInHand, rememberFx, effectBrush } from './brush.js';
import { state, changed, commit, undo, historyList, historyGo, removeStep, currentItem, currentLayer, selectedItems, select, selectAll, onChange, items } from '../state.js';
import { newItem, slideLabel, LIGHT_DEFAULTS, COLOUR_DEFAULTS, partDefaults, newId, cropDefaults, activeSet, aspectOf, isVideo, LAYOUTS, layersOf, isGrid } from '../project.js';
import { PRESETS } from '../effects/presets.js';
import { getEffect, EFFECTS, effectOrder } from '../effects/registry.js';
import { vibeSettings, VIBE_DEFAULT } from '../effects/vibe.js';
import { COLOUR_PRESETS } from '../effects/colourPresets.js';
import { HSL_COLOURS } from '../effects/hsl.js';
import { addLutFile } from '../effects/lutStore.js';
import { curveControl, wheelsControl } from './colourControls.js';
import { MASK_KINDS, PAINTED, maskName, BRUSH_EFFECTS, RETIRED_EFFECTS, effectOf, tidyEffect } from '../masks.js';
import { addMask, pickMask, removeMask, pickedMask, pickingNow, WAND, setWandTolerance } from './masks.js';
import { myFilters, getFilter, filterName, freshChain, newEffect, saveMyFilter, deleteMyFilter, isMine } from '../filters.js';
import { presetSwatch, presetSwatchKept, effectSwatch } from '../looks.js';
import { listFilms, loadFilm, filmsCredit } from '../effects/filmTables.js';
import { getPicture } from '../media.js';
import { SHAPE_KINDS, SHAPE_DEFAULTS, layoutText, shownBox, TEXT_STYLES, FONTS, fillCrop, fitCrop, layerFrame, BLENDS, PHOTO_SHAPES, photoBox, trimOf } from '../render.js';
import { moveLayer, placeLayer, removeLayer, duplicateLayer } from '../actions.js';
import { showMenu } from './menu.js';
import { toast } from './toast.js';
import { cropToSubject } from '../autocrop.js';
import { loadBrand, brandNow, brandArtist, brandLogos, addLogo, removeLogo } from '../brand.js';
import { useFont } from '../fonts.js';
import { dbGet } from '../store.js';
import { giphyReady, searchGiphy, keepGif, keepGifFile } from '../gifs.js';
import { ask } from './dialogs.js';

const undoAction = { label: "Undo", run: () => undo() };

// Filters, grouped for people new to them: everyday looks first, the A New Song collection,
// then the strong creative ones
const EVERYDAY = ["ans-film-snapshot", "ans-clean-editorial", "ans-35mm-400", "expired-35mm", "film-scan", "faded-bw", "soft-bw", "grainy-bw", "painted-blur", "flash-at-night", "hard-light", "magazine-print", "photocopy"];
function filterGroups() {
  const everyday = EVERYDAY.map((id) => PRESETS.find((p) => p.id === id)).filter(Boolean);
  const ans = PRESETS.filter((p) => p.id.startsWith("ans-") && !EVERYDAY.includes(p.id));
  const creative = PRESETS.filter((p) => !EVERYDAY.includes(p.id) && !p.id.startsWith("ans-"));
  return [{ name: "Everyday", list: everyday }, { name: "A New Song", list: ans }, { name: "Creative", list: creative }];
}

let body = null;
let shownTab = null;
// (the presets row and the Tools box move into the left column's libraries, out of the page now and then, so they're
// kept here rather than looked up by id)
const keep = {};
const kept = (id) => keep[id] || (keep[id] = document.getElementById(id));

export function initPanel() {
  body = document.getElementById("tab-body");
  ["presets-row", "preset-pick", "tools-box"].forEach(kept);
  keep["presets-row"].remove(); keep["tools-box"].remove(); // (they live in the Filters and Tools libraries on the left)
  document.querySelectorAll("#scope-switch button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.scope === "all") selectAll();
    else if (state.current) select(state.current, "one");
  }));
  // The Editor's fold arrow: the column folds to a strip (remembered in this browser, like Media's)
  const foldEditor = (on) => {
    document.getElementById("panel").classList.toggle("folded", on);
    document.getElementById("workspace").classList.toggle("no-editor", on);
    const b = document.getElementById("btn-editor-open");
    b.classList.toggle("on", !on); b.title = on ? "Open the Editor" : "Fold the Editor";
    try { localStorage.setItem("ans_photo_editor_folded", on ? "1" : "0"); } catch (e) {}
    window.dispatchEvent(new Event("resize"));
  };
  let folded = false;
  try { folded = localStorage.getItem("ans_photo_editor_folded") === "1"; } catch (e) {}
  foldEditor(folded);
  // (one Editor button at the window's top right, open or folded, as the Lyric Visualiser's #nl-editor-btn: it opens and
  // shuts the column, lit while it's open; Tom, 2026-11-23)
  const editorBtn = document.getElementById("btn-editor-open");
  document.getElementById("workspace").append(editorBtn);
  editorBtn.onclick = () => foldEditor(!document.getElementById("panel").classList.contains("folded"));
  document.getElementById("btn-editor-fold").hidden = true;
  document.getElementById("panel").addEventListener("click", (e) => { if (e.target === e.currentTarget && e.currentTarget.classList.contains("folded")) foldEditor(false); });
  // The presets row: every filter (yours first), Save Preset (this slide's look as one of yours), the dice (a random one)
  const pick = kept("preset-pick");
  pick.onchange = () => { const chosen = lookItems().filter(Boolean); if (chosen.length && pick.value !== "-") useFilter(chosen, pick.value || null); };
  keep["presets-row"].querySelector("#btn-save-preset").onclick = () => saveThisFilter(lookItems().filter(Boolean));
  keep["presets-row"].querySelector("#btn-random").onclick = () => {
    const chosen = lookItems().filter(Boolean);
    if (!chosen.length) return;
    const all = [...myFilters(), ...PRESETS].filter((f) => f.id !== (lookItem() && lookItem().look.preset));
    useFilter(chosen, all[Math.floor(Math.random() * all.length)].id);
  };
  document.getElementById("panel").addEventListener("input", (e) => { if (e.target.type === "range") fillTrack(e.target); });
  onChange((what) => { if (what !== "look") build(); });
  document.addEventListener("focus-text", () => setTimeout(() => { const box = body.querySelector("textarea[data-text-content]"); if (box) { box.focus(); box.select(); } }, 0));
  build();
}

// ---- Layers: the photos on the slide on the canvas (top of the list = on top), click one to
// pick it (Filters, Adjust and Crop then change just that one), ↑ ↓ to reorder (in a grid: which
// cell), ✕ to take one off (or drag a row), right-click: Duplicate, ＋ Add layer. A slide saved in a
// grid keeps its gap and rounded corners.

// A layer's name in Layers: Photo 1, Photo 2…; on a video slide the bottom one is the Video
function layerLabel(item, i) {
  return isVideo(item) ? (i === 0 ? "Video" : `Photo ${i}`) : `Photo ${i + 1}`;
}

// Rows picked with ⌘ / Shift in Layers (for Group), by id
const layerPicks = new Set();
// Each group's name on this slide: Group 1, Group 2… in the order they first appear
function groupNamesOf(slide) {
  const names = new Map();
  [...layersOf(slide), ...slide.texts].forEach((x) => { if (x.group && !names.has(x.group)) names.set(x.group, `Group ${names.size + 1}`); });
  return names;
}
// Rename a row in place: its name becomes a box; Enter or leaving it keeps the name (empty: back to its own)
function renameRow(span, thing, fallback) {
  const input = el("input", { className: "layer-rename", value: thing.name || fallback });
  span.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const finish = (keepIt) => {
    if (done) return; done = true;
    const v = input.value.trim();
    if (keepIt) { if (v && v !== fallback) thing.name = v; else delete thing.name; }
    changed("project"); if (keepIt) commit();
  };
  input.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); };
  input.onblur = () => finish(true);
  input.onclick = (e) => e.stopPropagation();
}
const shapeLabel = (t) => (SHAPE_KINDS.find(([k]) => k === t.shape) || [, "Shape"])[1];

function buildLayersBox() {
  const box = document.getElementById("layers-box");
  const slide = currentItem();
  box.innerHTML = "";
  if (!slide) { box.hidden = true; return; }
  box.hidden = false;
  // (a video slide: the video is the bottom layer and stays there; photos go over it)
  const vid = isVideo(slide);
  const nameOf = (i) => layerLabel(slide, i);
  // (no layout templates (Tom, 2026-11-11): photos sit freely; a slide saved in a grid keeps it)
  const plus = button("+", () => document.dispatchEvent(new CustomEvent("add-layer")), "mc-plus");
  plus.title = "Another photo on this slide";
  // (Layers folds up and down like Light, Colour and the rest: Tom, 2026-11-18)
  const open = !openCards.has("layers:shut");
  const name = el("button", { className: "fold-name layers-fold", title: "Show / hide the layers" }, el("span", { className: "fold-arrow" }), el("span", { textContent: "Layers" }), el("span", { className: "mc-n", textContent: String(layersOf(slide).length + slide.texts.length) }));
  name.onclick = () => { if (open) openCards.add("layers:shut"); else openCards.delete("layers:shut"); changed("view"); };
  box.classList.toggle("open", open);
  box.append(el("div", { className: "layers-head" }, name, plus));
  if (!open) return;

  const all = layersOf(slide);
  const picked = currentLayer();
  const cells = isGrid(slide) ? LAYOUTS[slide.layout.kind].cells.length : Infinity;
  // (Tom, 2026-11-23, as Photoshop's: each row has an eye (hide) and a lock (it stays put on the canvas); double-click its
  // name to rename it; ⌘- or Shift-click rows to pick several, then Group: a group moves together on the canvas.
  // Captions and shapes are listed above the photos, as they're drawn over them.)
  const groupNames = groupNamesOf(slide);
  const rowParts = (thing, label, pickIt) => {
    const eye = el("button", { type: "button", className: "lr-btn lr-eye" + (thing.hidden ? " off" : ""), title: thing.hidden ? "Show" : "Hide", ariaLabel: thing.hidden ? "Show" : "Hide",
      onclick: (e) => { e.stopPropagation(); thing.hidden = !thing.hidden || undefined; if (!thing.hidden) delete thing.hidden; changed("project"); commit(); } });
    const lock = el("button", { type: "button", className: "lr-btn lr-lock" + (thing.locked ? " on" : ""), title: thing.locked ? "Unlock" : "Lock: it stays put on the canvas", ariaLabel: thing.locked ? "Unlock" : "Lock",
      onclick: (e) => { e.stopPropagation(); if (thing.locked) delete thing.locked; else thing.locked = true; changed("project"); commit(); } });
    const name = el("span", { className: "layer-name", textContent: thing.name || label, title: "Double-click to rename" });
    name.ondblclick = (e) => { e.stopPropagation(); renameRow(name, thing, label); };
    const tag = thing.group ? el("span", { className: "layer-group", textContent: groupNames.get(thing.group), title: "In a group: they move together (right-click: Ungroup)" }) : "";
    return { eye, lock, name, tag };
  };
  const key = (thing) => thing.id;
  const sel = layerPicks;
  for (const k of [...sel]) if (![...all, ...slide.texts].some((x) => key(x) === k)) sel.delete(k);
  const pickRow = (e, thing, plain) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) { if (sel.has(key(thing))) sel.delete(key(thing)); else sel.add(key(thing)); changed("view"); return true; }
    sel.clear();
    plain();
    return false;
  };
  const ungroupMenu = (e, thing) => {
    if (!thing.group) return false;
    const g = thing.group;
    showMenu(e, [{ label: "Ungroup", action: () => { [...all, ...slide.texts].forEach((x) => { if (x.group === g) delete x.group; }); changed("project"); commit(); } }]);
    return true;
  };

  // Captions and shapes (top of the list = on top)
  if (slide.texts.length) {
    const tl = el("div", { className: "layer-list" });
    slide.texts.map((t, i) => ({ t, i })).reverse().forEach(({ t, i }) => {
      const shape = t.kind === "shape", gif = t.kind === "gif";
      const label = gif ? (t.name || "GIF") : shape ? shapeLabel(t) : (String(t.content || "").split("\n")[0].trim().slice(0, 24) || "Caption");
      const { eye, lock, name, tag } = rowParts(t, label);
      const icon = el("span", { className: "layer-thumb layer-icon" + (gif ? " gif" : shape ? " shape" : " text"), textContent: gif ? (t.logo ? "Logo" : "GIF") : shape ? "" : "T" });
      if (shape) icon.style.setProperty("--fill", t.fill || "#ffffff");
      const row = el("div", { className: "layer-row" + (state.textId === t.id ? " on" : "") + (sel.has(t.id) ? " sel" : "") + (t.hidden ? " hidden-row" : "") },
        eye, icon, name, tag, el("span", { className: "spacer" }), lock);
      const up = button("↑", (e) => { e.stopPropagation(); slide.texts.splice(i, 1); slide.texts.splice(i + 1, 0, t); changed("project"); commit(); }, "btn ghost small");
      const down = button("↓", (e) => { e.stopPropagation(); slide.texts.splice(i, 1); slide.texts.splice(i - 1, 0, t); changed("project"); commit(); }, "btn ghost small");
      const del = button("✕", (e) => { e.stopPropagation(); slide.texts.splice(i, 1); if (state.textId === t.id) state.textId = null; changed("project"); commit(); }, "btn ghost small");
      up.disabled = i === slide.texts.length - 1; down.disabled = i === 0;
      up.title = "Bring forward"; down.title = "Send back"; del.title = gif ? "Delete this GIF" : shape ? "Delete this shape" : "Delete this caption";
      row.append(up, down, del);
      row.onclick = (e) => pickRow(e, t, () => { state.textId = t.id; state.photoPicked = false; state.layerId = null; changed("view"); });
      row.addEventListener("contextmenu", (e) => { if (ungroupMenu(e, t)) e.preventDefault(); });
      tl.append(row);
    });
    box.append(tl);
  }

  const list = el("div", { className: "layer-list" });
  all.map((layer, i) => ({ layer, i })).reverse().forEach(({ layer, i }) => {
    const pic = getPicture(layer.mediaId);
    const thumb = el("canvas", { width: 60, height: 60, className: "layer-thumb" });
    if (pic) { const src = pic.preview, s = Math.min(src.width, src.height); thumb.getContext("2d").drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, 60, 60); }
    const { eye, lock, name, tag } = rowParts(layer, `${nameOf(i)}${i >= cells ? " (no cell)" : ""}`);
    const row = el("div", { className: "layer-row" + (state.photoPicked && layer === picked ? " on" : "") + (sel.has(layer.id) ? " sel" : "") + (i >= cells ? " off" : "") + (layer.hidden ? " hidden-row" : "") },
      eye, thumb, name, tag, el("span", { className: "spacer" }),
      el("span", { className: "layer-where", textContent: all.length > 1 ? (i === 0 ? "Bottom" : i === all.length - 1 ? "Top" : "") : "" }), lock);
    const up = button("↑", (e) => { e.stopPropagation(); moveLayer(layer, 1); }, "btn ghost small");
    const down = button("↓", (e) => { e.stopPropagation(); moveLayer(layer, -1); }, "btn ghost small");
    const del = button("✕", (e) => { e.stopPropagation(); removeLayer(layer); }, "btn ghost small");
    up.disabled = i === all.length - 1;
    down.disabled = i === 0 || (vid && i === 1);
    if (vid && i === 0) up.disabled = true;
    up.title = isGrid(slide) ? "Later cell" : "Bring forward";
    down.title = isGrid(slide) ? "Earlier cell" : "Send back";
    del.title = "Take this photo off the slide";
    del.disabled = all.length === 1 || (vid && i === 0);
    row.append(up, down, del);
    row.onclick = (e) => { if (dragged) return; pickRow(e, layer, () => { state.photoPicked = true; state.textId = null; state.layerId = layer === slide ? null : layer.id; changed("view"); }); };
    row.addEventListener("contextmenu", (e) => {
      if (vid && i === 0) return;
      state.photoPicked = true; state.textId = null; state.layerId = layer === slide ? null : layer.id; changed("view");
      const entries = [{ label: "Duplicate", keys: "⌘D", action: () => duplicateLayer(layer) }];
      if (!(vid && i === 0)) entries.push(layer.cutout && layer.cutout.on && !layer.cutout.hand
        ? { label: "Bring background back", action: () => restoreBackground(layer) }
        : { label: "Remove background", action: () => removeBackground(layer) });
      if (all.length > 1) entries.push({ label: "Remove from slide", action: () => removeLayer(layer) });
      if (layer.group) entries.push({ label: "Ungroup", action: () => { const g = layer.group; [...all, ...slide.texts].forEach((x) => { if (x.group === g) delete x.group; }); changed("project"); commit(); } });
      showMenu(e, entries);
    });
    row.title = "Drag up or down to change the order";
    row.layer = layer;
    row.addEventListener("pointerdown", (e) => dragRow(e, row, list, all));
    list.append(row);
  });
  // (several picked: Group them, or Ungroup)
  if (sel.size > 1) {
    const chosen = [...all, ...slide.texts].filter((x) => sel.has(x.id));
    const bar = el("div", { className: "layer-sel-bar" },
      el("span", { textContent: `${chosen.length} picked` }), el("span", { className: "spacer" }),
      button("Group", () => { const g = newId("g"); chosen.forEach((x) => { x.group = g; }); sel.clear(); changed("project"); commit(); }, "btn small"),
      button("Ungroup", () => { chosen.forEach((x) => { delete x.group; }); sel.clear(); changed("project"); commit(); }, "btn small"));
    box.append(bar);
  }
  box.append(list);
  // (the picked photo's opacity and blend: Edit → Opacity, Tom 2026-11-23)
  if (isGrid(slide)) {
    const foot = el("div", { className: "row" });
    const gap = slider({ label: "Gap", min: 0, max: 10, step: 0.5, unit: "%", targets: [slide], get: (i) => i.layout.gap * 100, set: (i, v) => { i.layout.gap = v / 100; }, onCommit: () => {} });
    const round = slider({ label: "Corners", min: 0, max: 50, unit: "%", targets: [slide], get: (i) => i.layout.radius * 100, set: (i, v) => { i.layout.radius = v / 100; }, onCommit: () => {} });
    gap.classList.add("half");
    round.classList.add("half");
    foot.append(gap, round);
    box.append(foot);
  }
}

// The brush's Size (gradual: sizeToSlider) and Hardness, side by side (the Tools fold, Masks)
function brushSliders(sizeLabel = "Size") {
  const slider = (label, key, min, max, title = "", toV = (x) => x, fromV = (x) => x) => {
    const value = el("span", { className: "value", textContent: String(brush[key]) });
    const input = el("input", { type: "range", min, max, value: toV(brush[key]), title, oninput: (e) => { brush[key] = fromV(Number(e.target.value)); value.textContent = String(brush[key]); fillTrack(e.target); changed("look"); }, onchange: () => setBrush(key, brush[key]) });
    fillTrack(input);
    return el("label", { className: "field" }, el("span", { className: "field-head" }, el("span", { textContent: label }), value), input);
  };
  return el("div", { className: "pair" }, slider(sizeLabel, "size", 0, 1000, "[ ]", sizeToSlider, sliderToSize), slider("Hardness", "hardness", 0, 100, "Shift [ ]"));
}

// ---- Tools (Tom, 2026-11-18): everything that works on the picked photo itself, in one fold under Layers:
// Remove background, then the brushes: Remove, Clone, Edge brush
function buildToolsBox() {
  const box = kept("tools-box");
  const slide = currentItem();
  box.innerHTML = "";
  const picked = slide && currentLayer();
  if (!slide || !picked || (isVideo(slide) && picked === slide)) { box.hidden = true; return; }
  box.hidden = false;
  // (Tom, 2026-11-18: its own tab, between Adjust and Crop, so no fold of its own)
  box.classList.add("open");
  // The brushes (js/ui/brush.js): picked here, painted on the canvas; Esc or a second click puts one down.
  // Right-click the photo with one in hand for the same settings at the pointer.
  const cutOn = !!(picked.cutout && picked.cutout.on);
  if (state.tool === "edge" && !cutOn) state.tool = null;
  if (state.tool === "heal") state.tool = "remove";
  const icons = toolIcons("ti");
  icons.className = "tool-icons";
  box.append(icons);
  // Remove background (js/cutout.js), under the tools (Tom, 2026-11-26): the picked photo's cut-out, on / off
  box.append(cutoutRow(picked));
  // (the Effect brush: what it paints, Add / Erase and its size; the effect's own settings are in Effects on the right)
  if (fxInHand()) box.append(...effectBrushControls(pickedMask(), true, false));
  else if (state.tool && state.tool !== "mask") { // (the Mask brush's settings are with the picked mask, in Edit)
    box.append(brushSliders());
    if (state.tool === "edge" || state.tool === "clone") {
      const seg = el("div", { className: "segmented wide" });
      const opts = state.tool === "edge" ? [["edge", "erase", "Erase"], ["edge", "restore", "Restore"]] : [["blend", true, "Blend"], ["blend", false, "Exact copy"]];
      opts.forEach(([key, v, l]) => seg.append(el("button", { textContent: l, className: brush[key] === v ? "on" : "", onclick: () => setBrush(key, v) })));
      box.append(seg);
    }
    const hint = brushStatus.hint || (state.tool === "clone" && !cloneHasSource(picked) ? "Alt-click the photo where to copy from" : "");
    if (hint) box.append(el("div", { className: "tool-hint", textContent: hint }));
  }
  const touched = picked.retouch && (picked.retouch.patchId || (picked.retouch.tiles || []).length);
  if (touched) box.append(el("div", { className: "tool-row" }, button("Clear touch-ups", () => clearTouchUps(picked), "btn small cut-btn")));
  if (!isVideo(slide) || picked !== slide) box.append(masksList(picked));
}

function cutoutRow(layer) {
  const on = !!(layer.cutout && layer.cutout.on && !layer.cutout.hand); // (a mask made with the Eraser isn't a cut-out)
  const busy = cutoutStatus.busy;
  const label = busy && cutoutStatus.layer === layer.id
    ? (cutoutStatus.progress !== null && cutoutStatus.progress < 1 ? `Downloading the cut-out model ${Math.round(cutoutStatus.progress * 100)}%` : "Removing background…")
    : on ? "Background removed" : "Remove background";
  const b = button(label, () => (on ? restoreBackground(layer) : removeBackground(layer)), "btn small cut-btn" + (on ? " on" : "") + (busy ? " busy" : ""));
  b.disabled = busy;
  b.title = on ? "Click to bring the background back" : "Cut out the person or thing in this photo (the photo itself is kept)";
  const row = el("div", { className: "cut-row" }, b);
  if (cutoutStatus.error) row.append(el("span", { className: "note", textContent: cutoutStatus.error }));
  return row;
}

// Dragging a row in Layers up or down: the row moves through the list as you go, and letting go
// puts the photo there (the list shows the top first, so place 0 is the last row)
let dragged = false;
function dragRow(e, row, list, all) {
  if (e.button !== 0 || e.target.closest("button")) return;
  const startY = e.clientY;
  let moving = false;
  dragged = false;
  const move = (ev) => {
    if (!moving && Math.abs(ev.clientY - startY) < 4) return;
    // (once it's a drag, the list holds on to the pointer: the row itself moves around in it)
    if (!moving) { moving = true; row.classList.add("dragging"); list.setPointerCapture(ev.pointerId); }
    const rows = [...list.children];
    const over = rows.find((r) => r !== row && ev.clientY > r.getBoundingClientRect().top && ev.clientY < r.getBoundingClientRect().bottom);
    if (!over) return;
    const box = over.getBoundingClientRect(), mid = box.top + box.height / 2; // (both in screen px: the panel is drawn at --ui-zoom)
    if (ev.clientY < mid) list.insertBefore(row, over); else list.insertBefore(row, over.nextSibling);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    if (!moving) return;
    dragged = true;
    setTimeout(() => { dragged = false; }, 0); // (the click that ends a drag doesn't pick the row)
    row.classList.remove("dragging");
    placeLayer(row.layer, all.length - 1 - [...list.children].indexOf(row));
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

// What Filters, Adjust and Crop change: a picked extra layer by itself, else the selected slides
// (each slide's own photo)
// (sample: a blank photo standing in while the project is empty, so the settings can be looked through, greyed:
// Tom, 2026-11-23: new users click around before they start)
let sample = null;
const slideNow = () => sample || currentItem();
const layerNow = () => sample || currentLayer();
export const lookItems = () => (sample ? [sample] : state.layerId ? [currentLayer()] : selectedItems());
const lookItem = () => layerNow() || currentItem();
const layerName = (item, layer) => layerLabel(item, layersOf(item).indexOf(layer)).toLowerCase();

// ---- Building

// The right column (Tom, 2026-11-23, as the Lyric Visualiser's): its title names what's picked, then Layers, then the
// settings of what's picked: a caption's own, else Crop and Adjust (Light, Skin, Colour, Masks, Effects, Background).
// The libraries (Filters, Tools, Captions) are on the left: buildLibrary.
let rightTab = (() => { try { return localStorage.getItem("ans_photo_right_tab") === "effects" ? "effects" : "edit"; } catch { return "edit"; } })();
export function setRightTab(t) { rightTab = t; try { localStorage.setItem("ans_photo_right_tab", t); } catch {} changed("view"); }
const withBody = (host, fn, ...args) => { const keep = body; body = host; try { fn(...args); } finally { body = keep; } };
const pickedCaption = () => { const slide = currentItem(); return slide && state.textId ? slide.texts.find((t) => t.id === state.textId) : null; };

function build() {
  const p = state.project;
  const chosen = selectedItems();
  const all = items().length;
  const slide = currentItem();
  const caption = pickedCaption();
  // (This slide | Apply all: what Adjust and the filters change; a caption is on its own slide, so it's greyed then)
  const scoped = !caption;
  document.getElementById("scope-switch").classList.toggle("idle", !scoped);
  document.querySelectorAll("#scope-switch button").forEach((b) => {
    b.disabled = !scoped;
    b.classList.toggle("on", b.dataset.scope === "all" ? chosen.length > 1 && chosen.length === all : chosen.length === 1);
    if (b.dataset.scope === "all") b.textContent = all > 1 ? `Apply all (${all} slides)` : "Apply all";
  });
  document.getElementById("scope-switch").hidden = !all;
  // The title: what's picked
  const layer = currentLayer();
  // (only once something's picked on the canvas: a photo or a caption; nothing picked, no title: Tom, 2026-11-23)
  document.querySelector("#panel .ed-title").textContent = !slide ? ""
    : caption ? (caption.kind === "shape" ? "Shape" : caption.kind === "gif" ? (caption.logo ? "Logo" : "GIF") : "Caption")
    : state.photoPicked || state.layerId ? layerLabel(slide, layersOf(slide).indexOf(layer))
    : "";

  buildLayersBox();
  alignRow(slide, caption);
  // (a mask just picked in Tools: its settings are in Edit)
  // (Tom, 2026-11-26: an Effect brush's mask in Effects, the others in Edit)
  if (state.maskId && state.maskId !== maskSeen) { const pm = pickedMask(); rightTab = pm && pm.effect ? "effects" : "edit"; }
  maskSeen = state.maskId;
  const mode = caption ? "caption" : rightTab;
  const scroll = mode === shownTab ? body.scrollTop : 0; // (switching between a caption and a photo starts at the top)
  shownTab = mode;
  body.innerHTML = "";
  sample = all ? null : newItem(null);
  body.classList.toggle("sample", !!sample);
  if (caption) buildText("edit");
  else {
    // Edit | Effects (Tom, 2026-11-23, as a clip's in the Lyric Visualiser): Edit = Crop, Light, Skin, Colour, Masks,
    // Background; Effects = the filter and the effects on this photo, Add effect (the Effects library on the left too)
    const on = effectsOn(lookItem()).filter((e) => fxOf(lookItem(), e.type).on !== false).length + ((layerNow() && layerNow().masks) || []).filter((m) => m.effect && m.on).length;
    const tabs = el("div", { className: "segmented wide right-tabs" },
      el("button", { className: rightTab === "edit" ? "on" : "", textContent: "Edit", onclick: () => setRightTab("edit") }),
      el("button", { className: rightTab === "effects" ? "on" : "", textContent: on ? `Effects (${on})` : "Effects", onclick: () => setRightTab("effects") }));
    body.append(el("div", { className: "sticky" }, tabs));
    if (rightTab === "effects") buildEffectsTab(); else buildAdjust();
  }
  document.querySelectorAll('#panel input[type="range"]').forEach(fillTrack);
  pairSliders(body);
  body.scrollTop = scroll;
  // (the stand-in's settings show but can't be changed; the folds and the Edit | Effects tabs still open)
  if (sample) body.querySelectorAll("input, select, textarea, button:not(.fold-name):not(.right-tabs button)").forEach((x) => { x.disabled = true; });
  sample = null;
}

// A library on the left (js/ui/mediaColumn.js asks for it): Filters (the presets row, then the grid), Tools (Remove
// background and the brushes, for the picked photo), Captions (new captions and the slide's list of them)
export function buildLibrary(host, lib) {
  if (lib === "history") { buildHistory(host); return; }
  const all = items().length;
  if (!all) { host.append(note("Add photos first")); return; }
  if (lib === "filters") {
    fillPresets();
    const row = kept("presets-row");
    row.hidden = false;
    host.append(row);
    withBody(host, buildFilters);
  } else if (lib === "tools") {
    const box = kept("tools-box");
    host.append(box);
    buildToolsBox();
    if (box.hidden) withBody(host, buildTools);
  } else if (lib === "effects") withBody(host, buildEffectsLibrary);
  else if (lib === "captions") withBody(host, buildText, "add");
  else if (lib === "shapes") withBody(host, buildShapes);
  else if (lib === "gifs") withBody(host, buildGifs);
  else if (lib === "brand") withBody(host, buildBrand);
  host.querySelectorAll('input[type="range"]').forEach(fillTrack);
  pairSliders(host);
}

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); kids.forEach((k) => e.append(k)); return e; };
const note = (text) => el("p", { className: "note", textContent: text });
const title = (text, extra) => { const t = el("div", { className: "section-title", textContent: text }); if (extra) t.append(extra); return t; };
const button = (text, onclick, cls = "btn small") => el("button", { className: cls, textContent: text, onclick });

// "<what> applied to 7 slides · Undo" when a change reached more than one slide
function saidAcross(what, count) {
  if (count > 1) toast(`${what} applied to ${count} slides`, undoAction);
}

// A slider for a setting on these targets: shows "mixed" when they differ; moving it sets them
// all; let go = one undo step. get / set read and write one target's value.
function slider({ label, min, max, step = 1, targets, get, set, unit = "", reset = 0, onCommit }) {
  const values = targets.map(get);
  const mixed = values.some((v) => v !== values[0]);
  const field = el("label", { className: "field" + (mixed ? " mixed" : "") });
  const valueEl = el("span", { className: "value", textContent: mixed ? "" : `${Math.round(values[0])}${unit}` });
  const input = el("input", { type: "range", min, max, step, value: values[0] ?? reset });
  fillTrack(input);
  input.addEventListener("input", () => {
    fillTrack(input);
    const v = Number(input.value);
    targets.forEach((t) => set(t, v));
    field.classList.remove("mixed");
    valueEl.textContent = `${Math.round(v)}${unit}`;
    changed("look");
  });
  input.addEventListener("change", () => { commit(); if (onCommit) onCommit(); else saidAcross(label, targets.length); });
  field.addEventListener("dblclick", (e) => {
    if (e.target === input) return;
    targets.forEach((t) => set(t, reset));
    changed("look");
    commit();
    saidAcross(`${label} reset`, targets.length);
  });
  field.title = `${label} · double-click the name to reset`;
  field.append(el("span", { className: "field-head" }, el("span", { textContent: short(label) }), valueEl), input);
  return field;
}

// Compact editor (Tom, 2026-11-17, as the Lyric Visualiser): sliders next to each other in the tab sit two to a
// row (inside a fold the fold's own grid does it, in styles.css)
function pairSliders(host) {
  const isSlider = (n) => n && n.matches && n.matches("label.field") && n.querySelector(':scope > input[type="range"]');
  [...host.children].forEach((n) => {
    if (!isSlider(n) || n.parentElement !== host) return;
    const run = [n];
    for (let m = n.nextElementSibling; isSlider(m); m = m.nextElementSibling) run.push(m);
    if (run.length < 2) return;
    const pair = el("div", { className: "pair" });
    n.before(pair);
    pair.append(...run);
  });
}

// A short label, the full name on hover: "Mirror (left / right)" → "Mirror"
const short = (label) => String(label || "").replace(/\s*\(.*?\)\s*/g, " ").trim();

// (the blue part of a slider's track, up to its knob)
export function fillTrack(input) {
  const min = Number(input.min) || 0, max = Number(input.max) || 100;
  input.style.setProperty("--p", `${((Number(input.value) - min) / (max - min || 1)) * 100}%`);
}

function segmented(options, value, onPick) {
  const seg = el("div", { className: "segmented small" });
  options.forEach((o) => seg.append(el("button", { textContent: o.label, className: o.value === value ? "on" : "", onclick: () => onPick(o.value) })));
  return seg;
}

// The presets row's menu: Presets… (or the filter the chosen slides have), Original, Your filters, then the groups
function fillPresets() {
  const pick = kept("preset-pick");
  const chosen = lookItems().filter(Boolean);
  const ids = chosen.map((i) => i.look.preset || "");
  const same = ids.length && ids.every((x) => x === ids[0]) ? ids[0] : null;
  pick.innerHTML = "";
  pick.append(el("option", { value: "-", textContent: same && same !== "custom" ? filterName(same) : "Presets…", disabled: true }));
  pick.append(el("option", { value: "", textContent: "Original" }));
  const groups = [];
  if (myFilters().length) groups.push({ name: "Your filters", list: myFilters() });
  groups.push(...filterGroups());
  groups.forEach((g) => {
    const og = el("optgroup", { label: g.name });
    g.list.forEach((f) => og.append(el("option", { value: f.id, textContent: f.name })));
    pick.append(og);
  });
  pick.value = "-";
}

// Save this slide's whole look (its Light, Colour, filter and effects) as one of Your filters, for any project
async function saveThisFilter(chosen) {
  const item = lookItem();
  if (!item) return;
  const name = await ask("Name this filter", { ok: "Save", input: "" });
  if (name === null) return;
  const id = item.look.preset;
  const chain = item.look.chain || (id && id !== "custom" ? freshChain(id) : []);
  const filter = await saveMyFilter(name || "My filter", chain, { ...item.look.light }, { ...item.look.colour }, copy({ curves: item.look.curves, grade: item.look.grade, hsl: item.look.hsl, lut: item.look.lut }));
  chosen.forEach((i) => { if (i === item || JSON.stringify(i.look) === JSON.stringify(item.look)) i.look.preset = filter.id; });
  item.look.preset = filter.id;
  if (!item.look.chain) item.look.chain = chain;
  changed("project");
  commit();
  toast(`Saved "${filter.name}" to Your filters`);
}

// ---- Filters: the tiles (Original first), Strength floating at the top

let swatchJob = 0;

// Starred filters (kept in this browser) and whether only they show
const STAR_KEY = "ans_photo_fav_filters", ONLY_KEY = "ans_photo_fav_only";
function starredFilters() { try { return new Set(JSON.parse(localStorage.getItem(STAR_KEY) || "[]")); } catch { return new Set(); } }
function toggleStar(id) {
  const s = starredFilters();
  if (s.has(id)) s.delete(id); else s.add(id);
  try { localStorage.setItem(STAR_KEY, JSON.stringify([...s])); } catch {}
}
// (All | Starred | Film, and the Film list's brand: kept in this browser)
function filterShow() { try { const v = localStorage.getItem(ONLY_KEY); return v === "1" ? "starred" : v === "film" ? "film" : "all"; } catch { return "all"; } }
function setFilterShow(k) { try { localStorage.setItem(ONLY_KEY, k === "starred" ? "1" : k === "film" ? "film" : "0"); } catch {} }
function filmBrand() { try { return localStorage.getItem("ans_photo_film_brand") || ""; } catch { return ""; } }
function setFilmBrand(b) { try { localStorage.setItem("ans_photo_film_brand", b); } catch {} }

// Strength, floating at the top (only once a filter is on: filters work like presets, so no name)
function strengthBar(chosen) {
  const withFilter = chosen.filter((i) => i.look.preset);
  if (!withFilter.length) return "";
  const bar = el("div", { className: "sticky" });
  bar.append(slider({ label: "Strength", min: 0, max: 100, unit: "%", reset: 100, targets: withFilter, get: (i) => i.look.strength, set: (i, v) => { i.look.strength = v; } }));
  return bar;
}

// Put a filter on these slides (each gets its own fresh copy of it)
export function useFilter(chosen, id) {
  const filter = getFilter(id);
  chosen.forEach((i) => {
    i.look.preset = id;
    i.look.chain = id ? freshChain(id) : null;
    if (id && !i.look.strength) i.look.strength = 100;
    // (one of yours brings its Light and Colour with it)
    if (filter && filter.light) i.look.light = { ...LIGHT_DEFAULTS(), ...filter.light };
    if (filter && filter.colour) i.look.colour = { ...COLOUR_DEFAULTS(), ...filter.colour };
    if (filter && filter.colour) ["curves", "grade", "hsl", "lut"].forEach((k) => { i.look[k] = { ...partDefaults(k), ...copy(filter[k] || {}) }; });
  });
  changed("project");
  commit();
  saidAcross(id ? filterName(id) : "Original", chosen.length);
}

// Flick through the filters with the arrow keys (Tom, 2026-11-23): once a filter tile has been clicked, ← → step to the
// one before / after and ↑ ↓ to the row above / below, putting each on as it goes. A click anywhere else gives the
// arrows back to the slides.
let flicking = false;
document.addEventListener("pointerdown", (e) => { flicking = !!(e.target.closest && e.target.closest(".media-col .swatches .swatch")); }, true);
export function flickFilter(key) {
  if (!flicking || state.lib !== "filters") return false;
  const tiles = [...document.querySelectorAll(".media-col .swatches .swatch")];
  if (!tiles.length) return false;
  const cols = Math.max(1, tiles.filter((t) => t.offsetTop === tiles[0].offsetTop).length);
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[key];
  if (!step) return false;
  const at = tiles.findIndex((t) => t.classList.contains("on"));
  const to = at < 0 ? 0 : Math.max(0, Math.min(tiles.length - 1, at + step));
  if (to !== at) tiles[to].click();
  requestAnimationFrame(() => { const on = document.querySelector(".media-col .swatches .swatch.on"); if (on) on.scrollIntoView({ block: "nearest" }); });
  return true;
}

function buildFilters() {
  const chosen = lookItems();
  const item = lookItem();
  const presets = chosen.map((i) => i.look.preset);
  const mixed = presets.some((x) => x !== presets[0]);
  body.append(strengthBar(chosen));
  if (mixed) body.append(note("These slides have different filters. Picking one puts it on all of them."));

  const job = ++swatchJob;
  const queue = [];
  const tile = (filter) => {
    const id = filter ? filter.id : null;
    const on = !mixed && (presets[0] || null) === id;
    const b = el("button", { className: "swatch" + (on ? " on" : ""), title: filter ? filter.note || filter.name : "No filter" });
    const holder = el("div", { className: "blank" });
    b.append(holder, el("span", { textContent: filter ? filter.name : "Original" }));
    const ready = presetSwatchKept(item, id, 132); // (already made: drawn at once, so flicking doesn't blank the grid)
    if (ready) { const shown = el("canvas", { width: ready.width, height: ready.height }); shown.getContext("2d").drawImage(ready, 0, 0); holder.replaceWith(shown); }
    else queue.push(async () => {
      if (id && id.startsWith("film:")) await loadFilm(id.slice(5)); // (its table fetched first)
      if (job !== swatchJob) return;
      const c = presetSwatch(item, id, state.project.seed, 132);
      if (c) { const shown = el("canvas", { width: c.width, height: c.height }); shown.getContext("2d").drawImage(c, 0, 0); holder.replaceWith(shown); }
    });
    b.onclick = () => {
      useFilter(chosen, id);
    };
    return b;
  };
  // One grid (Original, Your filters, then every ready-made one). All | ★ Starred | Film: just the starred ones, or the
  // films brought in (js/effects/filmTables.js), one brand at a time
  const stars = starredFilters();
  const films = listFilms();
  let show = filterShow();
  if (show === "film" && !films.length) show = "all";
  const seg = el("div", { className: "segmented wide filter-show" });
  [["all", "All"], ["starred", "★ Starred"], ...(films.length ? [["film", "Film"]] : [])].forEach(([k, label]) => seg.append(el("button", {
    className: k === show ? "on" : "", textContent: label,
    onclick: () => { setFilterShow(k); changed("view"); }
  })));
  body.append(seg);
  const filmFilter = (f) => ({ id: `film:${f.id}`, name: f.name, note: `${f.brand} ${f.name}${f.kind === "Black & white" ? " (black & white)" : ""}` });
  const all = [...myFilters(), ...filterGroups().flatMap((g) => g.list)];
  let shown;
  if (show === "film") {
    const brands = [...new Set(films.map((f) => f.brand))];
    let brand = filmBrand();
    if (!brands.includes(brand)) brand = brands[0];
    const pick = el("select", { className: "select film-brand", title: "Brand" });
    brands.forEach((b) => pick.append(el("option", { value: b, textContent: b, selected: b === brand })));
    pick.onchange = () => { setFilmBrand(pick.value); changed("view"); };
    body.append(pick);
    shown = films.filter((f) => f.brand === brand).map(filmFilter);
  } else if (show === "starred") {
    shown = [...all, ...films.map(filmFilter)].filter((f) => stars.has(f.id));
  } else shown = all;
  const grid = el("div", { className: "swatches" });
  if (show === "all") grid.append(tile(null));
  shown.forEach((f) => {
    const t = tile(f);
    const starred = stars.has(f.id);
    t.append(el("span", {
      className: "swatch-star" + (starred ? " on" : ""), textContent: starred ? "★" : "☆", title: starred ? "Unstar" : "Star",
      onclick: (e) => { e.stopPropagation(); toggleStar(f.id); changed("view"); }
    }));
    grid.append(t);
  });
  body.append(grid);
  if (show === "starred" && !shown.length) body.append(note("No starred filters yet"));
  if (show === "film" && filmsCredit()) body.append(el("p", { className: "film-credit", textContent: `Film looks: ${filmsCredit()}` }));
  // (swatches drawn one at a time, so the panel opens at once)
  if (!item || !getPicture(item.mediaId)) return;
  const next = () => { if (job !== swatchJob || !queue.length) return; Promise.resolve(queue.shift()()).then(() => setTimeout(next, 0)); };
  setTimeout(next, 0);
}

// ---- Fold-out cards: a name that opens / closes its settings (▸ / ▾), an optional tick box
// (on / off), an optional one slider, and ↺ (back to its starting settings). Which are open is
// remembered while the app is open.

const openCards = new Set(); // (every fold shut to start: site rule 2)
function foldCard({ key, name, tick = null, quick = null, onReset = null, onRemove = null, build, off = false }) {
  const open = openCards.has(key);
  const card = el("div", { className: "fold-card" + (open ? " open" : "") + (off ? " off" : "") });
  const head = el("div", { className: "fold-head" });
  if (tick) head.append(tick);
  const label = el("button", { className: "fold-name", title: "Show / hide its settings" }, el("span", { className: "fold-arrow" }), el("span", { textContent: name }));
  label.onclick = () => { if (openCards.has(key)) openCards.delete(key); else openCards.add(key); changed("view"); };
  head.append(label, el("span", { className: "spacer" }));
  if (quick) head.append(quick);
  if (onReset) head.append(el("button", { className: "btn small fold-reset", textContent: "↺", title: "Back to its starting settings", onclick: onReset }));
  if (onRemove) head.append(el("button", { className: "btn small fold-reset fold-remove", title: "Take this effect off", ariaLabel: "Take this effect off", onclick: onRemove }));
  card.append(head);
  if (open) { const inner = el("div", { className: "fold-body" }); build(inner); card.append(inner); }
  return card;
}

// ---- The filter's own settings and every effect (in Adjust), listed like the lyric app's
// effects panel: the filter's Light and Colour (and its Curves, Per colour, LUT, wheels), then Effects, each with its tick
// box, its one slider and its settings folded under its name. Moving a setting of an effect
// that's off switches it on. A slide with no filter can switch effects on too (its own "Custom").

const ADJUST_TYPES = ["tone", "skin", "curves", "colour", "hsl", "lut", "grade"];
// An effect on a slide's look: the one in its chain (the filter's own copy), or none
const fxOf = (i, type) => (i.look.chain || (i.look.preset ? freshChain(i.look.preset) : [])).find((fx) => fx.type === type) || null;
// The effect on a slide, made (switched on, in its place in the order) if it isn't there yet
function ensureFx(i, type) {
  if (!i.look.chain) i.look.chain = i.look.preset ? freshChain(i.look.preset) : [];
  if (!i.look.preset) { i.look.preset = "custom"; i.look.strength = i.look.strength || 100; }
  let fx = i.look.chain.find((f) => f.type === type);
  if (!fx) {
    fx = newEffect(type);
    const effect = getEffect(type);
    if (effect.vibe) Object.assign(fx, vibeSettings(effect, VIBE_DEFAULT), { vibe: VIBE_DEFAULT });
    if ("sweep" in fx) fx.sweep = 0; // (a photo is a still: Scan's whole page already scanned, not mid-sweep)
    i.look.chain.push(fx);
    i.look.chain.sort((x, y) => effectOrder(x.type) - effectOrder(y.type));
  }
  fx.on = true;
  return fx;
}
// The effects that can be added (not Light / Colour and the rest, which are in Edit; not the ones a filter puts on)
const addable = () => EFFECTS.filter((e) => !ADJUST_TYPES.includes(e.type) && !e.later);
// The effects in a slide's look (on or switched off), in order
const effectsOn = (item) => (item ? EFFECTS.filter((e) => !ADJUST_TYPES.includes(e.type) && fxOf(item, e.type)) : []);

// Put an effect on the picked photo(s) and show it open in Effects
function addEffect(type) {
  const chosen = lookItems().filter(Boolean);
  if (!chosen.length) return;
  chosen.forEach((i) => ensureFx(i, type));
  openCards.add(`fx:${type}`);
  rightTab = "effects";
  try { localStorage.setItem("ans_photo_right_tab", "effects"); } catch {}
  changed("project");
  commit();
  saidAcross(getEffect(type).label, chosen.length);
}

// ---- The Effects library on the left (Tom, 2026-11-23, as the Lyric Visualiser's): every effect as a tile, drawn on the
// photo; a click puts it on the picked photo (lit: it's on already, a click opens it in Effects on the right)
let fxJob = 0;
function buildEffectsLibrary() {
  const item = lookItem();
  const job = ++fxJob, queue = [];
  const grid = el("div", { className: "swatches" });
  addable().forEach((effect) => {
    const on = !!item && !!fxOf(item, effect.type) && fxOf(item, effect.type).on !== false;
    const holder = el("div", { className: "blank" });
    const b = el("button", { className: "swatch" + (on ? " on" : ""), title: effect.description || effect.label }, holder, el("span", { textContent: effect.label }));
    b.onclick = () => { if (on) { openCards.add(`fx:${effect.type}`); setRightTab("effects"); } else addEffect(effect.type); };
    grid.append(b);
    queue.push(() => {
      if (job !== fxJob || !item) return;
      const fx = { type: effect.type, ...effect.defaults() };
      if (effect.vibe) Object.assign(fx, vibeSettings(effect, VIBE_DEFAULT));
      if ("sweep" in fx) fx.sweep = 0;
      const c = effectSwatch(item, fx, state.project.seed, 132);
      if (c) { const shown = el("canvas", { width: c.width, height: c.height }); shown.getContext("2d").drawImage(c, 0, 0); holder.replaceWith(shown); }
    });
  });
  body.append(grid);
  if (!item || !getPicture(item.mediaId)) return;
  const next = () => { if (job !== fxJob || !queue.length) return; queue.shift()(); setTimeout(next, 0); };
  setTimeout(next, 0);
}

// ---- Effects on the right: the filter's own Light and Colour (when it has one), each effect on this photo (its tick,
// one slider, its settings folded under its name), Add effect, then Save this filter / Reset filter
function buildEffectsTab() {
  const chosen = lookItems();
  const item = lookItem();
  if (!item) return;
  const id = item.look.preset;
  const targets = chosen;
  const done = () => { changed("project"); commit(); };
  const shown = (type) => fxOf(item, type) || { type, ...getEffect(type).defaults() };
  const resetTo = (type) => () => { targets.forEach((i) => { const fx = i.look.chain && i.look.chain.find((f) => f.type === type); if (fx) Object.assign(fx, getEffect(type).defaults()); }); done(); };
  const controlsOf = (effect) => (inner) => (effect.controls || []).forEach((c) => inner.append(effectControl(c, effect.type, targets, shown, ensureFx)));

  if (id && id !== "custom") {
    // (its Strength is on Filters only; the bin takes the filter off, back to Original: Tom, 2026-11-23)
    body.append(el("div", { className: "fx-filter-head" },
      el("span", { className: "fx-filter-name", textContent: filterName(id) || "Filter" }),
      el("button", { className: "btn small fold-reset fold-remove", title: "Take this filter off", ariaLabel: "Take this filter off", onclick: () => useFilter(targets, null) })));
    // (no Filter light / colour any more, Tom 2026-11-23: a filter's own light and colour stay inside it, scaled by
    // Strength; Edit's Light and Colour are the one set of sliders, on top of whatever filter is on)
  }
  effectsOn(item).forEach((effect) => {
    const fx = fxOf(item, effect.type);
    const on = !!fx && fx.on !== false;
    const tick = el("input", { type: "checkbox", checked: on, title: "Switch this effect on / off" });
    tick.onchange = () => { targets.forEach((i) => { if (tick.checked) ensureFx(i, effect.type); else { const f = i.look.chain && i.look.chain.find((x) => x.type === effect.type); if (f) f.on = false; } }); done(); };
    let quick = null;
    if (effect.vibe) {
      quick = el("input", { type: "range", min: 0, max: 100, step: 1, className: "fold-quick", value: on ? (fx.vibe > 0 ? fx.vibe : VIBE_DEFAULT) : 0, title: `${effect.label}: 0 = off, up to the full look` });
      const move = () => {
        const v = Number(quick.value);
        targets.forEach((i) => {
          if (v <= 0) { const f = i.look.chain && i.look.chain.find((x) => x.type === effect.type); if (f) { f.on = false; f.vibe = 0; } }
          else Object.assign(ensureFx(i, effect.type), vibeSettings(effect, v), { vibe: v });
        });
      };
      quick.addEventListener("input", () => { move(); changed("look"); });
      quick.addEventListener("change", () => { move(); done(); });
    }
    // (✕ takes it off the photo altogether: Tom, 2026-11-23)
    const remove = () => {
      targets.forEach((i) => {
        if (!i.look.chain) i.look.chain = i.look.preset ? freshChain(i.look.preset) : [];
        i.look.chain = i.look.chain.filter((x) => x.type !== effect.type);
        if (i.look.preset === "custom" && !i.look.chain.length) { i.look.preset = null; i.look.chain = null; }
      });
      openCards.delete(`fx:${effect.type}`);
      done();
    };
    body.append(foldCard({ key: `fx:${effect.type}`, name: effect.label, tick, quick, off: !on, onReset: resetTo(effect.type), onRemove: remove, build: controlsOf(effect) }));
  });
  // Painted effects (Tom, 2026-11-26): each Effect brush stroke set on this photo, its effect's settings here
  const layer = layerNow();
  ((layer && layer.masks) || []).filter((m) => m.effect).forEach((m) => {
    const key = `fxmask:${m.id}`;
    if (m.id === state.maskId && shownFxMask !== m.id) { shownFxMask = m.id; openCards.add(key); }
    const tick = el("input", { type: "checkbox", checked: !!m.on, title: "Switch this painted effect on / off" });
    tick.onchange = () => { m.on = tick.checked; done(); };
    body.append(foldCard({ key, name: `${maskName(layer, m)} · painted`, tick, off: !m.on, build: (inner) => {
      const paint = state.tool === "mask" && state.maskId === m.id;
      inner.append(el("div", { className: "row" }, el("button", { type: "button", className: "mask-btn" + (paint ? " lit" : ""), textContent: paint ? "Painting" : "Paint more", title: "Paint more of this effect on (Esc puts the brush down)", onclick: () => { if (state.maskId !== m.id) pickMask(m.id); setTool(paint ? null : "mask"); } })));
      inner.append(...effectBrushControls(m));
    }, onRemove: () => removeMask(layer, m.id) }));
  });
  const add = button("Add effect", (e) => {
    const have = new Set(effectsOn(item).map((x) => x.type));
    showMenu(e, addable().filter((x) => !have.has(x.type)).map((x) => ({ label: x.label, action: () => addEffect(x.type) })), { above: e.currentTarget });
  }, "btn add-effect");
  body.append(add);
  saveFilterSection(chosen);
}

// Save this filter: the slide's whole look (its Light, Colour, filter and effects) as one of Your
// filters, for any project. Always at the bottom of Adjust. Reset / Delete when it has a filter.
function saveFilterSection(chosen) {
  const item = lookItem();
  if (!item) return;
  const id = item.look.preset;
  const row = el("div", { className: "two" }, button("Save this filter", () => saveThisFilter(chosen), "btn"));
  const reset = button("Reset filter", () => { chosen.forEach((i) => { if (i.look.preset) i.look.chain = freshChain(i.look.preset); }); changed("project"); commit(); toast("Filter back to how it comes", undoAction); }, "btn");
  reset.disabled = !id || id === "custom";
  row.append(reset);
  body.append(row);
  if (id && isMine(id)) body.append(el("div", { className: "row" }, button("Delete from Your filters", async () => {
    if (!(await ask(`Delete "${filterName(id)}" from Your filters? Slides using it keep their look.`, { ok: "Delete", danger: true }))) return;
    await deleteMyFilter(id);
    changed("view");
  }, "btn ghost small")));
}

// One setting of an effect (built from its `controls`, like the lyric app's effects panel), on
// these slides. shown(type): the effect as the slide on the canvas has it (or its starting
// settings); ensure(slide, type): that slide's effect, switched on, made if needed.
function effectControl(c, type, targets, shown, ensure) {
  const done = () => { changed("project"); commit(); };
  const live = () => changed("look");
  const value = shown(type)[c.key];
  const setAll = (v) => targets.forEach((i) => { ensure(i, type)[c.key] = v; });
  if (c.kind === "curve" || c.kind === "wheels" || c.kind === "perColour" || c.lut) {
    const get = (i) => (i.look.chain || []).find((f) => f.type === type) || shown(type);
    return drawnControl(c, targets, get, (i) => ensure(i, type));
  }
  if (c.kind === "colour") {
    const input = el("input", { type: "color", value: value || "#000000" });
    input.oninput = () => { setAll(input.value); live(); };
    input.onchange = done;
    return el("div", { className: "row" }, el("span", { textContent: c.label }), input);
  }
  if (c.kind === "toggle") {
    const input = el("input", { type: "checkbox", checked: !!value });
    input.onchange = () => { setAll(input.checked); done(); };
    return el("label", { className: "check-row", title: c.label }, input, el("span", { textContent: short(c.label) }));
  }
  if (c.kind === "text") {
    const input = el("input", { className: "input", value: value || "" });
    input.oninput = () => { setAll(input.value); live(); };
    input.onchange = done;
    return el("div", { className: "field" }, el("span", { className: "field-head", textContent: c.label }), input);
  }
  if (c.kind === "segment") {
    return el("div", { className: "row" }, c.label ? el("span", { textContent: c.label }) : "", segmented(c.options, value, (v) => { setAll(v); done(); }));
  }
  if (c.kind === "choice") {
    const options = c.options.filter((o) => o.value !== "lyrics"); // (no song here)
    const input = el("select", { className: "select" });
    options.forEach((o) => input.append(el("option", { value: String(o.value), textContent: o.label, selected: String(o.value) === String(value) })));
    input.onchange = () => { const o = options.find((x) => String(x.value) === input.value); setAll(o ? o.value : input.value); done(); };
    return el("div", { className: "row" }, el("span", { textContent: c.label }), input);
  }
  const start = getEffect(type).defaults()[c.key];
  return slider({
    label: c.label, min: c.min, max: c.max, step: c.step || 1, targets, reset: typeof start === "number" ? start : 0,
    get: (i) => { const fx = (i.look.chain || []).find((f) => f.type === type); return Number((fx || shown(type))[c.key]) || 0; },
    set: (i, v) => { const fx = ensure(i, type); fx[c.key] = v; if (c.drives) Object.assign(fx, c.drives(fx, 0)); },
    onCommit: () => {}
  });
}

// ---- Adjust: Light, Colour and Background, each folding open (they follow This slide / All)

function buildAdjust() {
  const chosen = lookItems();
  const tone = getEffect("tone"), colour = getEffect("colour");
  const resetPart = (part, fresh, label) => () => { chosen.forEach((i) => { i.look[part] = fresh(); }); changed("project"); commit(); saidAcross(`${label} reset`, chosen.length); };
  body.append(foldCard({
    key: "adjust:light", name: "Light", onReset: resetPart("light", LIGHT_DEFAULTS, "Light"),
    build: (inner) => tone.controls.forEach((c) => inner.append(slider({
      label: c.label, min: c.min, max: c.max, step: c.step, targets: chosen,
      get: (i) => i.look.light[c.key], set: (i, v) => { i.look.light[c.key] = v; }
    })))
  }));
  // Skin (js/effects/skin.js): smooth it, even its tone, keep its texture
  const skin = getEffect("skin");
  const skinCard = foldCard({
    key: "adjust:skin", name: "Skin", onReset: resetPart("skin", skin.defaults, "Skin"),
    build: (inner) => skin.controls.forEach((c) => inner.append(slider({
      label: c.label, min: c.min, max: c.max, step: c.step, targets: chosen,
      get: (i) => (i.look.skin || skin.defaults())[c.key], set: (i, v) => { i.look.skin = { ...skin.defaults(), ...(i.look.skin || {}), [c.key]: v }; }
    })))
  });
  // Edit (Tom, 2026-11-23): the picked mask (if one is), Light, Colour, Skin, Crop, Opacity (Masks are in Tools) (the background colour is in the tools row)
  // Opacity (Tom, 2026-11-23, as in Edits): the picked photo (else the slide's own) seen through, and how it mixes with
  // what's under it
  const layer = lookItem();
  const opacityCard = layer ? foldCard({
    key: "adjust:opacity", name: "Opacity",
    onReset: () => { layer.style = { ...(layer.style || {}), opacity: 1, blend: "normal" }; changed("project"); commit(); },
    build: (inner) => {
      inner.append(slider({ label: "Opacity", min: 0, max: 100, unit: "%", reset: 100, targets: [layer],
        get: (l) => ((l.style && l.style.opacity) ?? 1) * 100, set: (l, v) => { l.style = l.style || {}; l.style.opacity = v / 100; }, onCommit: () => {} }));
      const blend = el("select", { className: "select", title: "How this photo mixes with what's under it" });
      Object.entries(BLENDS).forEach(([value, label]) => blend.append(el("option", { value, textContent: label })));
      blend.value = (layer.style && layer.style.blend) || "normal";
      blend.onchange = () => { layer.style = layer.style || {}; layer.style.blend = blend.value; changed("project"); commit(); };
      inner.append(el("label", { className: "field" }, el("span", { textContent: "Blend" }), blend));
    }
  }) : null;
  const mask = maskCard();
  if (mask) body.insertBefore(mask, body.querySelector(".fold-card"));
  body.append(colourCard(chosen), skinCard, foldCard({ key: "adjust:crop", name: "Crop", build: (inner) => withBody(inner, buildCrop) }));
  if (opacityCard) body.append(opacityCard);
}

// The Effect brush's settings (a mask carrying an effect, js/masks.js BRUSH_EFFECTS): which effect, its sliders,
// Add / Erase, Size and Hardness. In the Tools fold while it's in hand, and in Adjust → Masks when its row is picked.
const HIDDEN_FX_KEYS = ["speed", "wander", "phone", "movement", "start", "end", "drift"];
// (fresh: the Tools fold's menu: a different effect starts a new brush when this one has been painted, so what's painted
// keeps its effect; in Masks the menu changes the picked one's)
function effectBrushControls(m, fresh = false, withSettings = true) {
  const out = [];
  if (tidyEffect(m.effect) !== m.effect) m.effect = tidyEffect(m.effect); // (an effect since taken off the list)
  const pick = el("select", { className: "select", title: "The effect this brush paints" });
  [...BRUSH_EFFECTS, ...RETIRED_EFFECTS.filter(([id]) => id === m.effect.id)].forEach(([id, label]) => pick.append(el("option", { value: id, textContent: label, selected: m.effect.id === id })));
  pick.onchange = () => {
    rememberFx(pick.value);
    if (fresh && m.maskId) { effectBrush(pick.value); return; }
    m.effect = effectOf(pick.value); changed("project"); commit();
  };
  out.push(el("div", { className: "row" }, el("span", { textContent: "Effect" }), pick));
  const fx = getEffect(m.effect.type);
  const now = (x) => ({ ...fx.defaults(), ...x.effect.settings });
  const sliders = (fx.controls || []).filter((c) => !c.kind && !HIDDEN_FX_KEYS.includes(c.key)).map((c) => slider({
    label: c.label.replace(/\s*\(.*\)$/, ""), min: c.min, max: c.max, step: c.step || 1, targets: [m], get: (x) => Number(now(x)[c.key]) || 0, set: (x, v) => { x.effect.settings[c.key] = v; }
  }));
  if (withSettings) out.push(...sliders);
  out.push(el("div", { className: "row" }, segmented([{ value: "paint", label: "Add" }, { value: "erase", label: "Erase" }], brush.mask, (v) => { setBrush("mask", v); if (state.tool !== "mask") setTool("mask"); })));
  out.push(brushSliders("Brush size"));
  return out;
}

// ---- Masks (Tom, 2026-11-18, like Lightroom's; js/masks.js, js/ui/masks.js): fixes on part of the photo picked.
// (Tom, 2026-11-23: in Tools, with the brushes) The Tools library has Brush · Gradient · Subject, which add one, and a
// row per mask (picking it shows its handles on the canvas) with Invert, On / Off and ✕. The picked one's settings are on
// the right, in Edit: the brush's Add | Erase, Size and Hardness (a Brush mask), Feather (an old Round one), then its own
// Light and Colour sliders.
function masksList(layer) {
  const box = el("div", { className: "tools-masks" }, el("div", { className: "tools-head", textContent: "Masks" }));
  const kinds = el("div", { className: "mask-kinds" });
  MASK_KINDS.forEach(([kind, label, tip]) => kinds.append(el("button", { type: "button", className: "mask-kind" + (pickingNow() === kind ? " lit" : ""), textContent: kind === "subject" && cutoutStatus.busy ? "Finding…" : label, title: tip, disabled: kind === "subject" && cutoutStatus.busy, onclick: () => addMask(kind) })));
  box.append(kinds);
  if (pickingNow() === "wand") {
    const v = el("span", { className: "value", textContent: String(WAND.tolerance) });
    const input = el("input", { type: "range", min: 1, max: 100, value: WAND.tolerance, oninput: (e) => { setWandTolerance(Number(e.target.value)); v.textContent = e.target.value; fillTrack(e.target); } });
    fillTrack(input);
    box.append(el("label", { className: "field" }, el("span", { className: "field-head" }, el("span", { textContent: "Wand tolerance" }), v), input));
  }
  (layer.masks || []).forEach((m) => {
    const row = el("div", { className: "mask-row" + (m.id === state.maskId ? " on" : "") + (m.on ? "" : " off"), onclick: () => pickMask(m.id) });
    const flip = el("button", { type: "button", className: "mask-btn" + (m.invert ? " lit" : ""), textContent: "Invert", title: "Everything but this part", onclick: (e) => { e.stopPropagation(); m.invert = !m.invert; changed("project"); commit(); } });
    const eye = el("button", { type: "button", className: "mask-btn", textContent: m.on ? "On" : "Off", title: "Switch this mask on / off", onclick: (e) => { e.stopPropagation(); m.on = !m.on; changed("project"); commit(); } });
    const del = el("button", { type: "button", className: "mask-btn", textContent: "✕", title: "Delete this mask", onclick: (e) => { e.stopPropagation(); removeMask(layer, m.id); } });
    row.append(el("span", { className: "mask-name", textContent: maskName(layer, m) }), flip, eye, del);
    box.append(row);
  });
  return box;
}
// The picked mask's settings (Edit, first, open as it's picked)
let shownMask = null, maskSeen = null, shownFxMask = null;
function maskCard() {
  const layer = layerNow(), m = !sample && pickedMask();
  if (!m || !layer || m.effect) { shownMask = null; return null; } // (an Effect brush's: in Effects)
  const key = `mask:${m.id}`;
  if (shownMask !== m.id) { shownMask = m.id; openCards.add(key); }
  return foldCard({ key, name: `Mask · ${maskName(layer, m)}`, build: (inner) => {
    if (m.effect) {
      const paint = state.tool === "mask";
      inner.append(el("div", { className: "row" }, el("button", { type: "button", className: "mask-btn" + (paint ? " lit" : ""), textContent: paint ? "Painting" : "Paint", title: "Paint on the photo (Esc puts the brush down)", onclick: () => { setTool(paint ? null : "mask"); } })));
      inner.append(...effectBrushControls(m));
      return;
    }
    if (PAINTED.includes(m.kind)) {
      const paint = state.tool === "mask";
      inner.append(el("div", { className: "row" },
        el("button", { type: "button", className: "mask-btn" + (paint ? " lit" : ""), textContent: paint ? "Painting" : "Paint", title: "Paint on the photo (Esc puts the brush down)", onclick: () => { setTool(paint ? null : "mask"); } }),
        segmented([{ value: "paint", label: "Add" }, { value: "erase", label: "Erase" }], brush.mask, (v) => { setBrush("mask", v); if (state.tool !== "mask") setTool("mask"); })));
      inner.append(brushSliders());
    }
    if (m.kind === "radial") inner.append(slider({ label: "Feather", min: 0, max: 100, targets: [m], get: (x) => x.round.feather, set: (x, v) => { x.round.feather = v; } }));
    [["tone", "light"], ["colour", "colour"]].forEach(([type, part]) => (getEffect(type).controls || []).filter((c) => !c.kind).forEach((c) => inner.append(slider({
      label: c.label, min: c.min, max: c.max, step: c.step, targets: [m], get: (x) => x[part][c.key], set: (x, v) => { x[part][c.key] = v; }
    }))));
  } });
}

// ---- Colour (Tom, 2026-11-18, as the Lyric Visualiser's one Colour card): Presets… on top (js/effects/colourPresets.js:
// each sets Basic, Curves and the wheels, so everything can still be moved after), then the tabs Basic (Temperature,
// Tint, Saturation, Vibrance, Colour | B&W) · Curves · Wheels (Colour Grading) · Mixer (per colour: eight colours' hue,
// saturation, luminance) · LUT (your own .cube files). The last tab is remembered in this browser. ↺ resets all five.

const COLOUR_TABS = [{ value: "basic", label: "Basic" }, { value: "curves", label: "Curves" }, { value: "grade", label: "Wheels" }, { value: "hsl", label: "Mixer", title: "Per colour: the hue, saturation and luminance of each colour" }, { value: "lut", label: "LUT" }];
const pref = (key, start) => { try { return localStorage.getItem(key) || start; } catch (err) { return start; } };
const keepPref = (key, value) => { try { localStorage.setItem(key, value); } catch (err) { /* this time only */ } };
const copy = (v) => JSON.parse(JSON.stringify(v));

function colourCard(chosen) {
  const reset = () => {
    chosen.forEach((i) => { i.look.colour = COLOUR_DEFAULTS(); ["curves", "grade", "hsl", "lut"].forEach((k) => { i.look[k] = partDefaults(k); }); });
    changed("project"); commit(); saidAcross("Colour reset", chosen.length);
  };
  return foldCard({ key: "adjust:colour", name: "Colour", onReset: reset, build: (inner) => {
    const pick = el("select", { className: "select colour-presets", title: "A ready-made grade (every part can still be moved after)" });
    pick.append(el("option", { value: "", textContent: "Presets…" }), ...COLOUR_PRESETS.map((p, n) => el("option", { value: String(n), textContent: p.name })));
    pick.onchange = () => {
      const p = COLOUR_PRESETS[Number(pick.value)];
      if (!p) return;
      chosen.forEach((i) => {
        i.look.colour = { ...COLOUR_DEFAULTS(), ...(p.colour || {}) };
        i.look.curves = { ...partDefaults("curves"), ...copy(p.curves || {}) };
        i.look.grade = { ...partDefaults("grade"), ...(p.grade || {}) };
      });
      changed("project"); commit(); saidAcross(p.name, chosen.length);
    };
    const tab = COLOUR_TABS.some((t) => t.value === pref("ans_photo_colour_tab", "basic")) ? pref("ans_photo_colour_tab", "basic") : "basic";
    const tabs = segmented(COLOUR_TABS, tab, (v) => { keepPref("ans_photo_colour_tab", v); changed("view"); });
    [...tabs.children].forEach((b, n) => { if (COLOUR_TABS[n].title) b.title = COLOUR_TABS[n].title; });
    tabs.classList.add("colour-tabs");
    inner.append(pick, tabs);
    if (tab === "basic") {
      const colour = getEffect("colour");
      const monos = chosen.map((i) => !!i.look.colour.mono);
      inner.append(el("div", { className: "row" }, segmented([{ value: false, label: "Colour" }, { value: true, label: "B&W" }], monos.every((m) => m === monos[0]) ? monos[0] : null, (v) => {
        chosen.forEach((i) => { i.look.colour.mono = v; });
        changed("project"); commit(); saidAcross(v ? "B&W" : "Colour", chosen.length);
      })));
      colour.controls.filter((c) => !c.kind).forEach((c) => inner.append(slider({
        label: c.label, min: c.min, max: c.max, step: c.step, targets: chosen,
        get: (i) => i.look.colour[c.key], set: (i, v) => { i.look.colour[c.key] = v; }
      })));
      return;
    }
    const own = (i) => (i.look[tab] = i.look[tab] || partDefaults(tab));
    effectControls(getEffect(tab), chosen, own, own).forEach((n) => inner.append(n));
  } });
}

// An effect's settings for these slides: get(slide) = its settings to show, own(slide) = its settings to change
function effectControls(effect, targets, get, own) {
  const start = effect.defaults();
  return (effect.controls || []).map((c) => (c.kind || c.lut) ? drawnControl(c, targets, get, own) : slider({
    label: c.label, min: c.min, max: c.max, step: c.step || 1, targets, reset: typeof start[c.key] === "number" ? start[c.key] : 0,
    get: (i) => Number(get(i)[c.key]) || 0, set: (i, v) => { own(i)[c.key] = v; }
  }));
}

// The drawn colour controls (Curves, the wheels, Per colour) and the LUT menu, on these slides (the slide's own Colour
// card, or a filter's: get / own as in effectControls)
let hslPick = pref("ans_photo_hsl_pick", "red");
function drawnControl(c, targets, get, own) {
  const shownOn = () => lookItem() && targets.includes(lookItem()) ? lookItem() : targets[0];
  const values = () => get(shownOn());
  let root = null;
  const set = (patch, done) => {
    targets.forEach((i) => Object.assign(own(i), copy(patch)));
    if (root && root.paint) root.paint(values());
    if (done && !(Object.keys(patch).length === 1 && "channel" in patch)) { changed("project"); commit(); } else changed("look");
  };
  if (c.kind === "curve") return (root = curveControl({ values, set }));
  if (c.kind === "wheels") return (root = wheelsControl({ values, set }, c.parts));
  if (c.kind === "perColour") {
    const box = el("div", { className: "per-colour" });
    const dots = el("div", { className: "hsl-dots" });
    const name = (HSL_COLOURS.find(([k]) => k === hslPick) || HSL_COLOURS[0])[1];
    HSL_COLOURS.forEach(([k, label, , ink]) => {
      const v = values(), moved = ["Hue", "Sat", "Lum"].some((w) => Number(v[k + w]));
      dots.append(el("button", { className: "hsl-dot" + (k === hslPick ? " on" : "") + (moved ? " moved" : ""), title: label, style: `--dot:${ink}`, onclick: () => { hslPick = k; keepPref("ans_photo_hsl_pick", k); changed("view"); } }));
    });
    box.append(dots);
    [["Hue", "Hue"], ["Sat", "Saturation"], ["Lum", "Luminance"]].forEach(([w, label]) => box.append(slider({
      label: `${label} (${name})`, min: -100, max: 100, targets, get: (i) => Number(get(i)[hslPick + w]) || 0, set: (i, v) => { own(i)[hslPick + w] = v; }
    })));
    return box;
  }
  // (LUT: your own .cube files and HaldCLUT pictures, and Load a LUT… at the end)
  const input = el("select", { className: "select" });
  const now = values()[c.key];
  c.options.forEach((o) => input.append(el("option", { value: String(o.value), textContent: o.label, selected: String(o.value) === String(now) })));
  input.append(el("option", { value: "+load", textContent: "Load a LUT (.cube or HaldCLUT .png)…" }));
  input.onchange = () => {
    if (input.value !== "+load") { set({ [c.key]: input.value }, true); return; }
    input.value = String(now);
    const file = el("input", { type: "file", accept: ".cube,.png,image/png" });
    file.onchange = async () => {
      if (!file.files[0]) return;
      try { const id = await addLutFile(file.files[0]); set({ [c.key]: id }, true); }
      catch (err) { toast(err.message || "That file couldn't be read"); }
    };
    file.click();
  };
  return el("div", { className: "row" }, el("span", { textContent: c.label }), input);
}

// ---- Tools (Tom, 2026-11-18): Remove background and the brushes, in the box above (buildToolsBox); just a word when
// there's no photo to work on
function buildTools() {
  const slide = currentItem(), picked = slide && currentLayer();
  if (!picked || (isVideo(slide) && picked === slide)) body.append(note("Pick a photo"));
}

// ---- Crop (the slide on the canvas only)

const svgIcon = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.8" stroke-linejoin="round">${inner}</svg>`;
const starPts = Array.from({ length: 10 }, (_, i) => { const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? 4 : 9.5; return `${(12 + Math.cos(a) * k).toFixed(1)},${(12.6 + Math.sin(a) * k).toFixed(1)}`; }).join(" ");
const SHAPE_ICONS = {
  rect: svgIcon('<rect x="3.5" y="5.5" width="17" height="13" rx="1"/>'),
  circle: svgIcon('<circle cx="12" cy="12" r="8.5"/>'),
  triangle: svgIcon('<path d="M12 3.5 21 20H3z"/>'),
  diamond: svgIcon('<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/>'),
  hexagon: svgIcon('<path d="M7.5 3.5h9L21 12l-4.5 8.5h-9L3 12z"/>'),
  star: svgIcon(`<polygon points="${starPts}"/>`),
  heart: svgIcon('<path d="M12 20.5C4.5 15 2.5 10.5 4.2 7 5.8 3.8 10 3.6 12 7c2-3.4 6.2-3.2 7.8 0 1.7 3.5-.3 8-7.8 13.5z"/>'),
  arch: svgIcon('<path d="M4.5 21V11a7.5 7.5 0 0 1 15 0v10z"/>')
};
// Picking Circle: the part that shows made square (the longer sides trimmed evenly), so it's round, not an oval
function squareUp(item, pic, frame) {
  const b = photoBox(item.crop, pic.width, pic.height, frame.w, frame.h), t = trimOf(item.crop);
  const sw = b.w * (1 - t.l - t.r), sh = b.h * (1 - t.t - t.b);
  if (sw > sh) { const k = (sw - sh) / b.w / 2; t.l += k; t.r += k; } else { const k = (sh - sw) / b.h / 2; t.t += k; t.b += k; }
  item.crop.trim = t;
}

function buildCrop() {
  const slide = slideNow();
  if (!slide) return;
  const item = lookItem(); // (the picked layer: its crop)
  const pic = getPicture(item.mediaId);
  const many = layersOf(slide).length > 1;
  const act = (fn) => () => { fn(); changed("project"); commit(); };
  const frame = () => layerFrame(slide, item, slide.span * aspectOf(activeSet(state.project).ratio), 1) || { w: 1, h: 1 };
  const inGrid = isGrid(slide);
  const fitFill = el("div", { className: "segmented wide" },
    el("button", { textContent: "Fit", title: "The whole photo, on the background", onclick: act(() => { if (pic) { delete item.crop.trim; fitCrop(item.crop, pic.width, pic.height, frame().w, frame().h); } }) }),
    el("button", { textContent: "Fill", title: "The photo covers the slide", onclick: act(() => { if (pic) { delete item.crop.trim; fillCrop(item.crop, pic.width, pic.height, frame().w, frame().h); } }) }),
    // (Tom, 2026-11-26) Subject: framed round the person (js/autocrop.js); with several slides picked in the strip, each one's own photo
    el("button", { textContent: cutoutStatus.busy ? "Finding…" : "Subject", disabled: cutoutStatus.busy || !pic || pic.kind === "video", title: "Frame the person: the photo zoomed and centred on them",
      onclick: async () => {
        const chosen = selectedItems().filter((s) => !isVideo(s));
        const jobs = chosen.length > 1 ? chosen.map((s) => [s, s, { w: s.span * aspectOf(activeSet(state.project).ratio), h: 1 }]) : [[slide, item, frame()]];
        let moved = 0;
        for (const [, layer, f] of jobs) if (await cropToSubject(layer, f.w, f.h)) moved++;
        if (moved) { changed("project"); commit(); }
        if (moved < jobs.length) toast(jobs.length > 1 ? `No subject found on ${jobs.length - moved} of ${jobs.length} slides` : "No subject found in this photo");
      } }));
  body.append(fitFill);
  // The photo's shape (Tom, 2026-11-18): it fills the part that shows (the side handles on the canvas trim it)
  if (!inGrid && item.style) {
    const now = item.style.shape || "rect";
    body.append(el("div", { className: "tool-icons shape-icons" }, ...PHOTO_SHAPES.map(([shape, label]) => el("button", {
      type: "button", className: `ti${now === shape ? " on" : ""}`, title: label, ariaLabel: label,
      style: `--i: url("data:image/svg+xml,${encodeURIComponent(SHAPE_ICONS[shape])}")`,
      onclick: act(() => { item.style.shape = shape; if (shape === "circle" && pic) squareUp(item, pic, frame()); })
    }))));
  }
  body.append(slider({
    label: "Zoom", min: 5, max: 400, unit: "%", reset: 100, targets: [item],
    get: (i) => i.crop.zoom * 100, set: (i, v) => { i.crop.zoom = v / 100; }, onCommit: () => {}
  }));
  body.append(slider({
    label: "Turn", min: -180, max: 180, step: 0.5, unit: "°", targets: [item],
    get: (i) => i.crop.rotation, set: (i, v) => { i.crop.rotation = v; }, onCommit: () => {}
  }));
  // Straighten and perspective (Tom, 2026-11-23): drag a line on the photo that should be level or upright; Vertical /
  // Horizontal tip the photo back so leaning walls stand straight (crop.keystone, js/looks.js)
  if (!isVideo(slide) || item !== slide) {
    body.append(el("div", { className: "row" }, button("Straighten", () => { document.dispatchEvent(new CustomEvent("straighten")); toast("Drag along something that should be level or upright (Esc: never mind)"); }, "btn small"), el("span", { className: "spacer" })));
    [["v", "Vertical"], ["h", "Horizontal"]].forEach(([k, label]) => body.append(slider({ label, min: -100, max: 100, step: 1, reset: 0, targets: [item],
      get: (i) => (i.crop.keystone && i.crop.keystone[k]) || 0, set: (i, v) => { i.crop.keystone = { v: 0, h: 0, ...(i.crop.keystone || {}), [k]: v }; }, onCommit: () => {} })));
  }
  body.append(el("div", { className: "four" },
    button("↺ 90°", act(() => { item.crop.rotation = ((item.crop.rotation - 90 + 540) % 360) - 180; })),
    button("↻ 90°", act(() => { item.crop.rotation = ((item.crop.rotation + 90 + 540) % 360) - 180; })),
    button("Flip ↔", act(() => { item.crop.flipH = !item.crop.flipH; })),
    button("Flip ↕", act(() => { item.crop.flipV = !item.crop.flipV; }))));
  const lock = el("input", { type: "checkbox", checked: item.crop.lockRatio !== false });
  lock.onchange = act(() => { item.crop.lockRatio = lock.checked; if (lock.checked) item.crop.stretch = 1; });
  body.append(el("div", { className: "row" },
    el("label", { className: "check-row", title: "Off: dragging a corner can stretch the photo" }, lock, el("span", { textContent: "Lock ratio" })),
    el("span", { className: "spacer" }),
    button("Reset", act(() => { item.crop = cropDefaults(); }), "btn ghost small")));

  // A photo's own style (free layouts): rounded corners, a border, a soft shadow
  if (!inGrid && (many || slide.layout.kind === "free")) {
    const st = item.style;
    body.append(title("Photo style"));
    if ((st.shape || "rect") === "rect") body.append(slider({ label: "Corners", min: 0, max: 50, unit: "%", targets: [item], get: (i) => (i.style.radius || 0) * 100, set: (i, v) => { i.style.radius = v / 100; }, onCommit: () => {} }));
    body.append(slider({ label: "Border", min: 0, max: 5, step: 0.25, targets: [item], get: (i) => i.style.border || 0, set: (i, v) => { i.style.border = v; }, onCommit: () => {} }));
    const bc = el("input", { type: "color", value: st.borderColour || "#ffffff" });
    bc.oninput = () => { st.borderColour = bc.value; changed("look"); };
    bc.onchange = () => { changed("project"); commit(); };
    const sh = el("input", { type: "checkbox", checked: !!st.shadow });
    sh.onchange = act(() => { st.shadow = sh.checked; });
    body.append(el("div", { className: "row" }, el("span", { textContent: "Border colour" }), bc, el("span", { className: "spacer" }), el("label", { className: "check-row" }, sh, el("span", { textContent: "Shadow" }))));
  }

}

// ---- Text (the slide on the canvas only)

function buildText(part = "add") {
  const item = currentItem();
  if (!item) return;
  if (part === "edit") return captionSettings(item);
  if (selectedItems().length > 1) body.append(note(`Text goes on ${slideLabel(state.project, item).toLowerCase()} only.`));
  const add = (style) => () => {
    const s = TEXT_STYLES[style];
    const t = { id: newId("t"), ...s };
    delete t.label;
    t.x /= item.span; // (on a panorama: in the first square)
    item.texts.push(t);
    state.textId = t.id;
    changed("project");
    commit();
    document.dispatchEvent(new CustomEvent("focus-text"));
  };
  const styles = Object.keys(TEXT_STYLES);
  body.append(button("New Text Overlay", add(styles[0]), "btn primary wide"));
  body.append(el("div", { className: "row text-styles" }, ...styles.slice(1).map((k) => button(TEXT_STYLES[k].label, add(k)))));
  const words = item.texts.filter((t) => t.kind !== "shape" && t.kind !== "gif");
  if (!words.length) return;

  const list = el("div", { className: "text-list" });
  words.forEach((t) => {
    const row = el("div", { className: "text-row" + (t.id === state.textId ? " on" : "") }, el("span", { textContent: t.content.split("\n")[0] || "(empty)" }));
    row.onclick = () => { state.textId = t.id; changed("view"); };
    list.append(row);
  });
  body.append(list);
}

// ---- Align (Tom, 2026-11-23, as Photoshop's / Canva's): the picked photo, caption or shape lined up to the left, middle or
// right of its slide (on a panorama, the square it's mostly on), or its top, middle or bottom. Its turned outline counts.
const ALIGNS = [
  ["left", "Align left", '<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="8" height="4" rx="1"/>'],
  ["centre", "Centre across", '<path d="M12 3v18"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="7" y="14" width="10" height="4" rx="1"/>'],
  ["right", "Align right", '<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="9" y="14" width="8" height="4" rx="1"/>'],
  ["top", "Align top", '<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="8" rx="1"/>'],
  ["middle", "Centre up and down", '<path d="M3 12h18"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="7" width="4" height="10" rx="1"/>'],
  ["bottom", "Align bottom", '<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="9" width="4" height="8" rx="1"/>']
];
const scratch = document.createElement("canvas").getContext("2d");
function alignRow(slide, caption) {
  document.querySelectorAll("#panel .align-row").forEach((x) => x.remove());
  const layer = !caption && state.photoPicked ? currentLayer() : null;
  if (!slide || (!caption && !layer) || (layer && isGrid(slide))) return;
  const row = el("div", { className: "align-row" });
  ALIGNS.forEach(([how, label, d]) => row.append(el("button", { type: "button", className: "ti", title: label, ariaLabel: label,
    style: `--i: url("data:image/svg+xml,${encodeURIComponent(svgIcon(d))}")`, onclick: () => alignTo(slide, caption, layer, how) })));
  document.getElementById("layers-box").after(row);
}
function alignTo(slide, t, layer, how) {
  const H = 1000, pw = H * aspectOf(activeSet(state.project).ratio), W = pw * slide.span;
  let box, rect = { x: 0, y: 0, w: W, h: H };
  if (t) { const L = layoutText(scratch, t, W, H); box = { cx: L.cx, cy: L.cy, w: L.width, h: L.height, rotation: L.rotation }; }
  else {
    const pic = getPicture(layer.mediaId);
    if (!pic) return;
    rect = layerFrame(slide, layer, W, H) || rect;
    const b = shownBox(layer.crop, pic.width, pic.height, rect.w, rect.h);
    box = { ...b, cx: b.cx + rect.x, cy: b.cy + rect.y };
  }
  const a = ((box.rotation || 0) * Math.PI) / 180, c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
  const ex = (box.w * c + box.h * sn) / 2, ey = (box.w * sn + box.h * c) / 2; // (half the turned outline's width and height)
  const piece = Math.max(0, Math.min(slide.span - 1, Math.floor(box.cx / pw))), x0 = piece * pw;
  let cx = box.cx, cy = box.cy;
  if (how === "left") cx = x0 + ex; else if (how === "centre") cx = x0 + pw / 2; else if (how === "right") cx = x0 + pw - ex;
  if (how === "top") cy = ey; else if (how === "middle") cy = H / 2; else if (how === "bottom") cy = H - ey;
  if (t) { t.x = cx / W; t.y = cy / H; }
  else { layer.crop.x += (cx - box.cx) / rect.w; layer.crop.y += (cy - box.cy) / rect.h; }
  changed("project");
  commit();
}

// ---- Shapes (Tom, 2026-11-23): the library on the left adds one (or a frame, or a sticker); a picked shape's settings
// are on the right (shapeSettings)
const STICKERS = ["✨", "❤️", "⭐", "🔥", "👉", "🎵", "📍", "✅", "💬", "⚡"];
const SHAPE_ICON = (shape) => {
  const d = { line: '<path d="M3 12h18" stroke-width="3" stroke-linecap="round"/>', arrow: '<path d="M3 12h15M13 6l6 6-6 6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' }[shape];
  return d ? svgIcon(d) : SHAPE_ICONS[shape];
};
// History (Tom, 2026-11-25, its own tab under Shapes): every step, newest at the top, the one showing marked. Click a
// step to go back (or forward) to it; ✕ takes just that step out and keeps everything done after it (removeStep in
// state.js), say a pixelation made 50 changes ago.
function buildHistory(host) {
  const list = historyList(), at = list.findIndex((h) => h.now);
  const when = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const box = el("div", { className: "history-list" });
  list.map((h, i) => [h, i]).reverse().forEach(([h, i]) => {
    const row = el("div", { className: "history-row" + (h.now ? " now" : "") + (i > at ? " undone" : ""), title: i > at ? "Undone: click to bring it back" : "Go back to here" });
    row.append(el("span", { className: "h-name", textContent: h.label }), el("span", { className: "h-time", textContent: when(h.time) }));
    row.onclick = () => historyGo(i);
    if (i >= 1 && i <= at) {
      row.append(el("button", { type: "button", className: "lr-btn h-out", textContent: "✕", title: "Take out just this step, keep everything after it",
        onclick: (e) => { e.stopPropagation(); const kept = removeStep(i); if (kept > 0) toast("Part of it was changed again later, so that part stays"); } }));
    } else row.append(el("span", { className: "h-out-gap" }));
    box.append(row);
  });
  host.append(box);
}

function buildShapes() {
  const item = currentItem();
  if (!item) return;
  const add = (extra) => {
    const t = { id: newId("t"), ...SHAPE_DEFAULTS(), ...extra };
    t.x /= item.span; // (on a panorama: in the first square)
    item.texts.push(t);
    state.textId = t.id; state.photoPicked = false; state.layerId = null;
    changed("project");
    commit();
  };
  const tiles = el("div", { className: "shape-tiles" });
  SHAPE_KINDS.forEach(([shape, label]) => tiles.append(el("button", {
    type: "button", className: "shape-tile", title: label, ariaLabel: label,
    style: `--i: url("data:image/svg+xml,${encodeURIComponent(SHAPE_ICON(shape))}")`,
    onclick: () => add(shape === "line" ? { shape, aspect: 40, size: 0.012 } : shape === "arrow" ? { shape, aspect: 4, size: 0.08 } : { shape })
  })));
  tiles.append(el("button", { type: "button", className: "shape-tile frame", title: "Frame: an outline round the slide", ariaLabel: "Frame",
    onclick: () => { const a = aspectOf(activeSet(state.project).ratio); add({ shape: "rect", fill: "none", outline: 3, outlineColour: "#ffffff", size: 0.94, aspect: (a - 0.06) / 0.94, name: "Frame" }); } })); // (round the first square, a margin of 3 % of its height)
  body.append(el("div", { className: "tools-head", textContent: "Shapes" }), tiles);
  const stickers = el("div", { className: "sticker-tiles" });
  STICKERS.forEach((s) => stickers.append(el("button", { type: "button", className: "sticker-tile", textContent: s, title: "Add this sticker",
    onclick: () => {
      const t = { id: newId("t"), ...TEXT_STYLES.title, content: s, size: 0.12, stroke: 0, name: "Sticker" };
      delete t.label;
      t.x /= item.span;
      item.texts.push(t);
      state.textId = t.id; state.photoPicked = false; state.layerId = null;
      changed("project"); commit();
    } })));
  body.append(el("div", { className: "tools-head", textContent: "Stickers" }), stickers);
}
// The picked shape's settings (on the right)
function shapeSettings(item, t) {
  const live = () => changed("look");
  const done = () => { changed("project"); commit(); };
  const kind = el("select", { className: "select" });
  SHAPE_KINDS.forEach(([k, l]) => kind.append(el("option", { value: k, textContent: l, selected: k === t.shape })));
  kind.onchange = () => { t.shape = kind.value; done(); };
  body.append(el("div", { className: "row" }, el("span", { textContent: "Shape" }), kind));
  const lineLike = t.shape === "line" || t.shape === "arrow";
  const fillOn = t.fill && t.fill !== "none";
  const fill = el("input", { type: "color", value: fillOn ? t.fill : "#ffffff" });
  fill.oninput = () => { t.fill = fill.value; live(); };
  fill.onchange = done;
  const noFill = el("input", { type: "checkbox", checked: fillOn });
  noFill.onchange = () => { t.fill = noFill.checked ? fill.value : "none"; if (!noFill.checked && !t.outline) t.outline = 3; done(); };
  body.append(el("div", { className: "row" }, el("span", { textContent: lineLike ? "Colour" : "Fill" }), fill, el("span", { className: "spacer" }),
    lineLike ? "" : el("label", { className: "check-row" }, noFill, el("span", { textContent: "Filled" }))));
  if (!lineLike) {
    body.append(slider({ label: "Outline", min: 0, max: 20, step: 0.5, targets: [t], get: (x) => x.outline || 0, set: (x, v) => { x.outline = v; }, onCommit: () => {} }));
    const oc = el("input", { type: "color", value: t.outlineColour || "#111111" });
    oc.oninput = () => { t.outlineColour = oc.value; live(); };
    oc.onchange = done;
    body.append(el("div", { className: "row" }, el("span", { textContent: "Outline colour" }), oc));
    if (t.shape === "rect") body.append(slider({ label: "Corners", min: 0, max: 50, unit: "%", targets: [t], get: (x) => x.radius || 0, set: (x, v) => { x.radius = v; }, onCommit: () => {} }));
  }
  body.append(slider({ label: "Size", min: 0.5, max: 200, step: 0.5, targets: [t], get: (x) => x.size * 100, set: (x, v) => { x.size = v / 100; }, onCommit: () => {} }));
  body.append(slider({ label: lineLike ? "Length" : "Width", min: 5, max: 4000, step: 1, unit: "%", targets: [t], get: (x) => Math.round((x.aspect || 1) * 100), set: (x, v) => { x.aspect = v / 100; }, onCommit: () => {} }));
  body.append(slider({ label: "Opacity", min: 0, max: 100, unit: "%", reset: 100, targets: [t], get: (x) => (x.opacity ?? 1) * 100, set: (x, v) => { x.opacity = v / 100; }, onCommit: () => {} }));
  body.append(slider({ label: "Angle", min: -180, max: 180, step: 0.5, unit: "°", targets: [t], get: (x) => x.rotation || 0, set: (x, v) => { x.rotation = v; }, onCommit: () => {} }));
  body.append(el("div", { className: "row" },
    button("Delete shape", () => { item.texts = item.texts.filter((x) => x !== t); state.textId = null; done(); }, "btn ghost small")));
}

// A picked GIF's settings (on the right)
function gifSettings(item, t) {
  const done = () => { changed("project"); commit(); };
  body.append(slider({ label: "Size", min: 2, max: 200, step: 0.5, targets: [t], get: (x) => x.size * 100, set: (x, v) => { x.size = v / 100; }, onCommit: () => {} }));
  if (!t.logo) body.append(slider({ label: "Speed", min: 25, max: 300, step: 5, unit: "%", reset: 100, targets: [t], get: (x) => (x.speed || 1) * 100, set: (x, v) => { x.speed = v / 100; }, onCommit: () => {} }));
  body.append(slider({ label: "Opacity", min: 0, max: 100, unit: "%", reset: 100, targets: [t], get: (x) => (x.opacity ?? 1) * 100, set: (x, v) => { x.opacity = v / 100; }, onCommit: () => {} }));
  body.append(slider({ label: "Angle", min: -180, max: 180, step: 0.5, unit: "°", targets: [t], get: (x) => x.rotation || 0, set: (x, v) => { x.rotation = v; }, onCommit: () => {} }));
  const flip = el("input", { type: "checkbox", checked: !!t.flip });
  flip.onchange = () => { t.flip = flip.checked; done(); };
  body.append(el("div", { className: "row" }, el("label", { className: "check-row" }, flip, el("span", { textContent: "Flip" })), el("span", { className: "spacer" }),
    button(t.logo ? "Delete logo" : "Delete GIF", () => { item.texts = item.texts.filter((x) => x !== t); state.textId = null; done(); }, "btn ghost small")));
}

// ---- Brand kit (Tom, 2026-11-26; js/brand.js): the artist's colours and fonts from their Visual Profile, and their
// logos. A colour goes on what's picked (a caption's words, a shape's fill), else the slide's background; a font on the
// picked caption, else a new caption in it; a logo onto the slide.
let brandPick = null, logosShown = null;
function buildBrand() {
  const item = currentItem();
  if (!item) return;
  const kit = brandNow();
  if (!kit || kit.artist !== brandArtist()) { body.append(note("Loading…")); loadBrand().then(() => changed("view")); return; }
  const looks = kit.looks;
  const look = looks.find((l) => l.id === brandPick) || looks[0];
  if (looks.length > 1) {
    const sel = el("select", { className: "select" });
    looks.forEach((l) => sel.append(el("option", { value: l.id, textContent: l.name, selected: l === look })));
    sel.onchange = () => { brandPick = sel.value; changed("view"); };
    body.append(el("div", { className: "row" }, el("span", { textContent: "Visual Profile" }), sel));
  }
  const picked = item.texts.find((x) => x.id === state.textId);
  const done = () => { changed("project"); commit(); };
  if (!look) {
    body.append(note("No Visual Profile yet"));
    if (kit.artist) body.append(el("p", { className: "note" }, el("a", { href: `/identity/lookbook/?artist=${encodeURIComponent(kit.artist)}`, textContent: "Make one in Identity" })));
  } else {
    body.append(title("Colours"));
    const sw = el("div", { className: "brand-swatches" });
    look.colours.forEach((c) => sw.append(el("button", {
      type: "button", className: "brand-swatch", style: `--c: ${c.hex}`, title: `${c.name} ${c.hex}`, ariaLabel: c.name,
      onclick: () => {
        const t = item.texts.find((x) => x.id === state.textId);
        if (t && t.kind === "shape") t.fill = c.hex;
        else if (t && t.kind !== "gif") t.colour = c.hex;
        else item.background = c.hex;
        done();
      }
    })));
    if (!look.colours.length) sw.append(note("No colours yet"));
    body.append(sw);
    body.append(title("Fonts"));
    look.fonts.forEach((f) => {
      useFont(f.family, f.url);
      body.append(el("button", {
        type: "button", className: "brand-font", title: picked && !picked.kind ? `Use ${f.label} for this caption` : `New caption in ${f.label}`,
        onclick: () => {
          const t = item.texts.find((x) => x.id === state.textId);
          if (t && !t.kind) { t.font = f.family; t.fontLabel = f.label; if (f.url) t.fontUrl = f.url; else delete t.fontUrl; done(); return; }
          const { label, ...style } = TEXT_STYLES.title;
          const n = { ...style, id: newId("t"), content: f.role === "display" ? kit.name || "Your title" : "Your text", size: f.role === "display" ? 0.1 : 0.05, font: f.family, fontLabel: f.label, ...(f.url ? { fontUrl: f.url } : {}), x: 0.5 / item.span };
          item.texts.push(n);
          state.textId = n.id; state.photoPicked = false; state.layerId = null;
          done();
        }
      }, el("span", { className: "bf-sample", style: `font-family: "${f.family}", Helvetica, sans-serif`, textContent: f.label }), el("span", { className: "bf-role", textContent: f.name })));
    });
  }
  body.append(title("Logos"));
  const grid = el("div", { className: "brand-logos" });
  const own = el("input", { type: "file", accept: "image/png,image/webp,image/jpeg", hidden: true });
  own.onchange = async () => { const f = own.files && own.files[0]; if (f) { logosShown = await addLogo(f); changed("view"); } };
  const draw = (list) => {
    grid.replaceChildren();
    list.forEach((l) => {
      const tile = el("button", { type: "button", className: "gif-tile sticker brand-logo", title: `Put ${l.name} on the slide` });
      dbGet("media", l.mediaId).then((m) => { if (m) tile.append(el("img", { src: URL.createObjectURL(m.blob), alt: l.name })); });
      tile.onclick = () => {
        const n = { id: newId("t"), kind: "gif", logo: true, mediaId: l.mediaId, name: l.name || "Logo", x: 0.5 / item.span, y: 0.86, size: 0.12, aspect: l.width / l.height, rotation: 0, opacity: 1, speed: 1 };
        item.texts.push(n);
        state.textId = n.id; state.photoPicked = false; state.layerId = null;
        done();
      };
      const x = el("span", { className: "brand-logo-x", textContent: "✕", title: "Take out of the brand kit" });
      x.onclick = async (e) => { e.stopPropagation(); logosShown = await removeLogo(l.mediaId); changed("view"); };
      tile.append(x);
      grid.append(tile);
    });
  };
  if (logosShown) draw(logosShown); else brandLogos().then((l) => { logosShown = l; draw(l); });
  body.append(grid, el("div", { className: "row" }, button("Add logo", () => own.click())), own);
}

// ---- GIFs (Tom, 2026-11-25): GIPHY's stickers and GIFs (js/gifs.js). A search box, Stickers | GIFs, then the results
// (what's trending with no words); a click puts one on the slide. Your own .gif / .webp from Add a GIF file.
const gifSearch = { words: "", type: "stickers", results: null, busy: false, error: "", asked: "" };
function buildGifs() {
  const item = currentItem();
  if (!item) return;
  if (!giphyReady()) { body.append(note("GIF search is switched off for now")); }
  const box = el("input", { type: "search", className: "gif-search", placeholder: "Search GIPHY", value: gifSearch.words });
  let wait = 0;
  box.oninput = () => { gifSearch.words = box.value; clearTimeout(wait); wait = setTimeout(run, 450); };
  box.onkeydown = (e) => { if (e.key === "Enter") { clearTimeout(wait); run(); } e.stopPropagation(); };
  const seg = el("div", { className: "segmented wide" });
  [["stickers", "Stickers"], ["gifs", "GIFs"]].forEach(([k, label]) => seg.append(el("button", {
    type: "button", className: k === gifSearch.type ? "on" : "", textContent: label,
    onclick: () => { gifSearch.type = k; seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.textContent === label)); run(); }
  })));
  const grid = el("div", { className: "gif-grid" });
  const own = el("input", { type: "file", accept: "image/gif,image/webp", hidden: true });
  own.onchange = async () => {
    const f = own.files && own.files[0];
    if (!f) return;
    const g = await keepGifFile(f, state.project.id);
    place({ mediaId: g.id, name: g.name || f.name.replace(/\.[^.]+$/, ""), aspect: g.width / g.height });
  };
  const foot = el("div", { className: "gif-foot" },
    button("Add a GIF file", () => own.click()), el("span", { className: "spacer" }),
    el("span", { className: "giphy-mark", textContent: "Powered by GIPHY" }));
  body.append(box, seg, grid, foot, own);

  function place(extra) {
    const slide = currentItem();
    if (!slide) return;
    const t = { id: newId("t"), kind: "gif", x: 0.5 / slide.span, y: 0.5, size: 0.3, aspect: 1, rotation: 0, opacity: 1, speed: 1, ...extra };
    slide.texts.push(t);
    state.textId = t.id; state.photoPicked = false; state.layerId = null;
    changed("project");
    commit();
  }
  function show() {
    grid.replaceChildren();
    if (gifSearch.error) { grid.append(note(gifSearch.error)); return; }
    if (!gifSearch.results) { if (gifSearch.busy) grid.append(note("Loading…")); return; }
    if (!gifSearch.results.length) { grid.append(note("Nothing found")); return; }
    gifSearch.results.forEach((g) => {
      const tile = el("button", { type: "button", className: "gif-tile" + (gifSearch.type === "stickers" ? " sticker" : ""), title: g.title });
      tile.append(el("img", { src: g.preview, alt: g.title, loading: "lazy" }));
      tile.onclick = async () => {
        if (tile.classList.contains("busy")) return;
        tile.classList.add("busy");
        try {
          const id = await keepGif(g, state.project.id);
          place({ mediaId: id, giphyId: g.id, name: g.title.replace(/\s+(GIF|Sticker)( by .*)?$/i, "").slice(0, 40) || "GIF", aspect: g.width / g.height });
        } catch (err) { toast(err.message || "The GIF couldn't be added"); }
        tile.classList.remove("busy");
      };
      grid.append(tile);
    });
  }
  async function run() {
    if (!giphyReady()) return;
    const asked = `${gifSearch.type}|${gifSearch.words.trim()}`;
    gifSearch.asked = asked; gifSearch.busy = true; gifSearch.error = ""; gifSearch.results = null;
    show();
    try {
      const results = await searchGiphy(gifSearch.words, gifSearch.type);
      if (gifSearch.asked !== asked) return;
      gifSearch.results = results;
    } catch (err) { if (gifSearch.asked === asked) gifSearch.error = err.message || "GIPHY didn't answer"; }
    gifSearch.busy = false;
    if (grid.isConnected) show();
  }
  if (gifSearch.results === null && !gifSearch.busy && !gifSearch.error) run(); else show();
}

// The picked caption's settings (on the right)
function captionSettings(item) {
  const t = item.texts.find((x) => x.id === state.textId);
  if (!t) return;
  if (t.kind === "shape") return shapeSettings(item, t);
  if (t.kind === "gif") return gifSettings(item, t);
  const live = () => changed("look");
  const done = () => { changed("project"); commit(); };

  const content = el("textarea", { value: t.content, spellcheck: true });
  content.dataset.textContent = "1";
  content.addEventListener("input", () => { t.content = content.value; live(); });
  content.addEventListener("change", () => commit());
  body.append(content);

  const font = el("select", { className: "select" });
  if (t.font && !FONTS.some((f) => f.id === t.font)) font.append(el("option", { value: t.font, textContent: t.fontLabel || t.font, selected: true })); // (a brand font)
  FONTS.forEach((f) => font.append(el("option", { value: f.id, textContent: f.id, selected: f.id === t.font })));
  font.onchange = () => { t.font = font.value; document.fonts && document.fonts.load(`20px "${font.value}"`).then(live); done(); };
  body.append(el("div", { className: "row" }, font, segmented([{ value: 400, label: "Regular" }, { value: 700, label: "Bold" }], t.weight >= 600 ? 700 : 400, (v) => { t.weight = v; done(); })));
  body.append(slider({ label: "Size", min: 1, max: 40, step: 0.5, targets: [t], get: (x) => x.size * 100, set: (x, v) => { x.size = v / 100; }, onCommit: () => {} }));

  const colour = el("input", { type: "color", value: t.colour });
  colour.oninput = () => { t.colour = colour.value; live(); };
  colour.onchange = done;
  body.append(el("div", { className: "row" }, el("span", { textContent: "Colour" }), colour, alignIcons(t.align, (v) => { t.align = v; done(); })));

  body.append(slider({ label: "Stroke", min: 0, max: 20, step: 0.5, targets: [t], get: (x) => x.stroke || 0, set: (x, v) => { x.stroke = v; }, onCommit: () => {} }));
  const strokeColour = el("input", { type: "color", value: t.strokeColour || "#000000" });
  strokeColour.oninput = () => { t.strokeColour = strokeColour.value; live(); };
  strokeColour.onchange = done;
  body.append(el("div", { className: "row" }, el("span", { textContent: "Stroke colour" }), strokeColour));

  const bubble = el("select", { className: "select" });
  [["none", "No background"], ["lines", "Around the words"], ["box", "Box"], ["rounded", "Rounded"], ["pill", "Pill"], ["outline", "Outline"]].forEach(([v, l]) => bubble.append(el("option", { value: v, textContent: l, selected: v === t.bubble })));
  bubble.onchange = () => { t.bubble = bubble.value; done(); };
  const bubbleColour = el("input", { type: "color", value: t.bubbleColour });
  bubbleColour.oninput = () => { t.bubbleColour = bubbleColour.value; live(); };
  bubbleColour.onchange = done;
  body.append(el("div", { className: "row" }, el("span", { textContent: "Behind" }), bubble, bubbleColour));
  body.append(slider({ label: "Angle", min: -180, max: 180, step: 0.5, unit: "°", targets: [t], get: (x) => x.rotation || 0, set: (x, v) => { x.rotation = v; }, onCommit: () => {} }));

  // Effects (Tom, 2026-11-23): shadow, glow, a gradient, a curve, and the photo showing through the words
  body.append(slider({ label: "Curve", min: -200, max: 200, step: 1, reset: 0, targets: [t], get: (x) => x.curve || 0, set: (x, v) => { x.curve = v; }, onCommit: () => {} }));
  const fxRow = (key, label, start, sliders) => {
    const now = t[key] && t[key].on;
    const tick = el("input", { type: "checkbox", checked: !!now });
    tick.onchange = () => { t[key] = { ...start, ...(t[key] || {}), on: tick.checked }; done(); };
    const colour = el("input", { type: "color", value: (t[key] && t[key].colour) || start.colour });
    colour.oninput = () => { t[key] = { ...start, ...(t[key] || {}), on: true, colour: colour.value }; tick.checked = true; live(); };
    colour.onchange = done;
    body.append(el("div", { className: "row" }, el("label", { className: "check-row" }, tick, el("span", { textContent: label })), el("span", { className: "spacer" }), colour));
    if (now) sliders.forEach(([k, l]) => body.append(slider({ label: l, min: 0, max: 100, step: 1, targets: [t], get: (x) => x[key][k] ?? start[k], set: (x, v) => { x[key][k] = v; }, onCommit: () => {} })));
  };
  fxRow("shadow", "Shadow", { colour: "#000000", blur: 30, distance: 30 }, [["blur", "Blur"], ["distance", "Distance"]]);
  fxRow("glow", "Glow", { colour: "#ffffff", size: 30 }, [["size", "Glow size"]]);
  fxRow("gradient", "Gradient", { colour: "#ff3d7f" }, []);
  const inside = el("input", { type: "checkbox", checked: !!t.photoFill });
  inside.onchange = () => { if (inside.checked) t.photoFill = true; else delete t.photoFill; done(); };
  body.append(el("div", { className: "row" }, el("label", { className: "check-row", title: "The photos show only through these words, on the slide's background colour" }, inside, el("span", { textContent: "Photo inside the words" }))));

  body.append(el("div", { className: "row" },
    button("Centre it", () => { t.x = (Math.floor(t.x * item.span) + 0.5) / item.span; t.y = 0.5; done(); }),
    button("Delete text", () => { item.texts = item.texts.filter((x) => x !== t); state.textId = null; done(); }, "btn ghost small")));
}

// ---- Captions

// Left / centre / right / justify, as pictures of lines
const ALIGN_ICONS = {
  left: [[4, 20], [4, 14], [4, 18], [4, 11]],
  center: [[4, 20], [7, 17], [5, 19], [8, 16]],
  right: [[4, 20], [10, 20], [6, 20], [13, 20]],
  justify: [[4, 20], [4, 20], [4, 20], [4, 13]]
};
function alignIcons(value, onPick) {
  const seg = el("div", { className: "segmented small icons" });
  [["left", "Left"], ["center", "Centre"], ["right", "Right"], ["justify", "Justify"]].forEach(([v, label]) => {
    const b = el("button", { className: v === value ? "on" : "", title: label, onclick: () => onPick(v) });
    b.setAttribute("aria-label", label);
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${ALIGN_ICONS[v].map(([a, z], i) => `<path d="M${a} ${5 + i * 4.7}H${z}"/>`).join("")}</svg>`;
    seg.append(b);
  });
  return seg;
}
