import assert from 'node:assert/strict';
import test from 'node:test';
import { sourceModule } from '../scripts/modules.mjs';

const { GestureWind, createGestureInput } = await sourceModule('interaction/GestureWind');
const { MotionSimulation, motionDefaults } = await sourceModule('simulation/MotionSimulation');
const advance = (wind, seconds, reduced = false) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) wind.update(1 / 120, reduced);
};
const magnitude = wind => Math.hypot(wind.velocity.x, wind.velocity.y);

test('speed controls strength, length controls lifetime, and viewport scaling preserves response', () => {
  const slow = new GestureWind(), fast = new GestureWind(), scaled = new GestureWind();
  slow.move(100, 0, 0.8, 800);
  fast.move(100, 0, 0.08, 800);
  scaled.move(50, 0, 0.08, 400);
  for (const wind of [slow, fast, scaled]) advance(wind, 0.1);
  assert.ok(fast.velocity.x > slow.velocity.x * 4);
  assert.deepEqual(scaled.velocity, fast.velocity);
  const short = new GestureWind(), long = new GestureWind();
  short.move(80, 0, 0.1, 800);
  long.move(640, 0, 0.8, 800);
  advance(short, 0.5); advance(long, 0.5);
  assert.ok(long.velocity.x > 1 && short.velocity.x < 0.02);
  advance(long, 3);
  assert.deepEqual(long.velocity, { x: 0, y: 0 });
});

test('curves turn the gust during a drag and repeated swirls stay bounded', () => {
  const wind = new GestureWind();
  wind.move(160, 0, 0.1, 800); advance(wind, 0.08);
  const initialX = wind.velocity.x;
  wind.move(0, -160, 0.1, 800); advance(wind, 0.08);
  assert.ok(wind.velocity.y > 2 && wind.velocity.x < initialX * 0.4);
  for (let step = 0; step < 3000; step++) {
    wind.move(Math.cos(step / 10) * 30, Math.sin(step / 10) * 30, 1 / 60, 400);
    wind.update(1 / 60);
    assert.ok(Number.isFinite(magnitude(wind)) && magnitude(wind) <= 6);
  }
  advance(wind, 4);
  assert.equal(magnitude(wind), 0);
});

test('stationary holds fade, reduced motion softens gusts, and invalid samples are ignored', () => {
  const regular = new GestureWind(), reduced = new GestureWind();
  for (const wind of [regular, reduced]) wind.move(-200, 100, 0.1, 800);
  advance(regular, 0.1); advance(reduced, 0.1, true);
  assert.ok(regular.velocity.x < 0 && regular.velocity.y < 0);
  assert.ok(Math.abs(magnitude(reduced) / magnitude(regular) - 0.2) < 1e-12);
  const original = { ...regular.velocity };
  regular.move(NaN, 0, 0.1, 800);
  regular.move(100, 0, 0, 800);
  regular.move(100, 0, 0.1, 0);
  regular.update(NaN);
  assert.deepEqual(regular.velocity, original);
  regular.move(0, 0, 0.1, 800);
  advance(regular, 4);
  assert.equal(magnitude(regular), 0);
  reduced.reset();
  assert.equal(magnitude(reduced), 0);
});

test('shared gesture air influences CPU leaf physics, respects pause, and clears on reset', () => {
  const config = { ...motionDefaults, windSpeed: 0, gustStrength: 0, turbulence: 0, gravity: 0, lift: 0 };
  const baseline = new MotionSimulation({ ...config }), stirred = new MotionSimulation({ ...config });
  stirred.gestureWind.set(-4, 3, 0);
  for (let step = 0; step < 60; step++) { baseline.update(1 / 120); stirred.update(1 / 120); }
  const a = baseline.leaves[0], b = stirred.leaves[0];
  assert.ok(b.position.x < a.position.x - 0.1 && b.position.y > a.position.y + 0.1);
  const paused = JSON.stringify(stirred.leaves);
  stirred.config.running = false;
  stirred.update(0.05);
  assert.equal(JSON.stringify(stirred.leaves), paused);
  stirred.reset();
  assert.equal(stirred.gestureWind.length(), 0);
});

// EventTarget keeps the actual input listeners/lifecycle under test without a DOM shim.
class Canvas extends EventTarget {
  clientWidth = 800;
  clientHeight = 600;
  captures = new Set();
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); }
}
const pointerEvent = (type, x, y, time, changes = {}) => {
  const event = new Event(type);
  for (const [key, value] of Object.entries({ clientX: x, clientY: y, timeStamp: time,
    pointerId: 1, isPrimary: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...changes })) {
    Object.defineProperty(event, key, { value });
  }
  return event;
};

test('captured drags exclude hover/secondary pointers, distinguish taps, and clean up cancellation', () => {
  const previousWindow = globalThis.window;
  globalThis.window = new EventTarget();
  try {
    const canvas = new Canvas(), wind = new GestureWind(), abort = new AbortController();
    let enabled = true;
    const input = createGestureInput(canvas, wind, abort.signal, () => enabled);
    const send = (type, x, y, time, changes) => canvas.dispatchEvent(pointerEvent(type, x, y, time, changes));
    send('pointermove', 200, 0, 10); advance(wind, 0.1);
    assert.equal(magnitude(wind), 0);
    send('pointerdown', 0, 0, 20, { button: 2 });
    assert.equal(canvas.captures.size, 0);
    send('pointerdown', 0, 0, 30);
    send('pointerup', 2, 1, 60);
    assert.equal(input.consumeClick(), false);
    assert.equal(canvas.captures.size, 0);
    send('pointerdown', 0, 0, 100);
    send('pointermove', 100, 0, 180, { pointerId: 2, isPrimary: false });
    advance(wind, 0.1); assert.equal(magnitude(wind), 0);
    send('pointermove', 100, 0, 200);
    send('pointerup', 120, 0, 220);
    advance(wind, 0.1);
    assert.ok(wind.velocity.x > 1);
    assert.equal(input.consumeClick(), true);
    assert.equal(input.consumeClick(), false);
    assert.equal(canvas.captures.size, 0);
    input.reset(); enabled = false;
    send('pointerdown', 0, 0, 300); send('pointermove', 200, 0, 400); send('pointerup', 200, 0, 410);
    advance(wind, 0.1); assert.equal(magnitude(wind), 0);
    assert.equal(input.consumeClick(), true, 'a drag while paused is still not a tap');
    enabled = true;
    send('pointerdown', 0, 0, 500); send('pointermove', 100, 0, 600);
    send('pointercancel', 100, 0, 610);
    assert.equal(canvas.captures.size, 0);
    assert.equal(input.consumeClick(), true);
    send('pointerdown', 0, 0, 700);
    abort.abort();
    assert.equal(canvas.captures.size, 0);
    assert.equal(magnitude(wind), 0);
    send('pointermove', 300, 0, 800); advance(wind, 0.1);
    assert.equal(magnitude(wind), 0);
  } finally { globalThis.window = previousWindow; }
});
