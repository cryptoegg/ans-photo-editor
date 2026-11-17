// Remove background, worked out off the page (so the app never freezes): BiRefNet (MIT licence, by ZhengPeng7),
// run in the browser with Transformers.js. The model is downloaded the first time it's used and kept by the
// browser (its own cache), so later cut-outs take about a second. Graphics card (WebGPU) when there is one, else
// the processor (slow: about 40 s a photo).
// In: { id, bitmap } (the photo). Out: { id, mask } (512 x 512 bytes, 255 = keep) or { id, error };
// while the model loads: { progress: 0..1 }.
const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2";
const MODEL = "onnx-community/BiRefNet_512x512-ONNX";
const SIDE = 512;

let ready = null;
function load() {
  if (ready) return ready;
  ready = (async () => {
    const T = await import(LIB);
    T.env.allowLocalModels = false;
    const files = new Map();
    const progress_callback = (p) => {
      if (p.status !== "progress" || !p.total) return;
      files.set(p.file, [p.loaded, p.total]);
      let got = 0, all = 0;
      files.forEach(([l, t]) => { got += l; all += t; });
      self.postMessage({ progress: all ? got / all : 0 });
    };
    const tryLoad = (device, dtype) => T.AutoModel.from_pretrained(MODEL, { device, dtype, progress_callback });
    let model = null, device = "wasm";
    if (self.navigator.gpu) {
      try { model = await tryLoad("webgpu", "fp16"); device = "webgpu"; } catch (e) { console.warn("Cut-out: no graphics card, using the processor", e); }
    }
    if (!model) model = await tryLoad("wasm", "fp32");
    return { T, model, device };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

async function run(bitmap) {
  let { T, model, device } = await load();
  const canvas = new OffscreenCanvas(SIDE, SIDE);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, SIDE, SIDE);
  bitmap.close();
  const px = ctx.getImageData(0, 0, SIDE, SIDE).data;
  const n = SIDE * SIDE, input = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) input[k * n + i] = (px[i * 4 + k] / 255 - mean[k]) / std[k];
  let tensor = new T.Tensor("float32", input, [1, 3, SIDE, SIDE]);
  let out;
  try { out = await model({ input_image: tensor }); }
  catch (err) {
    if (device !== "webgpu") throw err;
    // (the graphics card couldn't run it: the processor instead, from now on)
    console.warn("Cut-out: the graphics card couldn't run it, using the processor", err);
    ready = (async () => ({ T, model: await T.AutoModel.from_pretrained(MODEL, { device: "wasm", dtype: "fp32" }), device: "wasm" }))();
    ({ model, device } = await ready);
    out = await model({ input_image: tensor });
  }
  const o = out.output_image;
  const logits = o.type === "float32" ? o.data : o.to("float32").data;
  const mask = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) mask[i] = 255 / (1 + Math.exp(-Number(logits[i])));
  return mask;
}

self.onmessage = async (e) => {
  const { id, bitmap } = e.data;
  try {
    const mask = await run(bitmap);
    self.postMessage({ id, mask, side: SIDE }, [mask.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
