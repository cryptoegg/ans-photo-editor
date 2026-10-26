// The app's skin: the colours around the photos, never the photos' own (styles.css has each
// skin's values). A preference in this browser; index.html sets it before the first paint.
const KEY = "ans_photo_skin";
export const SKINS = [
  { id: "concrete", label: "Concrete" },
  { id: "midnight", label: "Midnight" },
  { id: "slate", label: "Slate" },
  { id: "print", label: "Print" },
  { id: "electric", label: "Electric" }
];
const listeners = new Set();
export const onSkinChange = (fn) => listeners.add(fn);

// A colour role's value, for drawing on a canvas, e.g. uiColour("--snap")
export const uiColour = (role) => getComputedStyle(document.documentElement).getPropertyValue(role).trim();

// (picked in Settings)
export function setSkin(id) {
  document.documentElement.dataset.skin = SKINS.some((s) => s.id === id) ? id : "concrete";
  try { localStorage.setItem(KEY, document.documentElement.dataset.skin); } catch (err) { /* not kept */ }
  listeners.forEach((fn) => fn());
}
