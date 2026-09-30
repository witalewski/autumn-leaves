import { BackSide, Color, Mesh, MeshBasicNodeMaterial, SphereGeometry, Vector3 } from 'three/webgpu';
import { cameraPosition, dot, float, mix, mx_noise_float, positionWorld, smoothstep, uniform, vec3, vec4 } from 'three/tsl';

export function createSky(sunDirection: Vector3, sunColor: Color) {
  const haze = uniform(0.45);
  const clouds = uniform(0.32);
  const sunIntensity = uniform(3.2);
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

  // A few broad noise layers form distant wisps. No volumetric clouds or extra render passes.
  const p = ray.mul(vec3(3.8, 11, 3.8));
  const wisps = mx_noise_float(p).mul(0.6)
    .add(mx_noise_float(p.mul(2.1).add(7.3)).mul(0.28))
    .add(mx_noise_float(p.mul(4.3)).mul(0.12));
  const cloudMask = smoothstep(0.02, 0.5, wisps).mul(clouds)
    .mul(float(1).sub(smoothstep(0.35, 0.8, ray.y)));
  const cloudColor = mix(uniform(new Color('#ccd1d0')), sun.mul(1.1), alignment.pow(12));
  const output = mix(gradient, cloudColor, cloudMask).add(sun.mul(glow.add(halo).add(disc)).mul(sunIntensity.div(3.2)));
  const material = new MeshBasicNodeMaterial({ side: BackSide, depthWrite: false, fog: false });
  material.fragmentNode = vec4(output, 1);
  const mesh = new Mesh(new SphereGeometry(100, 32, 16), material);
  mesh.renderOrder = -1;
  return {
    mesh, haze, clouds, sunIntensity,
    dispose() { mesh.geometry.dispose(); material.dispose(); },
  };
}
