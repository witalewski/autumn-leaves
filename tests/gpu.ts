// Browser-only integration test: readback is confined to this test, never the app loop.
import { Matrix4, Vector3, WebGPURenderer } from 'three/webgpu';
import { createGpuMotion } from '../src/simulation/GpuMotion';
import { MotionSimulation, motionDefaults } from '../src/simulation/MotionSimulation';

const result = document.querySelector('#result')!;
const renderer = new WebGPURenderer();
const lines: string[] = [];
function assert(ok: boolean, message: string) {
  if (!ok) throw new Error(message);
  lines.push(`PASS ${message}`);
  result.textContent = lines.join('\n');
}
async function run() {
  await renderer.init();
  if (!('isWebGPUBackend' in renderer.backend)) throw new Error('This test requires WebGPU');
  const config = { ...motionDefaults, leafCount: 500 };
  const cpu = new MotionSimulation(config, 500);
  cpu.setBounds(100, 100);
  cpu.reset();
  const gpu = createGpuMotion(500);
  gpu.configure(config, 100, 100);
  const scale = new Vector3(0.25, 0.3, 0.35);
  function upload() {
    cpu.leaves.forEach((leaf, i) => gpu.seed(i, leaf, scale.toArray()));
    gpu.upload();
  }
  upload();
  gpu.setTime(0, 0);
  renderer.compute(gpu.kernel);
  const initial = new Float32Array(await renderer.getArrayBufferAsync(gpu.matrices));
  const expected = new Matrix4();
  let maxInitialError = 0;
  cpu.leaves.forEach((leaf, i) => {
    expected.compose(leaf.position, leaf.rotation, scale);
    expected.elements.forEach((value, j) => { maxInitialError = Math.max(maxInitialError, Math.abs(value - initial[i * 16 + j])); });
  });
  assert(maxInitialError < 0.0001, '500 initialized GPU matrices match CPU TRS, including nonuniform scale');
  for (let step = 1; step <= 120; step++) {
    cpu.update(1 / 120);
    gpu.setTime(step / 120, 1 / 120);
    renderer.compute(gpu.kernel);
  }
  const evolved = new Float32Array(await renderer.getArrayBufferAsync(gpu.matrices));
  let maxError = 0, compared = 0;
  cpu.leaves.forEach((leaf, i) => {
    // Exclude leaves that crossed the large test boundary: respawn RNG deliberately differs.
    if (Math.abs(leaf.position.x) > 95 || Math.abs(leaf.position.y) > 95) return;
    expected.compose(leaf.position, leaf.rotation, scale);
    expected.elements.forEach((value, j) => { maxError = Math.max(maxError, Math.abs(value - evolved[i * 16 + j])); });
    compared++;
  });
  assert(compared > 400 && maxError < 0.005, `GPU aerodynamic integration agrees with CPU after 120 steps (${compared} leaves, max error ${maxError.toExponential(2)})`);
  assert(evolved.some((value, i) => Math.abs(value - initial[i]) > 0.1), 'GPU matrices change without CPU transform uploads');
  cpu.reset(); upload(); gpu.setTime(0, 0); renderer.compute(gpu.kernel);
  const replay = new Float32Array(await renderer.getArrayBufferAsync(gpu.matrices));
  assert(replay.every((value, i) => value === initial[i]), 'Reset restores the same GPU transforms exactly');
  cpu.leaves[0].position.set(103, 0, -1);
  upload(); gpu.setTime(0, 0); renderer.compute(gpu.kernel);
  const recycled = new Float32Array(await renderer.getArrayBufferAsync(gpu.buffers[0].value));
  assert(recycled[3] === 1 && Math.abs(recycled[0]) <= 100 && Math.abs(recycled[1]) <= 100, 'GPU recycles an out-of-bounds leaf in place');
  gpu.configure({ ...config, windSpeed: 5, gustStrength: 5, turbulence: 2, drag: 3, lift: 2, tumble: 3, flutter: 2, angularDamping: 0 }, 100, 100);
  for (let step = 1; step <= 600; step++) {
    gpu.setTime(step / 120, 1 / 120);
    renderer.compute(gpu.kernel);
  }
  const stressed = new Float32Array(await renderer.getArrayBufferAsync(gpu.matrices));
  assert(stressed.every(Number.isFinite), '500 leaves remain finite at extreme controls for five simulated seconds');
  gpu.dispose();
  lines.push('All GPU checks passed.');
  result.textContent = lines.join('\n');
}
run().catch((error: unknown) => { result.textContent = `${lines.join('\n')}\nFAIL ${error}`; console.error(error); }).finally(() => renderer.dispose());
