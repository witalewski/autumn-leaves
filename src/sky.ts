import { BackSide, Color, Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector3 } from 'three/webgpu';
import type { MotionConfig } from './simulation/MotionSimulation';
import { cameraPosition, dot, float, mix, mx_noise_float, positionWorld, smoothstep, uniform, vec3, vec4 } from 'three/tsl';

export function createSky(sunDirection: Vector3, sunColor: Color, seed = 2409) {
  const haze = uniform(0.45);
  const clouds = uniform(0.32);
  const sunIntensity = uniform(3.2);
  const cloudOffset = uniform(new Vector3());
  const cloudTime = uniform(0);
  const cloudSeedOffset = uniform(new Vector3());
  let cloudSeed = seed >>> 0;
  function setCloudSeed(value: number) {
    cloudSeed = value >>> 0;
    let state = cloudSeed;
    function sample() {
      // Mix all 32 seed bits into bounded noise coordinates, including seed 0.
      state = (state + 0x9e3779b9) >>> 0;
      let mixed = Math.imul(state ^ (state >>> 16), 0x21f0aaad);
      mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
      return ((mixed ^ (mixed >>> 15)) >>> 0) / 4294967296 * 128;
    }
    cloudSeedOffset.value.set(sample(), sample(), sample());
  }
  setCloudSeed(cloudSeed);
  const direction = uniform(sunDirection);
  const sun = uniform(sunColor);
  const ray = positionWorld.sub(cameraPosition).normalize();
  const altitude = smoothstep(-0.22, 0.38, ray.y);
  const lower = uniform(new Color('#d2b296'));
  const upper = uniform(new Color('#3d709b'));
  const gradient = mix(lower, upper, altitude);
  const alignment = dot(ray, direction).max(0);
  const glow = alignment.pow(18).mul(haze).mul(0.65);
  const halo = alignment.pow(180).mul(0.32);
  const disc = smoothstep(Math.cos(0.008), Math.cos(0.0045), alignment).mul(9);

  // Advect the wisps with wind. Each octave evolves at its own slow rate
  // through the noise volume, gradually reshaping clouds rather than sliding
  // a single fixed image. All animation shares the scene's pause/reduced clock.
  const p = ray.mul(vec3(3.8, 11, 3.8)).add(cloudSeedOffset).sub(cloudOffset);
  const wisps = mx_noise_float(p.add(vec3(0, 0, cloudTime.mul(0.003)))).mul(0.6)
    .add(mx_noise_float(p.mul(2.1).add(7.3).add(vec3(cloudTime.mul(0.002), 0, cloudTime.mul(-0.005)))).mul(0.28))
    .add(mx_noise_float(p.mul(4.3).add(vec3(0, cloudTime.mul(0.004), cloudTime.mul(0.009)))).mul(0.12));
  const cloudMask = smoothstep(0.02, 0.5, wisps).mul(clouds)
    .mul(float(1).sub(smoothstep(0.35, 0.8, ray.y)));
  const cloudColor = mix(uniform(new Color('#ccd1d0')), sun.mul(1.1), alignment.pow(12));
  const output = mix(gradient, cloudColor, cloudMask).add(sun.mul(glow.add(halo).add(disc)).mul(sunIntensity.div(3.2)));
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  material.fragmentNode = vec4(output, 1);
  const mesh = new Mesh(new SphereGeometry(100, 32, 16), material);
  mesh.renderOrder = -1;
  return {
    mesh, haze, clouds, sunIntensity, cloudOffset, cloudTime, cloudSeedOffset,
    update(delta: number, reducedMotion: boolean, config: Pick<MotionConfig, 'running' | 'windSpeed' | 'windDirection'>) {
      if (!config.running || !Number.isFinite(delta) || delta <= 0) return;
      const dt = Math.min(delta, 0.05) * (reducedMotion ? 0.08 : 1);
      const angle = config.windDirection * Math.PI / 180;
      cloudOffset.value.x += Math.cos(angle) * config.windSpeed * dt * 0.005;
      cloudOffset.value.y += Math.sin(angle) * config.windSpeed * dt * 0.008;
      cloudTime.value += dt;
    },
    reset(seed = cloudSeed) { setCloudSeed(seed); cloudTime.value = 0; cloudOffset.value.set(0, 0, 0); },
    dispose() { mesh.geometry.dispose(); material.dispose(); },
  };
}
