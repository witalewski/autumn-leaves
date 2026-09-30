import {
  BufferGeometry, Color, DataTexture, DoubleSide, Float32BufferAttribute,
  LinearMipmapLinearFilter, Mesh, MeshStandardNodeMaterial, RGBAFormat,
  SRGBColorSpace, Vector2, Vector3,
} from 'three/webgpu';
import type { DetailTier } from './simulation/DepthComposition';
import { cameraPosition, dot, mix, normalWorld, positionWorld, pow, texture, uniform } from 'three/tsl';

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

function createTextures() {
  const size = 768;
  const albedo = new Uint8ClampedArray(size * size * 4);
  const surface = new Uint8Array(albedo.length);
  const normals = new Uint8Array(albedo.length);
  const heights = new Float32Array(size * size);

  for (let row = 0; row < size; row++) {
    const t = row / (size - 1);
    for (let col = 0; col < size; col++) {
      const x = col / (size - 1) - 0.5;
      const ax = Math.abs(x);
      const p = (row * size + col) * 4;
      const broad = noise(x * 12 + 40, t * 9);
      const medium = noise(x * 55 + 40, t * 65);
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
      const russet = Math.min(1, Math.max(0, (broad - 0.48) * 2.2 + rim * 0.28));
      const detail = (medium - 0.5) * 28 + (fine - 0.5) * 16 - spot * 80;
      albedo[p] = 190 + broad * 37 - russet * 35 + detail + veins * 14;
      albedo[p + 1] = 117 + broad * 32 - russet * 72 + detail * 0.6 + veins * 21;
      albedo[p + 2] = 27 + broad * 14 - russet * 12 + detail * 0.2 + veins * 8;
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
  function map(data: Uint8Array | Uint8ClampedArray) {
    const result = new DataTexture(new Uint8Array(data.buffer), size, size, RGBAFormat);
    result.generateMipmaps = true;
    result.minFilter = LinearMipmapLinearFilter;
    result.anisotropy = 4;
    result.needsUpdate = true;
    return result;
  }
  const color = map(albedo);
  color.colorSpace = SRGBColorSpace;
  return { color, normal: map(normals), surface: map(surface) };
}

export function createGeometry(tier: DetailTier = 'high') {
  const strips = tier === 'high' ? 10 : tier === 'medium' ? 6 : 4;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  // Shared UVs and central fold; reduce longitudinal strips with distance.
  for (let row = 0; row <= strips; row++) {
    const t = 0.105 + row / strips * 0.895;
    const width = halfWidth(t) * 1.035 + 0.002;
    for (let column = -1; column <= 1; column++) {
      const x = column * width;
      const z = 0.13 * Math.sin(t * Math.PI) - Math.abs(x) * 0.32
        + x * (t - 0.3) * 0.5 + x * x * 0.8;
      positions.push(x * 3.15, (t - 0.5) * 3.15, z * 3.15);
      uvs.push(x + 0.5, t);
    }
  }
  for (let row = 0; row < strips; row++) {
    for (let col = 0; col < 2; col++) {
      const i = row * 3 + col;
      indices.push(i, i + 1, i + 3, i + 1, i + 4, i + 3);
    }
  }
  const base = positions.length / 3;
  for (const t of [0, 0.06, 0.125]) {
    for (const x of [-0.009, 0.009]) {
      positions.push(x * 3.15, (t - 0.5) * 3.15, 0.13 * Math.sin(t * Math.PI) * 3.15);
      uvs.push(x + 0.5, t);
    }
  }
  for (let row = 0; row < 2; row++) {
    const i = base + row * 2;
    indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createLeaf(sunDirection: Vector3, sunColor: Color) {
  const maps = createTextures();
  const material = new MeshStandardNodeMaterial({
    map: maps.color, normalMap: maps.normal, normalScale: new Vector2(0.65, 0.65),
    roughnessMap: maps.surface, roughness: 0.85, metalness: 0,
    side: DoubleSide, alphaTest: 0.5, alphaToCoverage: true,
  });
  const transmission = uniform(1.15);
  const sunStrength = uniform(3.2);
  const direction = uniform(sunDirection);
  const color = uniform(sunColor);
  const thickness = texture(maps.surface).r;
  // normalWorld is face-oriented, so either side transmits when facing away from the sun.
  const back = dot(normalWorld.negate(), direction).max(0);
  const view = cameraPosition.sub(positionWorld).normalize();
  const forwardScatter = pow(dot(view.negate(), direction).max(0), 5).mul(0.65).add(0.35);
  const thin = thickness.oneMinus().pow(1.7);
  const transmissionNode = texture(maps.color).rgb.mul(uniform(material.color))
    .mul(mix(color, uniform(new Color('#ffb83d')), 0.35))
    .mul(back.pow(0.8)).mul(thin).mul(transmission).mul(sunStrength).mul(forwardScatter);
  material.emissiveNode = transmissionNode;
  // Tiers share the atlas. Distant tiers skip normal-map sampling; the
  // background also skips the packed surface map and forward-scatter lobe.
  const tiers: DetailTier[] = ['high', 'medium', 'low'];
  const palettes = Object.fromEntries(tiers.map(tier => [tier,
    ['#fff3bb', '#ffffff', '#efb57f', '#d57d62', '#a7b777'].map(hex => {
      const tint = new Color(hex);
      const variant = material.clone();
      variant.color.copy(tint);
      if (tier !== 'high') variant.normalMap = null;
      if (tier === 'low') {
        variant.roughnessMap = null;
        variant.emissiveNode = texture(maps.color).rgb.mul(uniform(material.color)).mul(uniform(tint))
          .mul(mix(color, uniform(new Color('#ffb83d')), 0.35)).mul(back)
          .mul(0.3).mul(transmission).mul(sunStrength);
      } else {
        variant.emissiveNode = transmissionNode.mul(uniform(tint));
      }
      return { material: variant, tint };
    }),
  ])) as Record<DetailTier, { material: MeshStandardNodeMaterial; tint: Color }[]>;
  const geometries = { high: createGeometry('high'), medium: createGeometry('medium'), low: createGeometry('low') };
  const palette = palettes.high;
  const mesh = new Mesh(geometries.high, material);
  mesh.rotation.set(-0.18, -0.28, -0.38);
  return {
    mesh, material, palette, palettes, geometries, transmission, sunStrength,
    dispose() {
      Object.values(geometries).forEach(geometry => geometry.dispose());
      material.dispose();
      Object.values(palettes).flat().forEach((variant) => variant.material.dispose());
      Object.values(maps).forEach((map) => map.dispose());
    },
  };
}
