export type PopulationId = 'foreground' | 'midground' | 'background';
export type DetailTier = 'high' | 'medium' | 'low';

export interface PopulationConfig {
  id: PopulationId;
  count: number;
  /** World-space Z range, ascending. The fixed camera looks along -Z. */
  depth: { min: number; max: number };
  /** Base world-space leaf scale, before seeded aspect/curvature variation. */
  scale: { min: number; max: number };
  geometryTier: DetailTier;
  materialTier: DetailTier;
}

/** Fresh settings per system; these counts describe capacity, not visible count. */
export function createPopulationConfigs(gpu: boolean): PopulationConfig[] {
  return [
    { id: 'foreground', count: gpu ? 50 : 10, depth: { min: 4, max: 10 }, scale: { min: 0.28, max: 0.42 }, geometryTier: 'high', materialTier: 'high' },
    { id: 'midground', count: gpu ? 200 : 40, depth: { min: -6, max: 4 }, scale: { min: 0.23, max: 0.39 }, geometryTier: 'medium', materialTier: 'medium' },
    { id: 'background', count: gpu ? 250 : 50, depth: { min: -35, max: -6 }, scale: { min: 0.20, max: 0.34 }, geometryTier: 'low', materialTier: 'low' },
  ];
}

/** Projection inputs for the application's unrotated, centered perspective camera. */
export interface DepthCamera {
  position: { x: number; y: number; z: number };
  fov: number;
  aspect: number;
  zoom: number;
  near: number;
  far: number;
}

export interface PopulationBounds {
  minZ: number;
  maxZ: number;
  centerX: number;
  centerY: number;
  cameraZ: number;
  halfWidthPerDistance: number;
  halfHeightPerDistance: number;
  margin: number;
  /** Conservative outer extents, measured at the far edge of the depth range. */
  halfWidth: number;
  halfHeight: number;
}

export function createPopulationBounds(camera: DepthCamera, depth: PopulationConfig['depth'], margin = 1): PopulationBounds {
  if (![camera.position.x, camera.position.y, camera.position.z, camera.fov, camera.aspect, camera.zoom,
    camera.near, camera.far, depth.min, depth.max, margin].every(Number.isFinite)
    || camera.fov <= 0 || camera.fov >= 180 || camera.aspect <= 0 || camera.zoom <= 0
    || camera.near <= 0 || camera.far <= camera.near || depth.min >= depth.max || margin < 0) {
    throw new RangeError('Invalid depth volume or perspective camera');
  }
  const minZ = Math.max(depth.min, camera.position.z - camera.far);
  const maxZ = Math.min(depth.max, camera.position.z - camera.near);
  if (minZ >= maxZ) throw new RangeError('Depth volume is outside the camera clipping range');
  const halfHeightPerDistance = Math.tan(camera.fov * Math.PI / 360) / camera.zoom;
  const halfWidthPerDistance = halfHeightPerDistance * camera.aspect;
  const farDistance = camera.position.z - minZ;
  return {
    minZ, maxZ, centerX: camera.position.x, centerY: camera.position.y, cameraZ: camera.position.z,
    halfWidthPerDistance, halfHeightPerDistance, margin,
    halfWidth: farDistance * halfWidthPerDistance + margin,
    halfHeight: farDistance * halfHeightPerDistance + margin,
  };
}

/** Evaluate at the leaf's Z so future recycling follows the frustum, not a box. */
export function halfWidthAtDepth(bounds: PopulationBounds, z: number) {
  return (bounds.cameraZ - z) * bounds.halfWidthPerDistance + bounds.margin;
}

export function halfHeightAtDepth(bounds: PopulationBounds, z: number) {
  return (bounds.cameraZ - z) * bounds.halfHeightPerDistance + bounds.margin;
}
