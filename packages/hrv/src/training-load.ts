/**
 * Acute and chronic training load as exponentially weighted daily loads (Banister's
 * impulse-response model as popularised by Coggan): each day moves the average 1/tau of the
 * way toward that day's load. Form (TSB) is yesterday's CTL minus yesterday's ATL, so a
 * session done today does not change today's form.
 */

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface DatedLoad {
  /** Local calendar date of the session, YYYY-MM-DD. */
  readonly date: string;
  readonly load: number;
}

export interface TrainingLoadOptions {
  readonly atlDays: number;
  readonly ctlDays: number;
  /** First day of the series; defaults to the earliest load. */
  readonly fromDate?: string;
  /** Last day of the series, inclusive. */
  readonly toDate: string;
  readonly initialAtl: number;
  readonly initialCtl: number;
}

export interface TrainingLoadDay {
  readonly date: string;
  readonly load: number;
  readonly atl: number;
  readonly ctl: number;
  readonly tsb: number;
}

export const DEFAULT_ATL_DAYS = 7;
export const DEFAULT_CTL_DAYS = 42;

export function trainingLoadSeries(
  loads: readonly DatedLoad[],
  options: Pick<TrainingLoadOptions, 'toDate'> & Partial<TrainingLoadOptions>,
): readonly TrainingLoadDay[] {
  const atlDays = options.atlDays ?? DEFAULT_ATL_DAYS;
  const ctlDays = options.ctlDays ?? DEFAULT_CTL_DAYS;
  const perDay = new Map<string, number>();
  for (const { date, load } of loads) {
    assertIsoDate(date);
    perDay.set(date, (perDay.get(date) ?? 0) + load);
  }

  const earliest = [...perDay.keys()].sort()[0];
  const fromDate = options.fromDate ?? earliest ?? options.toDate;
  assertIsoDate(fromDate);
  assertIsoDate(options.toDate);

  const days: TrainingLoadDay[] = [];
  let atl = options.initialAtl ?? 0;
  let ctl = options.initialCtl ?? 0;
  for (let ms = dayMs(fromDate); ms <= dayMs(options.toDate); ms += MS_PER_DAY) {
    const date = isoDay(ms);
    const load = perDay.get(date) ?? 0;
    const tsb = ctl - atl;
    atl += (load - atl) / atlDays;
    ctl += (load - ctl) / ctlDays;
    days.push({ date, load, atl, ctl, tsb });
  }
  return days;
}

function assertIsoDate(date: string): void {
  if (!ISO_DATE.test(date) || Number.isNaN(dayMs(date))) throw new RangeError(`Invalid date ${date}`);
}

/** Calendar arithmetic only: the date carries no time zone, so UTC midnight is a neutral anchor. */
function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
