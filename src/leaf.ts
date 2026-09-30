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

function createTextures(pattern: number) {
  // Five reusable 512px surfaces, shared across depth tiers; generated once.
  const size = 512;
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
      const patch = noise(x * 6 + pattern * 19, t * 5 + pattern * 7);
      const stain = Math.max(0, Math.min(1, (patch - 0.36) * 3.5));
      const edgeBurn = Math.min(1, rim * (0.3 + medium * 0.7));
      // Broad pigment transitions, asymmetric green remnants, red tips, and
      // small freckles. These alter albedo, not just the overall material tint.
      const pigment = pattern === 0 ? stain * 0.5
        : pattern === 1 ? Math.min(1, stain * 0.8 + Math.max(0, t - 0.55) * 1.3)
        : pattern === 2 ? Math.min(1, stain * 0.55 + edgeBurn * 0.6)
        : pattern === 3 ? Math.min(1, stain * 0.7 + (x > 0 ? 0.22 : 0))
        : Math.max(0, Math.min(1, (patch - 0.42) * 5 + t * 0.5));
      const freckles = Math.max(0, noise(x * 72 + pattern * 13, t * 90) - 0.67) * 2.2;
      const russet = Math.min(1, pigment * 0.6 + edgeBurn * 0.4);
      const detail = (broad - 0.5) * 10 + (medium - 0.5) * 22 + (fine - 0.5) * 12 - spot * 80 - freckles * 60;
      for (let channel = 0; channel < 3; channel++) {
        albedo[p + channel] = baseColor[channel] + (stainColor[channel] - baseColor[channel]) * pigment
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

export const leafForms = [
  { name: 'open oval', width: 1.12, bend: 0.06, cup: 0.08, twist: 0.12, hook: 0.02, lobes: 0 },
  { name: 'cupped beech', width: 1, bend: 0.19, cup: 0.65, twist: -0.3, hook: 0.08, lobes: 0 },
  { name: 'curled lance', width: 0.72, bend: 0.38, cup: -0.2, twist: 0.6, hook: 0.32, lobes: 0 },
  { name: 'twisted blade', width: 0.9, bend: -0.16, cup: 0.3, twist: -1.35, hook: 0.12, lobes: 0 },
  { name: 'wavy broadleaf', width: 1.22, bend: 0.15, cup: -0.4, twist: 0.7, hook: 0.05, lobes: 0.18 },
] as const;

export function createGeometry(tier: DetailTier = 'high', formIndex = 0, seed = 2409) {
  const form = leafForms[formIndex];
  const variation = hash(seed, formIndex) * 2 - 1;
  const bend = form.bend + variation * 0.06;
  const twist = form.twist + variation * 0.25;
  function surfacePoint(x: number, t: number) {
    const blade = Math.max(0, (t - 0.105) / 0.895);
    const width = form.width * (1 + form.lobes * Math.sin(blade * Math.PI * 5));
    const across = x * width;
    const cup = form.cup * across * across / 0.34;
    const angle = twist * blade;
    const centerZ = bend * Math.sin(t * Math.PI) + form.hook * blade ** 4;
    // Twist around the curved midrib. UVs remain on the original flat blade,
    // so the cutout, normal map, veins, and pigment warp with the geometry.
    return [
      (across * Math.cos(angle) - cup * Math.sin(angle)) * 3.15,
      (t - 0.5 - form.hook * 0.45 * blade ** 4) * 3.15,
      (centerZ + across * Math.sin(angle) + cup * Math.cos(angle)) * 3.15,
    ];
  }
  const strips = tier === 'high' ? 10 : tier === 'medium' ? 6 : 4;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  // Shared UVs and central fold; reduce longitudinal strips with distance.
  for (let row = 0; row <= strips; row++) {
    const t = 0.105 + row / strips * 0.895;
    const width = halfWidth(t) * 1.035 + 0.002;
    for (let column = -1; column <= 1; column++) {
      const x = column * width;
      positions.push(...surfacePoint(x, t));
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
      positions.push(...surfacePoint(x, t));
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
  const surfaces = leafForms.map((_, index) => createTextures(index));
  const maps = surfaces[0];
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
    ['#fff3cf', '#fff0dd', '#efcfaf', '#edbdab', '#e0e7bb'].map((hex, index) => {
      const tint = new Color(hex);
      const variant = material.clone();
      variant.color.copy(tint);
      const surface = surfaces[index];
      variant.map = surface.color;
      variant.normalMap = surface.normal;
      variant.roughnessMap = surface.surface;
      const pigment = texture(surface.color).rgb.mul(uniform(material.color)).mul(uniform(tint));
      const warm = mix(color, uniform(new Color('#ffb83d')), 0.35);
      if (tier !== 'high') variant.normalMap = null;
      if (tier === 'low') {
        variant.roughnessMap = null;
        variant.emissiveNode = pigment.mul(warm).mul(back)
          .mul(0.3).mul(transmission).mul(sunStrength);
      } else {
        variant.emissiveNode = pigment.mul(warm).mul(back.pow(0.8))
          .mul(texture(surface.surface).r.oneMinus().pow(1.7)).mul(transmission).mul(sunStrength).mul(forwardScatter);
      }
      return { material: variant, tint };
    }),
  ])) as Record<DetailTier, { material: MeshStandardNodeMaterial; tint: Color }[]>;
  const geometryVariants = Object.fromEntries(tiers.map(tier => [tier, leafForms.map((_, index) => createGeometry(tier, index))])) as Record<DetailTier, BufferGeometry[]>;
  const geometries = { high: geometryVariants.high[0], medium: geometryVariants.medium[0], low: geometryVariants.low[0] };
  const palette = palettes.high;
  const mesh = new Mesh(geometries.high, material);
  mesh.rotation.set(-0.18, -0.28, -0.38);
  return {
    mesh, material, palette, palettes, geometries, geometryVariants, transmission, sunStrength,
    dispose() {
      Object.values(geometryVariants).flat().forEach(geometry => geometry.dispose());
      material.dispose();
      Object.values(palettes).flat().forEach((variant) => variant.material.dispose());
      surfaces.forEach(surface => Object.values(surface).forEach(map => map.dispose()));
    },
  };
}
