import { describe, expect, it } from 'vitest';

import { impactStatus } from './impact-guard.js';

const run = (startUtc: string, durationS = 3600) => ({ startUtc, durationS, recoveryHours: 48 });
const ride = (startUtc: string) => ({ startUtc, durationS: 3600, recoveryHours: 0 });
const now = new Date('2026-10-22T12:00:00Z');

describe('impactStatus', () => {
  it('locks until 48 hours after the run ended', () => {
    expect(impactStatus([run('2026-10-21T08:00:00Z')], now)).toEqual({
      status: 'TIBIAL_LOCK_ACTIVE',
      lastImpactEndUtc: '2026-10-21T09:00:00.000Z',
      lockedUntilUtc: '2026-10-23T09:00:00.000Z',
    });
  });

  it('clears once the window has passed', () => {
    expect(impactStatus([run('2026-10-20T08:00:00Z')], now)).toEqual({
      status: 'CLEARED_FOR_IMPACT',
      lastImpactEndUtc: '2026-10-20T09:00:00.000Z',
    });
  });

  it('ignores sessions without impact and sessions not finished yet', () => {
    expect(impactStatus([ride('2026-10-22T08:00:00Z'), run('2026-10-22T11:30:00Z')], now)).toEqual({
      status: 'CLEARED_FOR_IMPACT',
      lastImpactEndUtc: null,
    });
  });

  it('rejects an unreadable start', () => {
    expect(() => impactStatus([run('ontem')], now)).toThrow(RangeError);
  });
});
