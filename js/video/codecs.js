// Encoder helpers for the MP4 export (js/video/mp4.js), copied from the lyric video app.

// The first of `candidates` (encoder settings) this browser can use, or null
export async function pickSupportedConfig(Encoder, candidates) {
  for (const config of candidates) {
    try {
      const { supported } = await Encoder.isConfigSupported(config);
      if (supported) return config;
    } catch (err) {
      // Try the next candidate
    }
  }
  return null;
}

export function videoBitrateFor(height) {
  if (height >= 2160) return 20_000_000;
  if (height >= 1080) return 8_000_000;
  if (height >= 720) return 5_000_000;
  return 1_500_000;
}
