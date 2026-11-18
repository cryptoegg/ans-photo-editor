// A short note at the top of the canvas, only for what can't be seen (Tom, 2026-11-18: no "done · Undo" notes over the
// buttons; the change shows, and Undo is in the Editor and on ⌘Z): a file that wouldn't open, where an export went…
let timer = null;

export function toast(text, action = null) {
  if (action && action.label === "Undo") return; // (a note that just says what was done)
  const el = document.getElementById("toast");
  el.innerHTML = "";
  el.append(document.createTextNode(text));
  if (action) {
    const b = document.createElement("button");
    b.textContent = action.label;
    b.onclick = () => { hide(); action.run(); };
    el.append(b);
  }
  el.hidden = false;
  clearTimeout(timer);
  timer = setTimeout(hide, action ? 4500 : 2500);
}

function hide() { document.getElementById("toast").hidden = true; }
