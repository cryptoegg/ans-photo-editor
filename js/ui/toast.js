// A short note at the bottom, e.g. "Warmth applied to 7 slides · Undo"
let timer = null;

export function toast(text, action = null) {
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
