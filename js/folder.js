// Your main folder (Chrome / Edge: the File System Access API), chosen once in Settings or on the
// first Save / Export and remembered in this browser. Each project gets its own folder in it,
// laid out like the lyric video app's:
//   <name> Project/
//     <name>.ans          the project (Save, ⌘S): slides, edits, captions, every platform's set
//     Images/             the photos it uses, copied in once each
//     Backup/             the last 5 saves ("<name> [2026-10-26 21.10].ans")
//     Exports/<Platform>/ 01.jpg, 02.jpg… (Export)
// Every project is also kept in this browser, saved a moment after each change, so a Save is
// for having it on your computer (and in your backups), not for not losing work.
// Browsers that can't open folders (Safari, Firefox, app-embedded ones like the Claude app's
// pane): projects live in this browser only, and exports download as a zip.
import { dbGet, dbPut, dbAll } from './store.js';

const KEY = "place";      // (IndexedDB meta: the main folder's handle)
const BACKUPS_KEPT = 5;

export const foldersPossible = () => typeof window.showDirectoryPicker === "function" && !/\b(Electron|Claude)\//.test(navigator.userAgent);
export const safeName = (name) => (String(name || "Untitled").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Untitled").slice(0, 80);

export const mainFolder = () => dbGet("meta", KEY).catch(() => null);
export async function chooseMainFolder() {
  try {
    const handle = await window.showDirectoryPicker({ id: "ans-photo-main", startIn: "documents", mode: "readwrite" });
    await dbPut("meta", handle, KEY);
    return handle;
  } catch (err) { return null; }
}
export async function allowed(handle) {
  if (!handle.queryPermission) return true;
  const opts = { mode: "readwrite" };
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

// The main folder, ready to write (asking for it the first time). Null if none / not allowed.
export async function readyFolder() {
  let place = await mainFolder();
  if (!place) place = await chooseMainFolder();
  if (!place || !(await allowed(place))) return null;
  return place;
}
export const projectDir = (place, project) => place.getDirectoryHandle(`${safeName(project.name)} Project`, { create: true });

async function writeFile(dir, name, data) {
  const handle = await dir.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(data);
  await w.close();
}
async function exists(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch (err) { return false; }
}
const stamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}`; };
const mediaIdsOf = (p) => [...new Set([p.items || [], ...(p.stages ? Object.values(p.stages).map((s) => s.items || []) : [])].flat().map((i) => i.mediaId))];
const imageName = (m) => `${m.id}-${safeName(m.name || "photo")}`;

// Save: "<name> Project/<name>.ans", its photos into Images/, the last save into Backup/.
// Resolves to the path saved, or null when there's no folder.
export async function saveToFolder(project) {
  const place = await readyFolder();
  if (!place) return null;
  const dir = await projectDir(place, project);
  const file = `${safeName(project.name)}.ans`;
  // The save before this one goes to Backup/ (the oldest past 5 go)
  if (await exists(dir, file)) {
    const backup = await dir.getDirectoryHandle("Backup", { create: true });
    const old = await (await dir.getFileHandle(file)).getFile();
    await writeFile(backup, `${safeName(project.name)} [${stamp()}].ans`, old);
    const mine = [];
    for await (const [name] of backup.entries()) if (name.startsWith(`${safeName(project.name)} [`)) mine.push(name);
    mine.sort();
    for (const name of mine.slice(0, Math.max(0, mine.length - BACKUPS_KEPT))) await backup.removeEntry(name);
  }
  // The photos, once each
  const images = await dir.getDirectoryHandle("Images", { create: true });
  const ids = new Set(mediaIdsOf(project));
  const media = (await dbAll("media").catch(() => [])).filter((m) => ids.has(m.id));
  for (const m of media) if (!(await exists(images, imageName(m)))) await writeFile(images, imageName(m), m.blob);
  const record = { app: "ans-photo-editor", version: 1, saved: Date.now(), project, media: media.map((m) => ({ id: m.id, name: m.name, type: m.type, file: `Images/${imageName(m)}` })) };
  await writeFile(dir, file, new Blob([JSON.stringify(record, null, 1)], { type: "application/json" }));
  return `${place.name}/${safeName(project.name)} Project/${file}`;
}

// Open a project folder (or any folder with a .ans in it): its photos come into this browser.
// Resolves to the project record, or null (cancelled / nothing there).
export async function openFromFolder() {
  let dir;
  const place = await mainFolder();
  try { dir = await window.showDirectoryPicker({ id: "ans-photo-open", ...(place ? { startIn: place } : {}), mode: "read" }); } catch (err) { return null; }
  let ansName = null;
  for await (const [name, handle] of dir.entries()) if (handle.kind === "file" && name.endsWith(".ans")) { ansName = name; break; }
  if (!ansName) throw new Error("There's no .ans project file in that folder");
  const record = JSON.parse(await (await (await dir.getFileHandle(ansName)).getFile()).text());
  if (!record || !record.project) throw new Error("That .ans file isn't a photo editor project");
  for (const m of record.media || []) {
    if (await dbGet("media", m.id).catch(() => null)) continue;
    try {
      const [folder, name] = m.file.split("/");
      const blob = await (await (await dir.getDirectoryHandle(folder)).getFileHandle(name)).getFile();
      await dbPut("media", { id: m.id, projectId: record.project.id, name: m.name, type: m.type || blob.type, blob, added: Date.now() });
    } catch (err) { console.error(`A photo is missing from the project folder: ${m.file}`, err); }
  }
  return record.project;
}
