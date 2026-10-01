import { StorageInstancedBufferAttribute, Vector2, Vector4 } from 'three/webgpu';
import { Fn, If, abs, cos, cross, dot, exp, float, instanceIndex, instancedArray, length, mat4, max, min, normalize, sin, smoothstep, storage, uniform, vec3, vec4 } from 'three/tsl';
import type { PopulationBounds } from './DepthComposition';
import type { MotionConfig, LeafState } from './MotionSimulation';

// Population/palette batches receive the same global parameters. Buffers are uploaded only on reset;
// compute writes both aerodynamic state and the matrices read by instanced rendering.
export function createGpuMotion(capacity: number) {
  const time = uniform(0), dt = uniform(0);
  const bounds = uniform(new Vector2(10, 6));
  const depthEnabled = uniform(0);
  const depth = uniform(new Vector2(-2, 0));
  // Camera Z, horizontal/vertical extent per distance, offscreen margin.
  const projection = uniform(new Vector4(16, 1, 1, 1));
  const center = uniform(new Vector2());
  const wind = uniform(new Vector2(1.35, 15 * Math.PI / 180));
  const gust = uniform(1.3), turbulence = uniform(0.45), gravity = uniform(1.6);
  const drag = uniform(1.15), lift = uniform(0.65), tumble = uniform(0.75);
  const flutter = uniform(0.38), damping = uniform(1.75);
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
    const envelope = sin(time.mul(0.23).add(x.mul(0.17)).add(z.mul(0.23))).mul(0.32)
      .add(sin(time.mul(0.413).sub(x.mul(0.09)).add(y.mul(0.12)).add(1.7)).mul(0.18)).add(0.5);
    const pulse = envelope.pow(3).mul(gust);
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
    const halfDepth = depth.y.sub(depth.x).mul(0.5);
    const approach = smoothstep(0.88, 0.995, sin(time.mul(mass.mul(0.03).add(0.13)).add(phase)));
    const centerZ = depth.x.add(depth.y).mul(0.5)
      .add(depthEnabled.greaterThan(0).and(depth.x.greaterThanEqual(4)).select(approach.mul(halfDepth).mul(0.72), 0));
    v.z.addAssign(p.z.sub(centerZ).div(halfDepth).mul(-0.8).sub(v.z.mul(0.6)).mul(dt));
    v.mulAssign(min(float(1), float(9).div(max(length(v), 0.0001))));
    p.addAssign(v.mul(dt));
    If(depthEnabled.greaterThan(0), () => {
      If(p.z.lessThan(depth.x), () => { p.z.assign(depth.x); v.z.assign(max(v.z, 0)); });
      If(p.z.greaterThan(depth.y), () => { p.z.assign(depth.y); v.z.assign(min(v.z, 0)); });
    });
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
    const distance = projection.x.sub(p.z);
    const extentX = depthEnabled.greaterThan(0).select(distance.mul(projection.y).add(projection.w), bounds.x);
    const extentY = depthEnabled.greaterThan(0).select(distance.mul(projection.z).add(projection.w), bounds.y);
    If(abs(p.x.sub(center.x)).greaterThan(extentX.add(1)).or(abs(p.y.sub(center.y)).greaterThan(extentY.add(1))), () => {
      // Deterministic per-leaf respawn sequence lives in the fourth position channel.
      const cycle = position.element(instanceIndex).w.add(1).toVar();
      position.element(instanceIndex).w.assign(cycle);
      const r = sin(phase.mul(17.17).add(cycle.mul(91.7))).mul(43758.5453).fract().toVar();
      const r2 = sin(phase.mul(31.31).add(cycle.mul(47.3))).mul(15731.743).fract().toVar();
      const spawnZ = depthEnabled.greaterThan(0).select(depth.x.add(r2.mul(depth.y.sub(depth.x))), r2.mul(-2));
      const spawnDistance = projection.x.sub(spawnZ);
      const spawnX = depthEnabled.greaterThan(0).select(spawnDistance.mul(projection.y).add(projection.w), bounds.x);
      const spawnY = depthEnabled.greaterThan(0).select(spawnDistance.mul(projection.z).add(projection.w), bounds.y);
      p.assign(vec3(r.mul(2).sub(1).mul(spawnX), spawnY.add(r.mul(0.7)), spawnZ));
      If(r2.greaterThan(0.45), () => {
        p.x.assign(cos(wind.y).greaterThanEqual(0).select(spawnX.add(r2.mul(0.7)).negate(), spawnX.add(r2.mul(0.7))));
        p.y.assign(r.mul(2).sub(1).mul(spawnY));
      });
      p.xy.addAssign(center);
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
    configure(config: MotionConfig, halfWidth: number, halfHeight: number, population?: PopulationBounds) {
      bounds.value.set(halfWidth, halfHeight);
      depthEnabled.value = population ? 1 : 0;
      depth.value.set(population?.minZ ?? -2, population?.maxZ ?? 0);
      center.value.set(population?.centerX ?? 0, population?.centerY ?? 0);
      if (population) projection.value.set(population.cameraZ, population.halfWidthPerDistance, population.halfHeightPerDistance, population.margin);
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
