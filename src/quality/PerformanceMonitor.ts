/** Fixed storage; actual rAF intervals, independent of simulation delta clamping. */
export class PerformanceMonitor {
  private readonly samples = new Float64Array(240);
  private cursor = 0;
  private count = 0;
  private total = 0;
  meanMs = 0;

  reset() {
    this.cursor = this.count = this.total = this.meanMs = 0;
  }

  record(milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 1000) return false;
    // Approximately two seconds on 60/120 Hz displays, bounded at 240 samples.
    while (this.count > 0 && this.total >= 2000) {
      const oldest = (this.cursor - this.count + this.samples.length) % this.samples.length;
      this.total -= this.samples[oldest];
      this.count--;
    }
    if (this.count === this.samples.length) {
      this.total -= this.samples[this.cursor];
      this.count--;
    }
    this.samples[this.cursor] = milliseconds;
    this.cursor = (this.cursor + 1) % this.samples.length;
    this.count++;
    this.total += milliseconds;
    this.meanMs = this.total / this.count;
    return true;
  }
}
