// The Export window and the Projects menu
import { state, openProject, changed, commit } from '../state.js';
import { saveToFolder, openFromFolder, mainFolder, chooseMainFolder, safeName } from '../folder.js';
import { SKINS, setSkin } from './skin.js';
import { installApp, isInstalled } from '../install.js';
import { newProject, slideCount, newId } from '../project.js';
import { listProjects, loadProject, deleteProject, saveProject } from '../store.js';
import { EXPORT_PLATFORMS, exportShape, foldersPossible, savedPlace, choosePlace, makeExports, writeToFolder, downloadZip } from '../exporter.js';
import { toast } from './toast.js';

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); kids.forEach((k) => e.append(k)); return e; };

// ---- Export

const choices = { platforms: new Set(["instagram", "tiktok", "youtube"]), scale: 1 };

export async function openExport() {
  const p = state.project;
  if (!EXPORT_PLATFORMS.some((pl) => exportShape(p, pl.id).count)) { toast("Add photos first"); return; }
  const back = document.getElementById("export-dialog");
  const folders = foldersPossible();
  let place = folders ? await savedPlace() : null;
  const box = el("div", { className: "dialog", role: "dialog" });
  back.innerHTML = "";
  back.append(box);
  back.hidden = false;
  const close = () => { back.hidden = true; };
  back.onclick = (e) => { if (e.target === back) close(); };

  const draw = () => {
    box.innerHTML = "";
    box.append(el("h2", { textContent: "Export each platform's set" }));
    EXPORT_PLATFORMS.forEach((pl) => {
      const shape = exportShape(p, pl.id);
      const tick = el("input", { type: "checkbox", checked: choices.platforms.has(pl.id) && shape.count > 0 });
      tick.onchange = () => { if (tick.checked) choices.platforms.add(pl.id); else choices.platforms.delete(pl.id); };
      const about = `${shape.count} slide${shape.count === 1 ? "" : "s"} · ${shape.width} × ${shape.height}${shape.fill ? ", your slides with the fill round them" : ""}`;
      box.append(el("label", { className: "check" }, tick, el("span", { textContent: pl.label }), el("span", { className: "note", textContent: about })));
    });
    const size = el("select", { className: "select" });
    [[1, "Standard (1080 px wide)"], [2, "Extra sharp (2160 px wide)"]].forEach(([v, l]) => size.append(el("option", { value: v, textContent: l, selected: v === choices.scale })));
    size.onchange = () => { choices.scale = Number(size.value); };
    box.append(el("div", { className: "row" }, el("span", { textContent: "Size" }), size));
    if (folders) {
      const where = el("div", { className: "row" },
        el("span", { textContent: place ? `Saves to: ${place.name}/${p.name || "Untitled"} Project/Exports` : "You'll choose where the project folder goes (once)." }));
      if (place) where.append(el("button", { className: "btn ghost small", textContent: "Change…", onclick: async () => { const h = await choosePlace(); if (h) { place = h; draw(); } } }));
      box.append(where);
    } else {
      box.append(el("p", { className: "note", textContent: "This browser can't save into folders, so you'll get one zip with a folder per platform. (Chrome and Edge can save straight into a project folder.)" }));
    }
    box.append(el("p", { className: "note", textContent: "Numbered in swipe order (01.jpg, 02.mp4…). Videos go to Instagram as MP4 (30 fps, with their sound unless muted). Location and camera details are removed from every file." }));
    const bar = el("div", { className: "progress", hidden: true }, el("div"));
    box.append(bar);
    const go = el("button", { className: "btn primary", textContent: "Export" });
    const cancel = el("button", { className: "btn ghost", textContent: "Cancel", onclick: close });
    box.append(el("div", { className: "actions" }, cancel, go));
    go.onclick = async () => {
      const platforms = EXPORT_PLATFORMS.map((x) => x.id).filter((id) => choices.platforms.has(id) && exportShape(p, id).count > 0);
      if (!platforms.length) { toast("Tick at least one platform"); return; }
      if (folders && !place) { place = await choosePlace(); if (!place) return; }
      go.disabled = cancel.disabled = true;
      go.textContent = "Exporting…";
      bar.hidden = false;
      try {
        const files = await makeExports(p, platforms, choices.scale, (f) => { bar.firstChild.style.width = `${Math.round(f * 100)}%`; });
        const count = Object.values(files).reduce((n, list) => n + list.length, 0);
        if (folders) {
          const path = await writeToFolder(place, p, files);
          toast(`Saved ${count} photos to ${path}`);
        } else {
          const name = await downloadZip(p, files);
          toast(`Downloaded ${name} (${count} photos)`);
        }
        close();
      } catch (err) {
        console.error(err);
        toast(`The export didn't finish: ${err.message || err}`);
        go.disabled = cancel.disabled = false;
        go.textContent = "Export";
      }
    };
  };
  draw();
}

// ---- Asking (the app's own window: the browser's confirm / prompt boxes are blocked in some
// places, e.g. the Claude app's pane, where they answer No without showing)

// ask(text, { ok, cancel, input, danger }) → resolves to true / false, or the text typed (null: cancelled)
export function ask(text, { ok = "OK", cancel = "Cancel", input = null, danger = false } = {}) {
  return new Promise((resolve) => {
    const back = document.getElementById("ask-dialog");
    const box = el("div", { className: "dialog small" });
    const field = input !== null ? el("input", { className: "input", value: input }) : null;
    const finish = (answer) => { back.hidden = true; back.innerHTML = ""; document.removeEventListener("keydown", keys, true); resolve(answer); };
    const yes = () => finish(field ? field.value.trim() || null : true);
    const no = () => finish(field ? null : false);
    const keys = (e) => { if (e.key === "Escape") { e.stopPropagation(); no(); } if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); yes(); } };
    box.append(el("p", { textContent: text }));
    if (field) box.append(field);
    box.append(el("div", { className: "actions" }, el("button", { className: "btn ghost", textContent: cancel, onclick: no }), el("button", { className: "btn " + (danger ? "danger" : "primary"), textContent: ok, onclick: yes })));
    back.innerHTML = "";
    back.append(box);
    back.hidden = false;
    back.onclick = (e) => { if (e.target === back) no(); };
    document.addEventListener("keydown", keys, true);
    setTimeout(() => (field || box.querySelector(".btn:last-child")).focus(), 0);
    if (field) field.select();
  });
}

// ---- Projects: this one's name; New, Save, Save as…, Open…; your projects (click to open, ✕ to delete)

export async function saveNow() {
  await saveProject(state.project);
  if (!foldersPossible()) { toast("Saved in this browser (this browser can't save to a folder; Chrome or Edge can)"); return; }
  try {
    const path = await saveToFolder(state.project);
    toast(path ? `Saved to ${path}` : "Saved in this browser. Choose a main folder in Settings to save it on your computer too.");
  } catch (err) {
    console.error(err);
    toast(`Saved in this browser, but not to the folder: ${err.message || err}`);
  }
}

export async function saveAs() {
  const name = await ask("Save a copy of this project as:", { input: `${state.project.name} copy`, ok: "Save" });
  if (!name) return;
  await saveProject(state.project);
  const copy = JSON.parse(JSON.stringify(state.project));
  Object.assign(copy, { id: newId("p"), name, created: Date.now(), updated: Date.now() });
  openProject(copy);
  await saveNow();
}

export async function openFromComputer() {
  if (!foldersPossible()) { toast("This browser can't open project folders. Chrome or Edge can."); return; }
  try {
    const p = await openFromFolder();
    if (!p) return;
    await saveProject(state.project);
    await saveProject(p);
    openProject(p);
    toast(`Opened ${p.name}`);
  } catch (err) { toast(err.message || String(err)); }
}

export async function openProjectsMenu(anchor) {
  const menu = document.getElementById("projects-menu");
  if (!menu.hidden) { menu.hidden = true; return; }
  const r = anchor.getBoundingClientRect();
  menu.style.left = "";
  menu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`; // (it sits at the top right, by Export)
  menu.style.top = `${r.bottom + 6}px`;
  menu.innerHTML = "";
  const close = () => { menu.hidden = true; };
  // This project's name
  const name = el("input", { className: "input", value: state.project.name, spellcheck: false });
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });
  name.addEventListener("change", () => { state.project.name = name.value.trim() || "Untitled"; changed("project"); commit(); });
  menu.append(el("label", { className: "menu-name" }, el("span", { className: "note", textContent: "This project's name" }), name));
  menu.append(el("div", { className: "menu-sep" }));
  const item = (label, keys, run) => el("div", { className: "menu-item", onclick: () => { close(); run(); } }, el("span", { textContent: label }), el("span", { className: "meta", textContent: keys }));
  menu.append(item("＋ New project", "", async () => { await saveProject(state.project); openProject(newProject()); toast("New project"); }));
  menu.append(item("Save project", "⌘S", saveNow));
  menu.append(item("Save as…", "⇧⌘S", saveAs));
  menu.append(item("Open project folder…", "", openFromComputer));
  menu.append(el("div", { className: "menu-sep" }));
  menu.append(el("div", { className: "note menu-label", textContent: "In this browser" }));
  const list = await listProjects();
  if (!list.length) menu.append(el("div", { className: "note", textContent: "Your projects show here." }));
  list.forEach((entry) => {
    const date = new Date(entry.updated).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    const del = el("button", { className: "del", textContent: "✕", title: "Delete this project from this browser" });
    del.onclick = async (e) => {
      e.stopPropagation();
      close();
      const sure = await ask(`Delete "${entry.name}" and its photos from this browser? Anything saved in your main folder stays.`, { ok: "Delete", danger: true });
      if (!sure) return;
      await deleteProject(entry.id);
      if (entry.id === state.project.id) {
        const rest = await listProjects();
        const next = rest[0] ? await loadProject(rest[0].id) : null;
        openProject(next || newProject());
      }
      toast(`Deleted ${entry.name}`);
    };
    const row = el("div", { className: "menu-item" + (entry.id === state.project.id ? " on" : "") },
      el("span", { textContent: entry.name || "Untitled" }), el("span", { className: "meta", textContent: `${entry.slides} slides · ${date}` }), del);
    row.onclick = async () => {
      close();
      if (entry.id === state.project.id) return;
      await saveProject(state.project);
      const p = await loadProject(entry.id);
      if (p) openProject(p);
    };
    menu.append(row);
  });
  menu.hidden = false;
  const away = (e) => { if (!menu.contains(e.target) && e.target !== anchor) { menu.hidden = true; document.removeEventListener("pointerdown", away); } };
  setTimeout(() => document.addEventListener("pointerdown", away), 0);
}

// ---- Settings (⚙): where things are saved, the main folder, the skin, the keys

export async function openSettings() {
  const back = document.getElementById("export-dialog");
  const box = el("div", { className: "dialog settings" });
  back.innerHTML = "";
  back.append(box);
  back.hidden = false;
  const close = () => { back.hidden = true; };
  back.onclick = (e) => { if (e.target === back) close(); };
  const section = (heading, ...kids) => el("section", {}, el("h3", { textContent: heading }), ...kids);
  const draw = async () => {
    box.innerHTML = "";
    box.append(el("div", { className: "row" }, el("h2", { textContent: "Settings" }), el("span", { className: "spacer" }), el("button", { className: "btn ghost small", textContent: "Done", onclick: close })));

    const folders = foldersPossible();
    const place = folders ? await mainFolder() : null;
    const folderRow = el("div", { className: "row" });
    if (!folders) folderRow.append(el("p", { className: "note", textContent: "This browser can't save into folders on your computer, so your projects are kept in this browser and exports download as a zip. Open the app in Chrome or Edge to use a main folder." }));
    else {
      folderRow.append(el("strong", { textContent: place ? `📁 ${place.name}` : "Not chosen yet" }), el("span", { className: "spacer" }),
        el("button", { className: "btn small", textContent: place ? "Change…" : "Choose…", onclick: async () => { if (await chooseMainFolder()) draw(); } }));
    }
    box.append(section("Main folder", el("p", { className: "note", textContent: "Where your projects, their photos, backups and exports are saved on your computer." }), folderRow));

    const name = safeName(state.project.name);
    box.append(section("What's saved where",
      el("ul", { className: "where" },
        el("li", {}, el("strong", { textContent: "In this browser: " }), "every project, saved by itself a moment after each change. Projects ▾ lists them."),
        el("li", {}, el("strong", { textContent: "In your main folder, when you Save (⌘S): " }), `${name} Project/${name}.ans (the project), Images/ (its photos) and Backup/ (the last 5 saves).`),
        el("li", {}, el("strong", { textContent: "When you Export: " }), `${name} Project/Exports/Instagram, TikTok and YouTube (01.jpg, 02.jpg…).`))));

    box.append(section("App", el("div", { className: "row" },
      el("span", { textContent: isInstalled() ? "Installed: it opens in its own window and works offline." : "Install it: an icon on your dock or desktop, its own window, works offline." }),
      el("span", { className: "spacer" }),
      isInstalled() ? "" : el("button", { className: "btn small", textContent: "Install as an app", onclick: installApp }))));

    const skin = el("select", { className: "select" });
    SKINS.forEach((s) => skin.append(el("option", { value: s.id, textContent: s.label, selected: s.id === (document.documentElement.dataset.skin || "concrete") })));
    skin.onchange = () => setSkin(skin.value);
    box.append(section("Display", el("div", { className: "row" }, el("span", { textContent: "Skin (the app's colours, never your photos')" }), el("span", { className: "spacer" }), skin)));

    const keys = [["⌘S / ⇧⌘S", "Save / Save as…"], ["⌘Z / ⇧⌘Z", "Undo / Redo"], ["← →", "Previous / next slide"], ["⇧-click / ⌘-click", "Select a run / add a slide"], ["⌘A", "Select all slides"], ["Delete", "Remove the selected slides (or the picked text)"], ["⌘C / ⌘V", "Copy / paste a look"], ["⌘D", "Duplicate"], ["Hold \\", "See the photo before"], ["⌘ while dragging", "No snapping"], ["⌘-scroll", "Zoom the view"]];
    box.append(section("Keys", el("div", { className: "keys" }, ...keys.flatMap(([k, what]) => [el("kbd", { textContent: k }), el("span", { textContent: what })]))));
  };
  draw();
}
