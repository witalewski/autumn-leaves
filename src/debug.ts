import GUI from 'lil-gui';
import type { WebGPURenderer } from 'three/webgpu';
import type { createLeafSystem } from './LeafSystem';
import type { Settings } from './main';

export function createDebug(settings: Settings, renderer: WebGPURenderer, backend: string, apply: () => void, resize: () => void, restart: () => void, foliage: ReturnType<typeof createLeafSystem>) {
  const defaults = { ...settings };
  const populationDefaults = structuredClone(foliage.controls);
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
  motion.add(settings, 'leafCount', 20, foliage.capacity, 1).name('Leaves');
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
  const composition = gui.addFolder('Depth composition');
  composition.add(settings, 'depthHazeStart', 0, 60, 0.5).name('Haze start');
  composition.add(settings, 'depthHazeFalloff', 0, 0.15, 0.001).name('Haze falloff');
  composition.add(settings, 'depthHazeStrength', 0, 1, 0.01).name('Haze strength');
  for (const population of foliage.controls) {
    const folder = composition.addFolder(population.id);
    folder.add(population, 'visible').name('Visible');
    folder.add(population, 'activeCount', 0, population.count, 1).name('Count');
    // Keep editing inside each band's original envelope so depth stays ordered
    // and in front of the fixed camera. Only explicit edits reset the seed.
    const original = populationDefaults.find(p => p.id === population.id)!;
    const depthMin = folder.add(population.depth, 'min', original.depth.min, original.depth.max - 0.5, 0.5).name('Far Z');
    const depthMax = folder.add(population.depth, 'max', original.depth.min + 0.5, original.depth.max, 0.5).name('Near Z');
    depthMin.onFinishChange(() => { population.depth.min = Math.min(population.depth.min, population.depth.max - 0.5); depthMin.updateDisplay(); restart(); });
    depthMax.onFinishChange(() => { population.depth.max = Math.max(population.depth.max, population.depth.min + 0.5); depthMax.updateDisplay(); restart(); });
    const scaleMin = folder.add(population.scale, 'min', 0.1, 0.6, 0.01).name('Scale min');
    const scaleMax = folder.add(population.scale, 'max', 0.1, 0.6, 0.01).name('Scale max');
    scaleMin.onFinishChange(() => { population.scale.min = Math.min(population.scale.min, population.scale.max); scaleMin.updateDisplay(); restart(); });
    scaleMax.onFinishChange(() => { population.scale.max = Math.max(population.scale.max, population.scale.min); scaleMax.updateDisplay(); restart(); });
    folder.close();
  }
  composition.close();
  const post = gui.addFolder('Cinematic post');
  post.add(settings, 'postEnabled').name('Enable post / compare');
  post.add(settings, 'bloomStrength', 0, 0.6, 0.01).name('Bloom strength');
  post.add(settings, 'bloomRadius', 0, 1, 0.01).name('Bloom radius');
  post.add(settings, 'bloomThreshold', 0.5, 3, 0.01).name('Bloom threshold');
  post.add(settings, 'flareStrength', 0, 0.5, 0.01).name('Lens flare');
  post.add(settings, 'contrast', 0.7, 1.4, 0.01).name('Contrast');
  post.add(settings, 'saturation', 0, 1.5, 0.01).name('Saturation');
  post.add(settings, 'temperature', -0.15, 0.15, 0.005).name('Temperature');
  post.add(settings, 'tint', -0.15, 0.15, 0.005).name('Tint');
  post.add(settings, 'highlightWarmth', 0, 0.15, 0.005).name('Highlight warmth');
  post.add(settings, 'shadowCoolness', 0, 0.15, 0.005).name('Shadow coolness');
  post.add(settings, 'blackLevel', -0.03, 0.05, 0.001).name('Black level');
  post.add(settings, 'vignetteStrength', 0, 0.6, 0.01).name('Vignette');
  post.add(settings, 'grainStrength', 0, 0.06, 0.001).name('Film grain');
  post.close();
  const view = gui.addFolder('Renderer');
  view.add(settings, 'exposure', 0.3, 2, 0.01).name('Exposure');
  view.add(settings, 'renderScale', 0.5, 1, 0.05).name('Render scale').onChange(resize);
  view.add(settings, 'dprCap', 1, 2, 0.25).name('DPR cap').onChange(resize);
  view.close();
  const actions = {
    reset() { Object.assign(settings, defaults); foliage.controls.forEach((p, i) => { const d = populationDefaults[i]; p.visible = d.visible; p.activeCount = d.activeCount; Object.assign(p.depth, d.depth); Object.assign(p.scale, d.scale); }); gui.controllersRecursive().forEach((c) => c.updateDisplay()); resize(); restart(); apply(); },
    export() {
      const url = URL.createObjectURL(new Blob([JSON.stringify({ ...settings, populations: foliage.controls }, null, 2)], { type: 'application/json' }));
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
      const counts = foliage.getPopulationCounts();
      const visible = counts.reduce((sum, p) => sum + p.count, 0);
      overlay.textContent = `${backend}  ${fps.toFixed(0)} FPS  ${ms.toFixed(1)} ms\n${visible} leaves · ${backend === 'WebGPU' ? 'GPU compute' : 'CPU fallback'} · ${renderer.info.render.drawCalls} draws · ${renderer.info.render.triangles} tris\n${counts.map(p => `${p.id}: ${p.count}`).join(' · ')}\nScale ${settings.renderScale.toFixed(2)} · DPR ${renderer.getPixelRatio().toFixed(2)}`;
    },
    destroy() { gui.destroy(); overlay.remove(); },
  };
}
