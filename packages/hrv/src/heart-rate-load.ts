/**
 * Per-session load and drift from a heart-rate series sampled every `intervalS` seconds.
 * Lost samples are `null` so they keep their place in time without entering any mean.
 */

const SECONDS_PER_MINUTE = 60;

export type BanisterSex = 'male' | 'female';

const BANISTER_COEFFICIENTS: Readonly<Record<BanisterSex, { readonly a: number; readonly b: number }>> = {
  male: { a: 0.64, b: 1.92 },
  female: { a: 0.86, b: 1.67 },
};

export interface BanisterInput {
  readonly hrBpm: readonly (number | null)[];
  readonly intervalS: number;
  readonly restingHrBpm: number;
  readonly maxHrBpm: number;
  readonly sex: BanisterSex;
}

/** Banister (1991): sum of dt(min) * HRr * a * e^(b * HRr), HRr clamped to [0, 1]. */
export function banisterTrimp(input: BanisterInput): number | null {
  const { hrBpm, intervalS, restingHrBpm, maxHrBpm, sex } = input;
  if (!(maxHrBpm > restingHrBpm) || !(intervalS > 0)) return null;
  const { a, b } = BANISTER_COEFFICIENTS[sex];
  const dtMin = intervalS / SECONDS_PER_MINUTE;
  let total = 0;
  for (const bpm of hrBpm) {
    if (bpm === null) continue;
    const reserve = Math.max(0, Math.min(1, (bpm - restingHrBpm) / (maxHrBpm - restingHrBpm)));
    total += dtMin * reserve * a * Math.exp(b * reserve);
  }
  return total;
}

/** Edwards (1993): minutes in each of five zones times its weight 1..5. */
export function edwardsTrimp(secondsInZone: readonly number[]): number | null {
  if (secondsInZone.length === 0) return null;
  return secondsInZone.slice(0, 5).reduce((sum, seconds, zone) => sum + (seconds / SECONDS_PER_MINUTE) * (zone + 1), 0);
}

export interface DriftOptions {
  /** Warm-up excluded from the comparison; it inflates drift. */
  readonly warmupS: number;
  /** Below this analysed duration drift is not reported. */
  readonly minAnalyzedS: number;
}

export const DEFAULT_DRIFT_OPTIONS: DriftOptions = { warmupS: 600, minAnalyzedS: 1200 };

/**
 * Second half against first half after the warm-up, in percent. Heart rate only: without pace
 * or power it is interpretable only for a steady effort.
 */
export function heartRateDriftPct(
  hrBpm: readonly (number | null)[],
  intervalS: number,
  options: DriftOptions = DEFAULT_DRIFT_OPTIONS,
): number | null {
  if (!(intervalS > 0)) return null;
  const analyzed = hrBpm.slice(Math.ceil(options.warmupS / intervalS));
  if (analyzed.length * intervalS < options.minAnalyzedS) return null;
  const mid = Math.floor(analyzed.length / 2);
  const first = meanOf(analyzed.slice(0, mid));
  const second = meanOf(analyzed.slice(mid));
  if (first === null || second === null) return null;
  return ((second - first) / first) * 100;
}

/** Mean of each quarter of the time; the remainder joins the last quarter. */
export function quarterMeansBpm(hrBpm: readonly (number | null)[]): readonly (number | null)[] {
  if (hrBpm.length < 4) return [];
  const size = Math.floor(hrBpm.length / 4);
  return [0, 1, 2, 3].map((q) => meanOf(hrBpm.slice(q * size, q === 3 ? hrBpm.length : (q + 1) * size)));
}

export interface ZoneBounds {
  /** Lower bound of each zone, ascending; a sample belongs to the last zone whose bound it reaches. */
  readonly lowerBpm: readonly number[];
}

/** Seconds spent in each zone; samples below the first bound are not counted. */
export function secondsInZones(hrBpm: readonly (number | null)[], intervalS: number, zones: ZoneBounds): readonly number[] {
  const seconds = zones.lowerBpm.map(() => 0);
  for (const bpm of hrBpm) {
    if (bpm === null) continue;
    let zone = -1;
    zones.lowerBpm.forEach((lower, index) => {
      if (bpm >= lower) zone = index;
    });
    if (zone >= 0) seconds[zone] = (seconds[zone] ?? 0) + intervalS;
  }
  return seconds;
}

export interface SignalGap {
  readonly startS: number;
  readonly durationS: number;
}

/** Runs of lost samples at least `minGapS` long: pauses, strap off or dropouts. */
export function signalGaps(hrBpm: readonly (number | null)[], intervalS: number, minGapS: number): readonly SignalGap[] {
  const gaps: SignalGap[] = [];
  let runStart: number | null = null;
  const close = (endIndex: number): void => {
    if (runStart === null) return;
    const durationS = (endIndex - runStart) * intervalS;
    if (durationS >= minGapS) gaps.push({ startS: runStart * intervalS, durationS });
    runStart = null;
  };
  hrBpm.forEach((bpm, index) => {
    if (bpm === null) runStart ??= index;
    else close(index);
  });
  close(hrBpm.length);
  return gaps;
}

function meanOf(values: readonly (number | null)[]): number | null {
  let sum = 0;
  let count = 0;
  for (const v of values) {
    if (v === null) continue;
    sum += v;
    count++;
  }
  return count === 0 ? null : sum / count;
}
