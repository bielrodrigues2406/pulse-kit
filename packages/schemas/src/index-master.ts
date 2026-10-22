/**
 * `<YYYY>/index_master_<YYYY>.json`, written by polar-drive-sync v2 (schema 2.x).
 * Objects are loose: a newer writer may add fields, and readers must keep working.
 */

import { z } from 'zod';

const nullableNumber = z.number().nullable();

export const indexWorkoutSchema = z.looseObject({
  id: z.string().min(1),
  start_time_local: z.string().nullable(),
  start_time_utc: z.string().nullable(),
  utc_offset_min: z.number().int().nullable(),
  sport: z.string().nullable(),
  detailed_sport_info: z.string().nullable(),
  device: z.string().nullable(),
  duration_sec: nullableNumber,
  distance_m: nullableNumber,
  calories_kcal: nullableNumber,
  hr_avg_bpm: nullableNumber,
  hr_max_bpm: nullableNumber,
  hr_min_bpm: nullableNumber,
  hr_sample_interval_sec: nullableNumber,
  hr_valid_ratio: nullableNumber,
  hr_quarters_avg_bpm: z.array(z.number().nullable()),
  hr_drift_pct: nullableNumber,
  polar_cardio_load: nullableNumber,
  polar_cardio_load_status: z.string().nullable(),
  banister_trimp: nullableNumber,
  edwards_trimp: nullableNumber,
  tibial_impact_category: z.enum(['HIGH_AXIAL_IMPACT', 'NON_IMPACT']),
  tibial_recovery_window_hours: z.number().nonnegative(),
  drive_folder_id: z.string().nullable().optional(),
});

export const indexMasterSchema = z.looseObject({
  schema_version: z.string().regex(/^2\.\d+\.\d+$/, 'expected index_master schema 2.x'),
  year: z.number().int(),
  updated_at: z.string(),
  params: z.looseObject({ algorithm_version: z.string() }),
  total_workouts: z.number().int().nonnegative(),
  workouts: z.array(indexWorkoutSchema),
});

export type IndexWorkout = z.infer<typeof indexWorkoutSchema>;
export type IndexMaster = z.infer<typeof indexMasterSchema>;
