import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { encodeSessionFit } from '@pulse-kit/fit-session';
import type { IndexWorkout, OpenPulseSession } from '@pulse-kit/schemas';
import { describe, expect, it } from 'vitest';

import { createLocalFiles } from './adapters/local-files.js';
import type { Dependencies, DriveReader, WorkflowRun } from './ports.js';
import { createServer } from './server.js';

const NOW = new Date('2026-10-22T15:00:00Z');

function workout(id: string, startLocal: string, overrides: Partial<IndexWorkout> = {}): IndexWorkout {
  const startUtc = new Date(Date.parse(`${startLocal}Z`) + 3 * 3_600_000).toISOString();
  return {
    id,
    start_time_local: startLocal,
    start_time_utc: startUtc,
    utc_offset_min: -180,
    sport: 'RUNNING',
    detailed_sport_info: 'TREADMILL_RUNNING',
    device: 'Polar Flow app',
    duration_sec: 3600,
    distance_m: null,
    calories_kcal: 600,
    hr_avg_bpm: 140,
    hr_max_bpm: 154,
    hr_min_bpm: 120,
    hr_sample_interval_sec: 1,
    hr_valid_ratio: 1,
    hr_quarters_avg_bpm: [135, 140, 142, 143],
    hr_drift_pct: 3.1,
    polar_cardio_load: 100,
    polar_cardio_load_status: 'HIGH',
    banister_trimp: 70,
    edwards_trimp: 150,
    tibial_impact_category: 'HIGH_AXIAL_IMPACT',
    tibial_recovery_window_hours: 48,
    drive_folder_id: `folder-${id}`,
    ...overrides,
  };
}

function telemetry(id: string): unknown {
  const data = Array.from({ length: 2400 }, (_, s) => (s >= 1000 && s < 1060 ? 0 : 130 + Math.floor(s / 240)));
  return {
    id,
    start_time: '2026-10-21T18:00:00',
    start_time_utc_offset: -180,
    duration: 'PT2400S',
    sport: 'RUNNING',
    detailed_sport_info: 'TREADMILL_RUNNING',
    heart_rate: { average: 135, maximum: 139 },
    heart_rate_zones: [
      { index: 0, lower_limit: 100, upper_limit: 119, in_zone: 'PT0S' },
      { index: 1, lower_limit: 119, upper_limit: 139, in_zone: 'PT39M' },
      { index: 2, lower_limit: 139, upper_limit: 159, in_zone: 'PT1M' },
      { index: 3, lower_limit: 159, upper_limit: 179, in_zone: 'PT0S' },
      { index: 4, lower_limit: 179, upper_limit: 199, in_zone: 'PT0S' },
    ],
    samples: [{ recording_rate: 1, sample_type: 0, data: data.join(',') }],
    training_load_pro: { 'cardio-load': 55.2 },
  };
}

function fakeDrive(workouts: readonly IndexWorkout[]): DriveReader {
  const children = new Map<string, string>([
    ['root/2026', 'year-2026'],
    ['year-2026/index_master_2026.json', 'index-2026'],
    ...workouts.map((w): [string, string] => [`folder-${w.id}/telemetry_1hz.json`, `telemetry-${w.id}`]),
  ]);
  return {
    findChild: (parentId, name) => Promise.resolve(children.get(`${parentId}/${name}`) ?? null),
    downloadJson: (fileId) => {
      if (fileId === 'index-2026') {
        return Promise.resolve({
          schema_version: '2.0.0',
          year: 2026,
          updated_at: '2026-10-22T03:16:00Z',
          params: { algorithm_version: '2.0.0' },
          total_workouts: workouts.length,
          workouts,
        });
      }
      return Promise.resolve(telemetry(fileId.replace('telemetry-', '')));
    },
  };
}

async function connect(overrides: Partial<Dependencies> = {}): Promise<Client> {
  let clockMs = NOW.getTime();
  const deps: Dependencies = {
    drive: fakeDrive([workout('old', '2026-10-01T07:00:00'), workout('run1', '2026-10-21T18:00:00')]),
    driveRootFolderId: 'root',
    workflow: null,
    files: createLocalFiles(null),
    now: () => new Date(clockMs),
    timeZone: 'America/Sao_Paulo',
    sleep: (ms) => {
      clockMs += ms;
      return Promise.resolve();
    },
    ...overrides,
  };
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(deps).connect(serverSide);
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(clientSide);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ isError: boolean; json: unknown; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  const text = content[0]?.text ?? '';
  const isError = result.isError === true;
  return { isError, text, json: isError ? null : JSON.parse(text) };
}

function pinkRr(count: number, meanMs: number, sdMs: number, seed: number): number[] {
  let state = seed;
  const uniform = (): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  const phases = Array.from({ length: 200 }, () => 2 * Math.PI * uniform());
  return Array.from({ length: count }, (_, i) => {
    let v = 0;
    phases.forEach((phase, k) => {
      v += Math.cos((2 * Math.PI * (k + 1) * i) / count + phase) / Math.sqrt(k + 1);
    });
    return meanMs + (v / 4) * sdMs;
  });
}

describe('pulse-kit MCP server', () => {
  it('lists the four tools', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['analyze_recording', 'get_training_status', 'inspect_workout', 'trigger_polar_sync']);
  });

  it('reports load and the active tibial lock after yesterday evening run', async () => {
    const client = await connect();
    const { json, isError } = await call(client, 'get_training_status', { recent_days: 3 });
    expect(isError).toBe(false);
    const status = json as { date: string; impact: { status: string; lockedUntilUtc: string }; recentDays: unknown[]; workoutsCounted: number; today: { ctl: number } };
    expect(status.date).toBe('2026-10-22');
    expect(status.impact.status).toBe('TIBIAL_LOCK_ACTIVE');
    expect(status.impact.lockedUntilUtc).toBe('2026-10-23T22:00:00.000Z');
    expect(status.recentDays).toHaveLength(3);
    expect(status.workoutsCounted).toBe(2);
    expect(status.today.ctl).toBeGreaterThan(0);
  });

  it('says what is missing when Drive is not configured', async () => {
    const client = await connect({ drive: null });
    const result = await call(client, 'get_training_status');
    expect(result.isError).toBe(true);
    expect(result.text).toContain('GOOGLE_DRIVE_FOLDER_ID');
  });

  it('inspects a synced workout from its telemetry file', async () => {
    const client = await connect();
    const { json } = await call(client, 'inspect_workout', { id: 'run1' });
    const report = json as { quarterMeansBpm: number[]; driftPct: number; zones: { seconds: number }[]; gaps: { startS: number; durationS: number }[]; edwardsTrimp: number };
    expect(report.quarterMeansBpm).toHaveLength(4);
    expect(report.driftPct).toBeGreaterThan(0);
    expect(report.zones.map((z) => z.seconds)).toEqual([0, 2340, 60, 0, 0]);
    expect(report.gaps).toEqual([{ startS: 1000, durationS: 60 }]);
    expect(report.edwardsTrimp).toBe(81);
  });

  it('refuses an unknown workout id', async () => {
    const client = await connect();
    expect((await call(client, 'inspect_workout', { id: 'nope' })).isError).toBe(true);
  });

  it('analyses an openPulse orthostatic test', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulse-kit-'));
    const supine = pinkRr(330, 1000, 60, 7);
    const standing = pinkRr(330, 750, 12, 8);
    const rrMs = [...supine, ...standing];
    const standS = supine.reduce((s, v) => s + v, 0) / 1000;
    const session: OpenPulseSession = {
      schema: 'openpulse.session',
      version: 1,
      startedAtUtc: '2026-10-22T09:00:00Z',
      timeZone: 'America/Sao_Paulo',
      app: { name: 'openPulse', version: '0.2.0' },
      sensor: { name: 'Polar H10', model: 'H10' },
      activity: { sport: 'rest', indoor: true, protocol: 'orthostatic' },
      heartRate1Hz: { bpm: [] },
      rr: { ticks1024: rrMs.map((ms) => Math.round((ms * 1024) / 1000)) },
      markers: [{ tS: standS, label: 'stand' }],
    };
    const path = join(dir, 'orthostatic.json');
    await writeFile(path, JSON.stringify(session));
    const client = await connect();
    const { json } = await call(client, 'analyze_recording', { path });
    const report = json as { protocol: string; artifactPct: number; orthostatic: { supineRmssdMs: number; standingRmssdMs: number; dropPct: number } };
    expect(report.protocol).toBe('orthostatic');
    // Only the five beats right after standing are rejected before the gate re-anchors.
    expect(report.artifactPct).toBeLessThan(1);
    expect(report.orthostatic.supineRmssdMs).toBeGreaterThan(report.orthostatic.standingRmssdMs);
    expect(report.orthostatic.dropPct).toBeGreaterThan(50);
  });

  it('analyses a FIT file with HRV messages', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulse-kit-'));
    const rrMs = pinkRr(900, 800, 30, 3).map((v) => Math.round(v));
    const seconds = Math.floor(rrMs.reduce((s, v) => s + v, 0) / 1000);
    const path = join(dir, 'ride.fit');
    await writeFile(
      path,
      encodeSessionFit({
        startTime: new Date('2026-10-20T07:00:00Z'),
        sport: 'cycling',
        subSport: 'indoorCycling',
        heartRateBpm: Array.from({ length: seconds }, () => 75),
        rrMs,
        productName: 'openPulse',
        serialNumber: 1,
      }),
    );
    const client = await connect();
    const { json } = await call(client, 'analyze_recording', { path });
    const report = json as { source: string; beats: number; alpha1: { scoredWindows: number; perMinute: { minute: number }[] } };
    expect(report.source).toBe('fit');
    expect(report.beats).toBe(900);
    expect(report.alpha1.scoredWindows).toBeGreaterThan(0);
    expect(report.alpha1.perMinute[0]?.minute).toBe(2);
  });

  it('only reads recordings inside the configured folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pulse-kit-'));
    const client = await connect({ files: createLocalFiles(dir) });
    expect((await call(client, 'analyze_recording', { path: '../../etc/passwd.json' })).text).toContain('PULSE_KIT_RECORDINGS_DIR');
    expect((await call(client, 'analyze_recording', { path: 'notes.txt' })).text).toContain('.json');
  });

  it('dispatches the sync and waits for the run to finish', async () => {
    const dispatched: Record<string, string>[] = [];
    let polls = 0;
    const run = (status: string): WorkflowRun => ({
      id: 1,
      status,
      conclusion: status === 'completed' ? 'success' : null,
      htmlUrl: 'https://github.com/x/y/actions/runs/1',
      createdAt: NOW.toISOString(),
    });
    const client = await connect({
      workflow: {
        dispatch: (inputs) => {
          dispatched.push({ ...inputs });
          return Promise.resolve();
        },
        latestRunSince: () => {
          polls += 1;
          return Promise.resolve(polls < 3 ? run('in_progress') : run('completed'));
        },
      },
    });
    const { json } = await call(client, 'trigger_polar_sync', { rebuild_index: true });
    expect(dispatched).toEqual([{ rebuild_index: 'true' }]);
    expect((json as { run: WorkflowRun }).run.conclusion).toBe('success');
  });

  it('sends no inputs for a plain sync, so the v1 workflow still accepts it', async () => {
    const dispatched: Record<string, string>[] = [];
    const client = await connect({
      workflow: {
        dispatch: (inputs) => {
          dispatched.push({ ...inputs });
          return Promise.resolve();
        },
        latestRunSince: () => Promise.resolve(null),
      },
    });
    await call(client, 'trigger_polar_sync', { timeout_s: 0 });
    expect(dispatched).toEqual([{}]);
  });
});
