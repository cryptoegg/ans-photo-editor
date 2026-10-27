// Clip reader (copied from the lyric video app, js/media/clipDecoder.js): hands out the exact
// frame of a video clip for any moment, fast, for exports. It reads the file's index with
// mp4box.js (global MP4Box, loaded by js/video/mp4.js when a video is exported) and decodes the
// frames with the browser's VideoDecoder (WebCodecs), running forward through the clip, instead
// of seeking a video player and waiting for every frame. Only MP4 / MOV files the browser can
// decode this way are handled; openClip() gives null for anything else (e.g. WebM), and the
// export then seeks a player instead.

const READ_CHUNK = 4 * 1024 * 1024; // how much of the file to look through at a time for the index
const MAX_WAITING = 4;              // compressed frames handed to the decoder but not decoded yet
const MAX_AHEAD = 8;                // decoded frames kept ready ahead of the one showing (preview playback)

// A reader for a video file, or null if this file can't be read this way
export async function openClip(file) {
  if (!file || typeof MP4Box === "undefined" || typeof VideoDecoder === "undefined") return null;
  try {
    const index = await readIndex(file);
    if (!index) return null;
    const { supported } = await VideoDecoder.isConfigSupported(index.config);
    if (!supported) return null;
    return new ClipReader(file, index);
  } catch (err) {
    console.warn("Clip reader: can't read this file, using the video player instead.", err);
    return null;
  }
}

// The file's index: where each frame is, which ones are keyframes, and the decoder settings
async function readIndex(file) {
  const mp4 = MP4Box.createFile();
  let info = null;
  let failed = null;
  mp4.onReady = (i) => { info = i; };
  mp4.onError = (e) => { failed = e; };

  // Hand the file over a piece at a time until the index ('moov') has been found.
  // mp4box says where to read next, so a big block of frame data is skipped over.
  let position = 0;
  while (!info && !failed && position < file.size) {
    const piece = await file.slice(position, position + READ_CHUNK).arrayBuffer();
    piece.fileStart = position;
    const next = mp4.appendBuffer(piece, position + piece.byteLength >= file.size);
    position = next > position ? next : position + piece.byteLength;
  }
  if (!info) return null;

  const track = info.videoTracks && info.videoTracks[0];
  if (!track) return null;
  const trak = mp4.getTrackById(track.id);
  const samples = trak && trak.samples;
  if (!samples || !samples.length) return null;
  const description = codecDescription(trak);

  // Frame times in microseconds, with the first frame shown at 0 (as the player does)
  const scale = 1e6 / track.timescale;
  const firstShown = samples.reduce((min, s) => Math.min(min, s.cts), Infinity);
  const frames = samples.map((s) => ({
    offset: s.offset,
    size: s.size,
    key: s.is_sync,
    time: Math.round((s.cts - firstShown) * scale),
    duration: Math.round(s.duration * scale)
  }));

  return {
    frames, // in decoding order (the order they sit in the file)
    rotation: rotationOf(track.matrix),
    config: {
      codec: track.codec,
      codedWidth: track.video.width,
      codedHeight: track.video.height,
      ...(description ? { description } : {})
    }
  };
}

// The codec's setup bytes (e.g. H.264's avcC box, without its 8-byte box header)
function codecDescription(trak) {
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8);
    }
  }
  return null;
}

// Phone clips filmed sideways are stored sideways with a "turn it this much" note
function rotationOf(matrix) {
  if (!matrix) return 0;
  const degrees = Math.round(Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI);
  return ((degrees % 360) + 360) % 360;
}

class ClipReader {
  constructor(file, { frames, rotation, config }) {
    this.file = file;
    this.frames = frames;
    this.rotation = rotation;
    this.config = config;
    this.current = null;   // the frame handed out last (a VideoFrame), drawn by the layer
    this.decoded = [];     // decoded frames waiting to be used, in showing order
    this.nextToFeed = 0;   // next frame (decoding order) to hand to the decoder
    this.failed = null;
    this.wake = null;

    // Frames in showing order, and for each one the keyframe decoding has to start from
    this.shown = frames.map((f, i) => i).sort((a, b) => frames[a].time - frames[b].time);
    this.keyBefore = [];
    let key = 0;
    frames.forEach((f, i) => { if (f.key) key = i; this.keyBefore[i] = key; });

    this.decoder = new VideoDecoder({
      output: (frame) => { this.decoded.push(frame); this.nudge(); },
      error: (e) => { this.failed = e; this.nudge(); }
    });
    this.decoder.addEventListener("dequeue", () => this.nudge());
    this.decoder.configure(config);
  }

  // The frame showing at `seconds` into the clip (also kept in this.current)
  async frameAt(seconds) {
    if (this.failed) throw this.failed;
    const wanted = this.frameIndexAt(seconds * 1e6);
    const wantedTime = this.frames[wanted].time;
    if (this.current && this.current.timestamp === wantedTime) return this.current;

    // Going backwards (e.g. a loop starting over), or far enough ahead that starting from
    // a later keyframe is quicker: start decoding again from that frame's keyframe
    const key = this.keyBefore[wanted];
    const behind = this.current && wantedTime < this.current.timestamp;
    if (behind || key >= this.nextToFeed) this.restartAt(key);

    const startedFrom = this.current;
    for (;;) {
      if (this.failed) throw this.failed;
      // Meanwhile the preview took a ready frame at or past this one (frameIfReady): use that
      if (this.current !== startedFrom && this.current && this.current.timestamp >= wantedTime) return this.current;
      // Frames that come before the wanted one aren't needed any more
      while (this.decoded.length && this.decoded[0].timestamp < wantedTime) this.decoded.shift().close();
      if (this.decoded.length) return this.use(this.decoded.shift());

      if (this.nextToFeed < this.frames.length) {
        if (this.decoder.decodeQueueSize < MAX_WAITING) await this.feed();
        else await this.waitForDecoder();
      } else {
        await this.decoder.flush(); // the end of the clip: get out the last frames
        while (this.decoded.length && this.decoded[0].timestamp < wantedTime) {
          const frame = this.decoded.shift();
          if (!this.decoded.length) return this.use(frame); // nothing later: the last one
          frame.close();
        }
        if (this.decoded.length) return this.use(this.decoded.shift());
        return this.current;
      }
    }
  }

  // The frame for `seconds` if it's already decoded, without waiting (else null). The preview
  // uses this while playing, so it draws the frame for this very moment.
  frameIfReady(seconds) {
    if (this.failed) return null;
    const wantedTime = this.frames[this.frameIndexAt(seconds * 1e6)].time;
    if (this.current && this.current.timestamp === wantedTime) return this.current;
    if (this.current && wantedTime < this.current.timestamp) return null;
    const i = this.decoded.findIndex((f) => f.timestamp >= wantedTime);
    if (i < 0 || this.decoded[i].timestamp !== wantedTime) return null;
    this.decoded.splice(0, i).forEach((f) => f.close());
    return this.use(this.decoded.shift());
  }

  // Decode ahead, without showing anything, until the frame for `seconds` is ready (or
  // MAX_AHEAD frames are waiting), so playback finds its next frames already decoded
  async fillAhead(seconds) {
    const wantedTime = this.frames[this.frameIndexAt(seconds * 1e6)].time;
    while (!this.failed && this.decoded.length < MAX_AHEAD) {
      const newest = this.decoded.length ? this.decoded[this.decoded.length - 1] : this.current;
      if (newest && newest.timestamp >= wantedTime) return;
      if (this.nextToFeed >= this.frames.length) {
        await this.decoder.flush(); // the end of the clip: get out the last frames
        return;
      }
      if (this.decoder.decodeQueueSize < MAX_WAITING) await this.feed();
      else await this.waitForDecoder();
    }
  }

  // The frame (decoding-order index) showing at `micros`: the last one starting at or before it
  frameIndexAt(micros) {
    const shown = this.shown;
    let lo = 0, hi = shown.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.frames[shown[mid]].time <= micros) lo = mid;
      else hi = mid - 1;
    }
    return shown[lo];
  }

  use(frame) {
    if (this.current) this.current.close();
    this.current = frame;
    return frame;
  }

  restartAt(key) {
    this.decoder.reset();
    this.decoder.configure(this.config);
    this.decoded.forEach((f) => f.close());
    this.decoded = [];
    this.nextToFeed = key;
  }

  // Read the next compressed frame from the file and hand it to the decoder
  async feed() {
    const index = this.nextToFeed++;
    const f = this.frames[index];
    const data = await this.file.slice(f.offset, f.offset + f.size).arrayBuffer();
    this.decoder.decode(new EncodedVideoChunk({
      type: f.key ? "key" : "delta",
      timestamp: f.time,
      duration: f.duration,
      data
    }));
  }

  // Wait until the decoder has produced a frame or has room for more
  waitForDecoder() {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.wake = null; resolve(); }, 50);
      this.wake = () => { clearTimeout(timer); this.wake = null; resolve(); };
    });
  }

  nudge() { if (this.wake) this.wake(); }

  close() {
    this.decoded.forEach((f) => f.close());
    this.decoded = [];
    if (this.current) this.current.close();
    this.current = null;
    if (this.decoder.state !== "closed") this.decoder.close();
  }
}
