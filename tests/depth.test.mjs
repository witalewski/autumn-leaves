import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { transformWithOxc } from 'vite';

const source = await readFile(new URL('../src/simulation/DepthComposition.ts', import.meta.url), 'utf8');
const { code } = await transformWithOxc(source, 'DepthComposition.ts');
const { createPopulationConfigs, createPopulationBounds, halfWidthAtDepth, halfHeightAtDepth } =
  await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('population defaults fit backend pools and do not share mutable settings', () => {
  for (const gpu of [true, false]) {
    const populations = createPopulationConfigs(gpu);
    assert.deepEqual(populations.map(p => p.count), gpu ? [50, 200, 250] : [10, 40, 50]);
    assert.equal(populations.reduce((sum, p) => sum + p.count, 0), gpu ? 500 : 100);
  }
  const a = createPopulationConfigs(true), b = createPopulationConfigs(true);
  a[0].depth.min = 8;
  a[1].scale.max = 1;
  assert.equal(b[0].depth.min, 4);
  assert.equal(b[1].scale.max, 0.39);
});

test('depth extents track actual camera projection through resize and zoom', () => {
  const camera = new PerspectiveCamera(40, 1, 0.1, 200);
  for (const aspect of [16 / 9, 9 / 16, 0.4]) {
    for (const zoom of [1, 1.5]) {
      camera.aspect = aspect;
      camera.zoom = zoom;
      camera.position.set(2, -3, 16 * Math.max(1, 0.65 / aspect));
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      for (const population of createPopulationConfigs(true)) {
        const bounds = createPopulationBounds(camera, population.depth, 1);
        for (const z of [bounds.minZ, (bounds.minZ + bounds.maxZ) / 2, bounds.maxZ]) {
          const x = halfWidthAtDepth(bounds, z) - bounds.margin;
          const y = halfHeightAtDepth(bounds, z) - bounds.margin;
          const projected = new Vector3(bounds.centerX + x, bounds.centerY + y, z).project(camera);
          assert.ok(Math.abs(projected.x - 1) < 1e-12);
          assert.ok(Math.abs(projected.y - 1) < 1e-12);
          assert.ok(projected.z >= -1 && projected.z <= 1);
          assert.ok(bounds.halfWidth >= x + bounds.margin - 1e-12);
          assert.ok(bounds.halfHeight >= y + bounds.margin - 1e-12);
        }
      }
    }
  }
});

test('volumes respect clipping planes and reject unusable projection inputs', () => {
  const camera = new PerspectiveCamera(40, 1, 1, 20);
  camera.position.z = 16;
  const bounds = createPopulationBounds(camera, { min: -35, max: 20 });
  assert.equal(bounds.minZ, -4);
  assert.equal(bounds.maxZ, 15);
  assert.throws(() => createPopulationBounds(camera, { min: 17, max: 20 }), RangeError);
  camera.aspect = 0;
  assert.throws(() => createPopulationBounds(camera, { min: -2, max: 0 }), RangeError);
});

test('transitional shallow bounds preserve phase 4 framing', () => {
  const camera = new PerspectiveCamera(40, 16 / 9, 0.1, 200);
  camera.position.z = 16;
  const bounds = createPopulationBounds(camera, { min: -5, max: 0 });
  const previousHalfHeight = Math.tan(camera.fov * Math.PI / 360) * (camera.position.z + 5);
  assert.equal(bounds.halfHeight, previousHalfHeight + 1);
  assert.ok(Math.abs(bounds.halfWidth - (previousHalfHeight * camera.aspect + 1)) < 1e-12);
});
