// ANS Photo Editor: one set of slides for an Instagram carousel, a TikTok photo post and a YouTube post,
// edited once; Instagram | TikTok | YouTube only changes how it's shown. Plain JavaScript modules, no build
// step: run any static server from this folder (python3 -m http.server).
//
//   js/project.js   the project record          js/state.js     selection, undo / redo, events
//   js/media.js     photos in, decoded           js/looks.js     filters + adjustments (graphics card)
//   js/render.js    drawing a slide (screen = export)            js/exporter.js  JPEGs out
//   js/ui/…         filmstrip, stage (Edit view), panel, phone (Phone view), dialogs
//   js/effects/…    the effects and filters, copied from the lyric video app
import { openPost } from './ui/post.js';
import { maskIdsOf } from './cutout.js';
import { toolIcons } from './ui/brush.js';
import './ui/tips.js';
import { state, changed, onChange, commit, undo, redo, canUndo, canRedo, openProject, currentItem, select, selectAll, items, selectedItems } from './state.js';
import { newProject, slides as slideList, firstSlideOf, allLists, slideCount } from './project.js';
import { saveProject, loadProject } from './store.js';
import { loadPicture, warmHeicReader } from './media.js';
import { FONTS } from './render.js';
import { addFiles, duplicateSelected, removeSelected, resetSelected, makePanorama, setSpan, panoMost, copyLook, pasteLook, setStage, setRatio, addLayerFiles, duplicateLayer } from './actions.js';
import { loadMyFilters } from './filters.js';
import { initInstall } from './install.js';
import { STAGES, SHAPES, PLATFORMS, fitFor } from './project.js';
import { showMenu } from './ui/menu.js';
// The apps a shape suits, as their icons (the top bar's), for the shape menu and its button
function appIcons(r) {
  const box = Object.assign(document.createElement("span"), { className: "app-icons" });
  PLATFORMS.filter((x) => STAGES[x.id].ratios.includes(r)).forEach((x) => {
    const svg = document.querySelector(`#platform-switch [data-mode="${x.id}"] svg`);
    if (svg) { const i = svg.cloneNode(true); i.setAttribute("width", "14"); i.setAttribute("height", "14"); box.append(i); }
  });
  box.title = PLATFORMS.filter((x) => STAGES[x.id].ratios.includes(r)).map((x) => x.label).join(", ");
  return box;
}
import { initFilmstrip } from './ui/filmstrip.js';
import { initStage } from './ui/stage.js';
import { initPanel, flickFilter } from './ui/panel.js';
import { initDropper } from './ui/dropper.js';
import { initMediaColumn } from './ui/mediaColumn.js';
import { initPhone, go as phoneGo, showPhone } from './ui/phone.js';
import { openExport, openFileMenu, openSettings, saveNow, saveAs } from './ui/dialogs.js';

const $ = (id) => document.getElementById(id);

async function start() {
  await loadMyFilters();
  initInstall();
  initFilmstrip();
  initStage();
  initPanel();
  initDropper();
  initMediaColumn();
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

  // A blank project each time; ?open=<id> (the Account page's link) reopens that one instead.
  // Earlier projects are in File ▾. (The param comes off the address, so a refresh
  // doesn't keep forcing it.)
  let opened = false;
  try {
    const url = new URL(location.href);
    const id = url.searchParams.get("open");
    if (id) { url.searchParams.delete("open"); history.replaceState(null, "", url.pathname + url.search + url.hash); }
    const p = id ? await loadProject(id) : null;
    if (p) { openProject(p); opened = true; await Promise.all(allLists(state.project).flat().flatMap((i) => [i.mediaId, ...((i.layers || []).map((l) => l.mediaId)), ...maskIdsOf([i, ...(i.layers || [])])]).map((id) => loadPicture(id))); changed("project"); }
  } catch (err) { console.error("Couldn't open that project:", err); }
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
  // Panorama (Tom, 2026-11-18): the button makes the slide a panorama of 2; then the number beside it, with its arrows,
  // takes it up to 10 slides or back down to 1
  const joining = state.selected.size > 1, pano = !joining && item && item.span > 1;
  $("btn-pano").title = joining ? "Join as panorama: the picked slides become one photo across them" : "Panorama: one photo across several slides";
  $("btn-pano").classList.toggle("on", !!pano);
  $("pano-step").hidden = !pano;
  if (pano) {
    $("pano-n").textContent = String(item.span);
    $("pano-up").disabled = item.span >= panoMost(item);
  }
  $("btn-phone").classList.toggle("on", state.view === "phone");
  // The app the set is shown as, and how well the set suits each (faded: it doesn't take this shape; a dot: something
  // to know, in its hover box: too many slides, videos left out, or TikTok's tall frame)
  const p = state.project;
  document.querySelectorAll("#platform-switch button").forEach((b) => {
    const id = b.dataset.mode, fit = fitFor(p, id), label = PLATFORMS.find((x) => x.id === id).label;
    b.classList.toggle("on", id === p.stage);
    b.classList.toggle("fit-no", !fit.shapeOk);
    b.classList.toggle("fit-note", fit.shapeOk && fit.notes.length > 0);
    b.title = [`${label}${fit.ok ? (fit.framed ? `: takes ${p.set.ratio}, shown inside its tall screen` : `: takes ${p.set.ratio}`) : ""}`, ...fit.notes].join(" · ");
  });
  const shape = $("ratio-select");
  if (shape.dataset.ratio !== p.set.ratio) { shape.dataset.ratio = p.set.ratio; shape.replaceChildren(p.set.ratio, appIcons(p.set.ratio)); }
  if (state.phonePlatform !== p.stage) state.phonePlatform = p.stage;
  // Feed | Profile in the top bar is faint while editing (as in the Lyric Visualiser)
  document.body.classList.toggle("phone-on", state.view === "phone");
  showStatus();
  showCanvasBar();
  $("edit-view").hidden = state.view !== "edit";
  $("phone-view").hidden = state.view !== "phone";
}

// The next / previous slide on the canvas (← →, and ‹ › in the canvas bar)
function stepSlide(step, how = "one") {
  const list = items();
  const i = list.findIndex((x) => x.id === state.current);
  const next = list[Math.max(0, Math.min(list.length - 1, i + step))];
  if (next) select(next.id, how);
}

// The canvas bar: "Slide 3 of 7" (a panorama "Slides 5–6 of 7"), ‹ › and the background colour of the slides chosen
function showCanvasBar() {
  const p = state.project, item = currentItem(), list = items();
  $("canvas-bar").hidden = !list.length || state.view !== "edit"; // (an empty project: just "Drop photos here"; Phone view has its own − Fit +)
  const total = slideCount(p);
  const first = item ? firstSlideOf(p, item) : 0;
  $("slide-of").textContent = !item ? "No slides" : item.span > 1 ? `Slides ${first}–${first + item.span - 1} of ${total}` : `Slide ${first} of ${total}`;
  const i = list.indexOf(item);
  $("btn-slide-prev").disabled = i <= 0;
  $("btn-slide-next").disabled = i < 0 || i >= list.length - 1;
  const backs = selectedItems().map((x) => x.background || "#ffffff");
  const back = backs[0] || "#ffffff";
  $("bg-pick").style.setProperty("--bg-now", backs.every((b) => b === back) ? back : "conic-gradient(#fff 0 25%, #3b3a37 0 50%, #fff 0 75%, #3b3a37 0)");
  if (document.activeElement !== $("bg-colour")) $("bg-colour").value = back;
  // The tools (Tom, 2026-11-18): Move (the usual pointer) or a brush, the one in hand lit
  toolIcons("cb-icon", $("cb-tools"));
}

// The project's name is the window's title (Tom, 2026-11-17, as the Lyric Visualiser): "● Trial — Photo Editor",
// the ● while there are changes not saved to your folder (Save ⌘S stamps project.savedAt)
function showStatus() {
  const p = state.project, saved = p.savedAt || 0, dirty = (!saved || (p.updated || 0) > saved) && allLists(p).flat().length > 0;
  const title = `${dirty ? "● " : ""}${p.name || "Untitled"} — Photo Editor`;
  if (document.title !== title) document.title = title;
  alignBar();
}

// The top bar lined up with the columns (Tom, 2026-11-17, as the Lyric Visualiser): Edit | Phone, the platform and
// Feed | Profile centred over the canvas; the Editor's tabs spread over the Editor (folded: at the bar's right)
function alignBar() {
  const bar = document.querySelector(".topbar"), centre = document.querySelector(".topbar-centre");
  if (!bar || !centre) return;
  // (the Editor's tabs went to the left rail, 2026-11-23: Phone, the platforms and Feed | Profile centred over the
  // canvas, never over the buttons at the left)
  const zoom = parseFloat(getComputedStyle(bar).zoom) || 1, b = bar.getBoundingClientRect();
  const canvas = $("stage-area").getBoundingClientRect(), cw = centre.getBoundingClientRect().width;
  const leftEdge = document.querySelector(".topbar-left").getBoundingClientRect().right + 8;
  const rightEdge = b.right - 8;
  const left = Math.max(leftEdge, Math.min(canvas.left + canvas.width / 2 - cw / 2, rightEdge - cw));
  centre.style.left = `${(left - b.left) / zoom}px`;
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
  // Home (top left): back to Identity, the one main app this sits in: the Identity page that
  // opened the editor (kept for this tab, so a reload or ?open= still finds it), else Identity's start
  const home = $("btn-home");
  try {
    const from = document.referrer && new URL(document.referrer);
    if (from && from.origin === location.origin && from.pathname.startsWith("/identity/")) sessionStorage.setItem("ans_photo_home", from.pathname + from.search);
    const back = sessionStorage.getItem("ans_photo_home");
    // (Tom, 2026-11-13: Home always goes to Identity's home page, /identity/)
  } catch (err) { /* the start page, then */ }
  // Post: the calendar's Add a post, as a pop-up with the slides in it (js/ui/post.js)
  $("btn-post").addEventListener("click", (e) => { e.preventDefault(); openPost(); });
  $("btn-file").onclick = (e) => openFileMenu(e.currentTarget);
  // Instagram | TikTok | YouTube
  document.querySelectorAll("#platform-switch button").forEach((b) => b.addEventListener("click", () => setStage(b.dataset.mode)));
  { const watch = new ResizeObserver(() => alignBar()); ["stage-area", "panel", "media-col"].forEach((id) => watch.observe($(id))); watch.observe(document.querySelector(".topbar")); }
  window.addEventListener("resize", () => alignBar());
  // (the iPhone photo reader loaded once the app has settled, so the first iPhone photo doesn't wait for it)
  setTimeout(() => (window.requestIdleCallback || setTimeout)(() => warmHeicReader()), 3000);
  // The shape menu: each shape with the icons of the apps that take it
  $("ratio-select").addEventListener("click", (e) => showMenu(e, SHAPES.map((r) => ({ label: r, extra: appIcons(r), on: r === state.project.set.ratio, action: () => setRatio(r) })), { above: e.currentTarget }));
  // The canvas bar's ‹ ›, the background colour (the slides chosen), Before (held)
  $("btn-slide-prev").onclick = () => stepSlide(-1);
  $("btn-slide-next").onclick = () => stepSlide(1);
  const bg = $("bg-colour");
  bg.addEventListener("input", () => { selectedItems().forEach((x) => { x.background = bg.value; }); $("bg-pick").style.setProperty("--bg-now", bg.value); changed("look"); });
  bg.addEventListener("change", () => { changed("project"); commit(); });
  const before = $("btn-before");
  const hold = (on) => { if (state.before !== on) { state.before = on; changed("look"); } };
  before.addEventListener("pointerdown", (e) => { before.setPointerCapture(e.pointerId); hold(true); });
  ["pointerup", "pointercancel", "lostpointercapture"].forEach((t) => before.addEventListener(t, () => hold(false)));
  $("btn-phone").onclick = () => setView(state.view === "phone" ? "edit" : "phone"); // (one button, on / off, as the Lyric Visualiser's)
  $("btn-undo").onclick = undo;
  $("btn-redo").onclick = redo;
  $("btn-export").onclick = openExport;
}

function wireStrip() {
  const input = $("file-input");
  const pick = () => input.click();
  $("btn-add").onclick = pick;
  $("btn-empty-add").onclick = pick;
  input.addEventListener("change", () => { if (input.files.length) addFiles(input.files); input.value = ""; });
  // The strip's fold: the toolbar stays, the slides go (remembered in this browser)
  const foldStrip = (on) => { document.body.classList.toggle("strip-folded", on); try { localStorage.setItem("ans_photo_strip_folded", on ? "1" : "0"); } catch (e) {} window.dispatchEvent(new Event("resize")); };
  try { foldStrip(localStorage.getItem("ans_photo_strip_folded") === "1"); } catch (e) {}
  $("btn-strip-fold").onclick = () => foldStrip(!document.body.classList.contains("strip-folded"));
  $("btn-duplicate").onclick = duplicateSelected;
  $("btn-delete").onclick = removeSelected;
  $("btn-reset").onclick = resetSelected;
  $("btn-pano").onclick = () => { const item = currentItem(); if (item && item.span > 1 && state.selected.size <= 1) return; makePanorama(); };
  const step = (by) => { const item = currentItem(); if (!item) return; setSpan(item, Math.min(panoMost(item), item.span + by)); commit(); };
  $("pano-up").onclick = () => step(1);
  $("pano-down").onclick = () => step(-1);
  // The canvas bars scroll sideways in a narrow window: an up / down mouse wheel scrolls them too
  document.querySelectorAll(".canvas-bar").forEach((bar) => bar.addEventListener("wheel", (e) => {
    if (bar.scrollWidth <= bar.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    bar.scrollLeft += e.deltaY;
  }, { passive: false }));
  // Photos onto the slide as layers (＋ Add photo in Layers, or an empty grid cell)
  const layerInput = $("layer-input");
  document.addEventListener("add-layer", () => layerInput.click());
  layerInput.addEventListener("change", () => { if (layerInput.files.length) addLayerFiles(layerInput.files); layerInput.value = ""; });
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
    // ⌘D: a picked photo (on the canvas or in Layers) is copied onto the slide; else the selected slides
    if (cmd && key === "d") { e.preventDefault(); if (!(state.photoPicked && state.view === "edit" && currentItem() && duplicateLayer())) duplicateSelected(); return; }
    if (cmd) return;
    if (e.key.startsWith("Arrow") && flickFilter(e.key)) { e.preventDefault(); return; } // (a filter tile last clicked)
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      if (state.view === "phone") { phoneGo(step); return; }
      stepSlide(step, e.shiftKey ? "range" : "one");
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
