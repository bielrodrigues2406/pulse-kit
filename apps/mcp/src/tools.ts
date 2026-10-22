import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { readSessionFit } from '@pulse-kit/fit-session';
import {
  indexMasterSchema,
  openPulseSessionSchema,
  polarExerciseSchema,
  rrMsOfSession,
  type IndexWorkout,
} from '@pulse-kit/schemas';
import { z } from 'zod';

import { recordingReport, type RecordingInput } from './domain/recording-report.js';
import { LOAD_METRICS, localDate, trainingStatus } from './domain/training-status.js';
import { workoutReport } from './domain/workout-report.js';
import type { Dependencies, DriveReader } from './ports.js';

const TELEMETRY_FILE = 'telemetry_1hz.json';
const POLL_INTERVAL_MS = 10_000;
const MS_PER_SECOND = 1000;

function ok(result: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

async function guarded(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function requireDrive(deps: Dependencies): { drive: DriveReader; root: string } {
  if (deps.drive === null || deps.driveRootFolderId === null) {
    throw new Error('Google Drive não configurado: defina GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN e GOOGLE_DRIVE_FOLDER_ID.');
  }
  return { drive: deps.drive, root: deps.driveRootFolderId };
}

/** Workouts of the given years; a missing year folder or index counts as no workouts. */
async function loadWorkouts(deps: Dependencies, years: readonly number[]): Promise<{ workouts: IndexWorkout[]; updatedAt: string | null }> {
  const { drive, root } = requireDrive(deps);
  const workouts: IndexWorkout[] = [];
  let updatedAt: string | null = null;
  for (const year of years) {
    const yearFolder = await drive.findChild(root, String(year));
    if (yearFolder === null) continue;
    const indexId = await drive.findChild(yearFolder, `index_master_${String(year)}.json`);
    if (indexId === null) continue;
    const index = indexMasterSchema.parse(await drive.downloadJson(indexId));
    workouts.push(...index.workouts);
    if (updatedAt === null || index.updated_at > updatedAt) updatedAt = index.updated_at;
  }
  return { workouts, updatedAt };
}

function recentYears(today: string): number[] {
  const year = Number(today.slice(0, 4));
  return [year - 1, year];
}

export function registerTools(server: McpServer, deps: Dependencies): void {
  server.registerTool(
    'get_training_status',
    {
      title: 'Carga de treino e trava tibial',
      description:
        'ATL (7 dias), CTL (42 dias) e TSB a partir dos index_master do polar-drive-sync, os treinos dos últimos dias com seus ids e a regra pessoal de 48 h sem impacto após corrida. TSB é o CTL menos o ATL de ontem.',
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Dia de referência (AAAA-MM-DD); padrão: hoje no fuso configurado.'),
        metric: z.enum(LOAD_METRICS).default('banister_trimp').describe('Métrica de carga diária.'),
        recent_days: z.number().int().min(1).max(60).default(14).describe('Quantos dias recentes listar.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ date, metric, recent_days }) =>
      guarded(async () => {
        const now = deps.now();
        const today = date ?? localDate(now, deps.timeZone);
        const { workouts, updatedAt } = await loadWorkouts(deps, recentYears(today));
        return ok({ ...trainingStatus(workouts, { today, metric, recentDays: recent_days, now }), indexUpdatedAt: updatedAt });
      }),
  );

  server.registerTool(
    'inspect_workout',
    {
      title: 'Detalhar um treino da Polar',
      description:
        'Lê o telemetry_1hz.json de um treino sincronizado e devolve FC por quarto, deriva após 10 min de aquecimento, tempo por zona, TRIMP de Edwards e pausas.',
      inputSchema: { id: z.string().min(1).describe('Id do treino na Polar, por exemplo 5llKAe7n.') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ id }) =>
      guarded(async () => {
        const { drive } = requireDrive(deps);
        const { workouts } = await loadWorkouts(deps, recentYears(localDate(deps.now(), deps.timeZone)));
        const workout = workouts.find((w) => w.id === id);
        if (workout === undefined) return fail(`O treino ${id} não está nos índices deste ano nem do anterior.`);
        if (workout.drive_folder_id === undefined || workout.drive_folder_id === null) {
          return fail(`O índice não tem a pasta do treino ${id}; rode o sync com rebuild_index.`);
        }
        const fileId = await drive.findChild(workout.drive_folder_id, TELEMETRY_FILE);
        if (fileId === null) return fail(`A pasta do treino ${id} não tem ${TELEMETRY_FILE}.`);
        return ok(workoutReport(polarExerciseSchema.parse(await drive.downloadJson(fileId))));
      }),
  );

  server.registerTool(
    'analyze_recording',
    {
      title: 'Analisar gravação com R-R',
      description:
        'Analisa uma sessão exportada pelo openPulse (.json) ou um FIT com mensagens HRV (.fit): artefatos, RMSSD, DFA alpha-1 por minuto, tempo acima de VT1 (0,75) e abaixo de VT2 (0,50), limiares da rampa e queda ortostática. Tudo são estimativas.',
      inputSchema: {
        path: z.string().min(1).describe('Caminho do arquivo local.'),
        protocol: z.enum(['free', 'ramp', 'orthostatic']).optional().describe('Sobrepõe o protocolo gravado no arquivo.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path, protocol }) =>
      guarded(async () => {
        const bytes = await deps.files.read(path);
        const input = path.toLowerCase().endsWith('.fit') ? fromFit(bytes) : fromOpenPulse(bytes);
        return ok(recordingReport(protocol === undefined ? input : { ...input, protocol }));
      }),
  );

  server.registerTool(
    'trigger_polar_sync',
    {
      title: 'Sincronizar Polar agora',
      description:
        'Dispara o workflow do polar-drive-sync no GitHub Actions e espera ele terminar (até o tempo limite). Use antes de consultar um treino que acabou de terminar.',
      inputSchema: {
        rebuild_index: z.boolean().default(false).describe('Reconstrói os índices a partir de todos os arquivos do Drive.'),
        timeout_s: z.number().int().min(0).max(600).default(240).describe('Quanto esperar pelo fim da execução; 0 só dispara.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ rebuild_index, timeout_s }) =>
      guarded(async () => {
        if (deps.workflow === null) return fail('GitHub não configurado: defina GITHUB_TOKEN (Actions: read and write no polar-drive-sync).');
        const since = new Date(deps.now().getTime() - MS_PER_SECOND);
        // Only send the input when needed, so the call also works against the v1 workflow.
        await deps.workflow.dispatch(rebuild_index ? { rebuild_index: 'true' } : {});
        const deadline = deps.now().getTime() + timeout_s * MS_PER_SECOND;
        let run = await deps.workflow.latestRunSince(since);
        while ((run === null || run.status !== 'completed') && deps.now().getTime() < deadline) {
          await deps.sleep(POLL_INTERVAL_MS);
          run = await deps.workflow.latestRunSince(since);
        }
        return ok({ dispatched: true, run });
      }),
  );
}

function fromFit(bytes: Uint8Array): RecordingInput {
  const fit = readSessionFit(bytes);
  return { source: 'fit', startTime: fit.startTime, heartRateBpm: fit.heartRateBpm, rrMs: fit.rrMs, protocol: 'free', markers: [] };
}

function fromOpenPulse(bytes: Uint8Array): RecordingInput {
  const session = openPulseSessionSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  return {
    source: 'openpulse',
    startTime: new Date(session.startedAtUtc),
    heartRateBpm: session.heartRate1Hz.bpm,
    rrMs: rrMsOfSession(session),
    protocol: session.activity.protocol,
    markers: session.markers ?? [],
  };
}
