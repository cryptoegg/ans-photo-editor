// Eyedropper (Tom, 2026-11-23, as Photoshop's): a small pipette beside every colour box; click it, then click anywhere on
// the screen (the photo, a swatch) and that colour goes in the box, as if picked there. Uses the browser's EyeDropper
// (Chrome and Edge); where there's none, no pipettes are added.
const ok = typeof window.EyeDropper === "function";

function addTo(input) {
  if (input.dataset.dropper) return;
  input.dataset.dropper = "1";
  const b = document.createElement("button");
  b.type = "button";
  b.className = "dropper";
  b.title = "Pick a colour from the screen";
  b.setAttribute("aria-label", "Pick a colour from the screen");
  b.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      input.value = sRGBHex;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (err) { /* Esc: nothing picked */ }
  };
  input.after(b);
}

export function initDropper() {
  if (!ok) return;
  const scan = (root) => root.querySelectorAll && root.querySelectorAll('input[type="color"]').forEach(addTo);
  scan(document);
  new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) { if (n.matches('input[type="color"]')) addTo(n); else scan(n); } })))
    .observe(document.body, { childList: true, subtree: true });
}
