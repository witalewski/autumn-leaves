import { createTexturesFromData } from '../leaf';
import type { createSurfaceData } from './ProceduralSurfaces';

/** One small worker, no downloaded textures or WASM, zero pixel-buffer copies. */
export async function loadLeafSurfaces() {
  const data = await new Promise<ReturnType<typeof createSurfaceData>[]>((resolve, reject) => {
    const worker = new Worker(new URL('./SurfaceWorker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Surface generation timed out')); }, 15000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
  });
  return data.map(createTexturesFromData);
}
