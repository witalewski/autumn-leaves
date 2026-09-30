// Canvas readback is confined to this browser regression test.
import { Color, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { createRenderer } from '../src/renderer';
import { cinematicDefaults, createCinematicPost } from '../src/scene/CinematicPost';

const result = document.querySelector('#result')!;
async function run() {
  const { renderer, capabilities } = await createRenderer(new URLSearchParams(location.search).has('webgl'));
  const settings = { ...cinematicDefaults, exposure: 1, running: false, sunIntensity: 0,
    bloomStrength: 0, vignetteStrength: 0, contrast: 1, saturation: 1, temperature: 0,
    tint: 0, highlightWarmth: 0, shadowCoolness: 0, blackLevel: 0, grainStrength: 0 };
  const scene = new Scene();
  scene.background = new Color().setRGB(0.5, 0.5, 0.5);
  const camera = new PerspectiveCamera();
  const post = createCinematicPost(renderer, scene, camera, settings, new Vector3(0, 0, -1));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  function capture(strength: number, reduced = false) {
    settings.grainStrength = strength;
    post.apply();
    post.render(reduced);
    context.drawImage(renderer.domElement, 0, 0, 256, 256);
    return context.getImageData(0, 0, 256, 256).data;
  }
  function rms(a: Uint8ClampedArray, b: Uint8ClampedArray) {
    let sum = 0;
    for (let i = 0; i < a.length; i += 4) sum += (a[i] - b[i]) ** 2;
    return Math.sqrt(sum / (a.length / 4));
  }
  const lines = [capabilities.backend];
  try {
    for (const dpr of [1, 1.75]) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(256, 256);
      const off = capture(0);
      const subtle = capture(cinematicDefaults.grainStrength);
      const strong = capture(0.06);
      const repeat = capture(0.06);
      const preview = document.createElement('canvas');
      preview.width = preview.height = 256;
      preview.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(strong), 256, 256), 0, 0);
      document.body.append(`Maximum grain at DPR ${dpr}`, preview);
      settings.running = true;
      for (let i = 0; i < 4; i++) capture(0.06);
      const moving = capture(0.06);
      const reducedA = capture(0.06, true);
      const reducedB = capture(0.06, true);
      settings.running = false;
      if (rms(off, strong) < 3 || rms(off, strong) <= rms(off, subtle) * 1.8) throw new Error('Grain strength is not visible or responsive');
      if (rms(strong, repeat) !== 0 || rms(reducedA, reducedB) !== 0) throw new Error('Paused grain changed');
      if (rms(strong, moving) < 3) throw new Error('Grain failed to animate');
      lines.push(`PASS DPR ${dpr}: default RMS ${rms(off, subtle).toFixed(2)}, maximum RMS ${rms(off, strong).toFixed(2)} / 255; paused difference ${rms(strong, repeat).toFixed(2)}, animated difference ${rms(strong, moving).toFixed(2)}, reduced-motion difference ${rms(reducedA, reducedB).toFixed(2)}`);
    }
    renderer.setPixelRatio(1);
    renderer.setSize(64, 64);
    for (const fps of [60, 120, 144]) {
      const timedPost = createCinematicPost(renderer, scene, camera, settings, new Vector3(0, 0, -1));
      settings.running = true;
      settings.grainStrength = 0.06;
      timedPost.apply();
      const sample = (delta: number) => {
        timedPost.render(false, delta);
        context.drawImage(renderer.domElement, 0, 0, 256, 256);
        return context.getImageData(0, 0, 256, 256).data;
      };
      try {
        let previous = sample(0);
        let changes = 0;
        for (let frame = 1; frame <= fps; frame++) {
          const current = sample(1 / fps);
          const changed = rms(previous, current) > 0;
          const expected = Math.floor(frame * 24 / fps + 1e-9) !== Math.floor((frame - 1) * 24 / fps + 1e-9);
          if (changed !== expected) throw new Error(`Grain cadence mismatch at ${fps} FPS, frame ${frame}`);
          if (changed) changes++;
          previous = current;
        }
        if (changes !== 24) throw new Error(`Expected 24 grain changes at ${fps} FPS, got ${changes}`);
        lines.push(`PASS ${fps} FPS: exactly 24 grain changes per second; intervening frames identical`);
      } finally { timedPost.dispose(); }
    }
    result.textContent = lines.join('\n');
  } finally { post.dispose(); renderer.dispose(); }
}
run().catch(error => { result.textContent = `FAIL ${error}`; console.error(error); });
