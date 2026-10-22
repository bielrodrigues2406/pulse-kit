/**
 * RR interval artifact gate and time-domain HRV.
 * A beat is rejected if outside [250, 2000] ms or deviating >20% from the median of the
 * last 5 accepted beats. Rejected beats are kept (flagged) so artifact rate is observable.
 *
 * After a sustained step (standing up, or signal back after a dropout at a different heart
 * rate) every new beat would deviate from the stale median and the gate would never accept
 * again. So 5 consecutive in-range rejections that agree with each other become the new
 * reference; they stay rejected, and the beats after them are judged against them.
 */

export interface RrBeat {
  /** Cumulative time of the beat, ms since session start. */
  readonly tMs: number;
  readonly rrMs: number;
  readonly accepted: boolean;
}

export const RR_MIN_MS = 250;
export const RR_MAX_MS = 2000;
export const RR_MAX_RELATIVE_DEVIATION = 0.2;
const MEDIAN_WINDOW = 5;
const MS_PER_MINUTE = 60_000;

export function classifyRr(rrMs: number, recentAccepted: readonly number[]): boolean {
  if (!(rrMs >= RR_MIN_MS && rrMs <= RR_MAX_MS)) return false;
  if (recentAccepted.length < MEDIAN_WINDOW) return true;
  const ref = median(recentAccepted.slice(-MEDIAN_WINDOW));
  return Math.abs(rrMs - ref) / ref <= RR_MAX_RELATIVE_DEVIATION;
}

export class RrSeries {
  private readonly beats: RrBeat[] = [];
  private acceptedTail: number[] = [];
  private rejectedRun: number[] = [];
  private clockMs = 0;

  push(rrMs: number): RrBeat {
    const accepted = classifyRr(rrMs, this.acceptedTail);
    this.clockMs += rrMs;
    const beat: RrBeat = { tMs: this.clockMs, rrMs, accepted };
    this.beats.push(beat);
    if (accepted) {
      this.acceptedTail.push(rrMs);
      if (this.acceptedTail.length > MEDIAN_WINDOW) this.acceptedTail.shift();
      this.rejectedRun = [];
    } else if (rrMs >= RR_MIN_MS && rrMs <= RR_MAX_MS) {
      this.rejectedRun.push(rrMs);
      if (this.rejectedRun.length > MEDIAN_WINDOW) this.rejectedRun.shift();
      if (this.rejectedRun.length === MEDIAN_WINDOW && isSelfConsistent(this.rejectedRun)) {
        this.acceptedTail = this.rejectedRun;
        this.rejectedRun = [];
      }
    } else {
      this.rejectedRun = [];
    }
    return beat;
  }

  all(): readonly RrBeat[] {
    return this.beats;
  }

  window(durationMs: number): readonly RrBeat[] {
    return beatsInWindow(this.beats, this.clockMs, durationMs);
  }
}

/** Classifies a whole recording at once, with the same gate as {@link RrSeries}. */
export function classifyRrSeries(rrMs: readonly number[]): readonly RrBeat[] {
  const series = new RrSeries();
  for (const value of rrMs) series.push(value);
  return series.all();
}

/** Beats whose time falls in (endMs - durationMs, endMs]. `beats` must be sorted by time. */
export function beatsInWindow(beats: readonly RrBeat[], endMs: number, durationMs: number): readonly RrBeat[] {
  const from = endMs - durationMs;
  let start = beats.length;
  while (start > 0 && (beats[start - 1]?.tMs ?? -Infinity) > from) start--;
  let end = start;
  while (end < beats.length && (beats[end]?.tMs ?? Infinity) <= endMs) end++;
  return beats.slice(start, end);
}

/** RMSSD over successive pairs where both beats were accepted. null if <2 valid pairs. */
export function rmssd(beats: readonly RrBeat[]): number | null {
  let sum = 0;
  let n = 0;
  for (let i = 1; i < beats.length; i++) {
    const a = beats[i - 1];
    const b = beats[i];
    if (a === undefined || b === undefined || !a.accepted || !b.accepted) continue;
    const d = b.rrMs - a.rrMs;
    sum += d * d;
    n++;
  }
  return n < 2 ? null : Math.sqrt(sum / n);
}

/** Fraction of rejected beats, 0..1. null for an empty window. */
export function artifactRate(beats: readonly RrBeat[]): number | null {
  if (beats.length === 0) return null;
  return beats.filter((b) => !b.accepted).length / beats.length;
}

/** Mean heart rate implied by the accepted intervals. */
export function meanHeartRateBpm(beats: readonly RrBeat[]): number | null {
  const accepted = beats.filter((b) => b.accepted);
  if (accepted.length === 0) return null;
  const meanRrMs = accepted.reduce((sum, b) => sum + b.rrMs, 0) / accepted.length;
  return MS_PER_MINUTE / meanRrMs;
}

function isSelfConsistent(values: readonly number[]): boolean {
  const ref = median(values);
  return values.every((v) => Math.abs(v - ref) / ref <= RR_MAX_RELATIVE_DEVIATION);
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  const upper = s[mid] ?? 0;
  return s.length % 2 ? upper : ((s[mid - 1] ?? upper) + upper) / 2;
}
