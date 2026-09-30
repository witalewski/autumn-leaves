import { PerformanceMonitor } from './PerformanceMonitor';
import { qualityLevels, type QualityLevel, type QualityMode } from './QualityPresets';

/** Sustained pressure, asymmetric recovery, and cooldown prevent oscillation. */
export class QualityController {
  readonly monitor = new PerformanceMonitor();
  level: QualityLevel = 'High';
  mode: QualityMode = 'Auto';
  targetFps = 60;
  reason = 'Warming up';
  private age = 0;
  private cooldown = 0;
  private poorTime = 0;
  private goodTime = 0;

  reset() {
    this.monitor.reset();
    this.age = this.poorTime = this.goodTime = 0;
    this.cooldown = 0;
    this.reason = this.mode === 'Auto' ? 'Warming up' : 'Fixed preset';
  }

  setMode(mode: QualityMode) {
    this.mode = mode;
    if (mode !== 'Auto') this.level = mode;
    this.reset();
  }

  record(milliseconds: number): QualityLevel | undefined {
    if (!this.monitor.record(milliseconds)) { this.reset(); return; }
    if (this.mode !== 'Auto') return;
    const seconds = milliseconds / 1000;
    this.age += seconds;
    this.cooldown = Math.max(0, this.cooldown - seconds);
    if (this.age < 3 || this.cooldown > 0) return;
    const budget = 1000 / this.targetFps;
    const mean = this.monitor.meanMs;
    this.poorTime = mean > budget * 1.3 ? this.poorTime + seconds : 0;
    // Allow ordinary vsync intervals but require longer sustained recovery.
    this.goodTime = mean < budget * 1.05 ? this.goodTime + seconds : 0;
    const index = qualityLevels.indexOf(this.level);
    const next = this.poorTime >= 3 && index > 0 ? index - 1
      : this.goodTime >= 12 && index < qualityLevels.length - 1 ? index + 1 : index;
    if (next === index) {
      this.reason = this.level === 'Low' && this.poorTime >= 3 ? 'Minimum quality' : 'Monitoring';
      return;
    }
    this.level = qualityLevels[next];
    this.reason = next < index ? 'Sustained slow frames' : 'Sustained recovery';
    this.cooldown = 8;
    this.poorTime = this.goodTime = 0;
    this.monitor.reset();
    return this.level;
  }
}
