// Export (Tom, 2026-11-18: one export for the one set): every slide, numbered in swipe order (01.jpg, 02.mp4…):
// photos as JPEG, video slides as MP4 (js/video/mp4.js), 1080 px wide in the set's shape (4:5 = 1080 x 1350,
// 9:16 = 1080 x 1920…). "Extra sharp" doubles it. Photos are drawn fresh, so no location or camera details from the
// originals go with them. The same files go to every app (each takes them as they are; Post is where each gets them).
//
// Where they go: in Chrome / Edge, a project folder like the lyric video app's, made once in a
// place you choose and remembered:
//   <name> Project/Exports/01.jpg …
// Exporting again replaces the numbered files. Other browsers (and app-embedded ones, whose folder picker never
// opens): one zip download.
import { maskIdsOf } from './cutout.js';
import { gifsReady } from './gifs.js';
import { drawSlides } from './render.js';
import { activeSet, aspectOf, isVideo } from './project.js';
import { videoSlideToMp4 } from './video/mp4.js';
import { safeName, allowed } from './folder.js';
import { loadPicture } from './media.js';

const JSZIP = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

// What the export will be: { width, height, count, set } (at scale 1)
export function exportShape(project) {
  const set = activeSet(project);
  const count = set.items.reduce((n, i) => n + i.span, 0);
  return { width: 1080, height: Math.round(1080 / aspectOf(set.ratio)), count, set };
}

// (the main folder: js/folder.js)
export { foldersPossible, safeName, mainFolder as savedPlace, chooseMainFolder as choosePlace } from './folder.js';

// Make the files: [Blob…] in swipe order. progress(0 - 1).
export async function makeExports(project, scale, progress = () => {}) {
  const sh = exportShape(project);
  await Promise.all(sh.set.items.flatMap((i) => [i.mediaId, ...((i.layers || []).map((l) => l.mediaId)), ...maskIdsOf([i, ...(i.layers || [])])]).map((id) => loadPicture(id)));
  // (a video slide counts as much as ten photos in the progress bar: it takes longer)
  const weight = (item) => (isVideo(item) ? 10 : 1);
  const total = sh.set.items.reduce((m, i) => m + i.span * weight(i), 0);
  let done = 0;
  const w = 1080 * scale, h = sh.height * scale;
  const out = [];
  await gifsReady(sh.set.items);
  for (const slide of drawSlides(sh.set, w, h, { quality: "full", seed: project.seed, time: 0 })) { // (a GIF on a photo: its first frame)
    if (isVideo(slide.item)) {
      const even = (n) => Math.round(n / 2) * 2; // (H.264 wants even sizes)
      out.push(await videoSlideToMp4(slide.item, even(w), even(h), project.seed, (f) => progress((done + f * 10) / total)));
      done += 10;
      continue;
    }
    out.push(await new Promise((resolve) => slide.canvas.toBlob(resolve, "image/jpeg", 0.92)));
    progress(++done / total);
    await new Promise((r) => setTimeout(r, 0)); // (let the progress bar move)
  }
  return out;
}

const fileName = (i, blob) => `${String(i + 1).padStart(2, "0")}.${blob && blob.type === "video/mp4" ? "mp4" : "jpg"}`;

// Write them into "<name> Project/Exports/" in `place`. Resolves to the path written.
export async function writeToFolder(place, project, blobs) {
  if (!(await allowed(place))) throw new Error("The folder wasn't allowed");
  const projectDir = await place.getDirectoryHandle(`${safeName(project.name)} Project`, { create: true });
  const dir = await projectDir.getDirectoryHandle("Exports", { create: true });
  // (the last export's numbered files go, so the folder matches this set exactly)
  for await (const [name] of dir.entries()) { if (/^\d{2}\.(jpg|mp4)$/.test(name)) await dir.removeEntry(name); }
  for (let i = 0; i < blobs.length; i++) {
    const handle = await dir.getFileHandle(fileName(i, blobs[i]), { create: true });
    const writable = await handle.createWritable();
    await writable.write(blobs[i]);
    await writable.close();
  }
  return `${place.name}/${safeName(project.name)} Project/Exports`;
}

// One zip download
export async function downloadZip(project, blobs) {
  if (!window.JSZip) {
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = JSZIP;
      s.onload = resolve;
      s.onerror = () => reject(new Error("The zip maker couldn't be loaded (are you online?)"));
      document.head.appendChild(s);
    });
  }
  const zip = new window.JSZip();
  const root = zip.folder(`${safeName(project.name)} Exports`);
  blobs.forEach((blob, i) => root.file(fileName(i, blob), blob));
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${safeName(project.name)} Exports.zip`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return a.download;
}
