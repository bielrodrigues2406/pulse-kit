/** The parts of any FIT activity this ecosystem uses: 1 Hz heart rate and raw RR intervals. */

import { Decoder, Stream } from '@garmin/fitsdk';

const MS_PER_SECOND = 1000;

export interface SessionFitContents {
  readonly startTime: Date | null;
  /** One value per second from `startTime`; seconds without a record are null. */
  readonly heartRateBpm: readonly (number | null)[];
  /** Concatenated HRV messages; empty when the file has none (as in Polar Flow exports). */
  readonly rrMs: readonly number[];
  readonly sport: string | null;
}

export function readSessionFit(bytes: Uint8Array): SessionFitContents {
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  if (!decoder.checkIntegrity()) throw new RangeError('Not a FIT file or CRC mismatch');
  const { messages, errors } = decoder.read({ convertTypesToStrings: true, convertDateTimesToDates: true });
  const firstError = errors[0];
  if (firstError !== undefined) throw firstError;

  const records = messages.recordMesgs ?? [];
  const session = messages.sessionMesgs?.[0];
  const startTime = asDate(session?.startTime) ?? asDate(records[0]?.timestamp);

  const heartRateBpm: (number | null)[] = [];
  if (startTime !== null) {
    for (const record of records) {
      const timestamp = asDate(record.timestamp);
      if (timestamp === null || record.heartRate === undefined) continue;
      const second = Math.round((timestamp.getTime() - startTime.getTime()) / MS_PER_SECOND);
      if (second < 0) continue;
      while (heartRateBpm.length < second) heartRateBpm.push(null);
      heartRateBpm[second] = record.heartRate;
    }
  }

  const rrMs = (messages.hrvMesgs ?? []).flatMap((mesg) =>
    (mesg.time ?? []).filter((s) => Number.isFinite(s)).map((s) => Math.round(s * MS_PER_SECOND)),
  );
  return { startTime, heartRateBpm, rrMs, sport: session?.sport === undefined ? null : String(session.sport) };
}

function asDate(value: unknown): Date | null {
  return value instanceof Date ? value : null;
}
