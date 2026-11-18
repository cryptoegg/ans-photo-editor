// The panel on the right. At the top, what you're editing, in words ("Editing slide 3",
// "Editing all 7 slides") and a This slide / All switch: Filters and Adjust change every slide
// outlined in the filmstrip; Crop and Text always change the one on the canvas. Changing
// several slides at once says so in a note with Undo.
import { removeBackground, restoreBackground, cutoutStatus } from '../cutout.js';
import { brush, setBrush, clearTouchUps, brushStatus, cloneHasSource, sizeToSlider, sliderToSize, toolIcons } from './brush.js';
import { state, changed, commit, undo, currentItem, currentLayer, selectedItems, select, selectAll, onChange, items } from '../state.js';
import { slideLabel, LIGHT_DEFAULTS, COLOUR_DEFAULTS, PLATFORMS, newId, cropDefaults, activeSet, aspectOf, isVideo, LAYOUTS, layersOf, isGrid } from '../project.js';
import { PRESETS } from '../effects/presets.js';
import { getEffect, EFFECTS, effectOrder } from '../effects/registry.js';
import { vibeSettings, VIBE_DEFAULT } from '../effects/vibe.js';
import { myFilters, getFilter, filterName, freshChain, newEffect, saveMyFilter, deleteMyFilter, isMine } from '../filters.js';
import { presetSwatch } from '../looks.js';
import { getPicture } from '../media.js';
import { TEXT_STYLES, FONTS, fillCrop, fitCrop, layerFrame, BLENDS } from '../render.js';
import { setSpan, splitPanorama, makePanorama, setOwnLook, moveLayer, placeLayer, removeLayer, duplicateLayer } from '../actions.js';
import { showMenu } from './menu.js';
import { toast } from './toast.js';
import { ask } from './dialogs.js';

const undoAction = { label: "Undo", run: () => undo() };

// Filters, grouped for people new to them: everyday looks first, the A New Song collection,
// then the strong creative ones
const EVERYDAY = ["ans-clean-editorial", "ans-35mm-400", "expired-35mm", "film-scan", "faded-bw", "soft-bw", "grainy-bw", "painted-blur", "flash-at-night", "hard-light", "magazine-print", "photocopy"];
function filterGroups() {
  const everyday = EVERYDAY.map((id) => PRESETS.find((p) => p.id === id)).filter(Boolean);
  const ans = PRESETS.filter((p) => p.id.startsWith("ans-") && !EVERYDAY.includes(p.id));
  const creative = PRESETS.filter((p) => !EVERYDAY.includes(p.id) && !p.id.startsWith("ans-"));
  return [{ name: "Everyday", list: everyday }, { name: "A New Song", list: ans }, { name: "Creative", list: creative }];
}

let body = null;
let shownTab = null;

export function initPanel() {
  body = document.getElementById("tab-body");
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => {
    state.tab = b.dataset.tab;
    if (document.getElementById("panel").classList.contains("folded")) foldEditor(false); // (a tab opens a folded Editor)
    changed("view");
  }));
  document.querySelectorAll("#scope-switch button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.scope === "all") selectAll();
    else if (state.current) select(state.current, "one");
  }));
  // The Editor's fold arrow: the column folds to a strip (remembered in this browser, like Media's)
  const foldEditor = (on) => {
    document.getElementById("panel").classList.toggle("folded", on);
    document.getElementById("workspace").classList.toggle("no-editor", on);
    try { localStorage.setItem("ans_photo_editor_folded", on ? "1" : "0"); } catch (e) {}
    window.dispatchEvent(new Event("resize"));
  };
  let folded = false;
  try { folded = localStorage.getItem("ans_photo_editor_folded") === "1"; } catch (e) {}
  foldEditor(folded);
  document.getElementById("btn-editor-fold").onclick = () => foldEditor(!document.getElementById("panel").classList.contains("folded"));
  document.getElementById("panel").addEventListener("click", (e) => { if (e.target === e.currentTarget && e.currentTarget.classList.contains("folded")) foldEditor(false); });
  // The presets row: every filter (yours first), Save Preset (this slide's look as one of yours), the dice (a random one)
  const pick = document.getElementById("preset-pick");
  pick.onchange = () => { const chosen = lookItems().filter(Boolean); if (chosen.length && pick.value !== "-") useFilter(chosen, pick.value || null); };
  document.getElementById("btn-save-preset").onclick = () => saveThisFilter(lookItems().filter(Boolean));
  document.getElementById("btn-random").onclick = () => {
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

function buildLayersBox() {
  const box = document.getElementById("layers-box");
  const slide = currentItem();
  box.innerHTML = "";
  if (!slide) { box.hidden = true; return; }
  box.hidden = false;
  if (slide.span > 1) {
    box.append(el("div", { className: "layers-head" }, el("span", { textContent: "Layers" }), el("span", { className: "mc-n", textContent: "1" })));
    return;
  }
  // (a video slide: the video is the bottom layer and stays there; photos go over it)
  const vid = isVideo(slide);
  const nameOf = (i) => layerLabel(slide, i);
  // (no layout templates (Tom, 2026-11-11): photos sit freely; a slide saved in a grid keeps it)
  const plus = button("+", () => document.dispatchEvent(new CustomEvent("add-layer")), "mc-plus");
  plus.title = "Another photo on this slide";
  // (Layers folds up and down like Light, Colour and the rest: Tom, 2026-11-18)
  const open = !openCards.has("layers:shut");
  const name = el("button", { className: "fold-name layers-fold", title: "Show / hide the layers" }, el("span", { className: "fold-arrow" }), el("span", { textContent: "Layers" }), el("span", { className: "mc-n", textContent: String(layersOf(slide).length) }));
  name.onclick = () => { if (open) openCards.add("layers:shut"); else openCards.delete("layers:shut"); changed("view"); };
  box.classList.toggle("open", open);
  box.append(el("div", { className: "layers-head" }, name, plus));
  if (!open) return;

  const list = el("div", { className: "layer-list" });
  const all = layersOf(slide);
  const picked = currentLayer();
  const cells = isGrid(slide) ? LAYOUTS[slide.layout.kind].cells.length : Infinity;
  all.map((layer, i) => ({ layer, i })).reverse().forEach(({ layer, i }) => {
    const pic = getPicture(layer.mediaId);
    const thumb = el("canvas", { width: 60, height: 60, className: "layer-thumb" });
    if (pic) { const src = pic.preview, s = Math.min(src.width, src.height); thumb.getContext("2d").drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, 60, 60); }
    const row = el("div", { className: "layer-row" + (state.photoPicked && layer === picked ? " on" : "") + (i >= cells ? " off" : "") },
      thumb, el("span", { className: "layer-name", textContent: `${nameOf(i)}${i >= cells ? " (no cell)" : ""}` }), el("span", { className: "spacer" }),
      el("span", { className: "layer-where", textContent: all.length > 1 ? (i === 0 ? "Bottom" : i === all.length - 1 ? "Top" : "") : "" }));
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
    row.onclick = () => { if (dragged) return; state.photoPicked = true; state.textId = null; state.layerId = layer === slide ? null : layer.id; changed("view"); };
    row.addEventListener("contextmenu", (e) => {
      if (vid && i === 0) return;
      state.photoPicked = true; state.textId = null; state.layerId = layer === slide ? null : layer.id; changed("view");
      const entries = [{ label: "Duplicate", keys: "⌘D", action: () => duplicateLayer(layer) }];
      if (!(vid && i === 0)) entries.push(layer.cutout && layer.cutout.on && !layer.cutout.hand
        ? { label: "Bring background back", action: () => restoreBackground(layer) }
        : { label: "Remove background", action: () => removeBackground(layer) });
      if (all.length > 1) entries.push({ label: "Remove from slide", action: () => removeLayer(layer) });
      showMenu(e, entries);
    });
    row.title = "Drag up or down to change the order";
    row.layer = layer;
    row.addEventListener("pointerdown", (e) => dragRow(e, row, list, all));
    list.append(row);
  });
  box.append(list);
  // The picked layer's opacity and blend (how it mixes with the layers under it)
  if (all.length > 1) {
    const st = picked.style;
    const opacity = slider({ label: `${nameOf(all.indexOf(picked))} opacity`, min: 0, max: 100, unit: "%", reset: 100, targets: [picked], get: (l) => (l.style.opacity ?? 1) * 100, set: (l, v) => { l.style.opacity = v / 100; }, onCommit: () => {} });
    const blend = el("select", { className: "select", title: "How this photo mixes with the ones under it" });
    Object.entries(BLENDS).forEach(([value, label]) => blend.append(el("option", { value, textContent: label })));
    blend.value = st.blend || "normal";
    blend.onchange = () => { st.blend = blend.value; changed("project"); commit(); };
    opacity.classList.add("half");
    box.append(el("div", { className: "row layer-mix" }, opacity, el("label", { className: "field" }, el("span", { textContent: "Blend" }), blend)));
  }
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

// ---- Tools (Tom, 2026-11-18): everything that works on the picked photo itself, in one fold under Layers:
// Remove background, then the brushes: Remove, Clone, Edge brush
function buildToolsBox() {
  const box = document.getElementById("tools-box");
  const slide = currentItem();
  box.innerHTML = "";
  const picked = slide && currentLayer();
  if (!slide || !picked || slide.span > 1 || (isVideo(slide) && picked === slide)) { box.hidden = true; return; }
  box.hidden = false;
  const open = !openCards.has("tools:shut");
  const name = el("button", { className: "fold-name layers-fold", title: "Show / hide the tools" }, el("span", { className: "fold-arrow" }), el("span", { textContent: "Tools" }));
  name.onclick = () => { if (open) openCards.add("tools:shut"); else openCards.delete("tools:shut"); changed("view"); };
  box.classList.toggle("open", open);
  box.append(el("div", { className: "layers-head" }, name));
  if (!open) return;
  // Remove background (js/cutout.js): the picked photo's cut-out, on / off; the model downloads the first time
  box.append(cutoutRow(picked));
  // The brushes (js/ui/brush.js): picked here, painted on the canvas; Esc or a second click puts one down.
  // Right-click the photo with one in hand for the same settings at the pointer.
  const cutOn = !!(picked.cutout && picked.cutout.on);
  if (state.tool === "edge" && !cutOn) state.tool = null;
  if (state.tool === "heal") state.tool = "remove";
  const icons = toolIcons("ti");
  icons.className = "tool-icons";
  box.append(icons);
  if (state.tool) {
    const slider = (label, key, min, max, title = "", toV = (x) => x, fromV = (x) => x) => {
      const value = el("span", { className: "value", textContent: String(brush[key]) });
      const input = el("input", { type: "range", min, max, value: toV(brush[key]), title, oninput: (e) => { brush[key] = fromV(Number(e.target.value)); value.textContent = String(brush[key]); fillTrack(e.target); changed("look"); }, onchange: () => setBrush(key, brush[key]) });
      fillTrack(input);
      return el("label", { className: "field" }, el("span", { className: "field-head" }, el("span", { textContent: label }), value), input);
    };
    box.append(el("div", { className: "pair" }, slider("Size", "size", 0, 1000, "[ ]", sizeToSlider, sliderToSize), slider("Hardness", "hardness", 0, 100, "Shift [ ]")));
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
export const lookItems = () => (state.layerId ? [currentLayer()] : selectedItems());
const lookItem = () => currentLayer() || currentItem();
const layerName = (item, layer) => layerLabel(item, layersOf(item).indexOf(layer)).toLowerCase();

// ---- Building

function build() {
  const p = state.project;
  const chosen = selectedItems();
  const all = items().length;
  document.querySelectorAll("#scope-switch button").forEach((b) => {
    b.classList.toggle("on", b.dataset.scope === "all" ? chosen.length > 1 && chosen.length === all : chosen.length === 1);
    if (b.dataset.scope === "all") b.textContent = all > 1 ? `All ${all} slides` : "All";
  });
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));
  // (Post text is the whole post's: no presets, slides or layers; Captions goes on the slide, not a layer)
  const post = state.tab === "captions";
  document.getElementById("presets-row").hidden = post || !all;
  document.getElementById("scope-switch").hidden = post || !all;
  fillPresets();

  buildLayersBox();
  buildToolsBox();
  if (post || state.tab === "text") document.getElementById("layers-box").hidden = document.getElementById("tools-box").hidden = true;
  const scroll = state.tab === shownTab ? body.scrollTop : 0; // (a different tab starts at its top)
  shownTab = state.tab;
  body.innerHTML = "";
  if (!all && state.tab !== "captions") {
    body.append(note("Add photos to start. Everything you set here shows on the canvas straight away."));
    return;
  }
  if ((state.tab === "filters" || state.tab === "adjust") && chosen.length) body.append(sharedLook(chosen));
  ({ filters: buildFilters, adjust: buildAdjust, crop: buildCrop, text: buildText, captions: buildCaptions })[state.tab]();
  document.querySelectorAll('#panel input[type="range"]').forEach(fillTrack);
  pairSliders(body);
  body.scrollTop = scroll;
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

// ---- Shared slides: a slide's filter and adjustments are the same on every platform (and its crop,
// text and layers on platforms with the same shape),
// unless it has its own here

function sharedLook(chosen) {
  const own = chosen.map((i) => !!i.ownLook);
  const box = el("input", { type: "checkbox", checked: !own.some(Boolean) });
  box.indeterminate = own.some(Boolean) && !own.every(Boolean);
  box.onchange = () => setOwnLook(!box.checked);
  const platform = PLATFORMS.find((x) => x.id === state.project.stage);
  return el("label", { className: "check-row note", title: "On: the look is the same on all three, and the crop, text and layers too on platforms with the same shape. Off: these slides stand alone here." }, box,
    el("span", { textContent: box.checked ? "Same on every platform" : `Only on ${platform ? platform.label : "this platform"}` }));
}

// The presets row's menu: Presets… (or the filter the chosen slides have), Original, Your filters, then the groups
function fillPresets() {
  const pick = document.getElementById("preset-pick");
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
  const filter = await saveMyFilter(name || "My filter", chain, { ...item.look.light }, { ...item.look.colour });
  chosen.forEach((i) => { if (i === item || JSON.stringify(i.look) === JSON.stringify(item.look)) i.look.preset = filter.id; });
  item.look.preset = filter.id;
  if (!item.look.chain) item.look.chain = chain;
  changed("project");
  commit();
  toast(`Saved "${filter.name}" to Your filters`);
}

// ---- Filters: the tiles (Original first), Strength floating at the top

let swatchJob = 0;

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
  });
  changed("project");
  commit();
  saidAcross(id ? filterName(id) : "Original", chosen.length);
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
    const b = el("button", { className: "swatch" + (on ? " on" : ""), title: filter ? `${filter.note || filter.name}${on ? " · click again to edit it in Adjust" : ""}` : "No filter" });
    const holder = el("div", { className: "blank" });
    b.append(holder, el("span", { textContent: filter ? filter.name : "Original" }));
    if (on && filter) b.append(el("span", { className: "swatch-edit", textContent: "Edit" }));
    queue.push(() => {
      const c = presetSwatch(item, id, state.project.seed, 132);
      if (c) { const shown = el("canvas", { width: c.width, height: c.height }); shown.getContext("2d").drawImage(c, 0, 0); holder.replaceWith(shown); }
    });
    b.onclick = () => {
      if (on && filter) { state.tab = "adjust"; changed("view"); return; } // (the picked one again: all its settings, in Adjust)
      useFilter(chosen, id);
    };
    return b;
  };
  const groups = [];
  if (myFilters().length) groups.push({ name: "Your filters", list: myFilters() });
  groups.push(...filterGroups());
  groups.forEach((group, g) => {
    // (each group folds; Original sits in the first, top left)
    const card = foldCard({ key: `filters:${group.name}`, name: group.name, build: (inner) => {
      const grid = el("div", { className: "swatches" });
      if (g === 0) grid.append(tile(null));
      group.list.forEach((f) => grid.append(tile(f)));
      inner.append(grid);
    } });
    body.append(card);
  });
  // (swatches drawn one at a time, so the panel opens at once)
  if (!item || !getPicture(item.mediaId)) return;
  const next = () => { if (job !== swatchJob || !queue.length) return; queue.shift()(); setTimeout(next, 0); };
  setTimeout(next, 0);
}

// ---- Fold-out cards: a name that opens / closes its settings (▸ / ▾), an optional tick box
// (on / off), an optional one slider, and ↺ (back to its starting settings). Which are open is
// remembered while the app is open.

const openCards = new Set(["adjust:light", "filters:Your filters", "filters:Everyday"]);
function foldCard({ key, name, tick = null, quick = null, onReset = null, build, off = false }) {
  const open = openCards.has(key);
  const card = el("div", { className: "fold-card" + (open ? " open" : "") + (off ? " off" : "") });
  const head = el("div", { className: "fold-head" });
  if (tick) head.append(tick);
  const label = el("button", { className: "fold-name", title: "Show / hide its settings" }, el("span", { className: "fold-arrow" }), el("span", { textContent: name }));
  label.onclick = () => { if (openCards.has(key)) openCards.delete(key); else openCards.add(key); changed("view"); };
  head.append(label, el("span", { className: "spacer" }));
  if (quick) head.append(quick);
  if (onReset) head.append(el("button", { className: "btn small fold-reset", textContent: "↺", title: "Back to its starting settings", onclick: onReset }));
  card.append(head);
  if (open) { const inner = el("div", { className: "fold-body" }); build(inner); card.append(inner); }
  return card;
}

// ---- The filter's own settings and every effect (in Adjust), listed like the lyric app's
// effects panel: the filter's Light, Colour and Colour tint, then Effects, each with its tick
// box, its one slider and its settings folded under its name. Moving a setting of an effect
// that's off switches it on. A slide with no filter can switch effects on too (its own "Custom").

const ADJUST_TYPES = ["tone", "colour", "tint"];
function effectsSection(chosen) {
  const item = lookItem();
  if (!item) return;
  const id = item.look.preset;
  const targets = chosen;
  const done = () => { changed("project"); commit(); };
  const fxOf = (i, type) => (i.look.chain || (i.look.preset ? freshChain(i.look.preset) : [])).find((fx) => fx.type === type) || null;
  // The effect on a slide, made (switched on, in its place in the order) if it isn't there yet
  const ensure = (i, type) => {
    if (!i.look.chain) i.look.chain = i.look.preset ? freshChain(i.look.preset) : [];
    if (!i.look.preset) { i.look.preset = "custom"; i.look.strength = i.look.strength || 100; }
    let fx = i.look.chain.find((f) => f.type === type);
    if (!fx) {
      fx = newEffect(type);
      i.look.chain.push(fx);
      i.look.chain.sort((x, y) => effectOrder(x.type) - effectOrder(y.type));
    }
    fx.on = true;
    return fx;
  };
  const shown = (type) => fxOf(item, type) || { type, ...getEffect(type).defaults() };
  const resetTo = (type) => () => { targets.forEach((i) => { const fx = i.look.chain && i.look.chain.find((f) => f.type === type); if (fx) Object.assign(fx, getEffect(type).defaults()); }); done(); };
  const controlsOf = (effect) => (inner) => (effect.controls || []).forEach((c) => inner.append(effectControl(c, effect.type, targets, shown, ensure)));

  if (id) {
    EFFECTS.filter((e) => ADJUST_TYPES.includes(e.type)).forEach((effect) => {
      body.append(foldCard({ key: `fx:${effect.type}`, name: effect.type === "tone" ? "Filter light" : effect.type === "colour" ? "Filter colour" : effect.label, onReset: resetTo(effect.type), build: controlsOf(effect) }));
    });
  }
  // Effects: one fold that opens to the whole list (each effect folds open in turn)
  const groupOpen = openCards.has("adjust:effects");
  const onCount = EFFECTS.filter((e) => !ADJUST_TYPES.includes(e.type)).filter((e) => { const f = fxOf(item, e.type); return f && f.on !== false; }).length;
  const groupHead = el("div", { className: "fold-card effects-group" + (groupOpen ? " open" : "") },
    el("div", { className: "fold-head" }, el("button", { className: "fold-name", title: "Show / hide every effect", onclick: () => { if (groupOpen) openCards.delete("adjust:effects"); else openCards.add("adjust:effects"); changed("view"); } },
      el("span", { className: "fold-arrow" }), el("span", { textContent: "Effects" })),
      el("span", { className: "note", textContent: onCount ? `${onCount} on` : "" })));
  body.append(groupHead);
  if (groupOpen) EFFECTS.filter((e) => !ADJUST_TYPES.includes(e.type) && (!e.later || fxOf(item, e.type))).forEach((effect) => {
    const fx = fxOf(item, effect.type);
    const on = !!fx && fx.on !== false;
    const tick = el("input", { type: "checkbox", checked: on, title: "Switch this effect on / off" });
    tick.onchange = () => { targets.forEach((i) => { if (tick.checked) ensure(i, effect.type); else { const f = i.look.chain && i.look.chain.find((x) => x.type === effect.type); if (f) f.on = false; } }); done(); };
    let quick = null;
    if (effect.vibe) {
      // The one slider: 0 = off, up from there a light touch to the full look (several settings at once)
      quick = el("input", { type: "range", min: 0, max: 100, step: 1, className: "fold-quick", value: on ? (fx.vibe > 0 ? fx.vibe : VIBE_DEFAULT) : 0, title: `${effect.label}: 0 = off, up to the full look` });
      const move = () => {
        const v = Number(quick.value);
        targets.forEach((i) => {
          if (v <= 0) { const f = i.look.chain && i.look.chain.find((x) => x.type === effect.type); if (f) { f.on = false; f.vibe = 0; } }
          else Object.assign(ensure(i, effect.type), vibeSettings(effect, v), { vibe: v });
        });
      };
      quick.addEventListener("input", () => { move(); changed("look"); });
      quick.addEventListener("change", () => { move(); done(); });
    }
    const card = foldCard({ key: `fx:${effect.type}`, name: effect.label, tick, quick, off: !on, onReset: resetTo(effect.type), build: controlsOf(effect) });
    card.classList.add("in-group");
    body.append(card);
  });

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
  const slidesChosen = selectedItems();
  const tone = getEffect("tone"), colour = getEffect("colour");
  body.append(strengthBar(chosen));
  const resetPart = (part, fresh, label) => () => { chosen.forEach((i) => { i.look[part] = fresh(); }); changed("project"); commit(); saidAcross(`${label} reset`, chosen.length); };
  body.append(foldCard({
    key: "adjust:light", name: "Light", onReset: resetPart("light", LIGHT_DEFAULTS, "Light"),
    build: (inner) => tone.controls.forEach((c) => inner.append(slider({
      label: c.label, min: c.min, max: c.max, step: c.step, targets: chosen,
      get: (i) => i.look.light[c.key], set: (i, v) => { i.look.light[c.key] = v; }
    })))
  }));
  body.append(foldCard({
    key: "adjust:colour", name: "Colour", onReset: resetPart("colour", COLOUR_DEFAULTS, "Colour"),
    build: (inner) => {
      const monos = chosen.map((i) => !!i.look.colour.mono);
      inner.append(el("div", { className: "row" }, segmented([{ value: false, label: "Colour" }, { value: true, label: "B&W" }], monos.every((m) => m === monos[0]) ? monos[0] : null, (v) => {
        chosen.forEach((i) => { i.look.colour.mono = v; });
        changed("project");
        commit();
        saidAcross(v ? "B&W" : "Colour", chosen.length);
      })));
      colour.controls.filter((c) => !c.kind).forEach((c) => inner.append(slider({
        label: c.label, min: c.min, max: c.max, step: c.step, targets: chosen,
        get: (i) => i.look.colour[c.key], set: (i, v) => { i.look.colour[c.key] = v; }
      })));
    }
  }));
  effectsSection(chosen);
  body.append(foldCard({
    key: "adjust:background", name: "Background",
    onReset: () => { slidesChosen.forEach((i) => { i.background = "#ffffff"; }); changed("project"); commit(); saidAcross("Background reset", slidesChosen.length); },
    build: (inner) => {
      const backs = slidesChosen.map((i) => i.background);
      const same = backs.every((b) => b === backs[0]) ? backs[0] : null;
      const setBack = (v, finished) => { slidesChosen.forEach((i) => { i.background = v; }); changed(finished ? "project" : "look"); if (finished) { commit(); saidAcross("Background", slidesChosen.length); } };
      const picker = el("input", { type: "color", className: "colour-big", value: same || "#ffffff", title: "Pick a colour" });
      picker.oninput = () => setBack(picker.value, false);
      picker.onchange = () => setBack(picker.value, true);
      inner.append(el("div", { className: "row" }, el("span", { textContent: "Colour" }), picker, same ? el("span", { className: "note", textContent: same }) : el("span", { className: "note", textContent: "mixed" })));
    }
  }));
  saveFilterSection(chosen);
}

// ---- Crop (the slide on the canvas only)

function buildCrop() {
  const slide = currentItem();
  if (!slide) return;
  const item = lookItem(); // (the picked layer: its crop)
  const pic = getPicture(item.mediaId);
  const many = layersOf(slide).length > 1;
  const act = (fn) => () => { fn(); changed("project"); commit(); };
  const frame = () => layerFrame(slide, item, slide.span * aspectOf(activeSet(state.project).ratio), 1) || { w: 1, h: 1 };
  const inGrid = isGrid(slide);
  const fitFill = el("div", { className: "segmented wide" },
    el("button", { textContent: "Fit", title: "The whole photo, on the background", onclick: act(() => { if (pic) fitCrop(item.crop, pic.width, pic.height, frame().w, frame().h); }) }),
    el("button", { textContent: "Fill", title: "The photo covers the slide", onclick: act(() => { if (pic) fillCrop(item.crop, pic.width, pic.height, frame().w, frame().h); }) }));
  body.append(fitFill);
  body.append(slider({
    label: "Zoom", min: 5, max: 400, unit: "%", reset: 100, targets: [item],
    get: (i) => i.crop.zoom * 100, set: (i, v) => { i.crop.zoom = v / 100; }, onCommit: () => {}
  }));
  body.append(slider({
    label: "Turn", min: -180, max: 180, step: 0.5, unit: "°", targets: [item],
    get: (i) => i.crop.rotation, set: (i, v) => { i.crop.rotation = v; }, onCommit: () => {}
  }));
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
    body.append(slider({ label: "Corners", min: 0, max: 50, unit: "%", targets: [item], get: (i) => (i.style.radius || 0) * 100, set: (i, v) => { i.style.radius = v / 100; }, onCommit: () => {} }));
    body.append(slider({ label: "Border", min: 0, max: 5, step: 0.25, targets: [item], get: (i) => i.style.border || 0, set: (i, v) => { i.style.border = v; }, onCommit: () => {} }));
    const bc = el("input", { type: "color", value: st.borderColour || "#ffffff" });
    bc.oninput = () => { st.borderColour = bc.value; changed("look"); };
    bc.onchange = () => { changed("project"); commit(); };
    const sh = el("input", { type: "checkbox", checked: !!st.shadow });
    sh.onchange = act(() => { st.shadow = sh.checked; });
    body.append(el("div", { className: "row" }, el("span", { textContent: "Border colour" }), bc, el("span", { className: "spacer" }), el("label", { className: "check-row" }, sh, el("span", { textContent: "Shadow" }))));
  }

  if (many || inGrid) return; // (panoramas are for a slide with one photo)
  const pano = slide;
  body.append(title("Panorama"));
  if (isVideo(item)) {
    body.append(note("Videos can't be panoramas: Instagram plays each slide's video by itself. Trim it and pick its cover in the bar under the canvas."));
  } else if (item.span > 1) {
    body.append(note("One photo across several slides. The dashed lines are where each swipe cuts: keep faces and words off them."));
    body.append(el("div", { className: "row" },
      el("span", { textContent: "Slides" }),
      button("−", () => { setSpan(item, item.span - 1); commit(); }),
      el("strong", { textContent: String(item.span) }),
      button("＋", () => { setSpan(item, item.span + 1); commit(); }),
      button("Split apart", () => splitPanorama(), "btn ghost small")));
  } else {
    body.append(note("Spread this photo across 2 or more slides, so swiping feels like one wide picture."));
    body.append(el("div", { className: "row" }, button("Make panorama", () => makePanorama())));
  }
}

// ---- Text (the slide on the canvas only)

function buildText() {
  const item = currentItem();
  if (!item) return;
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
  if (!item.texts.length) return;

  const list = el("div", { className: "text-list" });
  item.texts.forEach((t) => {
    const row = el("div", { className: "text-row" + (t.id === state.textId ? " on" : "") }, el("span", { textContent: t.content.split("\n")[0] || "(empty)" }));
    row.onclick = () => { state.textId = t.id; changed("view"); };
    list.append(row);
  });
  body.append(list);

  const t = item.texts.find((x) => x.id === state.textId);
  if (!t) return;
  const live = () => changed("look");
  const done = () => { changed("project"); commit(); };

  const content = el("textarea", { value: t.content, spellcheck: true });
  content.dataset.textContent = "1";
  content.addEventListener("input", () => { t.content = content.value; live(); });
  content.addEventListener("change", () => commit());
  body.append(content);

  const font = el("select", { className: "select" });
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

  body.append(el("div", { className: "row" },
    button("Centre it", () => { t.x = (Math.floor(t.x * item.span) + 0.5) / item.span; t.y = 0.5; done(); }),
    button("Delete text", () => { item.texts = item.texts.filter((x) => x !== t); state.textId = null; done(); }, "btn ghost small")));
}

// ---- Captions

function buildCaptions() {
  const p = state.project;
  PLATFORMS.filter((x) => x.id === p.stage).forEach((platform) => {
    const box = el("textarea", { value: p.captions[platform.id] || "", placeholder: `${platform.label} caption` });
    box.style.minHeight = "160px";
    const count = el("div", { className: "counter" });
    const show = () => {
      const n = box.value.length, tags = (box.value.match(/#[\p{L}\p{N}_]+/gu) || []).length;
      const over = platform.captionLimit && n > platform.captionLimit;
      count.textContent = `${n}${platform.captionLimit ? ` / ${platform.captionLimit}` : ""} characters${tags ? ` · ${tags} hashtag${tags === 1 ? "" : "s"}` : ""}${platform.id === "instagram" && tags > 30 ? " (Instagram allows 30)" : ""}`;
      count.classList.toggle("over", !!over || (platform.id === "instagram" && tags > 30));
    };
    box.addEventListener("input", () => { p.captions[platform.id] = box.value; show(); changed("look"); });
    box.addEventListener("change", () => commit());
    show();
    const copy = button("Copy", async () => {
      try { await navigator.clipboard.writeText(box.value); toast(`${platform.label} caption copied`); } catch (err) { box.select(); toast("Press ⌘C to copy"); }
    }, "btn ghost small");
    body.append(title(`${platform.label} caption`, copy), box, count);
  });
}

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
