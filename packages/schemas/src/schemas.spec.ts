import { describe, expect, it } from 'vitest';

import indexMaster from './fixtures/index-master-2026.json' with { type: 'json' };
import polarExercise from './fixtures/polar-exercise.json' with { type: 'json' };
import { indexMasterSchema } from './index-master.js';
import { openPulseSessionSchema, rrMsOfSession, type OpenPulseSession } from './openpulse-session.js';
import { polarExerciseSchema } from './polar-exercise.js';

// Both fixtures are produced by polar-drive-sync's own code and test data (synthetic values),
// so this is the contract test between the two repositories.
describe('indexMasterSchema', () => {
  it('accepts what polar-drive-sync v2 writes', () => {
    const parsed = indexMasterSchema.parse(indexMaster);
    expect(parsed.workouts.map((w) => w.id)).toEqual(['AbC123xy', 'Ride0001']);
    expect(parsed.workouts[0]?.tibial_impact_category).toBe('HIGH_AXIAL_IMPACT');
  });

  it('keeps fields a newer writer adds', () => {
    const newer = { ...indexMaster, workouts: [{ ...indexMaster.workouts[0], vo2_estimate: 52 }] };
    expect(indexMasterSchema.parse(newer).workouts[0]).toHaveProperty('vo2_estimate', 52);
  });

  it('rejects the v1 index of the original blueprint', () => {
    expect(indexMasterSchema.safeParse({ ...indexMaster, schema_version: '1.0.0' }).success).toBe(false);
  });
});

describe('polarExerciseSchema', () => {
  it('reads the stored AccessLink exercise and normalises the id', () => {
    const parsed = polarExerciseSchema.parse({ ...polarExercise, id: 12345 });
    expect(parsed.id).toBe('12345');
    expect(parsed.samples?.[0]?.sample_type).toBe(0);
    expect(parsed.heart_rate_zones?.[0]?.index).toBe(0);
  });
});

const session: OpenPulseSession = {
  schema: 'openpulse.session',
  version: 1,
  startedAtUtc: '2026-10-20T10:00:00Z',
  timeZone: 'America/Sao_Paulo',
  app: { name: 'openPulse', version: '0.2.0' },
  sensor: { name: 'Polar H10 ABC123', model: 'H10' },
  activity: { sport: 'cycling', indoor: true, protocol: 'ramp' },
  heartRate1Hz: { bpm: [120, null, 121] },
  rr: { ticks1024: [1024, 512] },
  markers: [{ tS: 0, label: 'step 1' }],
};

describe('openPulseSessionSchema', () => {
  it('accepts a minimal session and converts ticks to milliseconds', () => {
    const parsed = openPulseSessionSchema.parse(session);
    expect(rrMsOfSession(parsed)).toEqual([1000, 500]);
  });

  it('rejects a local time without offset and a non-integer tick', () => {
    expect(openPulseSessionSchema.safeParse({ ...session, startedAtUtc: '2026-10-20T10:00:00' }).success).toBe(false);
    expect(openPulseSessionSchema.safeParse({ ...session, rr: { ticks1024: [1024.5] } }).success).toBe(false);
  });
});
