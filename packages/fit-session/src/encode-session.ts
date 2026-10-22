/**
 * FIT activity file for one continuous session: 1 Hz records plus every beat-to-beat interval
 * in HRV messages (global message 78), which consumer apps such as Polar Flow drop on export.
 * Intervals.icu and Kubios read message 78 and can compute DFA alpha-1 from it.
 */

import {
  Encoder,
  Profile,
  type ActivityMesg,
  type EventMesg,
  type FileIdMesg,
  type HrvMesg,
  type LapMesg,
  type RecordMesg,
  type SessionMesg,
} from '@garmin/fitsdk';

/** HRV `time` is an array; devices write up to five intervals per message. */
const RR_PER_HRV_MESG = 5;
const MS_PER_SECOND = 1000;
const MAX_UINT8 = 255;
/** FIT stores HRV time as uint16 milliseconds; 0xFFFF is the invalid marker. */
const MAX_RR_MS = 65_534;

function mesgNum(name: string): number {
  const num = Profile.MesgNum[name];
  if (num === undefined) throw new Error(`FIT profile has no message ${name}`);
  return num;
}

const MESG = {
  fileId: mesgNum('FILE_ID'),
  event: mesgNum('EVENT'),
  record: mesgNum('RECORD'),
  hrv: mesgNum('HRV'),
  lap: mesgNum('LAP'),
  session: mesgNum('SESSION'),
  activity: mesgNum('ACTIVITY'),
} as const;

export type SessionSport = 'cycling' | 'running' | 'training' | 'generic';
export type SessionSubSport = 'indoorCycling' | 'treadmill' | 'generic';

export interface SessionFitInput {
  readonly startTime: Date;
  readonly sport: SessionSport;
  readonly subSport: SessionSubSport;
  /** One value per second from `startTime`; null where the strap had no signal. */
  readonly heartRateBpm: readonly (number | null)[];
  /** Optional, same timing as `heartRateBpm`. */
  readonly cadenceRpm?: readonly (number | null)[];
  /** Every beat as received, in ms, rejected ones included: readers apply their own gate. */
  readonly rrMs: readonly number[];
  readonly productName: string;
  readonly serialNumber: number;
}

export function encodeSessionFit(input: SessionFitInput): Uint8Array {
  const durationS = input.heartRateBpm.length;
  if (durationS === 0) throw new RangeError('A session needs at least one second of heart rate');
  if (input.cadenceRpm !== undefined && input.cadenceRpm.length !== durationS) {
    throw new RangeError('cadenceRpm must have one value per heart-rate second');
  }
  for (const rr of input.rrMs) {
    if (!(rr > 0 && rr <= MAX_RR_MS)) throw new RangeError(`RR interval out of FIT range: ${String(rr)} ms`);
  }

  const start = input.startTime.getTime();
  const at = (seconds: number): Date => new Date(start + seconds * MS_PER_SECOND);
  const end = at(durationS);
  const encoder = new Encoder();

  const fileId: FileIdMesg = {
    type: 'activity',
    manufacturer: 'development',
    product: 0,
    productName: input.productName,
    serialNumber: input.serialNumber,
    timeCreated: input.startTime,
  };
  encoder.onMesg(MESG.fileId, fileId);
  const timerStart: EventMesg = { timestamp: input.startTime, event: 'timer', eventType: 'start' };
  encoder.onMesg(MESG.event, timerStart);

  // Beats are interleaved after the record of the second in which they ended, as devices do.
  let beatIndex = 0;
  let beatEndMs = 0;
  let pending: number[] = [];
  const flush = (all: boolean): void => {
    while (pending.length >= RR_PER_HRV_MESG || (all && pending.length > 0)) {
      const hrv: HrvMesg = { time: pending.slice(0, RR_PER_HRV_MESG).map((ms) => ms / MS_PER_SECOND) };
      pending = pending.slice(RR_PER_HRV_MESG);
      encoder.onMesg(MESG.hrv, hrv);
    }
  };

  for (let second = 0; second < durationS; second++) {
    const heartRate = input.heartRateBpm[second] ?? null;
    const cadence = input.cadenceRpm?.[second] ?? null;
    const record: RecordMesg = {
      timestamp: at(second),
      ...(heartRate === null ? {} : { heartRate: clampUint8(heartRate) }),
      ...(cadence === null ? {} : { cadence: clampUint8(cadence) }),
    };
    encoder.onMesg(MESG.record, record);
    const secondEndMs = (second + 1) * MS_PER_SECOND;
    while (beatIndex < input.rrMs.length) {
      const rr = input.rrMs[beatIndex] ?? 0;
      if (beatEndMs + rr > secondEndMs) break;
      beatEndMs += rr;
      pending.push(rr);
      beatIndex++;
    }
    flush(false);
  }
  pending.push(...input.rrMs.slice(beatIndex));
  flush(true);

  const timerStop: EventMesg = { timestamp: end, event: 'timer', eventType: 'stopAll' };
  encoder.onMesg(MESG.event, timerStop);

  const totals = {
    timestamp: end,
    startTime: input.startTime,
    totalElapsedTime: durationS,
    totalTimerTime: durationS,
    sport: input.sport,
    subSport: input.subSport,
    ...heartRateSummary(input.heartRateBpm),
  };
  const lap: LapMesg = { ...totals, messageIndex: 0, event: 'lap', eventType: 'stop' };
  encoder.onMesg(MESG.lap, lap);
  const session: SessionMesg = {
    ...totals,
    messageIndex: 0,
    firstLapIndex: 0,
    numLaps: 1,
    event: 'session',
    eventType: 'stop',
    trigger: 'activityEnd',
  };
  encoder.onMesg(MESG.session, session);
  const activity: ActivityMesg = {
    timestamp: end,
    totalTimerTime: durationS,
    numSessions: 1,
    type: 'manual',
    event: 'activity',
    eventType: 'stop',
  };
  encoder.onMesg(MESG.activity, activity);
  return encoder.close();
}

function heartRateSummary(heartRateBpm: readonly (number | null)[]): { avgHeartRate?: number; maxHeartRate?: number } {
  const valid = heartRateBpm.filter((v): v is number => v !== null);
  if (valid.length === 0) return {};
  return {
    avgHeartRate: clampUint8(valid.reduce((s, v) => s + v, 0) / valid.length),
    maxHeartRate: clampUint8(Math.max(...valid)),
  };
}

function clampUint8(value: number): number {
  return Math.max(0, Math.min(MAX_UINT8 - 1, Math.round(value)));
}
