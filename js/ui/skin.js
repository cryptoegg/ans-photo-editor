// The app's colours: Style 2 is the one look now (Tom, 2026-11-16, as in the Lyric Visualiser); the colour
// roles are at the top of styles.css. uiColour reads a role for drawing on a canvas.
const listeners = new Set();
export const onSkinChange = (fn) => listeners.add(fn);

// A colour role's value, for drawing on a canvas, e.g. uiColour("--snap")
export const uiColour = (role) => getComputedStyle(document.documentElement).getPropertyValue(role).trim();
