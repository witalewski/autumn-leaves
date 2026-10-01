/** A small, shared air impulse; no particle work or gesture history is needed. */
export class GestureWind {
  readonly velocity = { x: 0, y: 0 };
  private targetX = 0;
  private targetY = 0;
  private path = 0;
  private remaining = 0;
  private duration = 0;

  begin() { this.path = 0; }

  move(dx: number, dy: number, seconds: number, viewportSize: number) {
    if (![dx, dy, seconds, viewportSize].every(Number.isFinite) || seconds <= 0 || viewportSize <= 0) return;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    this.path += distance / viewportSize;
    // Speed is measured in short viewport lengths per second, independent of DPR.
    // A soft cap keeps even a very fast flick within the scene's mellow range.
    const speed = distance / viewportSize / Math.max(seconds, 1 / 240);
    const strength = 6 * (1 - Math.exp(-speed / 1.15));
    const blend = this.remaining > 0 ? 1 - Math.exp(-seconds / 0.035) : 1;
    this.targetX += (dx / distance * strength - this.targetX) * blend;
    // Screen Y points down; world Y points up.
    this.targetY += (-dy / distance * strength - this.targetY) * blend;
    this.duration = Math.min(1.8, 0.18 + this.path * 1.25);
    this.remaining = this.duration;
  }

  update(seconds: number, reducedMotion = false) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.remaining = Math.max(0, this.remaining - seconds);
    const fraction = this.duration > 0 ? this.remaining / this.duration : 0;
    const envelope = fraction * fraction * (3 - 2 * fraction);
    const blend = 1 - Math.exp(-seconds / 0.06);
    const strength = envelope * (reducedMotion ? 0.2 : 1);
    this.velocity.x += (this.targetX * strength - this.velocity.x) * blend;
    this.velocity.y += (this.targetY * strength - this.velocity.y) * blend;
    if (this.remaining === 0 && Math.hypot(this.velocity.x, this.velocity.y) < 0.001) {
      this.velocity.x = this.velocity.y = this.targetX = this.targetY = 0;
    }
  }

  reset() {
    this.velocity.x = this.velocity.y = this.targetX = this.targetY = 0;
    this.path = this.remaining = this.duration = 0;
  }
}

/** Capture drags on the scene only; controls outside the canvas keep their input. */
export function createGestureInput(canvas: HTMLCanvasElement, wind: GestureWind, signal: AbortSignal, enabled: () => boolean) {
  let pointer: number | null = null;
  let x = 0, y = 0, time = 0, distance = 0;
  let dragged = false;
  const events = { signal };

  function finish() {
    const previous = pointer;
    pointer = null;
    if (previous !== null && canvas.hasPointerCapture(previous)) canvas.releasePointerCapture(previous);
  }

  function move(event: PointerEvent) {
    const dx = event.clientX - x, dy = event.clientY - y;
    const seconds = (event.timeStamp - time) / 1000;
    x = event.clientX; y = event.clientY; time = event.timeStamp;
    distance += Math.hypot(dx, dy);
    if (distance < 6) return; // Taps and tiny finger tremors remain taps.
    dragged = true;
    if (enabled()) wind.move(dx, dy, seconds, Math.min(canvas.clientWidth, canvas.clientHeight));
  }

  canvas.addEventListener('pointerdown', event => {
    if (pointer !== null || !event.isPrimary || event.button !== 0) return;
    pointer = event.pointerId;
    x = event.clientX; y = event.clientY; time = event.timeStamp;
    distance = 0; dragged = false;
    wind.begin();
    canvas.setPointerCapture(pointer);
  }, events);
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== pointer) return;
    if ((event.buttons & 1) === 0) { finish(); return; }
    // Preserve bends between rendered frames where the browser supplies them.
    const samples = event.getCoalescedEvents?.() ?? [];
    if (samples.length) { for (const sample of samples) move(sample); }
    else move(event);
  }, events);
  canvas.addEventListener('pointerup', event => {
    if (event.pointerId !== pointer) return;
    move(event);
    finish();
  }, events);
  canvas.addEventListener('pointercancel', event => {
    if (event.pointerId !== pointer) return;
    dragged = true;
    finish();
  }, events);
  canvas.addEventListener('lostpointercapture', event => {
    if (event.pointerId === pointer) { dragged = true; finish(); }
  }, events);

  function reset() { finish(); dragged = false; wind.reset(); }
  window.addEventListener('blur', reset, events);
  signal.addEventListener('abort', reset, { once: true });
  return {
    reset,
    consumeClick() {
      const consumed = dragged;
      dragged = false;
      return consumed;
    },
  };
}
