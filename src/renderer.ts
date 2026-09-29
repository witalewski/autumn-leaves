import { ACESFilmicToneMapping, WebGPURenderer } from 'three/webgpu';

export async function createRenderer(forceWebGL: boolean) {
  const renderer = new WebGPURenderer({ antialias: true, alpha: false, forceWebGL });
  try {
    // Three.js probes the adapter and automatically selects WebGL2 if WebGPU cannot initialize.
    await renderer.init();
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  const capabilities = {
    secureContext: window.isSecureContext,
    webgpuAPI: 'gpu' in navigator,
    backend: 'isWebGPUBackend' in renderer.backend ? 'WebGPU' : 'WebGL2',
  };
  return { renderer, capabilities };
}
