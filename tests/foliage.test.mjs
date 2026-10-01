import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Color, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { transformWithOxc } from 'vite';

const modules = new Map();
async function compile(path) {
  if (modules.has(path)) return modules.get(path);
  let source = await readFile(new URL(`../src/${path}.ts`, import.meta.url), 'utf8');
  source = source.replaceAll("'three/webgpu'", JSON.stringify(import.meta.resolve('three/webgpu')))
    .replaceAll("'three/tsl'", JSON.stringify(import.meta.resolve('three/tsl')));
  // Runtime dependencies of LeafSystem; the simulation modules use only type imports.
  if (path === 'leaf') source = source.replaceAll("'./foliage/ProceduralSurfaces'", JSON.stringify(await compile('foliage/ProceduralSurfaces')));
  if (path === 'LeafSystem') {
    source = source.replaceAll("'./leaf'", JSON.stringify(await compile('leaf')));
    for (const name of ['MotionSimulation', 'DepthComposition', 'GpuMotion']) {
      source = source.replaceAll(`'./simulation/${name}'`, JSON.stringify(await compile(`simulation/${name}`)));
    }
  }
  const { code } = await transformWithOxc(source, `${path}.ts`);
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  modules.set(path, url);
  return url;
}
const { createLeaf, createGeometry, leafForms } = await import(await compile('leaf'));
const { createLeafSystem } = await import(await compile('LeafSystem'));
const { motionDefaults } = await import(await compile('simulation/MotionSimulation'));

test('geometry LOD reduces triangles while retaining valid UVs and finite curved geometry', () => {
  const counts = [];
  for (const tier of ['high', 'medium', 'low']) {
    const geometry = createGeometry(tier);
    counts.push(geometry.index.count / 3);
    assert.ok(geometry.attributes.position.array.every(Number.isFinite));
    assert.ok(geometry.attributes.normal.array.every(Number.isFinite));
    assert.ok(geometry.attributes.uv.array.every(value => value >= 0 && value <= 1));
    assert.ok(geometry.index.array.every(index => index < geometry.attributes.position.count));
    geometry.dispose();
  }
  assert.deepEqual(counts, [44, 28, 20]);
});

test('real CPU foliage batches preserve seeded transforms, count controls, and resize state', () => {
  const leaf = createLeaf(new Vector3(0, 0.2, -1).normalize(), new Color('#fff0d0'));
  const surfaces = leaf.palettes.high.map(p => p.material.map);
  assert.equal(new Set(surfaces).size, 5);
  const sample = surface => Array.from(surface.image.data).filter((_, i) => i % 4096 < 3);
  assert.equal(new Set(surfaces.map(s => JSON.stringify(sample(s)))).size, 5);
  leaf.palettes.high.forEach((p, i) => {
    assert.equal(p.material.map, leaf.palettes.medium[i].material.map);
    assert.equal(p.material.map, leaf.palettes.low[i].material.map);
  });
  const config = { ...motionDefaults, leafCount: 100 };
  const system = createLeafSystem(leaf, config, {}, false);
  const camera = new PerspectiveCamera(40, 16 / 9, 0.1, 200);
  camera.position.z = 16;
  system.setCameraBounds(camera);
  system.reset();
  const snapshot = () => system.meshes.map(mesh => Array.from(mesh.instanceMatrix.array));
  const seeded = snapshot();
  const shapeSnapshot = () => system.meshes.map(mesh => Array.from(mesh.geometry.attributes.position.array));
  const seededShapes = shapeSnapshot();
  assert.equal(system.meshes.length, 15);
  assert.deepEqual(system.getPopulationCounts().map(p => p.count), [10, 40, 50]);
  for (let frame = 0; frame < 60; frame++) system.update(1 / 60, false);
  assert.notDeepEqual(snapshot(), seeded);
  system.reset();
  assert.deepEqual(snapshot(), seeded);
  assert.deepEqual(shapeSnapshot(), seededShapes);
  const beforeResize = snapshot();
  camera.aspect = 9 / 16;
  camera.position.z = 16 * 0.65 / camera.aspect;
  system.setCameraBounds(camera);
  assert.deepEqual(snapshot(), beforeResize);
  // Phase 7 presets change visible prefixes without resetting seeded shapes or motion.
  const beforeQuality = snapshot(), beforeQualityShapes = shapeSnapshot();
  for (const [count, populations] of [[70, [7, 28, 35]], [40, [4, 16, 20]], [100, [10, 40, 50]]]) {
    config.leafCount = count;
    system.configure();
    assert.deepEqual(system.getPopulationCounts().map(p => p.count), populations);
    assert.deepEqual(snapshot(), beforeQuality);
    assert.deepEqual(shapeSnapshot(), beforeQualityShapes);
  }
  config.leafCount = 20;
  system.configure();
  assert.equal(system.getPopulationCounts().reduce((sum, p) => sum + p.count, 0), 20);
  assert.ok(system.getPopulationCounts().every(p => p.count > 0));
  system.controls[1].activeCount = 0;
  system.controls[0].visible = false;
  system.configure();
  assert.deepEqual(system.getPopulationCounts().slice(0, 2).map(p => p.count), [0, 0]);
  config.running = false;
  system.configure();
  const paused = snapshot();
  system.update(1, false);
  assert.deepEqual(snapshot(), paused);
  assert.ok(leaf.palettes.high.every(p => p.material.normalMap));
  assert.ok(leaf.palettes.medium.every(p => !p.material.normalMap && p.material.roughnessMap));
  assert.ok(leaf.palettes.low.every(p => !p.material.normalMap && !p.material.roughnessMap));
  config.seed = 42;
  system.reset();
  assert.notDeepEqual(shapeSnapshot(), seededShapes);
  const textures = new Set(Object.values(leaf.palettes).flat().flatMap(p => [p.material.map, p.material.normalMap, p.material.roughnessMap]).filter(Boolean));
  const owned = [...textures, ...system.meshes.map(m => m.geometry), ...Object.values(leaf.geometryVariants).flat(), ...Object.values(leaf.palettes).flat().map(p => p.material)];
  let disposed = 0;
  owned.forEach(resource => resource.addEventListener('dispose', () => disposed++));
  system.dispose();
  leaf.dispose();
  assert.equal(disposed, owned.length);
});


test('leaf forms have distinct bending, silhouettes and normals at every LOD', () => {
  for (const tier of ['high', 'medium', 'low']) {
    const shapes = leafForms.map((_, i) => createGeometry(tier, i, 2409));
    assert.equal(new Set(shapes.map(g => JSON.stringify(Array.from(g.attributes.position.array)))).size, 5);
    for (let i = 0; i < shapes.length; i++) {
      const g = shapes[i], repeat = createGeometry(tier, i, 2409), other = createGeometry(tier, i, 42);
      assert.deepEqual(g.attributes.position.array, repeat.attributes.position.array);
      assert.notDeepEqual(g.attributes.position.array, other.attributes.position.array);
      assert.notDeepEqual(g.attributes.normal.array, other.attributes.normal.array);
      assert.ok(g.attributes.position.array.every(Number.isFinite));
      for (let j = 0; j < g.attributes.normal.count; j++) {
        const n = new Vector3().fromBufferAttribute(g.attributes.normal, j);
        assert.ok(Math.abs(n.length() - 1) < 1e-5);
      }
      // Cutout and vein coordinates remain shared even as the blade warps.
      assert.deepEqual(g.attributes.uv.array, shapes[0].attributes.uv.array);
      repeat.dispose(); other.dispose();
    }
    shapes.forEach(g => g.dispose());
  }
});


test('all seeded forms stay shallow and do not fold back along the blade', () => {
  for (const tier of ['high', 'medium', 'low']) {
    for (let form = 0; form < leafForms.length; form++) {
      for (const seed of [0, 1, 42, 2409, 65535, 4294967295]) {
        const geometry = createGeometry(tier, form, seed);
        geometry.computeBoundingBox();
        const size = geometry.boundingBox.getSize(new Vector3());
        // Include the largest existing per-instance depth scale (1.5x).
        assert.ok(size.z * 1.5 < size.y * 0.18, `${tier}/${form}/${seed}: excessive bending ${size.z} / ${size.y}`);
        const positions = geometry.attributes.position;
        const bladeRows = (positions.count - 6) / 3;
        for (let row = 1; row < bladeRows; row++) {
          assert.ok(positions.getY(row * 3 + 1) > positions.getY((row - 1) * 3 + 1));
        }
        geometry.dispose();
      }
    }
  }
});
