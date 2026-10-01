import type { PerspectiveCamera } from 'three/webgpu';

/** Translation only: slow parallax without changing the composed viewing angle. */
export function createCameraController(camera: PerspectiveCamera) {
  let time = 0;
  let baseZ = 16;
  function place(reducedMotion = false) {
    camera.position.set(reducedMotion ? 0 : Math.sin(time * 0.11) * 0.10,
      reducedMotion ? 0 : (Math.cos(time * 0.083) - 1) * 0.045, baseZ);
  }
  return {
    resize() {
      baseZ = 16 * Math.max(1, 0.65 / camera.aspect);
      // Bounds use the base camera; the existing >=1 world-unit spawn margin
      // exceeds this controller's maximum 0.10/0.09 translation.
      camera.position.set(0, 0, baseZ);
    },
    reset() { time = 0; place(); },
    update(delta: number, running: boolean, reducedMotion: boolean) {
      if (running && !reducedMotion && Number.isFinite(delta) && delta > 0) time += Math.min(delta, 0.05);
      place(reducedMotion);
    },
  };
}
