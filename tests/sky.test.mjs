import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Color, Vector3 } from 'three/webgpu';
import { transformWithOxc } from 'vite';

let source = await readFile(new URL('../src/sky.ts', import.meta.url), 'utf8');
for (const name of ['three/webgpu', 'three/tsl']) source = source.replaceAll(`'${name}'`, JSON.stringify(import.meta.resolve(name)));
const { code } = await transformWithOxc(source, 'sky.ts');
const { createSky } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const makeSky = (seed = 2409) => createSky(new Vector3(0, 0.2, -1).normalize(), new Color('#fff0d0'), seed);
const config = { running: true, windSpeed: 1.7, windDirection: 15 };

test('cloud motion is cadence-independent, pauses, slows for reduced motion, and resets', () => {
  const a = makeSky(), b = makeSky(), reduced = makeSky();
  try {
    for (let i = 0; i < 600; i++) a.update(1 / 60, false, config);
    for (let i = 0; i < 1200; i++) b.update(1 / 120, false, config);
    for (let i = 0; i < 600; i++) reduced.update(1 / 60, true, config);
    assert.ok(Math.abs(a.cloudTime.value - 10) < 1e-10);
    assert.ok(a.cloudOffset.value.distanceTo(b.cloudOffset.value) < 1e-10);
    assert.ok(Math.abs(reduced.cloudTime.value - a.cloudTime.value * 0.08) < 1e-10);
    assert.ok(reduced.cloudOffset.value.distanceTo(a.cloudOffset.value.clone().multiplyScalar(0.08)) < 1e-10);
    const offset = a.cloudOffset.value.clone(), time = a.cloudTime.value;
    a.update(1, false, { ...config, running: false });
    a.update(NaN, false, config);
    assert.equal(a.cloudTime.value, time);
    assert.deepEqual(a.cloudOffset.value, offset);
    a.reset();
    assert.equal(a.cloudTime.value, 0);
    assert.deepEqual(a.cloudOffset.value.toArray(), [0, 0, 0]);
    a.update(10, false, config);
    assert.equal(a.cloudTime.value, 0.05);
  } finally { a.dispose(); b.dispose(); reduced.dispose(); }
});

test('cloud drift follows wind changes continuously and evolution continues in still air', () => {
  const sky = makeSky();
  try {
    sky.update(0.05, false, { ...config, windDirection: 0 });
    assert.ok(sky.cloudOffset.value.x > 0);
    assert.equal(sky.cloudOffset.value.y, 0);
    const x = sky.cloudOffset.value.x;
    sky.update(0.05, false, { ...config, windDirection: 90 });
    assert.ok(Math.abs(sky.cloudOffset.value.x - x) < 1e-10);
    assert.ok(sky.cloudOffset.value.y > 0);
    const offset = sky.cloudOffset.value.clone(), time = sky.cloudTime.value;
    sky.update(0.05, false, { ...config, windSpeed: 0 });
    assert.deepEqual(sky.cloudOffset.value, offset);
    assert.ok(sky.cloudTime.value > time);
  } finally { sky.dispose(); }
});


test('cloud seed selects repeatable distinct noise domains and reset replays evolution', () => {
  const a = makeSky(42), b = makeSky(42), other = makeSky(43);
  try {
    assert.deepEqual(a.cloudSeedOffset.value, b.cloudSeedOffset.value);
    assert.notDeepEqual(a.cloudSeedOffset.value, other.cloudSeedOffset.value);
    const initial = a.cloudSeedOffset.value.clone();
    for (let i = 0; i < 600; i++) a.update(1 / 60, false, config);
    const offset = a.cloudOffset.value.clone(), time = a.cloudTime.value;
    a.reset();
    assert.deepEqual(a.cloudSeedOffset.value, initial);
    assert.equal(a.cloudTime.value, 0);
    for (let i = 0; i < 600; i++) a.update(1 / 60, false, config);
    assert.deepEqual(a.cloudOffset.value, offset);
    assert.equal(a.cloudTime.value, time);
    a.reset(43);
    assert.deepEqual(a.cloudSeedOffset.value, other.cloudSeedOffset.value);
    const domains = [];
    for (const seed of [0, 1, 42, 2409, 65535, 4294967295]) {
      a.reset(seed);
      const domain = a.cloudSeedOffset.value.toArray();
      assert.ok(domain.every(v => Number.isFinite(v) && v >= 0 && v < 128));
      domains.push(JSON.stringify(domain));
    }
    assert.equal(new Set(domains).size, domains.length);
  } finally { a.dispose(); b.dispose(); other.dispose(); }
});
