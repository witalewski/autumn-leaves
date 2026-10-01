import { Quaternion, Vector3 } from 'three/webgpu';
import type { PopulationBounds, PopulationConfig, PopulationId } from './DepthComposition';

export const motionDefaults = {
  running: true, leafCount: 32, seed: 2409,
  windDirection: 15, windSpeed: 1.35, gustStrength: 1.3, turbulence: 0.45,
  gravity: 1.6, drag: 1.15, lift: 0.65, tumble: 0.75, flutter: 0.38, angularDamping: 1.75,
};
export type MotionConfig = typeof motionDefaults;
export interface LeafState {
  readonly population: PopulationId | null;
  position: Vector3;
  velocity: Vector3;
  rotation: Quaternion;
  angularVelocity: Vector3;
  mass: number;
  drag: number;
  lift: number;
  phase: number;
  frequency: number;
}

// Smooth, advected eddies at three scales. Trigonometric terms describe the air
// field, never prescribed leaf positions. All leaves sample the same field.
export function sampleWind(position: Vector3, time: number, config: MotionConfig, out: Vector3) {
  const angle = config.windDirection * Math.PI / 180;
  const x = position.x - time * 0.4, y = position.y, z = position.z;
  // Overlapping slow fronts avoid a single obvious gust period.
  const envelope = 0.5 + 0.32 * Math.sin(time * 0.23 + x * 0.17 + z * 0.23)
    + 0.18 * Math.sin(time * 0.413 - x * 0.09 + y * 0.12 + 1.7);
  const gust = config.gustStrength * envelope ** 3;
  const speed = config.windSpeed + gust;
  out.set(Math.cos(angle) * speed, Math.sin(angle) * speed, 0);
  out.x += config.turbulence * Math.sin(y * 0.72 + time * 0.81 + z * 0.3);
  out.y += config.turbulence * Math.sin(z * 0.63 + time * 0.67 + x * 0.44);
  out.z += config.turbulence * Math.cos(x * 0.61 - time * 0.53 + y * 0.39);
  const fine = config.turbulence * 0.12;
  out.x += Math.sin(y * 2.3 + time * 2.1) * fine;
  out.y += Math.cos(x * 2.1 - time * 1.7) * fine;
  out.z += Math.sin(z * 2.7 + time * 1.9) * fine;
  return out;
}
const STEP = 1 / 120;

export class MotionSimulation {
  readonly leaves: LeafState[];
  time = 0;
  recycled = 0;
  private accumulator = 0;
  private randomState = 1;
  private halfWidth = 10;
  private halfHeight = 6;
  private populationBounds: ReadonlyMap<PopulationId, PopulationBounds> = new Map();
  private readonly air = new Vector3();
  private readonly normal = new Vector3();
  private readonly flow = new Vector3();
  private readonly liftDirection = new Vector3();
  private readonly torque = new Vector3();
  private readonly increment = new Quaternion();

  constructor(readonly config: MotionConfig, capacity = 50, populations: readonly PopulationConfig[] = []) {
    if (populations.length && (populations.some(p => !Number.isInteger(p.count) || p.count < 0)
      || populations.reduce((sum, p) => sum + p.count, 0) !== capacity
      || new Set(populations.map(p => p.id)).size !== populations.length)) {
      throw new RangeError('Population counts must partition the simulation capacity');
    }
    // Interleave weighted populations so the visible prefix includes depth variety.
    // Assignment consumes no motion randomness and survives reset/recycling.
    const assigned = populations.map(() => 0);
    this.leaves = Array.from({ length: capacity }, (_, index) => {
      let selected = -1, deficit = -Infinity;
      populations.forEach((population, i) => {
        const next = (index + 1) * population.count / capacity - assigned[i];
        if (assigned[i] < population.count && next > deficit) { selected = i; deficit = next; }
      });
      if (selected >= 0) assigned[selected]++;
      return {
        population: selected < 0 ? null : populations[selected].id,
        position: new Vector3(), velocity: new Vector3(), rotation: new Quaternion(),
        angularVelocity: new Vector3(), mass: 1, drag: 1, lift: 1, phase: 0, frequency: 1,
      };
    });
    this.reset();
  }

  setBounds(halfWidth: number, halfHeight: number) {
    this.halfWidth = halfWidth;
    this.halfHeight = halfHeight;
  }

  setPopulationBounds(bounds: ReadonlyMap<PopulationId, PopulationBounds>) {
    for (const leaf of this.leaves) {
      if (leaf.population !== null && !bounds.has(leaf.population)) throw new RangeError('Missing population bounds');
    }
    this.populationBounds = bounds;
  }

  private random() {
    this.randomState = (Math.imul(1664525, this.randomState) + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }

  reset() {
    this.randomState = this.config.seed >>> 0;
    this.time = this.accumulator = this.recycled = 0;
    for (const leaf of this.leaves) this.spawn(leaf, true);
  }

  private spawn(leaf: LeafState, initial: boolean) {
    const bounds = leaf.population === null ? undefined : this.populationBounds.get(leaf.population);
    const rx = this.random(), ry = this.random(), rz = this.random();
    const z = bounds ? bounds.minZ + rz * (bounds.maxZ - bounds.minZ) : -rz * 2;
    const distance = bounds ? bounds.cameraZ - z : 0;
    const x = bounds ? distance * bounds.halfWidthPerDistance + bounds.margin : this.halfWidth;
    const y = bounds ? distance * bounds.halfHeightPerDistance + bounds.margin : this.halfHeight;
    leaf.position.set((rx * 2 - 1) * x, (ry * 2 - 1) * y, z);
    if (!initial) {
      // Top or upstream edge, beyond the visible frame and leaf radius.
      if (this.random() < 0.45) leaf.position.y = y + rz * 0.7;
      else leaf.position.x = (Math.cos(this.config.windDirection * Math.PI / 180) >= 0 ? -1 : 1) * (x + rz * 0.7);
    }
    if (bounds) { leaf.position.x += bounds.centerX; leaf.position.y += bounds.centerY; }
    leaf.mass = 0.8 + this.random() * 0.4;
    leaf.drag = 0.8 + this.random() * 0.4;
    leaf.lift = 0.7 + this.random() * 0.6;
    leaf.phase = this.random() * Math.PI * 2;
    leaf.frequency = 5 + this.random() * 4;
    // Uniform unit quaternion, with no common starting orientation.
    const u = this.random(), a = this.random() * Math.PI * 2, b = this.random() * Math.PI * 2;
    leaf.rotation.set(Math.sqrt(1 - u) * Math.sin(a), Math.sqrt(1 - u) * Math.cos(a), Math.sqrt(u) * Math.sin(b), Math.sqrt(u) * Math.cos(b));
    leaf.angularVelocity.set(this.random() - 0.5, this.random() - 0.5, this.random() - 0.5);
    sampleWind(leaf.position, this.time, this.config, leaf.velocity).multiplyScalar(0.6);
    leaf.velocity.y -= 0.4;
  }

  update(delta: number, reducedMotion = false) {
    if (!this.config.running || !Number.isFinite(delta) || delta <= 0) return;
    // Fixed steps keep aerodynamic response independent of rendering frequency.
    // Time dilation slows both translation and rotation without changing stability.
    this.accumulator += Math.min(delta, 0.05) * (reducedMotion ? 0.08 : 1);
    while (this.accumulator + 1e-10 >= STEP) {
      this.step(STEP);
      this.accumulator -= STEP;
    }
  }

  private step(dt: number) {
    const c = this.config;
    this.time += dt;
    for (let i = 0; i < c.leafCount; i++) {
      const leaf = this.leaves[i];
      const bounds = leaf.population === null ? undefined : this.populationBounds.get(leaf.population);
      this.normal.set(0, 0, 1).applyQuaternion(leaf.rotation);
      sampleWind(leaf.position, this.time, c, this.air).sub(leaf.velocity);
      const speed = this.air.length();
      this.flow.copy(this.air).multiplyScalar(1 / Math.max(speed, 0.0001));
      const incidence = this.normal.dot(this.flow);
      // Projected area: edge-on leaves glide; broadside leaves brake strongly.
      const drag = c.drag * leaf.drag * (0.18 + 0.82 * Math.abs(incidence));
      const acceleration = Math.min(speed * drag / leaf.mass, 12);
      leaf.velocity.addScaledVector(this.air, acceleration * dt);
      // Lift is perpendicular to airflow and invariant when the leaf normal flips.
      this.liftDirection.copy(this.normal).addScaledVector(this.flow, -incidence);
      leaf.velocity.addScaledVector(this.liftDirection, Math.min(speed * speed, 36) * incidence * c.lift * leaf.lift / leaf.mass * dt);
      leaf.velocity.y -= c.gravity * dt;
      // A soft spring retains each depth band; no visible depth-triggered respawns.
      let centerZ = bounds ? (bounds.minZ + bounds.maxZ) / 2 : -1;
      const halfDepth = bounds ? (bounds.maxZ - bounds.minZ) / 2 : 1;
      // Independent, smooth near-camera excursions in the foreground pool.
      // No new particles, CPU events, readback, or teleporting across depth.
      if (bounds && bounds.minZ >= 4) {
        const pulse = Math.max(0, Math.min(1, (Math.sin(this.time * (0.13 + leaf.mass * 0.03) + leaf.phase) - 0.88) / 0.115));
        centerZ += halfDepth * 0.72 * pulse * pulse * (3 - 2 * pulse);
      }
      const displacement = (leaf.position.z - centerZ) / halfDepth;
      leaf.velocity.z += (-displacement * 0.8 - leaf.velocity.z * 0.6) * dt;
      leaf.velocity.clampLength(0, 9);
      leaf.position.addScaledVector(leaf.velocity, dt);
      if (bounds && (leaf.position.z < bounds.minZ || leaf.position.z > bounds.maxZ)) {
        leaf.position.z = Math.max(bounds.minZ, Math.min(bounds.maxZ, leaf.position.z));
        if ((leaf.position.z === bounds.minZ && leaf.velocity.z < 0)
          || (leaf.position.z === bounds.maxZ && leaf.velocity.z > 0)) leaf.velocity.z = 0;
      }

      // Aerodynamic alignment competes with asymmetric tumbling and edge flutter.
      // Damping permits brief settled attitudes between changes in local wind.
      this.torque.crossVectors(this.normal, this.flow).multiplyScalar(incidence * speed * 1.8);
      this.torque.x += c.tumble * speed * 0.35 * Math.sin(leaf.phase + this.time * 0.73);
      this.torque.y += c.tumble * speed * 0.28 * Math.cos(leaf.phase * 1.7 + this.time * 0.91);
      this.torque.z += c.tumble * speed * 0.22 * Math.sin(leaf.phase * 2.3 + this.time * 0.49);
      const flutter = c.flutter * speed * Math.sin(this.time * leaf.frequency + leaf.phase);
      this.torque.addScaledVector(this.flow, flutter);
      leaf.angularVelocity.addScaledVector(this.torque, dt / leaf.mass).multiplyScalar(Math.exp(-c.angularDamping * dt));
      leaf.angularVelocity.clampLength(0, 8);
      const angularSpeed = leaf.angularVelocity.length();
      if (angularSpeed > 1e-8) {
        this.torque.copy(leaf.angularVelocity).multiplyScalar(1 / angularSpeed);
        this.increment.setFromAxisAngle(this.torque, angularSpeed * dt);
        leaf.rotation.premultiply(this.increment).normalize();
      }
      const distance = bounds ? bounds.cameraZ - leaf.position.z : 0;
      const extentX = bounds ? distance * bounds.halfWidthPerDistance + bounds.margin : this.halfWidth;
      const extentY = bounds ? distance * bounds.halfHeightPerDistance + bounds.margin : this.halfHeight;
      if (Math.abs(leaf.position.x - (bounds?.centerX ?? 0)) > extentX + 1
        || Math.abs(leaf.position.y - (bounds?.centerY ?? 0)) > extentY + 1) {
        this.spawn(leaf, false);
        this.recycled++;
      }
    }
  }
}
