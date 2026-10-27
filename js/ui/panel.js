// The panel on the right. At the top, what you're editing, in words ("Editing slide 3",
// "Editing all 7 slides") and a This slide / All switch: Filters and Adjust change every slide
// outlined in the filmstrip; Crop and Text always change the one on the canvas. Changing
// several slides at once says so in a note with Undo.
import { state, changed, commit, undo, currentItem, selectedItems, select, selectAll, onChange, items } from '../state.js';
import { slideLabel, LIGHT_DEFAULTS, COLOUR_DEFAULTS, PLATFORMS, newId, cropDefaults, activeSet, aspectOf, isVideo } from '../project.js';
import { PRESETS } from '../effects/presets.js';
import { getEffect, EFFECTS, effectOrder } from '../effects/registry.js';
import { vibeSettings, VIBE_DEFAULT } from '../effects/vibe.js';
import { myFilters, getFilter, filterName, freshChain, newEffect, saveMyFilter, deleteMyFilter, isMine } from '../filters.js';
import { presetSwatch } from '../looks.js';
import { getPicture } from '../media.js';
import { TEXT_STYLES, FONTS, fillCrop, fitCrop } from '../render.js';
import { setSpan, splitPanorama, makePanorama, setOwnLook } from '../actions.js';
import { toast } from './toast.js';
import { ask } from './dialogs.js';

const undoAction = { label: "Undo", run: () => undo() };

// Filters, grouped for people new to them: everyday looks first, the A New Song collection,
// then the strong creative ones
const EVERYDAY = ["ans-clean-editorial", "ans-35mm-400", "expired-35mm", "film-scan", "faded-bw", "soft-bw", "grainy-bw", "painted-blur", "flash-at-night", "hard-light", "magazine-print", "photocopy"];
function filterGroups() {
  const everyday = EVERYDAY.map((id) => PRESETS.find((p) => p.id === id)).filter(Boolean);
  const ans = PRESETS.filter((p) => p.id.startsWith("ans-") && !EVERYDAY.includes(p.id));
  const creative = PRESETS.filter((p) => !EVERYDAY.includes(p.id) && !p.id.startsWith("ans-"));
  return [{ name: "Everyday", list: everyday }, { name: "A New Song", list: ans }, { name: "Creative", list: creative }];
}

let body = null;

export function initPanel() {
  body = document.getElementById("tab-body");
  document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => {
    state.tab = b.dataset.tab;
    changed("view");
  }));
  document.querySelectorAll("#scope-switch button").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.scope === "all") selectAll();
    else if (state.current) select(state.current, "one");
  }));
  onChange((what) => { if (what !== "look") build(); });
  document.addEventListener("focus-text", () => setTimeout(() => { const box = body.querySelector("textarea[data-text-content]"); if (box) { box.focus(); box.select(); } }, 0));
  build();
}

// ---- Building

function build() {
  const p = state.project;
  const chosen = selectedItems();
  const all = items().length;
  const scope = document.getElementById("scope");
  const text = document.getElementById("scope-text");
  if (!all) text.textContent = "No slides yet";
  else if (chosen.length === 1) text.textContent = `Editing ${slideLabel(p, chosen[0]).toLowerCase()}`;
  else if (chosen.length === all) text.textContent = `Editing all ${all} slides`;
  else text.textContent = `Editing ${chosen.length} slides`;
  scope.classList.toggle("many", chosen.length > 1);
  document.querySelectorAll("#scope-switch button").forEach((b) => b.classList.toggle("on", b.dataset.scope === "all" ? chosen.length > 1 && chosen.length === all : chosen.length === 1));
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === state.tab));

  const scroll = body.scrollTop;
  body.innerHTML = "";
  if (!all && state.tab !== "captions") {
    body.append(note("Add photos to start. Everything you set here shows on the canvas straight away."));
    return;
  }
  if ((state.tab === "filters" || state.tab === "adjust") && !p.linked && p.stages) body.append(sharedLook(chosen));
  ({ filters: buildFilters, adjust: buildAdjust, crop: buildCrop, text: buildText, captions: buildCaptions })[state.tab]();
  body.scrollTop = scroll;
}

const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); kids.forEach((k) => e.append(k)); return e; };
const note = (text) => el("p", { className: "note", textContent: text });
const title = (text, extra) => { const t = el("div", { className: "section-title", textContent: text }); if (extra) t.append(extra); return t; };
const button = (text, onclick, cls = "btn small") => el("button", { className: cls, textContent: text, onclick });

// "<what> applied to 7 slides · Undo" when a change reached more than one slide
function saidAcross(what, count) {
  if (count > 1) toast(`${what} applied to ${count} slides`, undoAction);
}

// A slider for a setting on these targets: shows "mixed" when they differ; moving it sets them
// all; let go = one undo step. get / set read and write one target's value.
function slider({ label, min, max, step = 1, targets, get, set, unit = "", reset = 0, onCommit }) {
  const values = targets.map(get);
  const mixed = values.some((v) => v !== values[0]);
  const field = el("label", { className: "field" + (mixed ? " mixed" : "") });
  const valueEl = el("span", { className: "value", textContent: mixed ? "" : `${Math.round(values[0])}${unit}` });
  const input = el("input", { type: "range", min, max, step, value: values[0] ?? reset });
  input.addEventListener("input", () => {
    const v = Number(input.value);
    targets.forEach((t) => set(t, v));
    field.classList.remove("mixed");
    valueEl.textContent = `${Math.round(v)}${unit}`;
    changed("look");
  });
  input.addEventListener("change", () => { commit(); if (onCommit) onCommit(); else saidAcross(label, targets.length); });
  field.addEventListener("dblclick", (e) => {
    if (e.target === input) return;
    targets.forEach((t) => set(t, reset));
    changed("look");
    commit();
    saidAcross(`${label} reset`, targets.length);
  });
  field.title = "Double-click the name to reset";
  field.append(el("span", { className: "field-head" }, el("span", { textContent: label }), valueEl), input);
  return field;
}

function segmented(options, value, onPick) {
  const seg = el("div", { className: "segmented small" });
  options.forEach((o) => seg.append(el("button", { textContent: o.label, className: o.value === value ? "on" : "", onclick: () => onPick(o.value) })));
  return seg;
}

// ---- Shared looks (Linked off): a slide's filter and adjustments are the same on every platform,
// unless it has its own here

function sharedLook(chosen) {
  const own = chosen.map((i) => !!i.ownLook);
  const box = el("input", { type: "checkbox", checked: !own.some(Boolean) });
  box.indeterminate = own.some(Boolean) && !own.every(Boolean);
  box.onchange = () => setOwnLook(!box.checked);
  const platform = PLATFORMS.find((x) => x.id === state.project.stage);
  return el("label", { className: "check-row note", title: "Off: this platform gets its own look for the selected slides" }, box,
    el("span", { textContent: box.checked ? "Same look on every platform" : `Own look on ${platform ? platform.label : "this platform"}` }));
}

// ---- Filters: the tiles (Original first), Strength floating at the top

let swatchJob = 0;

// Strength, floating at the top (only once a filter is on: filters work like presets, so no name)
function strengthBar(chosen) {
  const withFilter = chosen.filter((i) => i.look.preset);
  if (!withFilter.length) return "";
  const bar = el("div", { className: "sticky" });
  bar.append(slider({ label: "Strength", min: 0, max: 100, unit: "%", reset: 100, targets: withFilter, get: (i) => i.look.strength, set: (i, v) => { i.look.strength = v; } }));
  return bar;
}

// Put a filter on these slides (each gets its own fresh copy of it)
function useFilter(chosen, id) {
  const filter = getFilter(id);
  chosen.forEach((i) => {
    i.look.preset = id;
    i.look.chain = id ? freshChain(id) : null;
    if (id && !i.look.strength) i.look.strength = 100;
    // (one of yours brings its Light and Colour with it)
    if (filter && filter.light) i.look.light = { ...LIGHT_DEFAULTS(), ...filter.light };
    if (filter && filter.colour) i.look.colour = { ...COLOUR_DEFAULTS(), ...filter.colour };
  });
  changed("project");
  commit();
  saidAcross(id ? filterName(id) : "Original", chosen.length);
}

function buildFilters() {
  const chosen = selectedItems();
  const item = currentItem();
  const presets = chosen.map((i) => i.look.preset);
  const mixed = presets.some((x) => x !== presets[0]);
  body.append(strengthBar(chosen));
  if (mixed) body.append(note("These slides have different filters. Picking one puts it on all of them."));

  const job = ++swatchJob;
  const queue = [];
  const tile = (filter) => {
    const id = filter ? filter.id : null;
    const on = !mixed && (presets[0] || null) === id;
    const b = el("button", { className: "swatch" + (on ? " on" : ""), title: filter ? `${filter.note || filter.name}${on ? " · click again to edit it in Adjust" : ""}` : "No filter" });
    const holder = el("div", { className: "blank" });
    b.append(holder, el("span", { textContent: filter ? filter.name : "Original" }));
    if (on && filter) b.append(el("span", { className: "swatch-edit", textContent: "Edit" }));
    queue.push(() => {
      const c = presetSwatch(item.mediaId, id, state.project.seed, 132);
      if (c) { const shown = el("canvas", { width: c.width, height: c.height }); shown.getContext("2d").drawImage(c, 0, 0); holder.replaceWith(shown); }
    });
    b.onclick = () => {
      if (on && filter) { state.tab = "adjust"; changed("view"); return; } // (the picked one again: all its settings, in Adjust)
      useFilter(chosen, id);
    };
    return b;
  };
  const groups = [];
  if (myFilters().length) groups.push({ name: "Your filters", list: myFilters() });
  groups.push(...filterGroups());
  groups.forEach((group, g) => {
    body.append(title(group.name));
    const grid = el("div", { className: "swatches" });
    if (g === 0) grid.append(tile(null)); // (Original: the first tile, top left)
    group.list.forEach((f) => grid.append(tile(f)));
    body.append(grid);
  });
  // (swatches drawn one at a time, so the panel opens at once)
  if (!item || !getPicture(item.mediaId)) return;
  const next = () => { if (job !== swatchJob || !queue.length) return; queue.shift()(); setTimeout(next, 0); };
  setTimeout(next, 0);
}

// ---- Fold-out cards: a name that opens / closes its settings (▸ / ▾), an optional tick box
// (on / off), an optional one slider, and ↺ (back to its starting settings). Which are open is
// remembered while the app is open.

const openCards = new Set(["adjust:light"]);
function foldCard({ key, name, tick = null, quick = null, onReset = null, build, off = false }) {
  const open = openCards.has(key);
  const card = el("div", { className: "fold-card" + (open ? " open" : "") + (off ? " off" : "") });
  const head = el("div", { className: "fold-head" });
  if (tick) head.append(tick);
  const label = el("button", { className: "fold-name", title: "Show / hide its settings" }, el("span", { textContent: name }), el("span", { className: "fold-arrow", textContent: "▸" }));
  label.onclick = () => { if (openCards.has(key)) openCards.delete(key); else openCards.add(key); changed("view"); };
  head.append(label, el("span", { className: "spacer" }));
  if (quick) head.append(quick);
  if (onReset) head.append(el("button", { className: "btn small fold-reset", textContent: "↺", title: "Back to its starting settings", onclick: onReset }));
  card.append(head);
  if (open) { const inner = el("div", { className: "fold-body" }); build(inner); card.append(inner); }
  return card;
}

// ---- The filter's own settings and every effect (in Adjust), listed like the lyric app's
// effects panel: the filter's Light, Colour and Colour tint, then Effects, each with its tick
// box, its one slider and its settings folded under its name. Moving a setting of an effect
// that's off switches it on. A slide with no filter can switch effects on too (its own "Custom").

const ADJUST_TYPES = ["tone", "colour", "tint"];
function effectsSection(chosen) {
  const item = currentItem();
  if (!item) return;
  const id = item.look.preset;
  const targets = chosen;
  const done = () => { changed("project"); commit(); };
  const fxOf = (i, type) => (i.look.chain || (i.look.preset ? freshChain(i.look.preset) : [])).find((fx) => fx.type === type) || null;
  // The effect on a slide, made (switched on, in its place in the order) if it isn't there yet
  const ensure = (i, type) => {
    if (!i.look.chain) i.look.chain = i.look.preset ? freshChain(i.look.preset) : [];
    if (!i.look.preset) { i.look.preset = "custom"; i.look.strength = i.look.strength || 100; }
    let fx = i.look.chain.find((f) => f.type === type);
    if (!fx) {
      fx = newEffect(type);
      i.look.chain.push(fx);
      i.look.chain.sort((x, y) => effectOrder(x.type) - effectOrder(y.type));
    }
    fx.on = true;
    return fx;
  };
  const shown = (type) => fxOf(item, type) || { type, ...getEffect(type).defaults() };
  const resetTo = (type) => () => { targets.forEach((i) => { const fx = i.look.chain && i.look.chain.find((f) => f.type === type); if (fx) Object.assign(fx, getEffect(type).defaults()); }); done(); };
  const controlsOf = (effect) => (inner) => (effect.controls || []).forEach((c) => inner.append(effectControl(c, effect.type, targets, shown, ensure)));

  if (id) {
    EFFECTS.filter((e) => ADJUST_TYPES.includes(e.type)).forEach((effect) => {
      body.append(foldCard({ key: `fx:${effect.type}`, name: effect.type === "tone" ? "Filter light" : effect.type === "colour" ? "Filter colour" : effect.label, onReset: resetTo(effect.type), build: controlsOf(effect) }));
    });
  }
  // Effects: one fold that opens to the whole list (each effect folds open in turn)
  const groupOpen = openCards.has("adjust:effects");
  const onCount = EFFECTS.filter((e) => !ADJUST_TYPES.includes(e.type)).filter((e) => { const f = fxOf(item, e.type); return f && f.on !== false; }).length;
  const groupHead = el("div", { className: "fold-card effects-group" + (groupOpen ? " open" : "") },
    el("div", { className: "fold-head" }, el("button", { className: "fold-name", title: "Show / hide every effect", onclick: () => { if (groupOpen) openCards.delete("adjust:effects"); else openCards.add("adjust:effects"); changed("view"); } },
      el("span", { textContent: "Effects" }), el("span", { className: "fold-arrow", textContent: "▸" })),
      el("span", { className: "note", textContent: onCount ? `${onCount} on` : "" })));
  body.append(groupHead);
  if (groupOpen) EFFECTS.filter((e) => !ADJUST_TYPES.includes(e.type) && (!e.later || fxOf(item, e.type))).forEach((effect) => {
    const fx = fxOf(item, effect.type);
    const on = !!fx && fx.on !== false;
    const tick = el("input", { type: "checkbox", checked: on, title: "Switch this effect on / off" });
    tick.onchange = () => { targets.forEach((i) => { if (tick.checked) ensure(i, effect.type); else { const f = i.look.chain && i.look.chain.find((x) => x.type === effect.type); if (f) f.on = false; } }); done(); };
    let quick = null;
    if (effect.vibe) {
      // The one slider: 0 = off, up from there a light touch to the full look (several settings at once)
      quick = el("input", { type: "range", min: 0, max: 100, step: 1, className: "fold-quick", value: on ? (fx.vibe > 0 ? fx.vibe : VIBE_DEFAULT) : 0, title: `${effect.label}: 0 = off, up to the full look` });
      const move = () => {
        const v = Number(quick.value);
        targets.forEach((i) => {
          if (v <= 0) { const f = i.look.chain && i.look.chain.find((x) => x.type === effect.type); if (f) { f.on = false; f.vibe = 0; } }
          else Object.assign(ensure(i, effect.type), vibeSettings(effect, v), { vibe: v });
        });
      };
      quick.addEventListener("input", () => { move(); changed("look"); });
      quick.addEventListener("change", () => { move(); done(); });
    }
    const card = foldCard({ key: `fx:${effect.type}`, name: effect.label, tick, quick, off: !on, onReset: resetTo(effect.type), build: controlsOf(effect) });
    card.classList.add("in-group");
    body.append(card);
  });

}

// Save this filter: the slide's whole look (its Light, Colour, filter and effects) as one of Your
// filters, for any project. Always at the bottom of Adjust. Reset / Delete when it has a filter.
function saveFilterSection(chosen) {
  const item = currentItem();
  if (!item) return;
  const id = item.look.preset;
  const done = () => { changed("project"); commit(); };
  const nameBox = el("input", { className: "input", placeholder: "Name it", value: "" });
  nameBox.style.flex = "1";
  const save = button("Save", async () => {
    const name = nameBox.value.trim() || "My filter";
    const chain = item.look.chain || (id ? freshChain(id) : []);
    const filter = await saveMyFilter(name, chain, { ...item.look.light }, { ...item.look.colour });
    chosen.forEach((i) => { if (i === item || JSON.stringify(i.look) === JSON.stringify(item.look)) i.look.preset = filter.id; });
    item.look.preset = filter.id;
    if (!item.look.chain) item.look.chain = chain;
    done();
    toast(`Saved "${filter.name}" to Your filters`);
  }, "btn small primary");
  body.append(title("Save this filter"));
  body.append(el("div", { className: "row" }, nameBox, save));
  body.append(note("Keeps this slide's Light, Colour, filter and effects as one of Your filters, at the top of Filters in every project."));
  if (!id) return;
  const row = el("div", { className: "row" }, button("Reset filter", () => { chosen.forEach((i) => { if (i.look.preset) i.look.chain = freshChain(i.look.preset); }); done(); toast("Filter back to how it comes", undoAction); }, "btn ghost small"));
  if (isMine(id)) row.append(button("Delete from Your filters", async () => {
    if (!(await ask(`Delete "${filterName(id)}" from Your filters? Slides using it keep their look.`, { ok: "Delete", danger: true }))) return;
    await deleteMyFilter(id);
    changed("view");
  }, "btn ghost small"));
  body.append(row);
}

// One setting of an effect (built from its `controls`, like the lyric app's effects panel), on
// these slides. shown(type): the effect as the slide on the canvas has it (or its starting
// settings); ensure(slide, type): that slide's effect, switched on, made if needed.
function effectControl(c, type, targets, shown, ensure) {
  const done = () => { changed("project"); commit(); };
  const live = () => changed("look");
  const value = shown(type)[c.key];
  const setAll = (v) => targets.forEach((i) => { ensure(i, type)[c.key] = v; });
  if (c.kind === "colour") {
    const input = el("input", { type: "color", value: value || "#000000" });
    input.oninput = () => { setAll(input.value); live(); };
    input.onchange = done;
    return el("div", { className: "row" }, el("span", { textContent: c.label }), input);
  }
  if (c.kind === "toggle") {
    const input = el("input", { type: "checkbox", checked: !!value });
    input.onchange = () => { setAll(input.checked); done(); };
    return el("label", { className: "check-row" }, input, el("span", { textContent: c.label }));
  }
  if (c.kind === "text") {
    const input = el("input", { className: "input", value: value || "" });
    input.oninput = () => { setAll(input.value); live(); };
    input.onchange = done;
    return el("div", { className: "field" }, el("span", { className: "field-head", textContent: c.label }), input);
  }
  if (c.kind === "segment") {
    return el("div", { className: "row" }, c.label ? el("span", { textContent: c.label }) : "", segmented(c.options, value, (v) => { setAll(v); done(); }));
  }
  if (c.kind === "choice") {
    const options = c.options.filter((o) => o.value !== "lyrics"); // (no song here)
    const input = el("select", { className: "select" });
    options.forEach((o) => input.append(el("option", { value: String(o.value), textContent: o.label, selected: String(o.value) === String(value) })));
    input.onchange = () => { const o = options.find((x) => String(x.value) === input.value); setAll(o ? o.value : input.value); done(); };
    return el("div", { className: "row" }, el("span", { textContent: c.label }), input);
  }
  const start = getEffect(type).defaults()[c.key];
  return slider({
    label: c.label, min: c.min, max: c.max, step: c.step || 1, targets, reset: typeof start === "number" ? start : 0,
    get: (i) => { const fx = (i.look.chain || []).find((f) => f.type === type); return Number((fx || shown(type))[c.key]) || 0; },
    set: (i, v) => { const fx = ensure(i, type); fx[c.key] = v; if (c.drives) Object.assign(fx, c.drives(fx, 0)); },
    onCommit: () => {}
  });
}

// ---- Adjust: Light, Colour and Background, each folding open (they follow This slide / All)

function buildAdjust() {
  const chosen = selectedItems();
  const tone = getEffect("tone"), colour = getEffect("colour");
  body.append(strengthBar(chosen));
  const resetPart = (part, fresh, label) => () => { chosen.forEach((i) => { i.look[part] = fresh(); }); changed("project"); commit(); saidAcross(`${label} reset`, chosen.length); };
  body.append(foldCard({
    key: "adjust:light", name: "Light", onReset: resetPart("light", LIGHT_DEFAULTS, "Light"),
    build: (inner) => tone.controls.forEach((c) => inner.append(slider({
      label: c.label, min: c.min, max: c.max, step: c.step, targets: chosen,
      get: (i) => i.look.light[c.key], set: (i, v) => { i.look.light[c.key] = v; }
    })))
  }));
  body.append(foldCard({
    key: "adjust:colour", name: "Colour", onReset: resetPart("colour", COLOUR_DEFAULTS, "Colour"),
    build: (inner) => {
      const monos = chosen.map((i) => !!i.look.colour.mono);
      inner.append(el("div", { className: "row" }, segmented([{ value: false, label: "Colour" }, { value: true, label: "B&W" }], monos.every((m) => m === monos[0]) ? monos[0] : null, (v) => {
        chosen.forEach((i) => { i.look.colour.mono = v; });
        changed("project");
        commit();
        saidAcross(v ? "B&W" : "Colour", chosen.length);
      })));
      colour.controls.filter((c) => !c.kind).forEach((c) => inner.append(slider({
        label: c.label, min: c.min, max: c.max, step: c.step, targets: chosen,
        get: (i) => i.look.colour[c.key], set: (i, v) => { i.look.colour[c.key] = v; }
      })));
    }
  }));
  effectsSection(chosen);
  body.append(foldCard({
    key: "adjust:background", name: "Background",
    onReset: () => { chosen.forEach((i) => { i.background = "#ffffff"; }); changed("project"); commit(); saidAcross("Background reset", chosen.length); },
    build: (inner) => {
      inner.append(note("Shows wherever the photo doesn't cover the slide."));
      const backs = chosen.map((i) => i.background);
      const same = backs.every((b) => b === backs[0]) ? backs[0] : null;
      const setBack = (v, finished) => { chosen.forEach((i) => { i.background = v; }); changed(finished ? "project" : "look"); if (finished) { commit(); saidAcross("Background", chosen.length); } };
      const picker = el("input", { type: "color", className: "colour-big", value: same || "#ffffff", title: "Pick a colour" });
      picker.oninput = () => setBack(picker.value, false);
      picker.onchange = () => setBack(picker.value, true);
      inner.append(el("div", { className: "row" }, el("span", { textContent: "Colour" }), picker, same ? el("span", { className: "note", textContent: same }) : el("span", { className: "note", textContent: "mixed" })));
    }
  }));
  saveFilterSection(chosen);
  body.append(note("Tip: ⌘C copies this slide's look, ⌘V puts it on the selected slides. Hold \\ to see the photo before."));
}

// ---- Crop (the slide on the canvas only)

function buildCrop() {
  const item = currentItem();
  if (!item) return;
  const pic = getPicture(item.mediaId);
  if (selectedItems().length > 1) body.append(note(`Crop changes ${slideLabel(state.project, item).toLowerCase()} only.`));
  body.append(note("Click the photo on the canvas: drag it to move, a corner to size it, just outside a corner to turn it. Scroll or pinch to zoom."));
  const act = (fn) => () => { fn(); changed("project"); commit(); };
  body.append(el("div", { className: "row" },
    button("Fill", act(() => { if (pic) fillCrop(item.crop, pic.width, pic.height, item.span * aspectOf(activeSet(state.project).ratio), 1); }), "btn small"),
    button("Fit", act(() => { if (pic) fitCrop(item.crop, pic.width, pic.height, item.span * aspectOf(activeSet(state.project).ratio), 1); }), "btn small"),
    el("span", { className: "note", textContent: "Fill covers the slide; Fit shows the whole photo on the background." })));
  body.append(slider({
    label: "Size", min: 5, max: 400, unit: "%", reset: 100, targets: [item],
    get: (i) => i.crop.zoom * 100, set: (i, v) => { i.crop.zoom = v / 100; }, onCommit: () => {}
  }));
  body.append(slider({
    label: "Angle", min: -180, max: 180, step: 0.5, unit: "°", targets: [item],
    get: (i) => i.crop.rotation, set: (i, v) => { i.crop.rotation = v; }, onCommit: () => {}
  }));
  body.append(el("div", { className: "row" },
    button("↺ 90°", act(() => { item.crop.rotation = ((item.crop.rotation - 90 + 540) % 360) - 180; })),
    button("↻ 90°", act(() => { item.crop.rotation = ((item.crop.rotation + 90 + 540) % 360) - 180; })),
    button("Flip ↔", act(() => { item.crop.flipH = !item.crop.flipH; })),
    button("Flip ↕", act(() => { item.crop.flipV = !item.crop.flipV; }))));
  const lock = el("input", { type: "checkbox", checked: item.crop.lockRatio !== false });
  lock.onchange = act(() => { item.crop.lockRatio = lock.checked; if (lock.checked) item.crop.stretch = 1; });
  body.append(el("div", { className: "row" },
    el("label", { className: "check-row", title: "Off: dragging a corner can stretch the photo" }, lock, el("span", { textContent: "Lock ratio" })),
    el("span", { className: "spacer" }),
    button("Reset", act(() => { item.crop = cropDefaults(); }), "btn ghost small")));

  body.append(title("Panorama"));
  if (isVideo(item)) {
    body.append(note("Videos can't be panoramas: Instagram plays each slide's video by itself. Trim it and pick its cover in the bar under the canvas."));
  } else if (item.span > 1) {
    body.append(note("One photo across several slides. The dashed lines are where each swipe cuts: keep faces and words off them."));
    body.append(el("div", { className: "row" },
      el("span", { textContent: "Slides" }),
      button("−", () => { setSpan(item, item.span - 1); commit(); }),
      el("strong", { textContent: String(item.span) }),
      button("＋", () => { setSpan(item, item.span + 1); commit(); }),
      button("Split apart", () => splitPanorama(), "btn ghost small")));
  } else {
    body.append(note("Spread this photo across 2 or more slides, so swiping feels like one wide picture."));
    body.append(el("div", { className: "row" }, button("Make panorama", () => makePanorama())));
  }
}

// ---- Text (the slide on the canvas only)

function buildText() {
  const item = currentItem();
  if (!item) return;
  if (selectedItems().length > 1) body.append(note(`Text goes on ${slideLabel(state.project, item).toLowerCase()} only.`));
  const add = (style) => () => {
    const s = TEXT_STYLES[style];
    const t = { id: newId("t"), ...s };
    delete t.label;
    t.x /= item.span; // (on a panorama: in the first square)
    item.texts.push(t);
    state.textId = t.id;
    changed("project");
    commit();
    document.dispatchEvent(new CustomEvent("focus-text"));
  };
  body.append(title("Add text"));
  body.append(el("div", { className: "row" }, ...Object.keys(TEXT_STYLES).map((k) => button(TEXT_STYLES[k].label, add(k)))));
  if (!item.texts.length) { body.append(note("Text is drawn into the slide. Drag it on the canvas; drag a corner to size it.")); return; }

  const list = el("div", { className: "text-list" });
  item.texts.forEach((t) => {
    const row = el("div", { className: "text-row" + (t.id === state.textId ? " on" : "") }, el("span", { textContent: t.content.split("\n")[0] || "(empty)" }));
    row.onclick = () => { state.textId = t.id; changed("view"); };
    list.append(row);
  });
  body.append(list);

  const t = item.texts.find((x) => x.id === state.textId);
  if (!t) { body.append(note("Click a text (here or on the canvas) to change it.")); return; }
  const live = () => changed("look");
  const done = () => { changed("project"); commit(); };

  const content = el("textarea", { value: t.content, spellcheck: true });
  content.dataset.textContent = "1";
  content.addEventListener("input", () => { t.content = content.value; live(); });
  content.addEventListener("change", () => commit());
  body.append(content);

  const font = el("select", { className: "select" });
  FONTS.forEach((f) => font.append(el("option", { value: f.id, textContent: f.id, selected: f.id === t.font })));
  font.onchange = () => { t.font = font.value; document.fonts && document.fonts.load(`20px "${font.value}"`).then(live); done(); };
  body.append(el("div", { className: "row" }, font, segmented([{ value: 400, label: "Regular" }, { value: 700, label: "Bold" }], t.weight >= 600 ? 700 : 400, (v) => { t.weight = v; done(); })));
  body.append(slider({ label: "Size", min: 1, max: 40, step: 0.5, targets: [t], get: (x) => x.size * 100, set: (x, v) => { x.size = v / 100; }, onCommit: () => {} }));

  const colour = el("input", { type: "color", value: t.colour });
  colour.oninput = () => { t.colour = colour.value; live(); };
  colour.onchange = done;
  body.append(el("div", { className: "row" }, el("span", { textContent: "Colour" }), colour, alignIcons(t.align, (v) => { t.align = v; done(); })));

  body.append(slider({ label: "Stroke", min: 0, max: 20, step: 0.5, targets: [t], get: (x) => x.stroke || 0, set: (x, v) => { x.stroke = v; }, onCommit: () => {} }));
  const strokeColour = el("input", { type: "color", value: t.strokeColour || "#000000" });
  strokeColour.oninput = () => { t.strokeColour = strokeColour.value; live(); };
  strokeColour.onchange = done;
  body.append(el("div", { className: "row" }, el("span", { textContent: "Stroke colour" }), strokeColour));

  const bubble = el("select", { className: "select" });
  [["none", "No background"], ["lines", "Around the words"], ["box", "Box"], ["rounded", "Rounded"], ["pill", "Pill"], ["outline", "Outline"]].forEach(([v, l]) => bubble.append(el("option", { value: v, textContent: l, selected: v === t.bubble })));
  bubble.onchange = () => { t.bubble = bubble.value; done(); };
  const bubbleColour = el("input", { type: "color", value: t.bubbleColour });
  bubbleColour.oninput = () => { t.bubbleColour = bubbleColour.value; live(); };
  bubbleColour.onchange = done;
  body.append(el("div", { className: "row" }, el("span", { textContent: "Behind" }), bubble, bubbleColour));
  body.append(slider({ label: "Angle", min: -180, max: 180, step: 0.5, unit: "°", targets: [t], get: (x) => x.rotation || 0, set: (x, v) => { x.rotation = v; }, onCommit: () => {} }));

  body.append(el("div", { className: "row" },
    button("Centre it", () => { t.x = (Math.floor(t.x * item.span) + 0.5) / item.span; t.y = 0.5; done(); }),
    button("Delete text", () => { item.texts = item.texts.filter((x) => x !== t); state.textId = null; done(); }, "btn ghost small")));
}

// ---- Captions

function buildCaptions() {
  const p = state.project;
  body.append(note("Kept with the project, ready to copy when you post."));
  PLATFORMS.forEach((platform) => {
    const box = el("textarea", { value: p.captions[platform.id] || "", placeholder: `${platform.label} caption` });
    box.style.minHeight = "110px";
    const count = el("div", { className: "counter" });
    const show = () => {
      const n = box.value.length, tags = (box.value.match(/#[\p{L}\p{N}_]+/gu) || []).length;
      const over = platform.captionLimit && n > platform.captionLimit;
      count.textContent = `${n}${platform.captionLimit ? ` / ${platform.captionLimit}` : ""} characters${tags ? ` · ${tags} hashtag${tags === 1 ? "" : "s"}` : ""}${platform.id === "instagram" && tags > 30 ? " (Instagram allows 30)" : ""}`;
      count.classList.toggle("over", !!over || (platform.id === "instagram" && tags > 30));
    };
    box.addEventListener("input", () => { p.captions[platform.id] = box.value; show(); changed("look"); });
    box.addEventListener("change", () => commit());
    show();
    const copy = button("Copy", async () => {
      try { await navigator.clipboard.writeText(box.value); toast(`${platform.label} caption copied`); } catch (err) { box.select(); toast("Press ⌘C to copy"); }
    }, "btn ghost small");
    body.append(title(`${platform.label} · ${platform.post}`, copy), box, count);
  });
}

// Left / centre / right / justify, as pictures of lines
const ALIGN_ICONS = {
  left: [[4, 20], [4, 14], [4, 18], [4, 11]],
  center: [[4, 20], [7, 17], [5, 19], [8, 16]],
  right: [[4, 20], [10, 20], [6, 20], [13, 20]],
  justify: [[4, 20], [4, 20], [4, 20], [4, 13]]
};
function alignIcons(value, onPick) {
  const seg = el("div", { className: "segmented small icons" });
  [["left", "Left"], ["center", "Centre"], ["right", "Right"], ["justify", "Justify"]].forEach(([v, label]) => {
    const b = el("button", { className: v === value ? "on" : "", title: label, onclick: () => onPick(v) });
    b.setAttribute("aria-label", label);
    b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${ALIGN_ICONS[v].map(([a, z], i) => `<path d="M${a} ${5 + i * 4.7}H${z}"/>`).join("")}</svg>`;
    seg.append(b);
  });
  return seg;
}
