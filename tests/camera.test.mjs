import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three/webgpu';
import { sourceModule } from '../scripts/modules.mjs';
const { createCameraController } = await sourceModule('scene/CameraController');
const { selectLeafForm } = await sourceModule('leaf');

function make(aspect = 16 / 9) {
  const camera = new PerspectiveCamera(40, aspect, 0.1, 200);
  const controller = createCameraController(camera);
  controller.resize();
  return { camera, controller };
}
test('camera parallax remains bounded, cadence-independent, and freezes while paused', () => {
  const a = make(), b = make();
  for (let i = 0; i < 3600; i++) a.controller.update(1 / 60, true, false);
  for (let i = 0; i < 7200; i++) b.controller.update(1 / 120, true, false);
  assert.ok(a.camera.position.distanceTo(b.camera.position) < 1e-10);
  const paused = a.camera.position.clone();
  a.controller.update(1, false, false);
  assert.deepEqual(a.camera.position, paused);
  for (let i = 0; i < 18000; i++) {
    a.controller.update(0.05, true, false);
    assert.ok(Math.abs(a.camera.position.x) <= 0.10 && Math.abs(a.camera.position.y) <= 0.09);
    assert.equal(a.camera.position.z, 16);
    assert.deepEqual(a.camera.rotation.toArray(), [0, 0, 0, 'XYZ']);
  }
});
test('reduced motion fixes the camera and reset/resizing restore the composed base', () => {
  const { camera, controller } = make(9 / 16);
  controller.update(0.05, true, false);
  controller.update(0.05, true, true);
  assert.deepEqual(camera.position.toArray(), [0, 0, 16 * 0.65 / (9 / 16)]);
  controller.reset();
  controller.update(NaN, true, false);
  assert.equal(camera.position.x, 0);
  camera.aspect = 16 / 9;
  controller.resize();
  assert.deepEqual(camera.position.toArray(), [0, 0, 16]);
});
test('shape/color permutations keep all forms in every population and replay by seed', () => {
  const pairs = new Set();
  for (let population = 0; population < 3; population++) {
    const forms = Array.from({ length: 5 }, (_, palette) => selectLeafForm(palette, population, 2409));
    assert.equal(new Set(forms).size, 5);
    forms.forEach((form, palette) => pairs.add(`${form}/${palette}`));
    assert.deepEqual(forms, Array.from({ length: 5 }, (_, palette) => selectLeafForm(palette, population, 2409)));
  }
  assert.ok(pairs.size > 5);
});
