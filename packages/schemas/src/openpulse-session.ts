/**
 * Local session export of openPulse (Stage 2), version 1.
 *
 * Raw data is the source of truth: 1 Hz heart rate and every RR interval in the sensor's native
 * 1/1024 s ticks, so nothing is lost to rounding. `estimates` holds what openPulse computed live;
 * readers may recompute them from the raw data and must label them as estimates.
 */

import { z } from 'zod';

export const OPENPULSE_SESSION_SCHEMA = 'openpulse.session';
export const OPENPULSE_SESSION_VERSION = 1;

const timedValue = z.object({ tS: z.number().nonnegative(), value: z.number() });

export const openPulseSessionSchema = z.object({
  schema: z.literal(OPENPULSE_SESSION_SCHEMA),
  version: z.literal(OPENPULSE_SESSION_VERSION),
  /** ISO 8601 UTC instant of the first second. */
  startedAtUtc: z.iso.datetime({ offset: false }),
  /** IANA time zone of the recording device, for local-date grouping. */
  timeZone: z.string().min(1),
  app: z.object({ name: z.literal('openPulse'), version: z.string() }),
  sensor: z.object({ name: z.string(), model: z.string() }),
  activity: z.object({
    sport: z.enum(['cycling', 'running', 'rest', 'other']),
    indoor: z.boolean(),
    /** Why the recording exists: free training, a guided ramp, an orthostatic test. */
    protocol: z.enum(['free', 'ramp', 'orthostatic']),
  }),
  heartRate1Hz: z.object({
    /** One value per second from `startedAtUtc`; null where the strap reported no signal. */
    bpm: z.array(z.number().int().min(0).max(255).nullable()),
  }),
  rr: z.object({
    /** Every interval as received, rejected ones included, in 1/1024 s. */
    ticks1024: z.array(z.number().int().positive().max(65535)),
  }),
  estimates: z
    .object({
      dfaAlpha1: z.array(timedValue).optional(),
      rmssdMs: z.array(timedValue).optional(),
      respirationBrpm: z.array(timedValue).optional(),
      cadenceRpm: z.array(timedValue).optional(),
      swayRmsMg: z.array(timedValue).optional(),
    })
    .optional(),
  /** Protocol markers, for example ramp step changes or the moment of standing up. */
  markers: z.array(z.object({ tS: z.number().nonnegative(), label: z.string().min(1) })).optional(),
});

export type OpenPulseSession = z.infer<typeof openPulseSessionSchema>;

const MS_PER_SECOND = 1000;
const TICKS_PER_SECOND = 1024;

export function rrMsOfSession(session: OpenPulseSession): number[] {
  return session.rr.ticks1024.map((ticks) => (ticks / TICKS_PER_SECOND) * MS_PER_SECOND);
}
