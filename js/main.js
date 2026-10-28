// ANS Photo Editor: one linked set of slides (1:1 or 4:5) for an Instagram carousel, a TikTok photo post
// and a YouTube post at once, or a set per platform (up to 10 linked). Plain JavaScript modules, no build
// step: run any static server from this folder (python3 -m http.server).
//
//   js/project.js   the project record          js/state.js     selection, undo / redo, events
//   js/media.js     photos in, decoded           js/looks.js     filters + adjustments (graphics card)
//   js/render.js    drawing a slide (screen = export)            js/exporter.js  JPEGs out
//   js/ui/…         filmstrip, stage (Edit view), panel, phone (Phone view), dialogs
//   js/effects/…    the effects and filters, copied from the lyric video app
import { state, changed, onChange, commit, undo, redo, canUndo, canRedo, openProject, currentItem, select, selectAll, items } from './state.js';
import { newProject, slides as slideList, firstSlideOf, allLists } from './project.js';
import { saveProject, loadProject, lastProjectId } from './store.js';
import { loadPicture } from './media.js';
import { FONTS } from './render.js';
import { addFiles, duplicateSelected, removeSelected, resetSelected, makePanorama, splitPanorama, copyLook, pasteLook, setLinked, setStage, setRatio, copySelectedTo, addLayerFiles } from './actions.js';
import { loadMyFilters } from './filters.js';
import { initInstall } from './install.js';
import { STAGES, RATIO_NAMES, LINKED_RATIOS, linkedRatio } from './project.js';
import { initFilmstrip } from './ui/filmstrip.js';
import { initStage } from './ui/stage.js';
import { initPanel } from './ui/panel.js';
import { initPhone, go as phoneGo, showPhone } from './ui/phone.js';
import { openExport, openProjectsMenu, openSettings, saveNow, saveAs } from './ui/dialogs.js';

const $ = (id) => document.getElementById(id);

async function start() {
  await loadMyFilters();
  initInstall();
  initFilmstrip();
  initStage();
  initPanel();
  initPhone();
  wireTopBar();
  wireStrip();
  wireDropping();
  wireKeys();
  onChange(refresh);
  onChange(autosave);
  // The text fonts, fetched now, so canvases never draw a stand-in font (everything redraws once
  // they're in)
  if (document.fonts) Promise.all(FONTS.flatMap((f) => [document.fonts.load(`400 40px ${f.css}`), document.fonts.load(`700 40px ${f.css}`)])).catch(() => {}).then(() => changed("project"));

  // Where you left off
  let opened = false;
  try {
    const id = await lastProjectId();
    const p = id ? await loadProject(id) : null;
    if (p) { openProject(p); opened = true; await Promise.all(allLists(state.project).flat().flatMap((i) => [i.mediaId, ...((i.layers || []).map((l) => l.mediaId))]).map((id) => loadPicture(id))); changed("project"); }
  } catch (err) { console.error("Couldn't open the last project:", err); }
  if (!opened) openProject(newProject());
}

// ---- Saving: shortly after every finished change, and when the page is hidden
let saveTimer = null;
function autosave(what) {
  if (what !== "commit") return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveProject(state.project).catch((err) => console.error("Couldn't save:", err)), 500);
}
document.addEventListener("visibilitychange", () => { if (document.hidden && allLists(state.project).flat().length) saveProject(state.project).catch(() => {}); });

// ---- What's on screen follows the state
function refresh(what) {
  $("btn-undo").disabled = !canUndo();
  $("btn-redo").disabled = !canRedo();
  const item = currentItem();
  const has = items().length > 0;
  ["btn-duplicate", "btn-reset", "btn-delete", "btn-pano"].forEach((id) => { $(id).disabled = !has; });
  $("btn-split").disabled = !item || item.span < 2;
  $("btn-copy-to").hidden = state.project.linked || !state.project.stages;
  $("btn-copy-to").disabled = !has;
  $("btn-pano").textContent = state.selected.size > 1 ? "Join as panorama" : item && item.span > 1 ? "Add a slide to it" : "Make panorama";
  document.querySelectorAll("#view-switch button").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
  // Linked, or a set per platform (with its shape): Linked greys the shape out (it's 1:1)
  const p = state.project, separate = !p.linked && !!p.stages;
  document.querySelectorAll("#platform-switch button").forEach((b) => b.classList.toggle("on", separate ? b.dataset.mode === p.stage : b.dataset.mode === "linked"));
  const select = $("ratio-select");
  const ratios = separate ? STAGES[p.stage].ratios : LINKED_RATIOS;
  const forKey = separate ? p.stage : "linked";
  if (select.dataset.for !== forKey) { select.innerHTML = ratios.map((r) => `<option value="${r}">${RATIO_NAMES[r]}</option>`).join(""); select.dataset.for = forKey; }
  select.value = separate ? p.stages[p.stage].ratio : linkedRatio(p);
  select.disabled = ratios.length < 2;
  select.title = !separate ? "Linked: one set for all three, 1:1 or 4:5 (both show in full everywhere)" : "This platform's shape";
  if (separate && state.phonePlatform !== p.stage) state.phonePlatform = p.stage;
  $("edit-view").hidden = state.view !== "edit";
  $("phone-view").hidden = state.view !== "phone";
}

function setView(view) {
  if (view === state.view) return;
  state.view = view;
  if (view === "phone") {
    const item = currentItem();
    state.phoneSlide = item ? firstSlideOf(state.project, item) - 1 : 0;
  }
  changed("view");
  if (view === "phone") showPhone();
}

function wireTopBar() {
  $("btn-projects").onclick = (e) => openProjectsMenu(e.currentTarget);
  // Linked | Instagram | TikTok | YouTube
  document.querySelectorAll("#platform-switch button").forEach((b) => b.addEventListener("click", () => {
    const mode = b.dataset.mode;
    if (mode === "linked") { setLinked(true); return; }
    if (state.project.linked || !state.project.stages) { state.phonePlatform = mode; setLinked(false); }
    setStage(mode);
  }));
  $("ratio-select").addEventListener("change", (e) => setRatio(e.target.value));
  document.querySelectorAll("#view-switch button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
  $("btn-undo").onclick = undo;
  $("btn-redo").onclick = redo;
  $("btn-export").onclick = openExport;
  $("btn-settings").onclick = openSettings;
}

function wireStrip() {
  const input = $("file-input");
  const pick = () => input.click();
  $("btn-add").onclick = pick;
  $("btn-empty-add").onclick = pick;
  input.addEventListener("change", () => { if (input.files.length) addFiles(input.files); input.value = ""; });
  $("btn-duplicate").onclick = duplicateSelected;
  $("btn-delete").onclick = removeSelected;
  $("btn-reset").onclick = resetSelected;
  $("btn-pano").onclick = makePanorama;
  $("btn-split").onclick = splitPanorama;
  // Photos onto the slide as layers (＋ Add photo in Layers, or an empty grid cell)
  const layerInput = $("layer-input");
  document.addEventListener("add-layer", () => layerInput.click());
  layerInput.addEventListener("change", () => { if (layerInput.files.length) addLayerFiles(layerInput.files); layerInput.value = ""; });
  // Copy to ▾ (separate sets): the other platforms, or all of them
  $("btn-copy-to").onclick = (e) => {
    const menu = $("copy-menu");
    if (!menu.hidden) { menu.hidden = true; return; }
    const r = e.currentTarget.getBoundingClientRect();
    menu.innerHTML = "";
    const here = state.project.stage;
    [["instagram", "Instagram"], ["tiktok", "TikTok"], ["youtube", "YouTube"]].filter(([id]) => id !== here).concat([["all", "All other platforms"]]).forEach(([id, label]) => {
      const row = Object.assign(document.createElement("div"), { className: "menu-item", textContent: label });
      row.onclick = () => { menu.hidden = true; copySelectedTo(id); };
      menu.append(row);
    });
    menu.style.left = `${r.left}px`;
    menu.style.top = "";
    menu.style.bottom = `${window.innerHeight - r.top + 6}px`;
    menu.hidden = false;
    const away = (ev) => { if (!menu.contains(ev.target) && ev.target !== e.currentTarget) { menu.hidden = true; document.removeEventListener("pointerdown", away); } };
    setTimeout(() => document.addEventListener("pointerdown", away), 0);
  };
}

// Photos dropped anywhere on the window
function wireDropping() {
  const area = $("stage-area");
  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); area.classList.add("dropping"); } });
  window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) area.classList.remove("dropping"); });
  window.addEventListener("drop", (e) => {
    area.classList.remove("dropping");
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.target.closest && e.target.closest("#filmstrip")) return; // (the filmstrip takes its own)
    addFiles(e.dataTransfer.files);
  });
}

function wireKeys() {
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
    const cmd = e.metaKey || e.ctrlKey;
    // Save / Save as… / Settings work even while typing
    if (cmd && e.key.toLowerCase() === "s") { e.preventDefault(); if (e.target.blur) e.target.blur(); if (e.shiftKey) saveAs(); else saveNow(); return; }
    if (cmd && e.key === ",") { e.preventDefault(); openSettings(); return; }
    if (!document.getElementById("ask-dialog").hidden || !document.getElementById("export-dialog").hidden) return;
    if (typing) return;
    const key = e.key.toLowerCase();
    if (cmd && key === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (cmd && key === "y") { e.preventDefault(); redo(); return; }
    if (cmd && key === "c") { e.preventDefault(); copyLook(); return; }
    if (cmd && key === "v") { e.preventDefault(); pasteLook(); return; }
    if (cmd && key === "a") { e.preventDefault(); selectAll(); return; }
    if (cmd && key === "d") { e.preventDefault(); duplicateSelected(); return; }
    if (cmd) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      if (state.view === "phone") { phoneGo(step); return; }
      const list = items();
      const i = list.findIndex((x) => x.id === state.current);
      const next = list[Math.max(0, Math.min(list.length - 1, i + step))];
      if (next) select(next.id, e.shiftKey ? "range" : "one");
      return;
    }
    if (e.key === "\\" && !e.repeat) { state.before = true; changed("look"); return; }
    if ((e.key === "Backspace" || e.key === "Delete") && state.textId) {
      e.preventDefault();
      const item = currentItem();
      item.texts = item.texts.filter((t) => t.id !== state.textId);
      state.textId = null;
      changed("project");
      commit();
      return;
    }
    // Delete / Backspace with slides selected (and no text picked): they leave the set (Undo brings them back)
    if ((e.key === "Backspace" || e.key === "Delete") && state.view === "edit" && state.selected.size) {
      e.preventDefault();
      removeSelected();
      return;
    }
    if (e.key === "Escape" && (state.textId || state.photoPicked)) { state.textId = null; state.photoPicked = false; changed("view"); }
  });
  document.addEventListener("keyup", (e) => { if (e.key === "\\" && state.before) { state.before = false; changed("look"); } });
  window.addEventListener("blur", () => { if (state.before) { state.before = false; changed("look"); } });
}

start();

// (for checking in the browser's console)
window.__ans = { state, slideList };
