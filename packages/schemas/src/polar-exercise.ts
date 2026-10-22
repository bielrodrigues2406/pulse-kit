/**
 * The fields this ecosystem reads from Polar AccessLink `GET /v3/exercises?samples=true&zones=true`,
 * stored by polar-drive-sync as `telemetry_1hz.json`. Checked against real files (Oct 2026):
 * snake_case at the top level, kebab-case only inside `training_load_pro`, zone index from 0.
 */

import { z } from 'zod';

export const POLAR_SAMPLE_TYPE = { heartRate: 0 } as const;

export const polarExerciseSchema = z.looseObject({
  id: z.union([z.string().min(1), z.number().int()]).transform(String),
  start_time: z.string(),
  start_time_utc_offset: z.number().int(),
  duration: z.string(),
  sport: z.string(),
  detailed_sport_info: z.string().nullish(),
  heart_rate: z.looseObject({ average: z.number().nullish(), maximum: z.number().nullish() }).nullish(),
  heart_rate_zones: z
    .array(
      z.looseObject({
        index: z.number().int(),
        lower_limit: z.number(),
        upper_limit: z.number(),
        in_zone: z.string(),
      }),
    )
    .nullish(),
  samples: z
    .array(
      z.looseObject({
        recording_rate: z.number().positive(),
        sample_type: z.coerce.number().int(),
        data: z.string(),
      }),
    )
    .nullish(),
  training_load_pro: z.record(z.string(), z.unknown()).nullish(),
});

export type PolarExercise = z.infer<typeof polarExerciseSchema>;
