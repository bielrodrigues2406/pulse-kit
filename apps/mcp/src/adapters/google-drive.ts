/** Read-only Google Drive v3 client over fetch, authenticated by an OAuth refresh token. */

import type { DriveReader } from '../ports.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
/** Refresh a minute early so a request never carries a token that expires in flight. */
const EXPIRY_MARGIN_MS = 60_000;
const MS_PER_SECOND = 1000;

export interface GoogleCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export function quoteDriveString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function createGoogleDriveReader(credentials: GoogleCredentials, now: () => Date = () => new Date()): DriveReader {
  let cached: { token: string; expiresAtMs: number } | null = null;

  async function accessToken(): Promise<string> {
    if (cached !== null && cached.expiresAtMs > now().getTime()) return cached.token;
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: 'refresh_token',
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      const hint = body.includes('invalid_grant') ? ' (refresh token expirado: app OAuth em modo "Testing" expira em 7 dias)' : '';
      throw new Error(`Google OAuth falhou (${String(res.status)})${hint}`);
    }
    const data = (await res.json()) as { access_token: string; expires_in: number };
    cached = { token: data.access_token, expiresAtMs: now().getTime() + data.expires_in * MS_PER_SECOND - EXPIRY_MARGIN_MS };
    return cached.token;
  }

  async function get(url: string): Promise<Response> {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
    if (!res.ok) throw new Error(`Google Drive respondeu ${String(res.status)}`);
    return res;
  }

  return {
    async findChild(parentId, name) {
      const q = `${quoteDriveString(parentId)} in parents and name = ${quoteDriveString(name)} and trashed = false`;
      const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' });
      const data = (await (await get(`${FILES_URL}?${params.toString()}`)).json()) as { files?: { id: string }[] };
      return data.files?.[0]?.id ?? null;
    },
    async downloadJson(fileId) {
      return (await get(`${FILES_URL}/${encodeURIComponent(fileId)}?alt=media`)).json() as Promise<unknown>;
    },
  };
}
