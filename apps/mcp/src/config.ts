import { z } from 'zod';

const optional = z
  .string()
  .transform((v) => v.trim())
  .optional()
  .transform((v) => (v === undefined || v === '' ? null : v));

const envSchema = z.object({
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  GOOGLE_REFRESH_TOKEN: optional,
  GOOGLE_DRIVE_FOLDER_ID: optional,
  GITHUB_TOKEN: optional,
  POLAR_SYNC_REPOSITORY: optional,
  POLAR_SYNC_WORKFLOW: optional,
  POLAR_SYNC_REF: optional,
  PULSE_KIT_RECORDINGS_DIR: optional,
  PULSE_KIT_TIME_ZONE: optional,
});

export interface Config {
  readonly google: { readonly clientId: string; readonly clientSecret: string; readonly refreshToken: string } | null;
  readonly driveRootFolderId: string | null;
  readonly github: { readonly token: string; readonly repository: string; readonly workflowFile: string; readonly ref: string } | null;
  readonly recordingsDir: string | null;
  readonly timeZone: string;
}

/** Every credential is optional: a tool whose service is not configured answers with what is missing. */
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const e = envSchema.parse(env);
  const google =
    e.GOOGLE_CLIENT_ID !== null && e.GOOGLE_CLIENT_SECRET !== null && e.GOOGLE_REFRESH_TOKEN !== null
      ? { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET, refreshToken: e.GOOGLE_REFRESH_TOKEN }
      : null;
  return {
    google,
    driveRootFolderId: e.GOOGLE_DRIVE_FOLDER_ID,
    github:
      e.GITHUB_TOKEN === null
        ? null
        : {
            token: e.GITHUB_TOKEN,
            repository: e.POLAR_SYNC_REPOSITORY ?? 'bielrodrigues2406/polar-drive-sync',
            workflowFile: e.POLAR_SYNC_WORKFLOW ?? 'polar-flow-sync.yml',
            ref: e.POLAR_SYNC_REF ?? 'main',
          },
    recordingsDir: e.PULSE_KIT_RECORDINGS_DIR,
    timeZone: e.PULSE_KIT_TIME_ZONE ?? 'America/Sao_Paulo',
  };
}
