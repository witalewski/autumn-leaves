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
  if (path === 'LeafSystem') {
    for (const name of ['MotionSimulation', 'DepthComposition', 'GpuMotion']) {
      source = source.replaceAll(`'./simulation/${name}'`, JSON.stringify(await compile(`simulation/${name}`)));
    }
  }
  const { code } = await transformWithOxc(source, `${path}.ts`);
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  modules.set(path, url);
  return url;
}
const { createLeaf, createGeometry } = await import(await compile('leaf'));
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
  const config = { ...motionDefaults, leafCount: 100 };
  const system = createLeafSystem(leaf, config, {}, false);
  const camera = new PerspectiveCamera(40, 16 / 9, 0.1, 200);
  camera.position.z = 16;
  system.setCameraBounds(camera);
  system.reset();
  const snapshot = () => system.meshes.map(mesh => Array.from(mesh.instanceMatrix.array));
  const seeded = snapshot();
  assert.equal(system.meshes.length, 15);
  assert.deepEqual(system.getPopulationCounts().map(p => p.count), [5, 35, 60]);
  for (let frame = 0; frame < 60; frame++) system.update(1 / 60, false);
  assert.notDeepEqual(snapshot(), seeded);
  system.reset();
  assert.deepEqual(snapshot(), seeded);
  const beforeResize = snapshot();
  camera.aspect = 9 / 16;
  camera.position.z = 16 * 0.65 / camera.aspect;
  system.setCameraBounds(camera);
  assert.deepEqual(snapshot(), beforeResize);
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
  const owned = [...system.meshes.map(m => m.geometry), ...Object.values(leaf.geometries), ...Object.values(leaf.palettes).flat().map(p => p.material)];
  let disposed = 0;
  owned.forEach(resource => resource.addEventListener('dispose', () => disposed++));
  system.dispose();
  leaf.dispose();
  assert.equal(disposed, owned.length);
});
