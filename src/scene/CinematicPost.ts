import { ACESFilmicToneMapping, NoToneMapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, RenderPipeline, Vector2, Vector3 } from 'three/webgpu';
import type { Node, PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';
import { dot, float, mix, pass, renderOutput, texture, smoothstep, toneMapping, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export const cinematicDefaults = {
  postEnabled: true, bloomStrength: 0.16, bloomRadius: 0.55, bloomThreshold: 1.15,
  flareStrength: 0.07, contrast: 1.04, saturation: 0.97, temperature: 0.025,
  tint: 0, highlightWarmth: 0.035, shadowCoolness: 0.025, blackLevel: 0.003,
  vignetteStrength: 0.16, grainStrength: 0.006, softFocus: 0.6,
};
type Controls = typeof cinematicDefaults & { exposure: number; running: boolean; sunIntensity: number };

/** Directional sun projection, including a soft viewport edge fade and rear-hemisphere rejection. */
export function projectSun(camera: PerspectiveCamera, direction: Vector3, target: Vector2) {
  const viewDirection = direction.clone().transformDirection(camera.matrixWorldInverse);
  if (viewDirection.z >= 0) { target.set(0.5, 0.5); return 0; }
  const point = camera.position.clone().addScaledVector(direction, 100).project(camera);
  target.set(point.x * 0.5 + 0.5, 0.5 - point.y * 0.5);
  const edge = Math.max(Math.abs(point.x), Math.abs(point.y));
  const fade = Math.max(0, Math.min(1, (1.08 - edge) / 0.2));
  return fade * fade * (3 - 2 * fade);
}

// Randomly positioned, overlapping grains of unequal size. The continuous
// splats avoid a visible texel lattice; wrapped edges keep filtering seamless.
export function createGrainTexture() {
  const size = 512;
  const field = new Float32Array(size * size);
  const data = new Uint8Array(size * size * 4);
  let state = 0x6d2b79f5;
  function random() {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 4294967296;
  }
  for (let grain = 0; grain < 90000; grain++) {
    const x = random() * size, y = random() * size;
    const radius = 0.3 + random() ** 2 * 0.85;
    const amplitude = (random() < 0.5 ? -1 : 1) * (0.5 + random() * 0.5);
    const reach = Math.ceil(radius * 3);
    for (let row = Math.floor(y) - reach; row <= Math.floor(y) + reach; row++) {
      for (let col = Math.floor(x) - reach; col <= Math.floor(x) + reach; col++) {
        const distance = (col + 0.5 - x) ** 2 + (row + 0.5 - y) ** 2;
        field[((row + size) % size) * size + (col + size) % size] += amplitude * Math.exp(-distance / (2 * radius * radius));
      }
    }
  }
  let mean = 0, squared = 0;
  for (const value of field) { mean += value; squared += value * value; }
  mean /= field.length;
  const deviation = Math.sqrt(squared / field.length - mean * mean);
  for (let i = 0; i < field.length; i++) {
    const value = Math.round(Math.max(0, Math.min(1, 0.5 + (field[i] - mean) / deviation * 0.23)) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = value;
    data[i * 4 + 3] = 255;
  }
  const map = new DataTexture(data, size, size, RGBAFormat);
  map.wrapS = map.wrapT = RepeatWrapping;
  map.magFilter = LinearFilter;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  map.needsUpdate = true;
  return map;
}

export function createCinematicPost(renderer: WebGPURenderer, scene: Scene, camera: PerspectiveCamera, settings: Controls, sunDirection: Vector3) {
  const scenePass = pass(scene, camera);
  const color = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const bloomPass = bloom(color, settings.bloomStrength, settings.bloomRadius, settings.bloomThreshold);
  bloomPass.setResolutionScale(0.5);
  const controls = {
    exposure: uniform(settings.exposure), contrast: uniform(settings.contrast), saturation: uniform(settings.saturation),
    temperature: uniform(settings.temperature), tint: uniform(settings.tint), highlightWarmth: uniform(settings.highlightWarmth),
    shadowCoolness: uniform(settings.shadowCoolness), blackLevel: uniform(settings.blackLevel),
    vignetteStrength: uniform(settings.vignetteStrength), grainStrength: uniform(settings.grainStrength),
    flareStrength: uniform(settings.flareStrength), softFocus: uniform(settings.softFocus),
  };
  const sunUV = uniform(new Vector2());
  const visibility = uniform(0);
  const aspect = uniform(1);
  const grainMap = createGrainTexture();
  const grainExtent = uniform(new Vector2(1, 1));
  const grainOffset = uniform(new Vector2());
  const inverseViewport = uniform(new Vector2(1, 1));
  const coord = uv();
  const metric = vec2(aspect, 1);
  // Sky does not write depth. Sample a small sun-disc footprint: a fully covered
  // source contributes no flare, partial cover fades instead of popping.
  let occlusion: Node<'float'> = float(0);
  for (const offset of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const sampleUV = sunUV.add(vec2(offset[0], offset[1]).mul(vec2(0.003).div(metric))).clamp(0.001, 0.999);
    occlusion = occlusion.add(smoothstep(0.9999, 1, depth.sample(sampleUV).r));
  }
  const sourceDistance = coord.sub(sunUV).mul(metric).length();
  const glow = sourceDistance.mul(-35).exp().mul(0.7);
  const halo = sourceDistance.sub(0.16).abs().mul(-95).exp().mul(0.12);
  let flare = vec3(1, 0.76, 0.43).mul(glow.add(halo));
  for (const [position, radius, strength] of [[0.55, 0.027, 0.12], [1.25, 0.045, 0.08], [1.7, 0.07, 0.05]]) {
    const center = sunUV.add(vec2(0.5).sub(sunUV).mul(position));
    const distance = coord.sub(center).mul(metric).length();
    flare = flare.add(vec3(0.65, 0.78, 1).mul(float(1).sub(smoothstep(radius * 0.25, radius, distance))).mul(strength));
  }
  // A small normalized 3×3 Gaussian kernel softens the entire scene in
  // the existing composite pass. Radius is in CSS pixels, independent of DPR.
  // Bloom and flare are already diffuse; grain is added later and stays crisp.
  const focusStep = inverseViewport.mul(controls.softFocus);
  let focused = color.rgb.mul(0.25);
  for (const [x, y, weight] of [
    [-1, 0, 0.125], [1, 0, 0.125], [0, -1, 0.125], [0, 1, 0.125],
    [-1, -1, 0.0625], [-1, 1, 0.0625], [1, -1, 0.0625], [1, 1, 0.0625],
  ]) {
    focused = focused.add(color.sample(coord.add(focusStep.mul(vec2(x, y))).clamp(0, 1)).rgb.mul(weight));
  }
  const hdr = focused.add(bloomPass.rgb).add(flare.mul(controls.flareStrength).mul(visibility).mul(occlusion.div(5)));
  const mapped = toneMapping(ACESFilmicToneMapping, controls.exposure, vec4(hdr, 1)).rgb;
  const luma = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
  const balance = vec3(controls.temperature, controls.tint.mul(0.5), controls.temperature.negate());
  const split = vec3(1, 0.35, -0.5).mul(controls.highlightWarmth).mul(smoothstep(0.45, 0.95, luma))
    .add(vec3(-0.35, 0.1, 0.65).mul(controls.shadowCoolness).mul(float(1).sub(smoothstep(0.05, 0.5, luma))));
  const graded = mix(vec3(luma), mapped, controls.saturation).add(balance).add(split)
    .sub(0.18).mul(controls.contrast).add(0.18).add(controls.blackLevel).max(0);
  const vignette = float(1).sub(smoothstep(0.2, 0.72, coord.sub(0.5).length()).mul(controls.vignetteStrength));
  // Fine silver-like grains plus a weaker, coarser field for organic clumping.
  // Filtering keeps both layers stable across display pixel densities.
  const grainUV = coord.mul(grainExtent);
  const first = texture(grainMap, grainUV.add(grainOffset)).r;
  const second = texture(grainMap, vec2(grainUV.y.negate(), grainUV.x).mul(0.43).add(grainOffset.mul(0.73))).r;
  const noise = first.sub(0.5).mul(2.8).add(second.sub(0.5).mul(0.55));
  // Grain lives in display space, after grading and the single output transform.
  const display = renderOutput(vec4(graded.mul(vignette), 1), NoToneMapping, renderer.outputColorSpace);
  const displayLuma = dot(display.rgb, vec3(0.2126, 0.7152, 0.0722)).clamp(0, 1);
  const grainWeight = displayLuma.mul(float(1).sub(displayLuma)).mul(2.4).add(0.4);
  const finished = display.rgb.add(noise.mul(controls.grainStrength).mul(grainWeight)).clamp(0, 1);
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = vec4(finished, 1);
  const grainFramesPerSecond = 24;
  let grainTime = 0;
  let grainTick = -1;
  const size = new Vector2();
  return {
    apply() {
      for (const key of Object.keys(controls) as (keyof typeof controls)[]) controls[key].value = settings[key];
      bloomPass.strength.value = settings.bloomStrength;
      bloomPass.radius.value = settings.bloomRadius;
      bloomPass.threshold.value = settings.bloomThreshold;
    },
    render(reducedMotion: boolean, delta = 1 / 60) {
      if (!settings.postEnabled) { renderer.render(scene, camera); return; }
      camera.updateMatrixWorld();
      visibility.value = projectSun(camera, sunDirection, sunUV.value) * Math.min(settings.sunIntensity / 3.2, 2);
      renderer.getDrawingBufferSize(size);
      renderer.getSize(grainExtent.value);
      inverseViewport.value.set(1 / grainExtent.value.x, 1 / grainExtent.value.y);
      grainExtent.value.divideScalar(512 * 1.15);
      aspect.value = size.x / size.y;
      if (settings.running && !reducedMotion) {
        grainTime += Math.max(0, Math.min(delta, 0.05));
        // Reuse the scene clock, but hold noise between 41.667 ms ticks.
        // The epsilon only corrects floating-point error at exact boundaries.
        const tick = Math.floor(grainTime * grainFramesPerSecond + 1e-9);
        if (tick !== grainTick) {
          grainTick = tick;
          // Jump to independent offsets at film cadence; never slide the texture.
          let seed = Math.imul(tick + 1, 1597334677);
          seed ^= seed >>> 16;
          const x = (seed >>> 0) / 4294967296;
          seed = Math.imul(seed, 2246822519); seed ^= seed >>> 13;
          grainOffset.value.set(x, (seed >>> 0) / 4294967296);
        }
      }
      pipeline.render();
    },
    dispose() { grainMap.dispose(); pipeline.dispose(); bloomPass.dispose(); scenePass.dispose(); },
  };
}
