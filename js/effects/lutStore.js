// LUTs (2026-11-17, step 3 of the pro features): colour looks as 3D tables (the .cube files colourists share).
// A .cube someone loads is kept in this browser
// (IndexedDB "ans_vtg_luts"), so it's offered in every session. A look: { id, name, size, data } where data holds
// size³ red, green, blue values 0 - 1, red changing fastest (the .cube order). The LUT effect (js/effects/lut.js)
// draws it onto a canvas atlas once (`atlasOf`) for the graphics card.

const clamp = (x) => Math.max(0, Math.min(1, x));

const looks = new Map(); // (the ready-made looks are Colour presets now: js/effects/colourPresets.js)
const listeners = new Set();
export const onLutsChange = (fn) => listeners.add(fn);

// Every look you've loaded: [{ id, name }]
export const listLuts = () => [...looks.values()].map(({ id, name }) => ({ id, name }));
export function getLut(id) {
  return looks.get(id) || null;
}

// A .cube file's text → { size, data } (throws a plain message when it isn't a 3D LUT)
export function parseCube(text) {
  let size = 0, min = [0, 0, 0], max = [1, 1, 1];
  const values = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const word = line.split(/\s+/);
    if (word[0] === "LUT_3D_SIZE") size = parseInt(word[1], 10);
    else if (word[0] === "LUT_1D_SIZE") throw new Error("That's a 1D LUT; only 3D LUTs (LUT_3D_SIZE) work here.");
    else if (word[0] === "DOMAIN_MIN") min = word.slice(1, 4).map(Number);
    else if (word[0] === "DOMAIN_MAX") max = word.slice(1, 4).map(Number);
    else if (/^[-+.\d]/.test(word[0]) && word.length >= 3) values.push(Number(word[0]), Number(word[1]), Number(word[2]));
  }
  if (!(size >= 2) || values.length !== size * size * size * 3) throw new Error("That file isn't a 3D .cube LUT this app can read.");
  const data = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) { const c = i % 3; data[i] = clamp((values[i] - min[c]) / ((max[c] - min[c]) || 1)); }
  return size > 64 ? resample({ size, data }, 33) : { size, data }; // (a 65-point table is too wide for some graphics cards)
}
function resample(lut, size) {
  const out = new Float32Array(size * size * size * 3), n = lut.size;
  const at = (r, g, b, c) => lut.data[((b * n + g) * n + r) * 3 + c];
  let i = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const p = [r, g, b].map((x) => (x / (size - 1)) * (n - 1)), q = p.map(Math.floor), f = p.map((x, k) => x - q[k]);
    for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let k = 0; k < 8; k++) {
        const dr = k & 1, dg = (k >> 1) & 1, db = (k >> 2) & 1;
        const w = (dr ? f[0] : 1 - f[0]) * (dg ? f[1] : 1 - f[1]) * (db ? f[2] : 1 - f[2]);
        v += w * at(Math.min(n - 1, q[0] + dr), Math.min(n - 1, q[1] + dg), Math.min(n - 1, q[2] + db), c);
      }
      out[i++] = v;
    }
  }
  return { size, data: out };
}

// The table as a picture for the graphics card: size² wide (one square per blue step), size tall
const atlases = new Map();
export function atlasOf(look) {
  if (atlases.has(look.id)) return atlases.get(look.id);
  const { size, data } = look;
  const canvas = document.createElement("canvas");
  canvas.width = size * size;
  canvas.height = size;
  const g = canvas.getContext("2d"), img = g.createImageData(canvas.width, canvas.height);
  for (let b = 0; b < size; b++) for (let gg = 0; gg < size; gg++) for (let r = 0; r < size; r++) {
    const s = ((b * size + gg) * size + r) * 3, d = (gg * canvas.width + b * size + r) * 4;
    img.data[d] = Math.round(data[s] * 255); img.data[d + 1] = Math.round(data[s + 1] * 255); img.data[d + 2] = Math.round(data[s + 2] * 255); img.data[d + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  atlases.set(look.id, canvas);
  return canvas;
}

// Kept in this browser
const DB = "ans_photo_luts";
function db() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("luts", { keyPath: "id" });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
// A .cube file brought in: kept, and its id returned
export async function addLutFile(file) {
  const { size, data } = parseCube(await file.text());
  const name = file.name.replace(/\.cube$/i, "");
  let h = 2166136261;
  for (let i = 0; i < data.length; i += 7) { h ^= Math.round(data[i] * 1e4); h = Math.imul(h, 16777619); }
  const id = `user:${(h >>> 0).toString(36)}${size}`;
  looks.set(id, { id, name, size, data });
  try { const d = await db(); d.transaction("luts", "readwrite").objectStore("luts").put({ id, name, size, data }); } catch (err) { /* this session only */ }
  listeners.forEach((fn) => fn());
  return id;
}
// The ones kept before, read in at startup
export const lutsReady = (async () => {
  try {
    const d = await db();
    const all = await new Promise((resolve) => { const q = d.transaction("luts").objectStore("luts").getAll(); q.onsuccess = () => resolve(q.result || []); q.onerror = () => resolve([]); });
    all.forEach((l) => looks.set(l.id, { ...l, data: new Float32Array(l.data) }));
    if (all.length) listeners.forEach((fn) => fn());
  } catch (err) { /* none kept */ }
})();
