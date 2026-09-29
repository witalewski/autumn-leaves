import { StorageInstancedBufferAttribute, Vector2 } from 'three/webgpu';
import { Fn, If, abs, cos, cross, dot, exp, float, instanceIndex, instancedArray, length, mat4, max, min, normalize, sin, storage, uniform, vec3, vec4 } from 'three/tsl';
import type { MotionConfig, LeafState } from './MotionSimulation';

// Five independent batches receive the same global parameters. Buffers are uploaded only on reset;
// compute writes both aerodynamic state and the matrices read by instanced rendering.
export function createGpuMotion(capacity: number) {
  const time = uniform(0), dt = uniform(0);
  const bounds = uniform(new Vector2(10, 6));
  const wind = uniform(new Vector2(1.7, 15 * Math.PI / 180));
  const gust = uniform(1.8), turbulence = uniform(0.65), gravity = uniform(1.6);
  const drag = uniform(1.15), lift = uniform(0.65), tumble = uniform(1.1);
  const flutter = uniform(0.55), damping = uniform(1.5);
  const position = instancedArray(capacity, 'vec4');
  const velocity = instancedArray(capacity, 'vec4');
  const rotation = instancedArray(capacity, 'vec4');
  const angular = instancedArray(capacity, 'vec4');
  const parameters = instancedArray(capacity, 'vec4');
  const scales = instancedArray(capacity, 'vec4');
  const matrices = new StorageInstancedBufferAttribute(capacity, 16);
  const transforms = storage(matrices, 'mat4', capacity);
  const kernel = Fn(() => {
    const p = position.element(instanceIndex).xyz.toVar();
    const v = velocity.element(instanceIndex).xyz.toVar();
    const q = rotation.element(instanceIndex).toVar();
    const omega = angular.element(instanceIndex).xyz.toVar();
    const params = parameters.element(instanceIndex);
    const mass = params.x, leafDrag = params.y, leafLift = params.z, phase = params.w;
    const frequency = angular.element(instanceIndex).w;
    const scale = scales.element(instanceIndex).xyz;
    const x = p.x.sub(time.mul(0.4)), y = p.y, z = p.z;
    const pulse = sin(time.mul(0.57).add(x.mul(0.17)).add(z.mul(0.23))).mul(0.5).add(0.5).pow(3).mul(gust);
    const speedWind = wind.x.add(pulse);
    const air = vec3(
      cos(wind.y).mul(speedWind).add(turbulence.mul(sin(y.mul(0.72).add(time.mul(0.81)).add(z.mul(0.3))))),
      sin(wind.y).mul(speedWind).add(turbulence.mul(sin(z.mul(0.63).add(time.mul(0.67)).add(x.mul(0.44))))),
      turbulence.mul(cos(x.mul(0.61).sub(time.mul(0.53)).add(y.mul(0.39)))),
    ).toVar();
    air.addAssign(vec3(sin(y.mul(2.3).add(time.mul(2.1))), cos(x.mul(2.1).sub(time.mul(1.7))), sin(z.mul(2.7).add(time.mul(1.9)))).mul(turbulence).mul(0.12));
    air.subAssign(v);
    const speed = length(air).toVar();
    const flow = air.div(max(speed, 0.0001)).toVar();
    // Quaternion rotation of the local surface normal.
    const normal = vec3(0, 0, 1).add(cross(q.xyz, cross(q.xyz, vec3(0, 0, 1)).add(vec3(0, 0, 1).mul(q.w))).mul(2)).toVar();
    const incidence = dot(normal, flow).toVar();
    const braking = min(speed.mul(drag).mul(leafDrag).mul(abs(incidence).mul(0.82).add(0.18)).div(mass), 12);
    v.addAssign(air.mul(braking).mul(dt));
    v.addAssign(normal.sub(flow.mul(incidence)).mul(min(speed.mul(speed), 36)).mul(incidence).mul(lift).mul(leafLift).div(mass).mul(dt));
    v.y.subAssign(gravity.mul(dt));
    v.z.addAssign(p.z.add(1).mul(-0.8).sub(v.z.mul(0.6)).mul(dt));
    v.mulAssign(min(float(1), float(9).div(max(length(v), 0.0001))));
    p.addAssign(v.mul(dt));
    const torque = cross(normal, flow).mul(incidence).mul(speed).mul(1.8).toVar();
    torque.addAssign(vec3(
      sin(phase.add(time.mul(0.73))).mul(0.35),
      cos(phase.mul(1.7).add(time.mul(0.91))).mul(0.28),
      sin(phase.mul(2.3).add(time.mul(0.49))).mul(0.22),
    ).mul(tumble).mul(speed));
    torque.addAssign(flow.mul(flutter).mul(speed).mul(sin(time.mul(frequency).add(phase))));
    omega.addAssign(torque.mul(dt).div(mass));
    omega.mulAssign(exp(damping.mul(dt).negate()));
    omega.mulAssign(min(float(1), float(8).div(max(length(omega), 0.0001))));
    const spin = length(omega).toVar();
    const halfAngle = spin.mul(dt).mul(0.5);
    const dq = vec4(omega.div(max(spin, 0.0001)).mul(sin(halfAngle)), cos(halfAngle)).toVar();
    q.assign(normalize(vec4(dq.xyz.mul(q.w).add(q.xyz.mul(dq.w)).add(cross(dq.xyz, q.xyz)), dq.w.mul(q.w).sub(dot(dq.xyz, q.xyz)))));
    If(abs(p.x).greaterThan(bounds.x.add(1)).or(abs(p.y).greaterThan(bounds.y.add(1))), () => {
      // Deterministic per-leaf respawn sequence lives in the fourth position channel.
      const cycle = position.element(instanceIndex).w.add(1).toVar();
      position.element(instanceIndex).w.assign(cycle);
      const r = sin(phase.mul(17.17).add(cycle.mul(91.7))).mul(43758.5453).fract().toVar();
      const r2 = sin(phase.mul(31.31).add(cycle.mul(47.3))).mul(15731.743).fract().toVar();
      p.assign(vec3(r.mul(2).sub(1).mul(bounds.x), bounds.y, r2.mul(-2)));
      If(r2.greaterThan(0.45), () => {
        p.x.assign(cos(wind.y).greaterThanEqual(0).select(bounds.x.negate(), bounds.x));
        p.y.assign(r.mul(2).sub(1).mul(bounds.y));
      });
      v.assign(vec3(cos(wind.y).mul(wind.x).mul(0.6), sin(wind.y).mul(wind.x).mul(0.6).sub(0.4), 0));
      omega.assign(vec3(r.sub(0.5), r2.sub(0.5), 0.2));
    });
    position.element(instanceIndex).xyz.assign(p);
    velocity.element(instanceIndex).xyz.assign(v);
    rotation.element(instanceIndex).assign(q);
    angular.element(instanceIndex).xyz.assign(omega);
    // Column-major TRS. Three's instance path transforms normals (including the
    // nonuniform scale), tangents, and positions, preserving the normal map.
    const xx = q.x.mul(q.x), yy = q.y.mul(q.y), zz = q.z.mul(q.z);
    const xy = q.x.mul(q.y), xz = q.x.mul(q.z), yz = q.y.mul(q.z);
    const wx = q.w.mul(q.x), wy = q.w.mul(q.y), wz = q.w.mul(q.z);
    transforms.element(instanceIndex).assign(mat4(
      vec4(vec3(float(1).sub(yy.add(zz).mul(2)), xy.add(wz).mul(2), xz.sub(wy).mul(2)).mul(scale.x), 0),
      vec4(vec3(xy.sub(wz).mul(2), float(1).sub(xx.add(zz).mul(2)), yz.add(wx).mul(2)).mul(scale.y), 0),
      vec4(vec3(xz.add(wy).mul(2), yz.sub(wx).mul(2), float(1).sub(xx.add(yy).mul(2))).mul(scale.z), 0),
      vec4(p, 1),
    ));
  })().compute(capacity);

  return {
    matrices, kernel,
    buffers: [position, velocity, rotation, angular, parameters, scales],
    configure(config: MotionConfig, halfWidth: number, halfHeight: number) {
      bounds.value.set(halfWidth, halfHeight);
      wind.value.set(config.windSpeed, config.windDirection * Math.PI / 180);
      gust.value = config.gustStrength; turbulence.value = config.turbulence;
      gravity.value = config.gravity; drag.value = config.drag; lift.value = config.lift;
      tumble.value = config.tumble; flutter.value = config.flutter; damping.value = config.angularDamping;
    },
    setTime(seconds: number, step: number) { time.value = seconds; dt.value = step; },
    seed(index: number, leaf: LeafState, scale: readonly number[]) {
      const offset = index * 4;
      position.value.array.set([...leaf.position.toArray(), 0], offset);
      velocity.value.array.set([...leaf.velocity.toArray(), 0], offset);
      rotation.value.array.set(leaf.rotation.toArray(), offset);
      angular.value.array.set([...leaf.angularVelocity.toArray(), leaf.frequency], offset);
      parameters.value.array.set([leaf.mass, leaf.drag, leaf.lift, leaf.phase], offset);
      scales.value.array.set([...scale, 0], offset);
    },
    upload() {
      for (const buffer of [position, velocity, rotation, angular, parameters, scales]) buffer.value.needsUpdate = true;
    },
    dispose() {
      kernel.dispose();
    },
  };
}
