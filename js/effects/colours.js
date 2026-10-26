// Colour helpers shared by effects

// "#2a4bff" -> [r, g, b] from 0 to 1 (what a recipe's vec3 colour wants)
export function toRGB(hex) {
  const n = parseInt(String(hex || "#ffffff").replace("#", ""), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
}
