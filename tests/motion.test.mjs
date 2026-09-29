import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

// Exercise the actual TS module without adding a test framework or requiring
// Node's newer experimental TypeScript support.
const source = await readFile(new URL('../src/simulation/MotionSimulation.ts', import.meta.url), 'utf8');
const { code: compiled } = await transformWithOxc(
  source.replace("'three/webgpu'", JSON.stringify(import.meta.resolve('three/webgpu'))),
  'MotionSimulation.ts',
);
const { MotionSimulation, motionDefaults, sampleWind } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const make = (changes = {}) => new MotionSimulation({ ...motionDefaults, ...changes });
const state = (simulation) => JSON.stringify(simulation.leaves);
const advance = (simulation, seconds, rate = 60, reduced = false) => {
  for (let i = 0; i < seconds * rate; i++) simulation.update(1 / rate, reduced);
};

test('same seed, restart, and rendering cadence reproduce the simulation', () => {
  const a = make(), b = make();
  advance(a, 10, 30);
  advance(b, 10, 120);
  assert.equal(state(a), state(b));
  const expected = state(a);
  a.reset();
  advance(a, 10);
  assert.equal(state(a), expected);
  assert.notEqual(state(make({ seed: 42 })), state(make()));
});

test('pause, reduced motion, and suspension do not advance unexpectedly', () => {
  const a = make();
  const original = state(a);
  a.config.running = false;
  a.update(1);
  assert.equal(state(a), original);
  a.config.running = true;
  a.update(1000);
  assert.ok(a.time <= 0.05 + 1e-9);
  const b = make(), c = make();
  advance(b, 10, 60, true);
  advance(c, 0.8);
  assert.equal(state(b), state(c));
});

test('pool survives extended simulation and extreme exposed controls', () => {
  for (const config of [{}, { drag: 3, lift: 2, tumble: 3, flutter: 2, angularDamping: 0, windSpeed: 5, gustStrength: 5, turbulence: 2 }, { drag: 0, lift: 0, gravity: 4, windDirection: 180 }]) {
    const sim = make({ ...config, leafCount: 50 });
    const references = [...sim.leaves];
    advance(sim, 120);
    assert.ok(sim.recycled > 0);
    sim.leaves.forEach((leaf, index) => {
      assert.equal(leaf, references[index]);
      for (const value of [...leaf.position.toArray(), ...leaf.velocity.toArray(), ...leaf.rotation.toArray(), ...leaf.angularVelocity.toArray()]) assert.ok(Number.isFinite(value));
      assert.ok(Math.abs(leaf.rotation.length() - 1) < 1e-10);
      assert.ok(leaf.velocity.length() <= 9 + 1e-9);
    });
  }
});

test('gravity falls, drag responds to air, and angular damping removes spin', () => {
  const sim = make({ windSpeed: 0, gustStrength: 0, turbulence: 0, drag: 0, lift: 0, tumble: 0, flutter: 0 });
  const leaf = sim.leaves[0];
  leaf.position.set(0, 0, -1);
  leaf.velocity.set(0, 0, 0);
  leaf.angularVelocity.set(1, 0, 0);
  sim.config.gravity = 0;
  advance(sim, 0.5);
  assert.ok(leaf.angularVelocity.length() < 0.5);
  sim.config.gravity = 1.6;
  advance(sim, 0.5);
  assert.ok(leaf.position.y < 0);
  sim.config.windSpeed = 3;
  sim.config.drag = 1;
  advance(sim, 0.5);
  assert.ok(leaf.velocity.x > 0);
});

test('wind is spatially varying and continuous', () => {
  const sim = make();
  const p = sim.leaves[0].position.clone();
  const a = sampleWind(p, 1, sim.config, p.clone());
  const b = sampleWind(p, 1.0001, sim.config, p.clone());
  assert.ok(a.distanceTo(b) < 0.001);
  const c = sampleWind(p.clone().addScalar(2), 1, sim.config, p.clone());
  assert.ok(a.distanceTo(c) > 0.1);
});

const depthSource = await readFile(new URL('../src/simulation/DepthComposition.ts', import.meta.url), 'utf8');
const { code: depthCode } = await transformWithOxc(depthSource, 'DepthComposition.ts');
const { createPopulationConfigs, createPopulationBounds, halfWidthAtDepth, halfHeightAtDepth } =
  await import(`data:text/javascript;base64,${Buffer.from(depthCode).toString('base64')}`);
const camera = (aspect = 16 / 9) => ({ position: { x: 0, y: 0, z: 16 * Math.max(1, 0.65 / aspect) }, fov: 40, aspect, zoom: 1, near: 0.1, far: 200 });
const makeDepth = (changes = {}, aspect = 16 / 9) => {
  const populations = createPopulationConfigs(false);
  const bounds = new Map(populations.map(p => [p.id, createPopulationBounds(camera(aspect), p.depth)]));
  const sim = new MotionSimulation({ ...motionDefaults, leafCount: 100, ...changes }, 100, populations);
  sim.setPopulationBounds(bounds);
  sim.reset();
  return { sim, populations, bounds };
};

test('CPU populations preserve exact counts, mixed visible prefixes, and seeded replay', () => {
  const { sim, populations } = makeDepth();
  for (const population of populations) assert.equal(sim.leaves.filter(l => l.population === population.id).length, population.count);
  assert.equal(new Set(sim.leaves.slice(0, 20).map(l => l.population)).size, 3);
  const assignments = sim.leaves.map(l => l.population);
  advance(sim, 10, 30);
  const expected = state(sim);
  sim.reset();
  advance(sim, 10, 120);
  assert.equal(state(sim), expected);
  assert.deepEqual(sim.leaves.map(l => l.population), assignments);
});

test('CPU recycling respawns offscreen within the same depth band in either wind direction', () => {
  for (const windDirection of [0, 180]) {
    const { sim, bounds } = makeDepth({ windDirection });
    const references = [...sim.leaves];
    sim.leaves.forEach(leaf => { leaf.position.x = 1000; });
    sim.update(1 / 120);
    assert.equal(sim.recycled, 100);
    sim.leaves.forEach((leaf, i) => {
      assert.equal(leaf, references[i]);
      const b = bounds.get(leaf.population);
      assert.ok(leaf.position.z >= b.minZ && leaf.position.z <= b.maxZ);
      const x = halfWidthAtDepth(b, leaf.position.z), y = halfHeightAtDepth(b, leaf.position.z);
      const upstream = windDirection === 0 ? -x : x;
      assert.ok(Math.abs(leaf.position.x - upstream) < 1e-10 || Math.abs(leaf.position.y - y) < 1e-10);
    });
  }
});

test('CPU depth populations stay finite and bounded under extreme controls and resize', () => {
  const { sim, populations } = makeDepth({ drag: 3, lift: 2, tumble: 3, flutter: 2, angularDamping: 0, windSpeed: 5, gustStrength: 5, turbulence: 2 });
  const references = [...sim.leaves];
  for (const aspect of [16 / 9, 9 / 16]) {
    const bounds = new Map(populations.map(p => [p.id, createPopulationBounds(camera(aspect), p.depth)]));
    const beforeResize = state(sim);
    sim.setPopulationBounds(bounds);
    assert.equal(state(sim), beforeResize);
    for (let frame = 0; frame < 60 * 60; frame++) {
      sim.update(1 / 60);
      sim.leaves.forEach((leaf, i) => {
        const b = bounds.get(leaf.population);
        assert.equal(leaf, references[i]);
        assert.ok(leaf.position.z >= b.minZ && leaf.position.z <= b.maxZ);
        assert.ok(Math.abs(leaf.position.x) <= halfWidthAtDepth(b, leaf.position.z) + 1 + 1e-10);
        assert.ok(Math.abs(leaf.position.y) <= halfHeightAtDepth(b, leaf.position.z) + 1 + 1e-10);
        assert.ok([...leaf.position.toArray(), ...leaf.velocity.toArray(), ...leaf.rotation.toArray()].every(Number.isFinite));
        assert.ok(Math.abs(leaf.rotation.length() - 1) < 1e-10);
      });
    }
  }
  assert.ok(sim.recycled > 0);
});
