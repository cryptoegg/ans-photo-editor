// Content-Aware fill (Tom, 2026-11-18, the Remove brush's quick fill, as Photoshop's Content-Aware): the brushed part
// is rebuilt from small patches of the photo around it, pieced together so edges and textures carry on through
// (PatchMatch, Barnes et al. 2009, with Wexler's patch voting). Worked out coarse to fine: a small copy first, then
// each size up refines it. No AI, nothing to download; off the page so the app never freezes.
// In: { id, rgba (Uint8ClampedArray), w, h, hole (Uint8Array, 1 = fill) }. Out: { id, rgba } (the hole filled).
const R = 3;            // patch radius: 7 x 7 patches
const EM_COARSE = 7;    // rounds of "find the best patches, then piece them together" on the smaller copies
const EM_FINE = 3;      // ...and on the full size (it starts close already)

self.onmessage = (e) => {
  const { id, rgba, w, h, hole } = e.data;
  try {
    const out = fill(rgba, w, h, hole);
    self.postMessage({ id, rgba: out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};

// ---- A level of the pyramid: the picture (floats, 3 channels) and its hole
function makeLevel(w, h) { return { w, h, img: new Float32Array(w * h * 3), hole: new Uint8Array(w * h) }; }

function down(L) {
  const w = Math.max(1, L.w >> 1), h = Math.max(1, L.h >> 1), D = makeLevel(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let n = 0, r = 0, g = 0, b = 0, holes = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const sx = Math.min(L.w - 1, x * 2 + dx), sy = Math.min(L.h - 1, y * 2 + dy), i = sy * L.w + sx;
      if (L.hole[i]) { holes++; continue; }
      r += L.img[i * 3]; g += L.img[i * 3 + 1]; b += L.img[i * 3 + 2]; n++;
    }
    const i = y * w + x;
    D.hole[i] = holes > 0 ? 1 : 0;
    if (n) { D.img[i * 3] = r / n; D.img[i * 3 + 1] = g / n; D.img[i * 3 + 2] = b / n; }
  }
  return D;
}

// Where a patch may be copied from: its whole 7 x 7 inside the picture and clear of the hole
function sourceMap(L) {
  const { w, h, hole } = L, ok = new Uint8Array(w * h);
  // (a hole pixel spoils every patch centre within R of it: a box test with a summed table)
  const sum = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += hole[y * w + x]; sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row; } }
  const box = (x0, y0, x1, y1) => sum[(y1 + 1) * (w + 1) + x1 + 1] - sum[y0 * (w + 1) + x1 + 1] - sum[(y1 + 1) * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
  const list = [];
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) if (!box(x - R, y - R, x + R, y + R)) { ok[y * w + x] = 1; list.push(y * w + x); }
  return { ok, list };
}

// The patch centres that cover the hole (they're the ones matched), each clamped inside the picture
function targetList(L) {
  const { w, h, hole } = L, seen = new Uint8Array(w * h), list = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!hole[y * w + x]) continue;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const cx = Math.min(w - 1 - R, Math.max(R, x + dx)), cy = Math.min(h - 1 - R, Math.max(R, y + dy)), i = cy * w + cx;
      if (!seen[i]) { seen[i] = 1; list.push(i); }
    }
  }
  return list;
}

// How different two patches are (sum of squared colour differences), giving up once past `best`
function dist(img, w, t, s, best) {
  let d = 0;
  for (let dy = -R; dy <= R; dy++) {
    let ti = (t + dy * w - R) * 3, si = (s + dy * w - R) * 3;
    for (let k = 0; k < (2 * R + 1) * 3; k++) { const v = img[ti + k] - img[si + k]; d += v * v; }
    if (d >= best) return d;
  }
  return d;
}

// PatchMatch: for each target patch, the best source patch (start from what each has, then try the neighbours' and
// random ones nearby, narrowing)
function patchMatch(L, src, targets, nnf, nd, passes) {
  const { w, h, img } = L;
  const isT = new Int32Array(w * h).fill(-1);
  targets.forEach((t, k) => { isT[t] = k; });
  for (let k = 0; k < targets.length; k++) nd[k] = dist(img, w, targets[k], nnf[k], Infinity);
  const tryS = (k, s) => {
    if (s < 0 || s >= w * h || !src.ok[s]) return;
    const d = dist(img, w, targets[k], s, nd[k]);
    if (d < nd[k]) { nd[k] = d; nnf[k] = s; }
  };
  for (let pass = 0; pass < passes; pass++) {
    const fwd = pass % 2 === 0, step = fwd ? 1 : -1;
    for (let n = 0; n < targets.length; n++) {
      const k = fwd ? n : targets.length - 1 - n, t = targets[k], tx = t % w, ty = (t / w) | 0;
      // (the neighbours' matches, shifted by one)
      const a = isT[t - step], b = isT[t - step * w];
      if (a >= 0 && tx - step >= 0 && tx - step < w) tryS(k, nnf[a] + step);
      if (b >= 0) tryS(k, nnf[b] + step * w);
      // (random tries round the current best, closer and closer)
      let rad = Math.max(w, h);
      const sx = nnf[k] % w, sy = (nnf[k] / w) | 0;
      while (rad >= 1) {
        const x = Math.round(sx + (Math.random() * 2 - 1) * rad), y = Math.round(sy + (Math.random() * 2 - 1) * rad);
        if (x >= R && y >= R && x < w - R && y < h - R) tryS(k, y * w + x);
        rad >>= 1;
      }
    }
  }
}

// Piece the hole together: each hole pixel the (weighted) average of what the patches over it say it should be
function vote(L, targets, nnf, nd) {
  const { w, img, hole } = L, acc = new Float32Array(w * L.h * 4);
  let mean = 0;
  for (let k = 0; k < nd.length; k++) mean += nd[k];
  mean = mean / Math.max(1, nd.length) + 1e-3;
  for (let k = 0; k < targets.length; k++) {
    const t = targets[k], s = nnf[k], wt = Math.exp(-nd[k] / (2 * mean));
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const q = t + dy * w + dx;
      if (!hole[q]) continue;
      const p = s + dy * w + dx;
      acc[q * 4] += img[p * 3] * wt; acc[q * 4 + 1] += img[p * 3 + 1] * wt; acc[q * 4 + 2] += img[p * 3 + 2] * wt; acc[q * 4 + 3] += wt;
    }
  }
  for (let q = 0; q < w * L.h; q++) if (hole[q] && acc[q * 4 + 3] > 0) {
    img[q * 3] = acc[q * 4] / acc[q * 4 + 3]; img[q * 3 + 1] = acc[q * 4 + 1] / acc[q * 4 + 3]; img[q * 3 + 2] = acc[q * 4 + 2] / acc[q * 4 + 3];
  }
}

// The smallest copy's hole: filled from its edge inward, ring by ring, each pixel from the patch elsewhere that best
// matches what's already there round it ("onion peel"), so lines and edges run on into it rather than a smooth blur
function peelFill(L, src) {
  const { w, h, img } = L, known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = L.hole[i] ? 0 : 1;
  const pick = [];
  for (let n = 0; n < src.list.length; n++) pick.push(src.list[n]);
  let ring = [];
  const edge = () => {
    ring = [];
    for (let i = 0; i < w * h; i++) if (!known[i]) {
      const x = i % w, y = (i / w) | 0;
      if ((x > 0 && known[i - 1]) || (x < w - 1 && known[i + 1]) || (y > 0 && known[i - w]) || (y < h - 1 && known[i + w])) ring.push(i);
    }
    return ring.length;
  };
  while (edge()) {
    const got = [];
    for (const t of ring) {
      const tx = t % w, ty = (t / w) | 0;
      let best = Infinity, bs = -1;
      for (const s of pick) {
        const sx = s % w, sy = (s / w) | 0;
        let d = 0, n = 0;
        for (let dy = -R; dy <= R && d < best * 49; dy++) {
          const yy = ty + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -R; dx <= R; dx++) {
            const xx = tx + dx;
            if (xx < 0 || xx >= w) continue;
            const q = yy * w + xx;
            if (!known[q]) continue;
            const p = ((sy + dy) * w + sx + dx) * 3;
            const a = img[q * 3] - img[p], b = img[q * 3 + 1] - img[p + 1], c = img[q * 3 + 2] - img[p + 2];
            d += a * a + b * b + c * c; n++;
          }
        }
        if (n && d / n < best) { best = d / n; bs = s; }
      }
      got.push([t, bs]);
    }
    for (const [t, s] of got) {
      if (s >= 0) { img[t * 3] = img[s * 3]; img[t * 3 + 1] = img[s * 3 + 1]; img[t * 3 + 2] = img[s * 3 + 2]; }
      known[t] = 1;
    }
  }
}

function fill(rgba, w, h, holeIn) {
  // The pyramid: halved until the hole is a few patches across
  const top = makeLevel(w, h);
  for (let i = 0; i < w * h; i++) { top.img[i * 3] = rgba[i * 4]; top.img[i * 3 + 1] = rgba[i * 4 + 1]; top.img[i * 3 + 2] = rgba[i * 4 + 2]; top.hole[i] = holeIn[i]; }
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let i = 0; i < w * h; i++) if (holeIn[i]) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0) return new Uint8ClampedArray(rgba);
  const levels = [top];
  let extent = Math.max(x1 - x0, y1 - y0) + 1;
  while (extent > 12 && Math.min(levels[levels.length - 1].w, levels[levels.length - 1].h) > 8 * R) { levels.push(down(levels[levels.length - 1])); extent >>= 1; }

  let nnf = null, prev = null;
  for (let li = levels.length - 1; li >= 0; li--) {
    const L = levels[li], src = sourceMap(L);
    if (!src.list.length) continue; // (no clean patch at this size: the smooth guess stands)
    const targets = targetList(L), nd = new Float64Array(targets.length), next = new Int32Array(targets.length);
    if (!prev) {
      peelFill(L, src);
      for (let k = 0; k < targets.length; k++) next[k] = src.list[(Math.random() * src.list.length) | 0];
    } else {
      // From the size below: its picture scaled up into the hole, its matches doubled
      const P = prev.L;
      for (let i = 0; i < L.w * L.h; i++) if (L.hole[i]) {
        const x = Math.min(P.w - 1, (i % L.w) >> 1), y = Math.min(P.h - 1, ((i / L.w) | 0) >> 1), j = y * P.w + x;
        L.img[i * 3] = P.img[j * 3]; L.img[i * 3 + 1] = P.img[j * 3 + 1]; L.img[i * 3 + 2] = P.img[j * 3 + 2];
      }
      const at = new Int32Array(P.w * P.h).fill(-1);
      prev.targets.forEach((t, k) => { at[t] = prev.nnf[k]; });
      for (let k = 0; k < targets.length; k++) {
        const t = targets[k], tx = t % L.w, ty = (t / L.w) | 0;
        const pt = Math.min(P.h - 1, ty >> 1) * P.w + Math.min(P.w - 1, tx >> 1), ps = at[pt];
        let s = -1;
        if (ps >= 0) { const sx = (ps % P.w) * 2 + (tx & 1), sy = ((ps / P.w) | 0) * 2 + (ty & 1), c = sy * L.w + sx; if (sx < L.w && sy < L.h && src.ok[c]) s = c; }
        next[k] = s >= 0 ? s : src.list[(Math.random() * src.list.length) | 0];
      }
    }
    nnf = next;
    const rounds = li === 0 ? EM_FINE : EM_COARSE;
    for (let em = 0; em < rounds; em++) { patchMatch(L, src, targets, nnf, nd, em === 0 ? 4 : 2); vote(L, targets, nnf, nd); }
    prev = { L, targets, nnf };
  }
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < w * h; i++) if (holeIn[i]) { out[i * 4] = top.img[i * 3]; out[i * 4 + 1] = top.img[i * 3 + 1]; out[i * 4 + 2] = top.img[i * 3 + 2]; }
  return out;
}
