import {
  BufferGeometry, Color, DataTexture, DoubleSide, Float32BufferAttribute,
  LinearMipmapLinearFilter, Mesh, MeshStandardNodeMaterial, RGBAFormat,
  SRGBColorSpace, Vector2, Vector3,
} from 'three/webgpu';
import { createSurfaceData } from './foliage/ProceduralSurfaces';
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

export function createTextures(pattern: number, size = 256) {
  return createTexturesFromData(createSurfaceData(pattern, size));
}

export function createTexturesFromData(data: ReturnType<typeof createSurfaceData>) {
  function map(bytes: Uint8Array) {
    const result = new DataTexture(bytes, data.size, data.size, RGBAFormat);
    result.generateMipmaps = true;
    result.minFilter = LinearMipmapLinearFilter;
    result.anisotropy = 4;
    result.needsUpdate = true;
    return result;
  }
  const color = map(data.color);
  color.colorSpace = SRGBColorSpace;
  return { color, normal: map(data.normal), surface: map(data.surface) };
}

export const leafForms = [
  { name: 'open oval', width: 1.12, bend: 0.04, cup: 0.05, twist: 0.08, hook: 0.02, lobes: 0 },
  { name: 'gently cupped beech', width: 1, bend: 0.055, cup: 0.12, twist: -0.08, hook: 0.015, lobes: 0 },
  { name: 'arched lance', width: 0.78, bend: 0.08, cup: -0.06, twist: 0.12, hook: 0.025, lobes: 0 },
  { name: 'flat blade', width: 1.02, bend: 0.015, cup: 0.02, twist: 0.015, hook: 0.008, lobes: 0 },
  { name: 'wavy broadleaf', width: 1.18, bend: 0.045, cup: -0.08, twist: -0.1, hook: 0.015, lobes: 0.06 },
] as const;

/** Each depth population uses all forms, paired independently with its colors. */
export function selectLeafForm(paletteIndex: number, populationIndex: number, seed: number) {
  const offset = (Math.floor(hash(seed, populationIndex) * leafForms.length) + populationIndex) % leafForms.length;
  return (paletteIndex + offset) % leafForms.length;
}

export function createGeometry(tier: DetailTier = 'high', formIndex = 0, seed = 2409) {
  const form = leafForms[formIndex];
  // Keep the flat form nearly planar even at the extremes of seeded variation.
  const variation = (hash(seed, formIndex) * 2 - 1) * (form.name === 'flat blade' ? 0.12 : 1);
  const bend = form.bend + variation * 0.015;
  const twist = form.twist + variation * 0.05;
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

export interface LeafSurface { color: DataTexture; normal: DataTexture; surface: DataTexture }

export function createLeaf(sunDirection: Vector3, sunColor: Color, surfaces: LeafSurface[] = leafForms.map((_, index) => createTextures(index))) {
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
  // Tiers share the surfaces. Distant tiers skip normal-map sampling; the
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
    textureBytes: [...new Set(surfaces.flatMap(surface => Object.values(surface)))].reduce((sum, map) => {
      let width = map.image.width, height = map.image.height, bytes = 0;
      do { bytes += width * height * 4; if (width === 1 && height === 1) break;
        width = Math.max(1, width >> 1); height = Math.max(1, height >> 1);
      } while (map.generateMipmaps);
      return sum + bytes;
    }, 0),
    dispose() {
      Object.values(geometryVariants).flat().forEach(geometry => geometry.dispose());
      material.dispose();
      Object.values(palettes).flat().forEach((variant) => variant.material.dispose());
      new Set(surfaces.flatMap(surface => Object.values(surface))).forEach(map => map.dispose());
    },
  };
}
