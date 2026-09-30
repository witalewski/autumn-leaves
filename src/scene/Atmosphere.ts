import { Color } from 'three/webgpu';
import { cameraPosition, fog, mix, positionView, positionWorld, smoothstep, uniform } from 'three/tsl';

export function createAtmosphere() {
  const start = uniform(18), falloff = uniform(0.035), strength = uniform(0.65);
  const ray = positionWorld.sub(cameraPosition).normalize();
  // Match the procedural sky gradient in linear color space before tone mapping.
  const color = mix(uniform(new Color('#d2b296')), uniform(new Color('#3d709b')), smoothstep(-0.22, 0.38, ray.y));
  const distance = positionView.z.negate().sub(start).max(0);
  const factor = distance.mul(falloff).negate().exp().oneMinus().mul(strength).clamp(0, 1);
  return { node: fog(color, factor), start, falloff, strength };
}
