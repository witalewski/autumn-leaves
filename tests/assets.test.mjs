import assert from 'node:assert/strict';
import test from 'node:test';
import { Color, Vector3 } from 'three/webgpu';
import { sourceModule, sourceModuleURL } from '../scripts/modules.mjs';
import { readFile } from 'node:fs/promises';
import { transformWithOxc } from 'vite';
const { createSurfaceData } = await sourceModule('foliage/ProceduralSurfaces');
const { createLeaf, createTexturesFromData } = await sourceModule('leaf');

test('small procedural surfaces retain five distinct pigments, alpha, normals and packed data', () => {
  const surfaces = Array.from({ length: 5 }, (_, index) => createSurfaceData(index));
  for (const surface of surfaces) {
    assert.equal(surface.size, 256);
    for (const data of [surface.color, surface.normal, surface.surface]) assert.equal(data.byteLength, 256 * 256 * 4);
    assert.ok(surface.color.some((value, index) => index % 4 === 3 && value === 0));
    assert.ok(surface.color.some((value, index) => index % 4 === 3 && value === 255));
    assert.ok(surface.normal.every((value, index) => index % 4 !== 2 || value >= 128));
  }
  assert.equal(new Set(surfaces.map(surface => Buffer.from(surface.color).toString('base64'))).size, 5);
  assert.deepEqual(createSurfaceData(2), surfaces[2]);
});

test('worker-generated buffers are shared across material tiers and consume 5 MiB with mips', () => {
  const surfaces = Array.from({ length: 5 }, (_, index) => createTexturesFromData(createSurfaceData(index)));
  const leaf = createLeaf(new Vector3(0, 0.2, -1), new Color('#fff0d0'), surfaces);
  assert.equal(leaf.textureBytes, 5242860);
  let disposed = 0;
  surfaces.forEach(surface => Object.values(surface).forEach(texture => texture.addEventListener('dispose', () => disposed++)));
  for (const tier of ['high', 'medium', 'low']) leaf.palettes[tier].forEach((variant, index) => assert.equal(variant.material.map, surfaces[index].color));
  assert.equal(surfaces[0].color.colorSpace, 'srgb');
  assert.equal(surfaces[0].normal.colorSpace, '');
  leaf.dispose();
  assert.equal(disposed, 15);
});

let source = await readFile(new URL('../src/foliage/SurfaceAssets.ts', import.meta.url), 'utf8');
source = source.replaceAll("'../leaf'", JSON.stringify(await sourceModuleURL('leaf')))
  .replace("new URL('./SurfaceWorker.ts', import.meta.url)", "'worker-url'");
const { code } = await transformWithOxc(source, 'SurfaceAssets.ts');
const { loadLeafSurfaces } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('surface worker failures terminate the worker and successful buffers remain owned by caller', async () => {
  let terminated = 0, fail = false;
  globalThis.Worker = class {
    constructor() { queueMicrotask(() => fail ? this.onerror({ message: 'Worker blocked' }) : this.onmessage({ data: Array.from({ length: 5 }, (_, i) => createSurfaceData(i)) })); }
    terminate() { terminated++; }
  };
  try {
    const surfaces = await loadLeafSurfaces();
    assert.equal(terminated, 1);
    surfaces.forEach(surface => Object.values(surface).forEach(texture => texture.dispose()));
    fail = true;
    await assert.rejects(loadLeafSurfaces, /Worker blocked/);
    assert.equal(terminated, 2);
  } finally { delete globalThis.Worker; }
});
