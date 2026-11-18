// The AI fill (Tom, 2026-11-18): the Remove brush's fill for big parts, where piecing the photo together (js/fill-worker.js)
// can't invent what was behind. LaMa (Suvorov et al. 2021, Apache-2.0), the ONNX export Carve/LaMa-ONNX: a fixed 512 x 512
// picture (0..1) and mask (1 = fill) in, the picture (0..255) out. About 200 MB, downloaded the first time (progress
// goes back to the page) and kept in this browser's Cache; run on the graphics card (WebGPU), else on the processor.
// In: { id, rgba (512*512*4), mask (512*512, 1 = fill) }. Out: { progress } while downloading, then { id, rgba } or { id, error }.
// { warm: true } just gets it ready.
const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/";
const MODEL = "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx";
const SIDE = 512;

let ready = null, gpuFailed = false;
function load() {
  return ready || (ready = (async () => {
    const ort = await import(ORT + "ort.webgpu.bundle.min.mjs");
    ort.env.wasm.wasmPaths = ORT;
    ort.env.wasm.numThreads = Math.min(8, (self.navigator && navigator.hardwareConcurrency) || 4);
    const bytes = await modelBytes();
    for (const ep of [...(self.navigator && navigator.gpu && !gpuFailed ? ["webgpu"] : []), "wasm"]) {
      try {
        const session = await ort.InferenceSession.create(bytes, { executionProviders: [ep] });
        return { ort, session, ep };
      } catch (err) { console.warn("AI fill:", ep, err); }
    }
    throw new Error("The AI fill couldn't start on this computer");
  })().catch((err) => { ready = null; throw err; }));
}

async function modelBytes() {
  const cache = await caches.open("ans-models").catch(() => null);
  const hit = cache && await cache.match(MODEL);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(MODEL);
  if (!res.ok) throw new Error(`The AI fill couldn't be downloaded (${res.status})`);
  const total = Number(res.headers.get("content-length")) || 208044816;
  const reader = res.body.getReader(), parts = [];
  let got = 0, shown = -1;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    const p = Math.floor((got / total) * 100) / 100;
    if (p !== shown) { shown = p; self.postMessage({ progress: Math.min(1, p) }); }
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  if (cache) cache.put(MODEL, new Response(bytes, { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
  return bytes;
}

// (some graphics cards can't run every part of it: then it runs on the processor from then on)
async function run(rgba, mask) {
  try { return await runOn(await load(), rgba, mask); } catch (err) {
    const now = ready && await ready.catch(() => null);
    if (!now || now.ep !== "webgpu") throw err;
    console.warn("AI fill on the graphics card failed, so on the processor:", err);
    gpuFailed = true; ready = null;
    return runOn(await load(), rgba, mask);
  }
}

async function runOn({ ort, session }, rgba, mask) {
  const n = SIDE * SIDE, image = new Float32Array(3 * n), m = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    image[i] = rgba[i * 4] / 255; image[n + i] = rgba[i * 4 + 1] / 255; image[2 * n + i] = rgba[i * 4 + 2] / 255;
    m[i] = mask[i] ? 1 : 0;
  }
  const out = await session.run({ image: new ort.Tensor("float32", image, [1, 3, SIDE, SIDE]), mask: new ort.Tensor("float32", m, [1, 1, SIDE, SIDE]) });
  const o = out[session.outputNames[0]].data, res = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { res[i * 4] = o[i]; res[i * 4 + 1] = o[n + i]; res[i * 4 + 2] = o[2 * n + i]; res[i * 4 + 3] = 255; }
  return res;
}

self.onmessage = async (e) => {
  const { id, rgba, mask, warm } = e.data;
  if (warm) { load().catch(() => {}); return; }
  try {
    const out = await run(rgba, mask);
    self.postMessage({ id, rgba: out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
