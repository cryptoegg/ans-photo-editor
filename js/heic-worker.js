// iPhone photos (HEIC) read off the page (Tom, 2026-11-18: they should come in as fast as a JPEG): Chrome can't open
// HEIC itself, so heic-to (libheif) reads it here, the picture goes back at once to be shown, and then a JPEG copy is
// made to keep (so the project opens quickly later). js/media.js keeps a few of these, so a batch reads in parallel.
// heic-to (kept up to date with libheif) replaced heic2any, whose 2020 libheif couldn't read newer iPhone photos.
// In: { id, blob }. Out: { id, bitmap } then { id, jpeg }; or { id, error }. { warm: true } just loads the reader.
const LIB = "https://cdn.jsdelivr.net/npm/heic-to@1.6.7/dist/heic-to.js";
let lib = null;
const load = () => lib || (lib = import(LIB).catch((err) => { lib = null; throw err; }));

self.onmessage = async (e) => {
  const { id, blob, warm } = e.data;
  if (warm) { load().catch(() => {}); return; }
  try {
    const { heicTo } = await load();
    const bitmap = await heicTo({ blob, type: "bitmap" });
    const shown = await createImageBitmap(bitmap);
    self.postMessage({ id, bitmap: shown }, [shown]);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    bitmap.close();
    const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
    self.postMessage({ id, jpeg });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
