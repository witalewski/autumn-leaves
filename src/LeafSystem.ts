import { DynamicDrawUsage, InstancedMesh, Matrix4, Vector3, type WebGPURenderer } from 'three/webgpu';
import type { createLeaf } from './leaf';
import { MotionSimulation, type MotionConfig } from './simulation/MotionSimulation';
import { createGpuMotion } from './simulation/GpuMotion';

export function createLeafSystem(leaf: ReturnType<typeof createLeaf>, config: MotionConfig, renderer: WebGPURenderer, gpu: boolean) {
  const capacity = gpu ? 500 : 100;
  const perBatch = capacity / leaf.palette.length;
  // CPU state exists only to seed GPU buffers on reset; it is never stepped on WebGPU.
  const initial = new MotionSimulation({ ...config, leafCount: capacity }, capacity);
  const scales = Array.from({ length: capacity }, () => new Vector3());
  const compute = gpu ? leaf.palette.map(() => createGpuMotion(perBatch)) : [];
  const meshes = leaf.palette.map((variant, index) => {
    const geometry = leaf.mesh.geometry.clone();
    const mesh = new InstancedMesh(geometry, variant.material, perBatch);
    // CPU bounds cannot describe GPU-updated transforms. This one shallow volume
    // is intentionally always drawn; phase 5 introduces composition/LOD later.
    mesh.frustumCulled = false;
    if (gpu) {
      mesh.instanceMatrix = compute[index].matrices;
      // Give geometry ownership of storage attributes for standard disposal.
      compute[index].buffers.forEach((buffer, i) => geometry.setAttribute(`state${i}`, buffer.value));
      geometry.setAttribute('stateMatrices', mesh.instanceMatrix);
    } else mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    return mesh;
  });
  const kernels = compute.map((batch) => batch.kernel);
  const matrix = new Matrix4();
  let halfWidth = 10, halfHeight = 6, time = 0, accumulator = 0;
  function configure() {
    config.leafCount = Math.max(20, Math.min(capacity, Math.round(config.leafCount)));
    for (let b = 0; b < meshes.length; b++) {
      meshes[b].count = Math.max(0, Math.ceil((config.leafCount - b) / meshes.length));
      compute[b]?.configure(config, halfWidth, halfHeight);
    }
    Object.assign(initial.config, config);
  }
  function syncCpu() {
    for (let i = 0; i < config.leafCount; i++) {
      const state = initial.leaves[i];
      matrix.compose(state.position, state.rotation, scales[i]);
      meshes[i % meshes.length].setMatrixAt(Math.floor(i / meshes.length), matrix);
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  }
  function reset() {
    time = accumulator = 0;
    configure();
    initial.setBounds(halfWidth, halfHeight);
    initial.reset();
    let seed = (config.seed ^ 0x9e3779b9) >>> 0;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < capacity; i++) {
      const size = 0.23 + random() * 0.16;
      scales[i].set(size * (0.72 + random() * 0.56), size, size * (0.65 + random() * 0.85));
      if (gpu) compute[i % meshes.length].seed(Math.floor(i / meshes.length), initial.leaves[i], scales[i].toArray());
    }
    if (gpu) {
      for (const batch of compute) { batch.upload(); batch.setTime(0, 0); }
      renderer.compute(kernels);
    } else syncCpu();
  }
  return {
    meshes, capacity,
    configure,
    setBounds(width: number, height: number) {
      halfWidth = width; halfHeight = height;
      initial.setBounds(width, height);
      configure();
    },
    reset,
    update(delta: number, reducedMotion: boolean) {
      if (!gpu) {
        initial.update(delta, reducedMotion);
        syncCpu();
        return;
      }
      if (!config.running || !Number.isFinite(delta) || delta <= 0) return;
      accumulator += Math.min(delta, 0.05) * (reducedMotion ? 0.08 : 1);
      while (accumulator + 1e-10 >= 1 / 120) {
        time += 1 / 120;
        for (const batch of compute) batch.setTime(time, 1 / 120);
        renderer.compute(kernels);
        accumulator -= 1 / 120;
      }
    },
    dispose() {
      compute.forEach((batch) => batch.dispose());
      meshes.forEach((mesh) => { mesh.dispose(); mesh.geometry.dispose(); });
    },
  };
}
