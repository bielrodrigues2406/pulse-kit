/**
 * Personal axial-impact rule: after a running session, no new impact session until the
 * recovery window has passed since it ended. A user-chosen rule, not a clinical criterion.
 */

const MS_PER_HOUR = 3_600_000;
const MS_PER_SECOND = 1000;

export interface ImpactSession {
  readonly startUtc: string;
  readonly durationS: number;
  /** 0 for sessions without axial impact. */
  readonly recoveryHours: number;
}

export type ImpactStatus =
  | { readonly status: 'CLEARED_FOR_IMPACT'; readonly lastImpactEndUtc: string | null }
  | { readonly status: 'TIBIAL_LOCK_ACTIVE'; readonly lastImpactEndUtc: string; readonly lockedUntilUtc: string };

export function impactStatus(sessions: readonly ImpactSession[], now: Date): ImpactStatus {
  let latestEndMs: number | null = null;
  let lockedUntilMs: number | null = null;
  for (const session of sessions) {
    if (session.recoveryHours <= 0) continue;
    const startMs = Date.parse(session.startUtc);
    if (Number.isNaN(startMs)) throw new RangeError(`Invalid startUtc ${session.startUtc}`);
    const endMs = startMs + session.durationS * MS_PER_SECOND;
    if (endMs > now.getTime()) continue;
    if (latestEndMs === null || endMs > latestEndMs) latestEndMs = endMs;
    const untilMs = endMs + session.recoveryHours * MS_PER_HOUR;
    if (lockedUntilMs === null || untilMs > lockedUntilMs) lockedUntilMs = untilMs;
  }

  const lastImpactEndUtc = latestEndMs === null ? null : new Date(latestEndMs).toISOString();
  if (lockedUntilMs !== null && lastImpactEndUtc !== null && lockedUntilMs > now.getTime()) {
    return { status: 'TIBIAL_LOCK_ACTIVE', lastImpactEndUtc, lockedUntilUtc: new Date(lockedUntilMs).toISOString() };
  }
  return { status: 'CLEARED_FOR_IMPACT', lastImpactEndUtc };
}
