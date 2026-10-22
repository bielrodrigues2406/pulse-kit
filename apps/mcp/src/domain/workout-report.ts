import { edwardsTrimp, heartRateDriftPct, quarterMeansBpm, signalGaps, type SignalGap } from '@pulse-kit/hrv';
import { POLAR_SAMPLE_TYPE, type PolarExercise } from '@pulse-kit/schemas';

const HR_VALID_MIN_BPM = 25;
const HR_VALID_MAX_BPM = 250;
/** Shorter dropouts are ordinary strap noise, not pauses. */
const MIN_REPORTED_GAP_S = 30;

export interface WorkoutReport {
  readonly id: string;
  readonly startTimeLocal: string;
  readonly sport: string;
  readonly detailedSport: string | null;
  readonly durationS: number | null;
  readonly heartRate: {
    readonly avgBpm: number | null;
    readonly maxBpm: number | null;
    readonly minBpm: number | null;
    readonly sampleIntervalS: number | null;
    readonly validRatio: number | null;
  };
  readonly quarterMeansBpm: readonly (number | null)[];
  readonly driftPct: number | null;
  readonly zones: readonly { readonly zone: number; readonly lowerBpm: number; readonly upperBpm: number; readonly seconds: number }[];
  readonly edwardsTrimp: number | null;
  readonly polarCardioLoad: number | null;
  readonly gaps: readonly SignalGap[];
}

export function parseIsoDurationS(iso: string): number | null {
  const m = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(iso);
  if (m === null || (m[1] === undefined && m[2] === undefined && m[3] === undefined)) return null;
  return Math.round(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0));
}

export function workoutReport(exercise: PolarExercise): WorkoutReport {
  const sample = exercise.samples?.find((s) => s.sample_type === POLAR_SAMPLE_TYPE.heartRate) ?? null;
  const intervalS = sample?.recording_rate ?? null;
  const hrBpm = (sample?.data.split(',') ?? []).map((raw) => {
    const bpm = Number(raw);
    return raw.trim() !== '' && bpm >= HR_VALID_MIN_BPM && bpm <= HR_VALID_MAX_BPM ? bpm : null;
  });
  const valid = hrBpm.filter((v): v is number => v !== null);

  const zones = [...(exercise.heart_rate_zones ?? [])]
    .sort((a, b) => a.index - b.index)
    .map((z) => ({ zone: z.index + 1, lowerBpm: z.lower_limit, upperBpm: z.upper_limit, seconds: parseIsoDurationS(z.in_zone) ?? 0 }));
  const cardioLoad = exercise.training_load_pro?.['cardio-load'];

  return {
    id: exercise.id,
    startTimeLocal: exercise.start_time,
    sport: exercise.sport,
    detailedSport: exercise.detailed_sport_info ?? null,
    durationS: parseIsoDurationS(exercise.duration),
    heartRate: {
      avgBpm: exercise.heart_rate?.average ?? null,
      maxBpm: exercise.heart_rate?.maximum ?? null,
      minBpm: valid.length === 0 ? null : Math.min(...valid),
      sampleIntervalS: intervalS,
      validRatio: hrBpm.length === 0 ? null : round(valid.length / hrBpm.length, 3),
    },
    quarterMeansBpm: quarterMeansBpm(hrBpm).map((v) => (v === null ? null : round(v, 1))),
    driftPct: intervalS === null ? null : roundOrNull(heartRateDriftPct(hrBpm, intervalS), 2),
    zones,
    edwardsTrimp: roundOrNull(edwardsTrimp(zones.map((z) => z.seconds)), 1),
    polarCardioLoad: typeof cardioLoad === 'number' ? cardioLoad : null,
    gaps: intervalS === null ? [] : signalGaps(hrBpm, intervalS, MIN_REPORTED_GAP_S),
  };
}

export function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function roundOrNull(value: number | null, digits: number): number | null {
  return value === null ? null : round(value, digits);
}
