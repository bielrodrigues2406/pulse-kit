import { Decoder, Stream } from '@garmin/fitsdk';
import { describe, expect, it } from 'vitest';

import { encodeSessionFit, type SessionFitInput } from './encode-session.js';
import { readSessionFit } from './read-session.js';

function session(overrides: Partial<SessionFitInput> = {}): SessionFitInput {
  const heartRateBpm = Array.from({ length: 600 }, (_, s) => (s === 100 ? null : 120 + Math.floor(s / 20)));
  const rrMs: number[] = [];
  for (let elapsed = 0; elapsed < 599_000; ) {
    const rr = 480 + ((rrMs.length * 37) % 61);
    rrMs.push(rr);
    elapsed += rr;
  }
  return {
    startTime: new Date('2026-10-20T07:00:00Z'),
    sport: 'cycling',
    subSport: 'indoorCycling',
    heartRateBpm,
    rrMs,
    productName: 'openPulse',
    serialNumber: 12345,
    ...overrides,
  };
}

function decode(bytes: Uint8Array) {
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  expect(decoder.checkIntegrity()).toBe(true);
  const { messages, errors } = decoder.read({ convertTypesToStrings: true });
  expect(errors).toEqual([]);
  return messages;
}

describe('encodeSessionFit', () => {
  it('passes the official SDK integrity check (header and CRC)', () => {
    decode(encodeSessionFit(session()));
  });

  it('keeps every RR interval to the millisecond in HRV messages', () => {
    const input = session();
    const messages = decode(encodeSessionFit(input));
    const decoded = (messages.hrvMesgs ?? []).flatMap((m) => m.time ?? []).map((s) => Math.round(s * 1000));
    expect(decoded).toEqual(input.rrMs);
    expect((messages.hrvMesgs ?? []).every((m) => (m.time?.length ?? 0) <= 5)).toBe(true);
  });

  it('writes one record per second and leaves lost seconds without heart rate', () => {
    const messages = decode(encodeSessionFit(session()));
    const records = messages.recordMesgs ?? [];
    expect(records).toHaveLength(600);
    expect(records[100]?.heartRate).toBeUndefined();
    expect(records[0]?.heartRate).toBe(120);
  });

  it('writes the activity structure that platforms require', () => {
    const messages = decode(encodeSessionFit(session()));
    expect(messages.fileIdMesgs?.[0]?.type).toBe('activity');
    const summary = messages.sessionMesgs?.[0];
    expect(summary?.sport).toBe('cycling');
    expect(summary?.subSport).toBe('indoorCycling');
    expect(summary?.totalElapsedTime).toBe(600);
    expect(summary?.maxHeartRate).toBe(149);
    expect(messages.lapMesgs).toHaveLength(1);
    expect(messages.activityMesgs?.[0]?.numSessions).toBe(1);
  });

  it('refuses values FIT cannot store instead of truncating them', () => {
    expect(() => encodeSessionFit(session({ rrMs: [800, 70_000] }))).toThrow(RangeError);
    expect(() => encodeSessionFit(session({ heartRateBpm: [] }))).toThrow(RangeError);
    expect(() => encodeSessionFit(session({ cadenceRpm: [90] }))).toThrow(RangeError);
  });
});

describe('readSessionFit', () => {
  it('reads back what encodeSessionFit wrote', () => {
    const input = session();
    const contents = readSessionFit(encodeSessionFit(input));
    expect(contents.startTime?.toISOString()).toBe('2026-10-20T07:00:00.000Z');
    expect(contents.rrMs).toEqual(input.rrMs);
    expect(contents.heartRateBpm).toEqual(input.heartRateBpm);
    expect(contents.sport).toBe('cycling');
  });

  it('rejects a corrupted file', () => {
    const bytes = encodeSessionFit(session());
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    expect(() => readSessionFit(bytes)).toThrow(RangeError);
  });
});
