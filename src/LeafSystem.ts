import { DynamicDrawUsage, InstancedMesh, Matrix4, Vector3, type WebGPURenderer } from 'three/webgpu';
import { createGeometry, selectLeafForm, type createLeaf } from './leaf';
import { MotionSimulation, type MotionConfig } from './simulation/MotionSimulation';
import { createGpuMotion } from './simulation/GpuMotion';
import { createPopulationBounds, createPopulationConfigs, type DepthCamera, type PopulationBounds, type PopulationId } from './simulation/DepthComposition';

export function createLeafSystem(leaf: ReturnType<typeof createLeaf>, config: MotionConfig, renderer: WebGPURenderer, gpu: boolean) {
  const populations = createPopulationConfigs(gpu);
  const populationBounds = new Map<PopulationId, PopulationBounds>();
  const capacity = populations.reduce((total, population) => total + population.count, 0);
  // CPU state seeds GPU buffers only on reset; it is never stepped on WebGPU.
  const initial = new MotionSimulation({ ...config, leafCount: capacity }, capacity, populations);
  const scales = Array.from({ length: capacity }, () => new Vector3());
  const controls = populations.map(population => ({ ...population, depth: { ...population.depth }, scale: { ...population.scale }, visible: true, activeCount: population.count }));
  const batches = populations.flatMap((population, populationIndex) => leaf.palettes[population.materialTier].map((variant, paletteIndex) => {
    const count = Math.ceil((population.count - paletteIndex) / leaf.palette.length);
    const compute = gpu ? createGpuMotion(count) : undefined;
    const geometry = leaf.geometryVariants[population.geometryTier][paletteIndex].clone();
    const mesh = new InstancedMesh(geometry, variant.material, count);
    // GPU transforms have no CPU bounding sphere. Fifteen conservative batches
    // remain drawn; depth LOD bounds their cost without per-instance readback.
    mesh.frustumCulled = false;
    if (compute) {
      mesh.instanceMatrix = compute.matrices;
      compute.buffers.forEach((buffer, i) => geometry.setAttribute(`state${i}`, buffer.value));
      geometry.setAttribute('stateMatrices', mesh.instanceMatrix);
    } else mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    return { mesh, compute, populationIndex, paletteIndex };
  }));
  const meshes = batches.map(batch => batch.mesh);
  const kernels = batches.flatMap(batch => batch.compute ? [batch.compute.kernel] : []);
  const cursors = populations.map(() => 0);
  const slots = initial.leaves.map(state => {
    const populationIndex = populations.findIndex(p => p.id === state.population);
    const local = cursors[populationIndex]++;
    return { populationIndex, local, batchIndex: populationIndex * leaf.palette.length + local % leaf.palette.length, index: Math.floor(local / leaf.palette.length) };
  });
  const matrix = new Matrix4();
  let camera: DepthCamera | undefined;
  let time = 0, accumulator = 0;
  function configure() {
    config.leafCount = Math.max(20, Math.min(capacity, Math.round(config.leafCount)));
    for (const batch of batches) {
      batch.mesh.count = 0;
      const control = controls[batch.populationIndex];
      control.activeCount = Math.max(0, Math.min(control.count, Math.round(control.activeCount)));
      batch.mesh.visible = control.visible;
      batch.compute?.configure(config, 10, 6, populationBounds.get(control.id));
    }
    for (let i = 0; i < config.leafCount; i++) {
      const slot = slots[i];
      if (slot.local < controls[slot.populationIndex].activeCount) meshes[slot.batchIndex].count++;
    }
    Object.assign(initial.config, config);
  }
  function setCameraBounds(next: DepthCamera) {
    camera = next;
    for (const control of controls) populationBounds.set(control.id, createPopulationBounds(next, control.depth, Math.max(1, control.scale.max * 2.5)));
    initial.setPopulationBounds(populationBounds);
    configure();
  }
  function syncCpu() {
    for (let i = 0; i < config.leafCount; i++) {
      const state = initial.leaves[i], slot = slots[i];
      matrix.compose(state.position, state.rotation, scales[i]);
      meshes[slot.batchIndex].setMatrixAt(slot.index, matrix);
    }
    for (const mesh of meshes) mesh.instanceMatrix.needsUpdate = true;
  }
  function reset() {
    time = accumulator = 0;
    if (camera) setCameraBounds(camera);
    else configure();
    initial.reset();
    // Bake form variation only on explicit reset. Keep storage attributes and
    // instance slots intact; recomputed normals follow each bend and twist.
    for (const batch of batches) {
      const geometry = createGeometry(populations[batch.populationIndex].geometryTier, selectLeafForm(batch.paletteIndex, batch.populationIndex, config.seed), config.seed + batch.populationIndex * 137);
      for (const name of ['position', 'normal']) {
        const target = batch.mesh.geometry.getAttribute(name);
        target.array.set(geometry.getAttribute(name).array);
        target.needsUpdate = true;
      }
      geometry.dispose();
    }
    let seed = (config.seed ^ 0x9e3779b9) >>> 0;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < capacity; i++) {
      const slot = slots[i], range = controls[slot.populationIndex].scale;
      const size = range.min + random() * (range.max - range.min);
      scales[i].set(size * (0.72 + random() * 0.56), size, size * (0.65 + random() * 0.85));
      batches[slot.batchIndex].compute?.seed(slot.index, initial.leaves[i], scales[i].toArray());
    }
    if (gpu) {
      for (const batch of batches) { batch.compute!.upload(); batch.compute!.setTime(0, 0); batch.compute!.setGestureWind(0, 0); }
      renderer.compute(kernels);
    } else syncCpu();
  }
  return {
    meshes, capacity, populations, populationBounds, controls,
    configure, setCameraBounds, reset,
    setGestureWind(x: number, y: number) {
      initial.gestureWind.set(x, y, 0);
      for (const batch of batches) batch.compute?.setGestureWind(x, y);
    },
    getPopulationCounts() {
      return controls.map((control, index) => ({ id: control.id, count: control.visible ? batches.filter(b => b.populationIndex === index).reduce((sum, b) => sum + b.mesh.count, 0) : 0 }));
    },
    update(delta: number, reducedMotion: boolean) {
      if (!gpu) { initial.update(delta, reducedMotion); syncCpu(); return; }
      if (!config.running || !Number.isFinite(delta) || delta <= 0) return;
      accumulator += Math.min(delta, 0.05) * (reducedMotion ? 0.08 : 1);
      while (accumulator + 1e-10 >= 1 / 120) {
        time += 1 / 120;
        for (const batch of batches) batch.compute!.setTime(time, 1 / 120);
        renderer.compute(kernels);
        accumulator -= 1 / 120;
      }
    },
    dispose() {
      batches.forEach(batch => batch.compute?.dispose());
      meshes.forEach(mesh => { mesh.dispose(); mesh.geometry.dispose(); });
    },
  };
}
