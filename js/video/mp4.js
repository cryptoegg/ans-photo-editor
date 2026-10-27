// A video slide as an MP4 for Instagram: every frame of its trimmed part drawn through the slide
// (its crop, look and texts, the same drawing as the screen), 30 frames a second, H.264, with
// the clip's own sound (AAC) unless the slide is muted. Frames come from the clip reader (exact,
// fast) or, for files it can't read (e.g. WebM), by seeking a player. Built on the lyric video
// app's export (its renderMp4); mp4-muxer and mp4box.js load from the CDN the first time.
import { openClip } from './clipReader.js';
import { pickSupportedConfig, videoBitrateFor } from './codecs.js';
import { drawItem } from '../render.js';
import { getPicture } from '../media.js';

const FPS = 30;
const MAX_FRAMES_AHEAD = 8;
const LIBS = [
  ["Mp4Muxer", "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.js"],
  ["MP4Box", "https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js"]
];

let loading = null;
function loadLibs() {
  if (!loading) loading = Promise.all(LIBS.map(([name, src]) => window[name] ? null : new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => { loading = null; reject(new Error("The video tools couldn't be loaded (are you online?)")); };
    document.head.appendChild(s);
  })));
  return loading;
}

export const canExportVideo = () => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined";

// The slide (a video item) as an MP4 blob, width x height (even numbers). progress(0 - 1).
export async function videoSlideToMp4(item, width, height, seed, progress = () => {}) {
  if (!canExportVideo()) throw new Error("This browser can't make MP4 video. Use Chrome or Edge.");
  await loadLibs();
  const pic = getPicture(item.mediaId);
  if (!pic || pic.kind !== "video") throw new Error("The video is missing");
  const start = item.trim.start, length = Math.max(0.1, item.trim.end - item.trim.start);
  const frames = makeFrameSource(pic, await openClip(pic.blob));
  const audio = item.muted ? null : await clipAudio(pic.blob, start, length);
  try {
    return await renderMp4({
      width, height, length, audio,
      drawFrame: async (ctx, t) => {
        const frame = await frames.at(start + t);
        drawItem(ctx, item, width, height, { quality: "full", seed, frame });
      },
      onProgress: progress
    });
  } finally {
    frames.close();
  }
}

// Frames as canvases the video's own (upright) size, for any moment
function makeFrameSource(pic, reader) {
  const canvas = document.createElement("canvas");
  canvas.width = pic.width;
  canvas.height = pic.height;
  const ctx = canvas.getContext("2d");
  if (reader) {
    return {
      async at(seconds) {
        const frame = await reader.frameAt(seconds);
        if (!frame) return canvas;
        // (phone clips filmed sideways are stored sideways with a turn: drawn upright, as the player shows them)
        const r = reader.rotation || 0;
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((r * Math.PI) / 180);
        const w = r % 180 ? canvas.height : canvas.width, h = r % 180 ? canvas.width : canvas.height;
        ctx.drawImage(frame, -w / 2, -h / 2, w, h);
        ctx.restore();
        return canvas;
      },
      close() { reader.close(); }
    };
  }
  // Can't read it frame by frame: seek a player for each one (slower, just as exact)
  const v = document.createElement("video");
  v.src = pic.url;
  v.muted = true;
  v.preload = "auto";
  return {
    async at(seconds) {
      if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
      v.currentTime = Math.min(seconds, pic.duration - 0.001);
      await new Promise((r) => v.addEventListener("seeked", r, { once: true }));
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      return canvas;
    },
    close() { v.removeAttribute("src"); v.load(); }
  };
}

// The clip's sound for [start, start + length], or null (no sound track / can't be read)
async function clipAudio(blob, start, length) {
  try {
    const decoded = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(await blob.arrayBuffer());
    const rate = decoded.sampleRate, from = Math.floor(start * rate), count = Math.min(decoded.length - from, Math.ceil(length * rate));
    if (count <= 0) return null;
    const channels = Math.min(2, decoded.numberOfChannels);
    return { sampleRate: rate, numberOfChannels: channels, length: count, data: Array.from({ length: channels }, (_, c) => decoded.getChannelData(c).slice(from, from + count)) };
  } catch (err) {
    return null; // (no sound in it, or a format the browser can't open: the MP4 is silent)
  }
}

async function renderMp4({ width, height, length, audio, drawFrame, onProgress }) {
  const videoConfig = await pickSupportedConfig(VideoEncoder, ["avc1.640028", "avc1.4d0028", "avc1.42003e", "avc1.640034"].map((codec) => ({
    codec, width, height, bitrate: videoBitrateFor(height), framerate: FPS, avc: { format: "avc" }
  })));
  if (!videoConfig) throw new Error(`This browser can't make H.264 video at ${width}x${height}.`);
  const audioConfig = audio ? await pickSupportedConfig(AudioEncoder, [{ codec: "mp4a.40.2", sampleRate: audio.sampleRate, numberOfChannels: audio.numberOfChannels, bitrate: 192_000 }]) : null;

  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width, height, frameRate: FPS },
    ...(audioConfig ? { audio: { codec: "aac", numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate } } : {}),
    fastStart: "in-memory",
    firstTimestampBehavior: "offset"
  });

  let failed = null, encoded = 0, moved = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => { muxer.addVideoChunk(chunk, meta); encoded++; if (moved) moved(); },
    error: (e) => { failed = e; if (moved) moved(); }
  });
  videoEncoder.configure(videoConfig);
  const catchUp = () => new Promise((resolve) => {
    const timer = setTimeout(() => { moved = null; resolve(); }, 100);
    moved = () => { clearTimeout(timer); moved = null; resolve(); };
  });

  if (audioConfig) {
    const audioEncoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failed = e; } });
    audioEncoder.configure(audioConfig);
    const BLOCK = 4096, ch = audio.numberOfChannels;
    for (let offset = 0; offset < audio.length; offset += BLOCK) {
      const n = Math.min(BLOCK, audio.length - offset);
      const planar = new Float32Array(n * ch);
      for (let c = 0; c < ch; c++) planar.set(audio.data[c].subarray(offset, offset + n), c * n);
      const data = new AudioData({ format: "f32-planar", sampleRate: audio.sampleRate, numberOfFrames: n, numberOfChannels: ch, timestamp: Math.round((offset / audio.sampleRate) * 1e6), data: planar });
      audioEncoder.encode(data);
      data.close();
    }
    await audioEncoder.flush();
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const total = Math.max(1, Math.round(length * FPS));
  const step = 1e6 / FPS;
  for (let i = 0; i < total; i++) {
    if (failed) throw failed;
    await drawFrame(ctx, i / FPS);
    const frame = new VideoFrame(canvas, { timestamp: Math.round(i * step), duration: Math.round(step) });
    videoEncoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    while (i + 1 - encoded > MAX_FRAMES_AHEAD && !failed) await catchUp();
    if (i % 10 === 0) { onProgress(encoded / total); await new Promise((r) => setTimeout(r, 0)); }
  }
  await videoEncoder.flush();
  if (failed) throw failed;
  muxer.finalize();
  onProgress(1);
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}
