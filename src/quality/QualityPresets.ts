export type QualityLevel = 'High' | 'Medium' | 'Low';
export type QualityMode = 'Auto' | QualityLevel;

// Counts scale the existing art-directed budget, rather than expanding the pool.
export const qualityPresets = {
  High: { renderScale: 1, dprCap: 1.75, leafRatio: 1 },
  Medium: { renderScale: 0.8, dprCap: 1.5, leafRatio: 0.7 },
  Low: { renderScale: 0.65, dprCap: 1.25, leafRatio: 0.4 },
} as const;
export const qualityLevels: QualityLevel[] = ['Low', 'Medium', 'High'];

export function qualityValues(level: QualityLevel, leafBudget: number) {
  const preset = qualityPresets[level];
  return { renderScale: preset.renderScale, dprCap: preset.dprCap,
    leafCount: Math.max(20, Math.round(leafBudget * preset.leafRatio)) };
}
