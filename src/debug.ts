import GUI from 'lil-gui';
import type { WebGPURenderer } from 'three/webgpu';
import type { Settings } from './main';

export function createDebug(settings: Settings, renderer: WebGPURenderer, backend: string, apply: () => void, resize: () => void, restart: () => void, capacity: number) {
  const defaults = { ...settings };
  const gui = new GUI({ title: 'Instanced motion study', width: 260 });
  const lighting = gui.addFolder('Sun & sky');
  lighting.add(settings, 'sunAzimuth', -180, 180, 0.1).name('Sun azimuth');
  lighting.add(settings, 'sunElevation', -15, 80, 0.1).name('Sun elevation');
  lighting.add(settings, 'sunIntensity', 0, 8, 0.01).name('Sun intensity');
  lighting.addColor(settings, 'sunColor').name('Sun color');
  lighting.add(settings, 'skyIntensity', 0, 4, 0.01).name('Sky fill');
  lighting.add(settings, 'haze', 0, 1, 0.01).name('Haze');
  lighting.add(settings, 'clouds', 0, 1, 0.01).name('Cloud amount');
  lighting.close();
  const material = gui.addFolder('Leaf surface');
  material.add(settings, 'transmission', 0, 4, 0.01).name('Transmission');
  material.add(settings, 'roughness', 0.1, 1, 0.01).name('Roughness');
  material.add(settings, 'normalStrength', 0, 2, 0.01).name('Normal detail');
  material.addColor(settings, 'leafColor').name('Albedo tint');
  const motion = gui.addFolder(backend === 'WebGPU' ? 'GPU compute motion' : 'CPU fallback motion');
  motion.add(settings, 'running').name('Run simulation').listen();
  motion.add(settings, 'leafCount', 20, capacity, 1).name('Leaves');
  motion.add(settings, 'seed', 0, 65535, 1).name('Seed').onFinishChange(restart);
  motion.add(settings, 'windDirection', -180, 180, 1).name('Wind direction (°)');
  motion.add(settings, 'windSpeed', 0, 5, 0.05).name('Wind speed');
  motion.add(settings, 'gustStrength', 0, 5, 0.05).name('Gust strength');
  motion.add(settings, 'turbulence', 0, 2, 0.01).name('Turbulence');
  motion.add(settings, 'gravity', 0, 4, 0.05).name('Gravity');
  motion.add(settings, 'drag', 0, 3, 0.01).name('Drag');
  motion.add(settings, 'lift', 0, 2, 0.01).name('Lift');
  motion.add(settings, 'tumble', 0, 3, 0.01).name('Tumble');
  motion.add(settings, 'flutter', 0, 2, 0.01).name('Flutter');
  motion.add(settings, 'angularDamping', 0, 4, 0.01).name('Angular damping');
  motion.add({ restart }, 'restart').name('Restart same seed');
  material.close();
  const view = gui.addFolder('Renderer');
  view.add(settings, 'exposure', 0.3, 2, 0.01).name('Exposure');
  view.add(settings, 'renderScale', 0.5, 1, 0.05).name('Render scale').onChange(resize);
  view.add(settings, 'dprCap', 1, 2, 0.25).name('DPR cap').onChange(resize);
  view.close();
  const actions = {
    reset() { Object.assign(settings, defaults); gui.controllersRecursive().forEach((c) => c.updateDisplay()); resize(); restart(); apply(); },
    export() {
      const url = URL.createObjectURL(new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'autumn-motion-study.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
  gui.add(actions, 'reset').name('Reset study');
  gui.add(actions, 'export').name('Export parameters');
  gui.onChange(apply);
  if (window.innerWidth < 600) gui.close();
  const overlay = document.createElement('pre');
  overlay.className = 'stats';
  overlay.textContent = `${backend} · warming up`;
  document.querySelector('#app')!.append(overlay);
  return {
    update(fps: number, ms: number) {
      overlay.textContent = `${backend}  ${fps.toFixed(0)} FPS  ${ms.toFixed(1)} ms\n${settings.leafCount} leaves · ${backend === 'WebGPU' ? 'GPU compute' : 'CPU fallback'} · ${renderer.info.render.drawCalls} draws · ${renderer.info.render.triangles} tris\nScale ${settings.renderScale.toFixed(2)} · DPR ${renderer.getPixelRatio().toFixed(2)}`;
    },
    destroy() { gui.destroy(); overlay.remove(); },
  };
}
