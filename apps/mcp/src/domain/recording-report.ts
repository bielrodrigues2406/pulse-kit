import {
  VT1_ALPHA1,
  VT2_ALPHA1,
  artifactRate,
  beatsInWindow,
  classifyRrSeries,
  dfaAlpha1Series,
  estimateRampThresholds,
  rmssd,
  type RampThresholds,
} from '@pulse-kit/hrv';

import { round, roundOrNull } from './workout-report.js';

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;
/** One alpha-1 point per minute keeps the answer readable; the full series is every 5 s. */
const SUMMARY_STEP_MS = 60_000;
const ORTHOSTATIC = { supineFromS: -120, supineToS: -10, standingFromS: 60, standingToS: 180 } as const;

export type RecordingProtocol = 'free' | 'ramp' | 'orthostatic';

export interface RecordingInput {
  readonly source: 'openpulse' | 'fit';
  readonly startTime: Date | null;
  readonly heartRateBpm: readonly (number | null)[];
  readonly rrMs: readonly number[];
  readonly protocol: RecordingProtocol;
  readonly markers: readonly { readonly tS: number; readonly label: string }[];
}

export interface RecordingReport {
  readonly source: RecordingInput['source'];
  readonly protocol: RecordingProtocol;
  readonly startTime: string | null;
  readonly durationS: number;
  readonly beats: number;
  readonly artifactPct: number | null;
  readonly rmssdMs: number | null;
  readonly alpha1: {
    readonly scoredWindows: number;
    readonly lowConfidenceWindows: number;
    readonly minutesAboveVt1: number;
    readonly minutesBetweenVt1AndVt2: number;
    readonly minutesBelowVt2: number;
    readonly perMinute: readonly { readonly minute: number; readonly alpha1: number; readonly hrBpm: number }[];
  };
  /** Only for ramp recordings; estimates, not lab thresholds. */
  readonly rampThresholds: RampThresholds | null;
  /** Only for orthostatic recordings with a "stand" marker. */
  readonly orthostatic: { readonly supineRmssdMs: number | null; readonly standingRmssdMs: number | null; readonly dropPct: number | null } | null;
  readonly notes: readonly string[];
}

export function recordingReport(input: RecordingInput): RecordingReport {
  const beats = classifyRrSeries(input.rrMs);
  const points = dfaAlpha1Series(beats);
  const stepMinutes = 5 / 60;
  const count = (predicate: (alpha: number) => boolean): number =>
    round(points.filter((p) => predicate(p.alpha1)).length * stepMinutes, 1);

  const perMinute = points
    .filter((p) => p.tMs % SUMMARY_STEP_MS === 0)
    .map((p) => ({ minute: p.tMs / MS_PER_MINUTE, alpha1: round(p.alpha1, 3), hrBpm: round(p.hrBpm, 1) }));

  const notes: string[] = [];
  if (input.rrMs.length === 0) notes.push('O arquivo nao tem intervalos R-R: sem DFA alpha-1 nem RMSSD.');
  if (points.length === 0 && input.rrMs.length > 0) notes.push('Nenhuma janela de 2 min teve batimentos suficientes com ate 5% de artefatos.');
  if (points.some((p) => p.lowConfidence)) notes.push('Ha janelas com 3-5% de artefatos: alpha-1 com confianca reduzida.');

  const rampThresholds =
    input.protocol === 'ramp' ? estimateRampThresholds(points.map((p) => ({ hrBpm: p.hrBpm, alpha1: p.alpha1 }))) : null;
  if (input.protocol === 'ramp' && rampThresholds === null) notes.push('A rampa nao sustentou a regressao (poucos pontos, faixa de FC curta ou alpha-1 sem queda).');

  return {
    source: input.source,
    protocol: input.protocol,
    startTime: input.startTime?.toISOString() ?? null,
    durationS: Math.max(input.heartRateBpm.length, Math.round((beats.at(-1)?.tMs ?? 0) / MS_PER_SECOND)),
    beats: beats.length,
    artifactPct: roundOrNull(mapNull(artifactRate(beats), (r) => r * 100), 2),
    rmssdMs: roundOrNull(rmssd(beats), 1),
    alpha1: {
      scoredWindows: points.length,
      lowConfidenceWindows: points.filter((p) => p.lowConfidence).length,
      minutesAboveVt1: count((a) => a >= VT1_ALPHA1),
      minutesBetweenVt1AndVt2: count((a) => a < VT1_ALPHA1 && a >= VT2_ALPHA1),
      minutesBelowVt2: count((a) => a < VT2_ALPHA1),
      perMinute,
    },
    rampThresholds,
    orthostatic: input.protocol === 'orthostatic' ? orthostaticDrop(input, beats) : null,
    notes,
  };
}

function orthostaticDrop(input: RecordingInput, beats: ReturnType<typeof classifyRrSeries>): RecordingReport['orthostatic'] {
  const stand = input.markers.find((m) => /stand|levant|em pe/i.test(m.label));
  if (stand === undefined) return { supineRmssdMs: null, standingRmssdMs: null, dropPct: null };
  const windowRmssd = (fromS: number, toS: number): number | null =>
    rmssd(beatsInWindow(beats, (stand.tS + toS) * MS_PER_SECOND, (toS - fromS) * MS_PER_SECOND));
  const supine = windowRmssd(ORTHOSTATIC.supineFromS, ORTHOSTATIC.supineToS);
  const standing = windowRmssd(ORTHOSTATIC.standingFromS, ORTHOSTATIC.standingToS);
  return {
    supineRmssdMs: roundOrNull(supine, 1),
    standingRmssdMs: roundOrNull(standing, 1),
    dropPct: supine === null || standing === null ? null : round(((supine - standing) / supine) * 100, 1),
  };
}

function mapNull<T, U>(value: T | null, map: (v: T) => U): U | null {
  return value === null ? null : map(value);
}
