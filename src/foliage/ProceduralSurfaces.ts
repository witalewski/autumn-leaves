// The texture and mesh share this silhouette. Alpha only trims small teeth at the edge.
function halfWidth(t: number): number {
  const blade = Math.max(0, Math.min(1, (t - 0.105) / 0.895));
  return 0.34 * Math.pow(Math.sin(Math.PI * blade), 0.78) * (1.1 - 0.35 * blade);
}

function hash(x: number, y: number): number {
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + 29;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function noise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  let fx = x - ix, fy = y - iy;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

export function createSurfaceData(pattern: number, size = 256) {
  // Five reusable surfaces, shared across depth tiers; generated once.
  const albedo = new Uint8ClampedArray(size * size * 4);
  const surface = new Uint8Array(albedo.length);
  const normals = new Uint8Array(albedo.length);
  const heights = new Float32Array(size * size);
  const baseColor = [[225, 172, 46], [220, 133, 35], [202, 115, 44], [174, 73, 36], [158, 154, 53]][pattern];
  const stainColor = [[164, 69, 27], [144, 35, 25], [109, 58, 29], [226, 157, 41], [219, 143, 36]][pattern];
  const detailWeights = [1, 0.7, 0.35], veinWeights = [14, 18, 7], burnWeights = [36, 30, 12];

  for (let row = 0; row < size; row++) {
    const t = row / (size - 1);
    for (let col = 0; col < size; col++) {
      const x = col / (size - 1) - 0.5;
      const ax = Math.abs(x);
      const p = (row * size + col) * 4;
      const broad = noise(x * 12 + 40 + pattern * 17, t * 9 + pattern * 5);
      const medium = noise(x * 55 + 40 + pattern * 11, t * 65);
      const fine = noise(x * 240 + 40, t * 290);
      const width = halfWidth(t);
      const teeth = 0.955 + 0.045 * Math.abs(Math.sin(t * 31 * Math.PI + (x > 0 ? 0.6 : 0)));
      const stem = t < 0.125 && ax < 0.0075 * (1 - 0.4 * t);
      const edge = width * teeth - ax;
      const alpha = stem ? 255 : Math.max(0, Math.min(255, edge * size * 255));

      // Paired, gently curving secondary veins, then fine branching veinlets.
      const branchCoordinate = t - ax * 0.74 - ax * ax * 0.8 + (x > 0 ? 0.018 : 0);
      const branchDistance = Math.abs((branchCoordinate + 0.041) % 0.082 - 0.041);
      const midrib = Math.exp(-ax * ax / 0.000018);
      const vein = Math.exp(-branchDistance * branchDistance / 0.000009) * Math.min(1, ax * 60);
      const fineDistance = Math.abs(Math.sin((t + ax * 0.7 + medium * 0.009) * 390));
      const veinlets = Math.pow(1 - fineDistance, 13) * 0.12;
      const veins = Math.min(1, midrib + vein * 0.6 + veinlets);
      const rim = Math.exp(-Math.max(0, edge) * 170);
      const spot = Math.max(0, noise(x * 130, t * 150) - 0.8) * 1.5;
      // Warp the red/gold pigment field off the texture grid. Independent,
      // signed coordinates keep patches from mirroring across the midrib;
      // overlapping scales break up the former rounded gold islands.
      const redWarpX = pattern === 1 ? noise(x * 5.7 + 83.2, t * 4.3 + 17.6) - 0.5 : 0;
      const redWarpY = pattern === 1 ? noise(x * 4.1 + 31.8, t * 6.2 + 61.3) - 0.5 : 0;
      const patch = pattern === 1
        ? noise(x * 5.1 + t * 2.7 + redWarpX * 1.7 + 91.4, t * 4.6 - x * 3.2 + redWarpY * 1.5 + 23.8) * 0.7
          + noise(x * 15.3 + redWarpY * 2 + 8.7, t * 13.1 + redWarpX * 2 + 47.2) * 0.3
        : noise(x * 6 + pattern * 19, t * 5 + pattern * 7);
      const stain = Math.max(0, Math.min(1, (patch - 0.36) * 3.5));
      const edgeBurn = Math.min(1, rim * (0.3 + medium * 0.7));
      // Organic pigment fields retain distinct autumn palettes. Their albedo
      // range is compressed below so each leaf has closely related shades.
      const pigment = pattern === 0 ? stain * 0.5
        : pattern === 1 ? Math.max(0, Math.min(1, (patch - 0.28) * 2.5 + redWarpY * 0.22))
        : pattern === 2 ? Math.min(1, stain * 0.55 + edgeBurn * 0.6)
        : pattern === 3 ? Math.min(1, stain * 0.7 + (x > 0 ? 0.22 : 0))
        : Math.max(0, Math.min(1, (patch - 0.42) * 5 + t * 0.5));
      // Keep each palette's overall hue while reducing the difference between
      // its light and dark pigment patches to one fifth of the former range.
      const pigmentCenter = [0.2, 0.55, 0.3, 0.4, 0.5][pattern];
      const colorPigment = pigmentCenter + (pigment - pigmentCenter) * 0.2;
      const freckles = Math.max(0, noise(x * 72 + pattern * 13, t * 90) - 0.67) * 2.2;
      const russet = Math.min(1, pigment * 0.6 + edgeBurn * 0.4);
      const detail = (broad - 0.5) * 10 + (medium - 0.5) * 22 + (fine - 0.5) * 12 - spot * 80 - freckles * 60;
      for (let channel = 0; channel < 3; channel++) {
        albedo[p + channel] = baseColor[channel] + (stainColor[channel] - baseColor[channel]) * colorPigment
          + detail * detailWeights[channel] + veins * veinWeights[channel] - edgeBurn * burnWeights[channel];
      }
      albedo[p + 3] = alpha;
      // R: optical thickness, G: roughness. Kept linear, never sRGB.
      surface[p] = Math.min(255, 62 + veins * 155 + russet * 60 + spot * 120 + rim * 30);
      surface[p + 1] = Math.min(255, 185 + medium * 48 + rim * 18);
      surface[p + 2] = 0;
      surface[p + 3] = 255;
      heights[row * size + col] = veins * 0.45 + fine * 0.025 + medium * 0.06;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = heights[y * size + Math.min(size - 1, x + 1)] - heights[y * size + Math.max(0, x - 1)];
      const dy = heights[Math.min(size - 1, y + 1) * size + x] - heights[Math.max(0, y - 1) * size + x];
      const nz = 1 / Math.hypot(dx * 2.4, dy * 2.4, 1);
      normals[i * 4] = (-dx * 2.4 * nz * 0.5 + 0.5) * 255;
      normals[i * 4 + 1] = (-dy * 2.4 * nz * 0.5 + 0.5) * 255;
      normals[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
      normals[i * 4 + 3] = 255;
    }
  }
  return { size, color: new Uint8Array(albedo.buffer), normal: normals, surface };
}
