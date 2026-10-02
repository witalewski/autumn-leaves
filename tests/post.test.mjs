import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PerspectiveCamera, Vector2, Vector3 } from 'three/webgpu';
import { transformWithOxc } from 'vite';

let source = await readFile(new URL('../src/scene/CinematicPost.ts', import.meta.url), 'utf8');
for (const name of ['three/webgpu', 'three/tsl', 'three/addons/tsl/display/BloomNode.js']) {
  source = source.replaceAll(`'${name}'`, JSON.stringify(import.meta.resolve(name)));
}
const { code } = await transformWithOxc(source, 'CinematicPost.ts');
const { projectSun, createGrainTexture } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('sun flare projection follows the camera and top-down post UVs in landscape and portrait', () => {
  const uv = new Vector2();
  for (const aspect of [16 / 9, 9 / 16]) {
    const camera = new PerspectiveCamera(40, aspect, 0.1, 200);
    camera.position.z = 16;
    camera.updateMatrixWorld();
    assert.equal(projectSun(camera, new Vector3(0, 0, -1), uv), 1);
    assert.deepEqual(uv.toArray(), [0.5, 0.5]);
    assert.equal(projectSun(camera, new Vector3(0.05, 0.1, -1).normalize(), uv), 1);
    assert.ok(uv.x > 0.5 && uv.y < 0.5);
    camera.rotation.y = 0.4;
    camera.updateMatrixWorld();
    const direction = camera.getWorldDirection(new Vector3());
    assert.equal(projectSun(camera, direction, uv), 1);
    assert.ok(uv.distanceTo(new Vector2(0.5, 0.5)) < 1e-10);
  }
});

test('flare fades at viewport edge and vanishes offscreen or behind the camera', () => {
  const camera = new PerspectiveCamera(40, 1, 0.1, 200);
  camera.updateMatrixWorld();
  const uv = new Vector2();
  const edge = Math.tan(20 * Math.PI / 180);
  const visibility = x => projectSun(camera, new Vector3(x * edge, 0, -1).normalize(), uv);
  assert.equal(visibility(0.8), 1);
  assert.ok(visibility(0.95) > visibility(1.02));
  assert.equal(visibility(1.1), 0);
  assert.equal(projectSun(camera, new Vector3(0, 0, 1), uv), 0);
  assert.equal(projectSun(camera, new Vector3(1, 0, 0), uv), 0);
  assert.ok(uv.toArray().every(Number.isFinite));
});


test('grain texture has unbiased, locally clustered monochrome noise and filtered sampling', () => {
  const texture = createGrainTexture();
  const data = texture.image.data;
  let mean = 0, variance = 0, covariance = 0;
  const count = data.length;
  assert.equal(data.byteLength, 512 * 512);
  for (let i = 0; i < data.length; i++) {
    const v = data[i] / 255 - 0.5;
    mean += v; variance += v * v;
    if (i + 1 < data.length) covariance += v * (data[i + 1] / 255 - 0.5);
  }
  assert.ok(Math.abs(mean / count) < 0.005);
  assert.ok(variance / count > 0.035);
  assert.ok(covariance / variance > 0.2 && covariance / variance < 0.8);
  assert.equal(texture.generateMipmaps, true);
  texture.dispose();
});
