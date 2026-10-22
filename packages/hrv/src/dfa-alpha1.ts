/**
 * Short-term detrended fluctuation analysis exponent (DFA alpha-1), Peng et al. (1995),
 * over box sizes of 4 to 16 beats as in Kubios and in the exercise-threshold literature
 * (Rogers et al., 2021).
 *
 * Boxes are non-overlapping and start at the first beat; the tail that does not fill a box is
 * dropped. No global smoothness-priors detrending is applied, unlike Kubios defaults; at box
 * sizes of 4 to 16 beats the difference is small and physio-lab tracks it against NeuroKit2.
 */

import { artifactRate, beatsInWindow, meanHeartRateBpm, type RrBeat } from './rr-quality.js';

export const DFA_MIN_BOX_BEATS = 4;
export const DFA_MAX_BOX_BEATS = 16;
/** Below two of the largest boxes there is no fluctuation estimate at that scale. */
const MIN_SERIES_BEATS = 2 * DFA_MAX_BOX_BEATS;

/**
 * Alpha-1 of an artifact-free RR series (ms). Returns null when the series is too short or
 * has no fluctuation at some scale (for example a constant or perfectly linear series).
 */
export function dfaAlpha1(rrMs: readonly number[]): number | null {
  const n = rrMs.length;
  if (n < MIN_SERIES_BEATS) return null;

  const meanRr = rrMs.reduce((sum, v) => sum + v, 0) / n;
  const profile = new Float64Array(n);
  let running = 0;
  for (let i = 0; i < n; i++) {
    running += (rrMs[i] ?? meanRr) - meanRr;
    profile[i] = running;
  }

  const logScale: number[] = [];
  const logFluctuation: number[] = [];
  for (let box = DFA_MIN_BOX_BEATS; box <= DFA_MAX_BOX_BEATS; box++) {
    const fluctuation = fluctuationAtScale(profile, box);
    if (fluctuation <= 0) return null;
    logScale.push(Math.log10(box));
    logFluctuation.push(Math.log10(fluctuation));
  }
  return olsSlope(logScale, logFluctuation);
}

/** Root mean square of the residuals of a per-box least-squares line. */
function fluctuationAtScale(profile: Float64Array, box: number): number {
  const boxes = Math.floor(profile.length / box);
  // x = 0..box-1, so its mean and sum of squares are closed-form.
  const xMean = (box - 1) / 2;
  const sxx = (box * (box * box - 1)) / 12;
  let squaredResiduals = 0;
  for (let b = 0; b < boxes; b++) {
    const start = b * box;
    let yMean = 0;
    for (let i = 0; i < box; i++) yMean += profile[start + i] ?? 0;
    yMean /= box;
    let sxy = 0;
    for (let i = 0; i < box; i++) sxy += (i - xMean) * ((profile[start + i] ?? 0) - yMean);
    const slope = sxy / sxx;
    for (let i = 0; i < box; i++) {
      const residual = (profile[start + i] ?? 0) - (yMean + slope * (i - xMean));
      squaredResiduals += residual * residual;
    }
  }
  return Math.sqrt(squaredResiduals / (boxes * box));
}

export function olsSlope(x: readonly number[], y: readonly number[]): number {
  const n = x.length;
  const xMean = x.reduce((s, v) => s + v, 0) / n;
  const yMean = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = (x[i] ?? xMean) - xMean;
    sxy += dx * ((y[i] ?? yMean) - yMean);
    sxx += dx * dx;
  }
  return sxy / sxx;
}

export interface DfaWindowOptions {
  /** Minimum accepted beats in the window. */
  readonly minAcceptedBeats: number;
  /** Above this artifact rate the window is not scored. */
  readonly maxArtifactRate: number;
  /** Between this rate and the maximum the result is flagged as low confidence. */
  readonly lowConfidenceArtifactRate: number;
}

/**
 * Defaults for a 2-minute window. Rogers et al. (2021) found alpha-1 biased once artifacts pass
 * about 3%, so 3-5% is scored but flagged.
 */
export const DEFAULT_DFA_WINDOW_OPTIONS: DfaWindowOptions = {
  minAcceptedBeats: 90,
  maxArtifactRate: 0.05,
  lowConfidenceArtifactRate: 0.03,
};

export interface DfaWindowResult {
  readonly alpha1: number;
  readonly acceptedBeats: number;
  readonly artifactRate: number;
  readonly lowConfidence: boolean;
}

/** Alpha-1 of one window of classified beats; rejected beats are dropped, not interpolated. */
export function dfaAlpha1Window(
  beats: readonly RrBeat[],
  options: DfaWindowOptions = DEFAULT_DFA_WINDOW_OPTIONS,
): DfaWindowResult | null {
  const rate = artifactRate(beats);
  if (rate === null || rate > options.maxArtifactRate) return null;
  const accepted = beats.filter((b) => b.accepted).map((b) => b.rrMs);
  if (accepted.length < options.minAcceptedBeats) return null;
  const alpha1 = dfaAlpha1(accepted);
  if (alpha1 === null) return null;
  return {
    alpha1,
    acceptedBeats: accepted.length,
    artifactRate: rate,
    lowConfidence: rate > options.lowConfidenceArtifactRate,
  };
}

export interface DfaSeriesPoint extends DfaWindowResult {
  /** End of the window, ms since the first beat's start. */
  readonly tMs: number;
  readonly hrBpm: number;
}

export interface DfaSeriesOptions extends DfaWindowOptions {
  readonly windowMs: number;
  readonly stepMs: number;
}

export const DEFAULT_DFA_SERIES_OPTIONS: DfaSeriesOptions = {
  ...DEFAULT_DFA_WINDOW_OPTIONS,
  windowMs: 120_000,
  stepMs: 5_000,
};

/** Sliding alpha-1 over a whole recording; windows that cannot be scored are skipped. */
export function dfaAlpha1Series(
  beats: readonly RrBeat[],
  options: DfaSeriesOptions = DEFAULT_DFA_SERIES_OPTIONS,
): readonly DfaSeriesPoint[] {
  const last = beats.at(-1);
  if (last === undefined) return [];
  const points: DfaSeriesPoint[] = [];
  for (let endMs = options.windowMs; endMs <= last.tMs; endMs += options.stepMs) {
    const window = beatsInWindow(beats, endMs, options.windowMs);
    const result = dfaAlpha1Window(window, options);
    const hrBpm = meanHeartRateBpm(window);
    if (result !== null && hrBpm !== null) points.push({ ...result, tMs: endMs, hrBpm });
  }
  return points;
}
