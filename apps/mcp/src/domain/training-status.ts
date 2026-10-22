import { impactStatus, trainingLoadSeries, type ImpactStatus, type TrainingLoadDay } from '@pulse-kit/hrv';
import type { IndexWorkout } from '@pulse-kit/schemas';

export const LOAD_METRICS = ['banister_trimp', 'edwards_trimp', 'polar_cardio_load'] as const;
export type LoadMetric = (typeof LOAD_METRICS)[number];

export interface RecentWorkout {
  readonly id: string;
  readonly startTimeLocal: string | null;
  readonly sport: string | null;
  readonly durationS: number | null;
  readonly load: number | null;
  readonly impact: boolean;
}

export interface TrainingStatus {
  readonly date: string;
  readonly metric: LoadMetric;
  readonly today: TrainingLoadDay | null;
  readonly recentDays: readonly TrainingLoadDay[];
  /** Workouts within `recentDays`, newest first, so a caller can pick one by id. */
  readonly recentWorkouts: readonly RecentWorkout[];
  readonly impact: ImpactStatus;
  readonly workoutsCounted: number;
  /** Workouts in the index without a value for the chosen metric (no heart rate, for example). */
  readonly workoutsWithoutMetric: number;
}

export interface TrainingStatusOptions {
  readonly today: string;
  readonly metric: LoadMetric;
  readonly recentDays: number;
  readonly now: Date;
}

export function trainingStatus(workouts: readonly IndexWorkout[], options: TrainingStatusOptions): TrainingStatus {
  const loads: { date: string; load: number }[] = [];
  for (const workout of workouts) {
    const load = workout[options.metric];
    // start_time_local is the athlete's own wall clock, so its date is the training day.
    const date = workout.start_time_local?.slice(0, 10) ?? null;
    if (typeof load === 'number' && date !== null && date <= options.today) loads.push({ date, load });
  }

  const series = trainingLoadSeries(loads, { toDate: options.today });
  const impactSessions = workouts.flatMap((w) =>
    w.start_time_utc === null || w.duration_sec === null
      ? []
      : [{ startUtc: w.start_time_utc, durationS: w.duration_sec, recoveryHours: w.tibial_recovery_window_hours }],
  );

  const recentDays = series.slice(-options.recentDays);
  const firstRecentDate = recentDays[0]?.date ?? options.today;
  const recentWorkouts = workouts
    .filter((w) => {
      const date = w.start_time_local?.slice(0, 10) ?? null;
      return date !== null && date >= firstRecentDate && date <= options.today;
    })
    .sort((a, b) => (b.start_time_local ?? '').localeCompare(a.start_time_local ?? ''))
    .map((w) => ({
      id: w.id,
      startTimeLocal: w.start_time_local,
      sport: w.detailed_sport_info ?? w.sport,
      durationS: w.duration_sec,
      load: w[options.metric],
      impact: w.tibial_impact_category === 'HIGH_AXIAL_IMPACT',
    }));

  return {
    date: options.today,
    metric: options.metric,
    today: series.at(-1) ?? null,
    recentDays,
    recentWorkouts,
    impact: impactStatus(impactSessions, options.now),
    workoutsCounted: loads.length,
    workoutsWithoutMetric: workouts.length - loads.length,
  };
}

/** Calendar date in a time zone, YYYY-MM-DD. */
export function localDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
