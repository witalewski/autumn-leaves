import { ACESFilmicToneMapping, NoToneMapping, RenderPipeline, Vector2, Vector3 } from 'three/webgpu';
import type { Node, PerspectiveCamera, Scene, WebGPURenderer } from 'three/webgpu';
import { dot, float, fract, mix, pass, renderOutput, sin, smoothstep, toneMapping, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

export const cinematicDefaults = {
  postEnabled: true, bloomStrength: 0.16, bloomRadius: 0.55, bloomThreshold: 1.15,
  flareStrength: 0.07, contrast: 1.04, saturation: 0.97, temperature: 0.025,
  tint: 0, highlightWarmth: 0.035, shadowCoolness: 0.025, blackLevel: 0.003,
  vignetteStrength: 0.16, grainStrength: 0.012,
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
    flareStrength: uniform(settings.flareStrength),
  };
  const sunUV = uniform(new Vector2());
  const visibility = uniform(0);
  const aspect = uniform(1);
  const pixels = uniform(new Vector2(1, 1));
  const grainFrame = uniform(0);
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
  const hdr = color.rgb.add(bloomPass.rgb).add(flare.mul(controls.flareStrength).mul(visibility).mul(occlusion.div(5)));
  const mapped = toneMapping(ACESFilmicToneMapping, controls.exposure, vec4(hdr, 1)).rgb;
  const luma = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
  const balance = vec3(controls.temperature, controls.tint.mul(0.5), controls.temperature.negate());
  const split = vec3(1, 0.35, -0.5).mul(controls.highlightWarmth).mul(smoothstep(0.45, 0.95, luma))
    .add(vec3(-0.35, 0.1, 0.65).mul(controls.shadowCoolness).mul(float(1).sub(smoothstep(0.05, 0.5, luma))));
  const graded = mix(vec3(luma), mapped, controls.saturation).add(balance).add(split)
    .sub(0.18).mul(controls.contrast).add(0.18).add(controls.blackLevel).max(0);
  const vignette = float(1).sub(smoothstep(0.2, 0.72, coord.sub(0.5).length()).mul(controls.vignetteStrength));
  // Pixel-scale, achromatic grain. Freeze its seed when paused/reduced motion.
  const pixel = coord.mul(pixels).floor();
  const noise = fract(sin(dot(pixel, vec2(12.9898, 78.233)).add(grainFrame.mul(37.719))).mul(43758.5453)).sub(0.5);
  const grainWeight = luma.clamp(0, 1).mul(float(1).sub(luma.clamp(0, 1))).mul(3).add(0.15);
  const finished = graded.mul(vignette).add(noise.mul(controls.grainStrength).mul(grainWeight)).max(0);
  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  pipeline.outputNode = renderOutput(vec4(finished, 1), NoToneMapping, renderer.outputColorSpace);
  let frame = 0;
  const size = new Vector2();
  return {
    apply() {
      for (const key of Object.keys(controls) as (keyof typeof controls)[]) controls[key].value = settings[key];
      bloomPass.strength.value = settings.bloomStrength;
      bloomPass.radius.value = settings.bloomRadius;
      bloomPass.threshold.value = settings.bloomThreshold;
    },
    render(reducedMotion: boolean) {
      if (!settings.postEnabled) { renderer.render(scene, camera); return; }
      camera.updateMatrixWorld();
      visibility.value = projectSun(camera, sunDirection, sunUV.value) * Math.min(settings.sunIntensity / 3.2, 2);
      renderer.getDrawingBufferSize(size);
      pixels.value.copy(size);
      aspect.value = size.x / size.y;
      if (settings.running && !reducedMotion) grainFrame.value = (frame++ % 4096);
      pipeline.render();
    },
    dispose() { pipeline.dispose(); bloomPass.dispose(); scenePass.dispose(); },
  };
}
