import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transformWithOxc } from 'vite';

async function compile(name) {
  let source = await readFile(new URL(`../src/quality/${name}.ts`, import.meta.url), 'utf8');
  if (name === 'QualityController') {
    for (const dependency of ['PerformanceMonitor', 'QualityPresets']) {
      source = source.replaceAll(`'./${dependency}'`, JSON.stringify(await compile(dependency)));
    }
  }
  const { code } = await transformWithOxc(source, `${name}.ts`);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const { QualityController } = await import(await compile('QualityController'));
const { PerformanceMonitor } = await import(await compile('PerformanceMonitor'));
const { qualityValues } = await import(await compile('QualityPresets'));
function run(controller, ms, seconds) {
  const transitions = [];
  for (let i = 0; i < Math.ceil(seconds * 1000 / ms); i++) {
    const level = controller.record(ms);
    if (level) transitions.push(level);
  }
  return transitions;
}

test('rolling frame intervals expire old pressure and reject lifecycle gaps', () => {
  const monitor = new PerformanceMonitor();
  for (let i = 0; i < 120; i++) monitor.record(1000 / 60);
  assert.ok(Math.abs(monitor.meanMs - 1000 / 60) < 1e-9);
  monitor.record(200);
  assert.ok(monitor.meanMs > 18);
  for (let i = 0; i < 240; i++) monitor.record(1000 / 120);
  assert.ok(Math.abs(monitor.meanMs - 1000 / 120) < 1e-9);
  for (const invalid of [NaN, Infinity, -1, 0, 2001]) assert.equal(monitor.record(invalid), false);
  monitor.reset();
  assert.equal(monitor.meanMs, 0);
});

test('sustained desktop/mobile load steps down, cooldown limits changes, recovery is slower', () => {
  for (const fps of [30, 60]) {
    const controller = new QualityController();
    controller.targetFps = fps;
    const slow = 1000 / fps * 1.5;
    assert.deepEqual(run(controller, slow, 2), []);
    assert.deepEqual(run(controller, slow, 5), ['Medium']);
    assert.deepEqual(run(controller, slow, 7), []);
    assert.deepEqual(run(controller, slow, 5), ['Low']);
    assert.deepEqual(run(controller, slow, 20), []);
    assert.deepEqual(run(controller, 1000 / fps, 8), []);
    assert.deepEqual(run(controller, 1000 / fps, 8), ['Medium']);
    assert.deepEqual(run(controller, 1000 / fps, 21), ['High']);
  }
});

test('isolated stalls and threshold jitter do not change quality', () => {
  const controller = new QualityController();
  run(controller, 1000 / 60, 5);
  controller.record(250);
  assert.deepEqual(run(controller, 1000 / 60, 8), []);
  for (let i = 0; i < 1000; i++) assert.equal(controller.record(i % 2 ? 23 : 18), undefined);
  assert.equal(controller.level, 'High');
});

test('fixed mode, resume warmup, and target changes discard stale history', () => {
  const controller = new QualityController();
  controller.setMode('Medium');
  assert.deepEqual(run(controller, 50, 60), []);
  assert.equal(controller.level, 'Medium');
  controller.setMode('Auto');
  run(controller, 50, 4);
  controller.reset();
  assert.deepEqual(run(controller, 50, 2), []);
  controller.record(5000);
  assert.equal(controller.monitor.meanMs, 0);
  assert.deepEqual(run(controller, 50, 2), []);
});

test('presets cap DPR and reduce both rendering resolution and the existing leaf budget', () => {
  for (const budget of [32, 100, 500]) {
    const high = qualityValues('High', budget), medium = qualityValues('Medium', budget), low = qualityValues('Low', budget);
    assert.equal(high.leafCount, budget);
    assert.ok(high.leafCount > medium.leafCount && medium.leafCount > low.leafCount);
    assert.ok(high.renderScale > medium.renderScale && medium.renderScale > low.renderScale);
    assert.ok(high.dprCap > medium.dprCap && medium.dprCap > low.dprCap);
    assert.ok(low.leafCount >= 20);
  }
});
