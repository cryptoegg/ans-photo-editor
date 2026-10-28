// Export: every slide for each platform, numbered in swipe order (01.jpg, 02.mp4…): photos as
// JPEG; video slides as MP4 for Instagram (js/video/mp4.js), and as their cover still for TikTok
// and YouTube (while Linked; their own sets hold no video),
// 1080 px wide in the platform's shape: Linked, the square set (TikTok: the square in the middle
// of 1080 x 1920 with the fill around it); Linked off, each platform's own set and shape (4:5 =
// 1080 x 1350, 9:16 = 1080 x 1920…; a 1:1 TikTok set gets the fill). "Extra sharp" doubles it. Photos are drawn fresh, so no location or camera details from
// the originals go with them.
//
// Where they go: in Chrome / Edge, a project folder like the lyric video app's, made once in a
// place you choose and remembered:
//   <name> Project/Exports/Instagram/01.jpg …   (TikTok/, YouTube/ beside it)
// Exporting again replaces that platform's numbered photos. Other browsers (and app-embedded
// ones, whose folder picker never opens): one zip download with the same folders inside.
import { drawSlides, composeTikTok } from './render.js';
import { setFor, aspectOf, tiktokFilled, isVideo } from './project.js';
import { videoSlideToMp4 } from './video/mp4.js';
import { safeName, allowed } from './folder.js';
import { loadPicture } from './media.js';

const JSZIP = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
export const EXPORT_PLATFORMS = [
  { id: "instagram", folder: "Instagram", label: "Instagram" },
  { id: "tiktok", folder: "TikTok", label: "TikTok" },
  { id: "youtube", folder: "YouTube", label: "YouTube" }
];

// What a platform's export will be: { width, height, count, fill } (at scale 1)
export function exportShape(project, platform) {
  const set = setFor(project, platform);
  const a = aspectOf(set.ratio);
  const count = set.items.reduce((n, i) => n + i.span, 0);
  if (platform === "tiktok" && tiktokFilled(set.ratio)) return { width: 1080, height: 1920, count, fill: true, set, slideHeight: Math.round(1080 / a) };
  return { width: 1080, height: Math.round(1080 / a), count, fill: false, set };
}

// (the main folder: js/folder.js)
export { foldersPossible, safeName, mainFolder as savedPlace, chooseMainFolder as choosePlace } from './folder.js';

// Make the photos: { platformId: [Blob…] }. progress(0 - 1).
export async function makeExports(project, platforms, scale, progress = () => {}) {
  const shapes = platforms.map((id) => ({ id, ...exportShape(project, id) }));
  await Promise.all(shapes.flatMap((sh) => sh.set.items.flatMap((i) => [i.mediaId, ...((i.layers || []).map((l) => l.mediaId))]).map((id) => loadPicture(id))));
  const out = {};
  // (a video slide counts as much as ten photos in the progress bar: it takes longer)
  const weight = (sh, item) => (sh.id === "instagram" && isVideo(item) ? 10 : 1);
  const total = shapes.reduce((n, sh) => n + sh.set.items.reduce((m, i) => m + i.span * weight(sh, i), 0), 0);
  let done = 0;
  for (const sh of shapes) {
    const w = 1080 * scale;
    const pieceH = sh.fill ? sh.slideHeight * scale : sh.height * scale;
    const slides = drawSlides(sh.set, w, pieceH, { quality: "full", seed: project.seed });
    out[sh.id] = [];
    for (const slide of slides) {
      if (sh.id === "instagram" && isVideo(slide.item)) {
        const even = (n) => Math.round(n / 2) * 2; // (H.264 wants even sizes)
        const share = weight(sh, slide.item);
        out[sh.id].push(await videoSlideToMp4(slide.item, even(w), even(pieceH), project.seed, (f) => progress((done + f * share) / total)));
        done += share;
        continue;
      }
      const canvas = sh.fill ? composeTikTok(slide.canvas, project, w, Math.round((w * 16) / 9)) : slide.canvas;
      out[sh.id].push(await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92)));
      progress(++done / total);
      await new Promise((r) => setTimeout(r, 0)); // (let the progress bar move)
    }
  }
  return out;
}

const fileName = (i, blob) => `${String(i + 1).padStart(2, "0")}.${blob && blob.type === "video/mp4" ? "mp4" : "jpg"}`;

// Write them into "<name> Project/Exports/<Platform>/" in `place`. Resolves to the path written.
export async function writeToFolder(place, project, files) {
  if (!(await allowed(place))) throw new Error("The folder wasn't allowed");
  const projectDir = await place.getDirectoryHandle(`${safeName(project.name)} Project`, { create: true });
  const exportsDir = await projectDir.getDirectoryHandle("Exports", { create: true });
  for (const [id, blobs] of Object.entries(files)) {
    const platform = EXPORT_PLATFORMS.find((p) => p.id === id);
    const dir = await exportsDir.getDirectoryHandle(platform.folder, { create: true });
    // (the last export's numbered photos go, so the folder matches this set exactly)
    for await (const [name] of dir.entries()) { if (/^\d{2}\.(jpg|mp4)$/.test(name)) await dir.removeEntry(name); }
    for (let i = 0; i < blobs.length; i++) {
      const handle = await dir.getFileHandle(fileName(i, blobs[i]), { create: true });
      const writable = await handle.createWritable();
      await writable.write(blobs[i]);
      await writable.close();
    }
  }
  return `${place.name}/${safeName(project.name)} Project/Exports`;
}

// One zip download with a folder per platform
export async function downloadZip(project, files) {
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
  Object.entries(files).forEach(([id, blobs]) => {
    const folder = root.folder(EXPORT_PLATFORMS.find((p) => p.id === id).folder);
    blobs.forEach((blob, i) => folder.file(fileName(i, blob), blob));
  });
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
