import { describe, expect, it } from 'vitest';

import { estimateRampThresholds, type Alpha1AtHeartRate } from './thresholds.js';

/** alpha-1 falling linearly from 1.25 at 120 bpm by 0.01 per bpm. */
const linearRamp = (fromBpm: number, toBpm: number): Alpha1AtHeartRate[] =>
  Array.from({ length: toBpm - fromBpm + 1 }, (_, i) => ({ hrBpm: fromBpm + i, alpha1: 1.25 - 0.01 * (fromBpm + i - 120) }));

describe('estimateRampThresholds', () => {
  it('reads VT1 at alpha-1 0.75 and VT2 at 0.50 from the regression', () => {
    const result = estimateRampThresholds(linearRamp(120, 200));
    expect(result?.vt1?.hrBpm).toBeCloseTo(170, 6);
    expect(result?.vt2?.hrBpm).toBeCloseTo(195, 6);
    expect(result?.vt1?.extrapolated).toBe(false);
    expect(result?.rSquared).toBeCloseTo(1, 10);
    expect(result?.slopePerBpm).toBeCloseTo(-0.01, 10);
  });

  it('marks a threshold beyond the heart rates reached as extrapolated', () => {
    const result = estimateRampThresholds(linearRamp(120, 180));
    expect(result?.vt1?.extrapolated).toBe(false);
    expect(result?.vt2?.extrapolated).toBe(true);
  });

  it('refuses a ramp too short, too flat or going the wrong way', () => {
    expect(estimateRampThresholds(linearRamp(120, 124))).toBeNull();
    expect(estimateRampThresholds(linearRamp(120, 130))).toBeNull();
    expect(estimateRampThresholds(linearRamp(120, 160).map((p) => ({ ...p, alpha1: 2 - p.alpha1 })))).toBeNull();
  });
});
