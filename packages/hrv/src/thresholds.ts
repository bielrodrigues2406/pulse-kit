/**
 * Ventilatory thresholds from DFA alpha-1 during an incremental test.
 * Rogers et al. (2021) placed VT1 near alpha-1 = 0.75 and VT2 near 0.50, and read the heart
 * rate at those values from a linear regression of alpha-1 on heart rate across the ramp.
 * These are estimates: individual offsets of several beats per minute are common.
 */

import { olsSlope } from './dfa-alpha1.js';

export const VT1_ALPHA1 = 0.75;
export const VT2_ALPHA1 = 0.5;

const MIN_POINTS = 6;
const MIN_HR_SPAN_BPM = 15;

export interface Alpha1AtHeartRate {
  readonly hrBpm: number;
  readonly alpha1: number;
}

export interface ThresholdHeartRate {
  readonly hrBpm: number;
  /** True when the threshold lies outside the heart rates actually reached in the test. */
  readonly extrapolated: boolean;
}

export interface RampThresholds {
  readonly vt1: ThresholdHeartRate | null;
  readonly vt2: ThresholdHeartRate | null;
  readonly slopePerBpm: number;
  readonly rSquared: number;
  readonly pointCount: number;
}

/**
 * Null when the ramp cannot support a regression: too few points, too small a heart-rate span,
 * or alpha-1 not falling as heart rate rises.
 */
export function estimateRampThresholds(points: readonly Alpha1AtHeartRate[]): RampThresholds | null {
  if (points.length < MIN_POINTS) return null;
  const hr = points.map((p) => p.hrBpm);
  const alpha = points.map((p) => p.alpha1);
  const minHr = Math.min(...hr);
  const maxHr = Math.max(...hr);
  if (maxHr - minHr < MIN_HR_SPAN_BPM) return null;

  const slope = olsSlope(hr, alpha);
  if (!(slope < 0)) return null;
  const hrMean = hr.reduce((s, v) => s + v, 0) / hr.length;
  const alphaMean = alpha.reduce((s, v) => s + v, 0) / alpha.length;
  const intercept = alphaMean - slope * hrMean;

  let ssRes = 0;
  let ssTot = 0;
  for (const p of points) {
    const predicted = intercept + slope * p.hrBpm;
    ssRes += (p.alpha1 - predicted) ** 2;
    ssTot += (p.alpha1 - alphaMean) ** 2;
  }

  const at = (target: number): ThresholdHeartRate => {
    const hrBpm = (target - intercept) / slope;
    return { hrBpm, extrapolated: hrBpm < minHr || hrBpm > maxHr };
  };

  return {
    vt1: at(VT1_ALPHA1),
    vt2: at(VT2_ALPHA1),
    slopePerBpm: slope,
    rSquared: ssTot === 0 ? 0 : 1 - ssRes / ssTot,
    pointCount: points.length,
  };
}
