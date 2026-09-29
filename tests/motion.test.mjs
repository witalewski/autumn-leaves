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
