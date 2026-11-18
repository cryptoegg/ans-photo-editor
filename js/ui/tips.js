// Hover boxes (Tom, 2026-11-18): hold the pointer over anything with a `title` (an icon, a button, a slider) and a small
// box says what it is, sooner and plainer than the browser's own. The title moves to data-tip so the browser's own
// doesn't show as well. Gone on moving away, clicking, scrolling or a key.
const DELAY = 450;
let box = null, timer = 0, shownFor = null;

function hide() {
  clearTimeout(timer);
  shownFor = null;
  if (box) box.hidden = true;
}

function show(el) {
  const text = el.dataset.tip;
  if (!text || !el.isConnected) return;
  if (!box) { box = Object.assign(document.createElement("div"), { className: "tip-box" }); document.body.append(box); }
  box.textContent = text;
  box.hidden = false;
  shownFor = el;
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  let x = r.left + r.width / 2 - b.width / 2, y = r.bottom + 6;
  if (y + b.height > window.innerHeight - 6) y = r.top - b.height - 6; // (above it, near the bottom of the window)
  x = Math.max(6, Math.min(window.innerWidth - b.width - 6, x));
  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
}

document.addEventListener("pointerover", (e) => {
  const el = e.target.closest && e.target.closest("[title], [data-tip]");
  if (!el) { hide(); return; }
  if (el.hasAttribute("title")) { const t = el.getAttribute("title"); el.removeAttribute("title"); if (t) el.dataset.tip = t; }
  if (el === shownFor) return;
  hide();
  if (!el.dataset.tip) return;
  timer = setTimeout(() => show(el), DELAY);
});
document.addEventListener("pointerout", (e) => { const el = e.target.closest && e.target.closest("[data-tip]"); if (el && !el.contains(e.relatedTarget)) hide(); });
for (const ev of ["pointerdown", "keydown", "wheel"]) document.addEventListener(ev, hide, true);
window.addEventListener("blur", hide);

// (code that sets a title later still works: a title set again replaces the tip)
new MutationObserver((list) => {
  for (const m of list) if (m.type === "attributes" && m.target.hasAttribute("title")) {
    const t = m.target.getAttribute("title");
    m.target.removeAttribute("title");
    if (t) m.target.dataset.tip = t; else delete m.target.dataset.tip;
    if (shownFor === m.target) show(m.target);
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ["title"], subtree: true });
