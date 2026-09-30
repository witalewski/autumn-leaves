import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { read, KHR_DF_TRANSFER_SRGB, KHR_DF_TRANSFER_LINEAR, KHR_SUPERCOMPRESSION_ZSTD } from 'ktx-parse';
import { sourceModule } from '../scripts/modules.mjs';
import { Color, DataTexture, Vector3 } from 'three/webgpu';
const { atlasLayout, atlasUV } = await sourceModule('foliage/AtlasLayout');
const { createLeaf, createGeometry } = await sourceModule('leaf');

test('baked KTX2 assets have verified payloads, full mip chains, and correct transfer functions', async () => {
  const manifest = JSON.parse(await readFile(new URL('../src/assets/manifest.json', import.meta.url)));
  assert.deepEqual(manifest.layout, atlasLayout);
  for (const file of manifest.files) {
    const bytes = await readFile(new URL(`../src/assets/${file.name}`, import.meta.url));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    const container = read(bytes);
    assert.equal(container.pixelWidth, atlasLayout.width);
    assert.equal(container.pixelHeight, atlasLayout.height);
    assert.equal(container.supercompressionScheme, KHR_SUPERCOMPRESSION_ZSTD);
    assert.equal(container.levels.length, 11);
    assert.equal(container.dataFormatDescriptor[0].transferFunction,
      file.name.includes('color') ? KHR_DF_TRANSFER_SRGB : KHR_DF_TRANSFER_LINEAR);
    assert.ok(container.levels.every(level => level.levelData.length > 0));
  }
  assert.ok(manifest.files.reduce((sum, file) => sum + file.bytes, 0) < 5 * 1024 ** 2);
});

test('atlas geometry addresses the correct padded tile and shares only three texture allocations', () => {
  const atlas = Object.fromEntries(['color', 'normal', 'surface'].map(key => [key, new DataTexture(new Uint8Array(4), 1, 1)]));
  const leaf = createLeaf(new Vector3(0, 0.2, -1), new Color('#fff0d0'), atlas);
  let disposed = 0;
  Object.values(atlas).forEach(map => map.addEventListener('dispose', () => disposed++));
  for (const tier of ['high', 'medium', 'low']) {
    leaf.palettes[tier].forEach(material => assert.equal(material.material.map, atlas.color));
    leaf.geometryVariants[tier].forEach((geometry, index) => {
      const original = createGeometry(tier, index);
      const originalUV = original.getAttribute('uv'), uv = geometry.getAttribute('uv');
      for (let vertex = 0; vertex < uv.count; vertex++) {
        const [u, v] = atlasUV(index, originalUV.getX(vertex), originalUV.getY(vertex));
        assert.ok(Math.abs(uv.getX(vertex) - u) < 1e-7 && Math.abs(uv.getY(vertex) - v) < 1e-7);
        assert.ok(uv.getX(vertex) > index % 3 / 3 && uv.getX(vertex) < (index % 3 + 1) / 3);
        assert.ok(uv.getY(vertex) > Math.floor(index / 3) / 2 && uv.getY(vertex) < (Math.floor(index / 3) + 1) / 2);
      }
      assert.deepEqual(geometry.getAttribute('position').array, original.getAttribute('position').array);
      original.dispose();
    });
  }
  leaf.dispose();
  assert.equal(disposed, 3);
});

// Exercise loader ownership without requiring a GPU/worker in Node. Transcoding
// itself is verified in the real browser on WebGPU and WebGL2.
const mockURL = `data:text/javascript;base64,${Buffer.from(`
  export const fixture = { disposed: 0, load: undefined };
  export class KTX2Loader {
    setTranscoderPath() { return this; }
    setWorkerLimit() { return this; }
    detectSupport() { return this; }
    loadAsync(url) { return fixture.load(url); }
    dispose() { fixture.disposed++; }
  }
`).toString('base64')}`;
const { fixture } = await import(mockURL);
let loaderSource = await readFile(new URL('../src/foliage/LeafAssets.ts', import.meta.url), 'utf8');
loaderSource = loaderSource.replaceAll("'three/webgpu'", JSON.stringify(import.meta.resolve('three/webgpu')))
  .replaceAll("'three/addons/loaders/KTX2Loader.js'", JSON.stringify(mockURL))
  .replace(/import (\w+) from '[^']+\?url';/g, (_, name) => `const ${name} = '${name}';`);
const { transformWithOxc } = await import('vite');
const { code: loaderCode } = await transformWithOxc(loaderSource, 'LeafAssets.ts');
const { loadLeafAtlas } = await import(`data:text/javascript;base64,${Buffer.from(loaderCode).toString('base64')}`);

test('a partial atlas failure waits for remaining loads, disposes their textures, and closes the worker pool', async () => {
  const color = new DataTexture(), surface = new DataTexture();
  let texturesDisposed = 0, finishSurface;
  color.addEventListener('dispose', () => texturesDisposed++);
  surface.addEventListener('dispose', () => texturesDisposed++);
  const pending = new Promise(resolve => { finishSurface = resolve; });
  fixture.disposed = 0;
  fixture.load = url => url === 'colorURL' ? Promise.resolve(color)
    : url === 'normalURL' ? Promise.reject(new Error('Corrupt atlas')) : pending;
  const loading = loadLeafAtlas({});
  assert.equal(fixture.disposed, 0);
  finishSurface(surface);
  await assert.rejects(loading, /Corrupt atlas/);
  assert.equal(texturesDisposed, 2);
  assert.equal(fixture.disposed, 1);
});

test('successful atlas loading preserves caller texture ownership and closes decoder workers', async () => {
  const textures = [new DataTexture(), new DataTexture(), new DataTexture()];
  let disposed = 0;
  textures.forEach(texture => texture.addEventListener('dispose', () => disposed++));
  fixture.disposed = 0;
  fixture.load = url => Promise.resolve(textures[['colorURL', 'normalURL', 'surfaceURL'].indexOf(url)]);
  const atlas = await loadLeafAtlas({});
  assert.deepEqual(Object.values(atlas), textures);
  assert.equal(fixture.disposed, 1);
  assert.equal(disposed, 0);
  assert.equal(atlas.color.colorSpace, 'srgb');
  assert.equal(atlas.normal.colorSpace, '');
  assert.equal(atlas.surface.colorSpace, '');
  Object.values(atlas).forEach(texture => texture.dispose());
  assert.equal(disposed, 3);
});
