/**
 * Timestamp parsing and formatting.
 *
 * The job this does that `new Date(x)` does not: figure out *what* a bare
 * number is. `1700000000` and `1700000000000` are the same instant written in
 * different units, and handing either to `new Date()` without deciding gives
 * you 1970 or 2023 with no warning. Unit detection by magnitude is the whole
 * trick, and it is why a pasted timestamp usually "doesn't work" elsewhere.
 */

export type Unit = 'seconds' | 'milliseconds' | 'microseconds' | 'nanoseconds';

export interface ParsedInstant {
  /** Milliseconds since the Unix epoch. */
  ms: number;
  /** How the input was read. */
  unit: Unit | 'date-string';
  /** True when the unit was inferred from magnitude rather than stated. */
  inferred: boolean;
  source: string;
}

/**
 * Decide the unit of an epoch number by magnitude.
 *
 * The boundaries are chosen so that any plausible *recent* timestamp lands in
 * the right bucket: ~1e9 seconds is 2001, ~1e12 ms is 2001, and so on. The
 * cost is that a seconds value from before 1973 (<1e8) reads as seconds
 * anyway, which is the right call — a tiny number is far more likely to be a
 * duration or a test fixture than a 1971 date.
 */
export function inferUnit(n: number): Unit {
  const abs = Math.abs(n);
  if (abs >= 1e16) return 'nanoseconds';
  if (abs >= 1e14) return 'microseconds';
  if (abs >= 1e11) return 'milliseconds';
  return 'seconds';
}

export function toMs(n: number, unit: Unit): number {
  switch (unit) {
    case 'seconds':      return n * 1000;
    case 'milliseconds': return n;
    case 'microseconds': return n / 1000;
    case 'nanoseconds':  return n / 1e6;
  }
}

export function fromMs(ms: number, unit: Unit): number {
  switch (unit) {
    case 'seconds':      return Math.floor(ms / 1000);
    case 'milliseconds': return Math.round(ms);
    case 'microseconds': return Math.round(ms * 1000);
    case 'nanoseconds':  return Math.round(ms * 1e6);
  }
}

export class TimestampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimestampError';
  }
}

/**
 * Parse anything a user is likely to paste: an epoch number in any unit, an
 * ISO 8601 string, an HTTP date, or "now".
 *
 * `forceUnit` overrides magnitude detection, for the case where the inference
 * guessed wrong and the user knows better.
 */
export function parseInstant(input: string, forceUnit?: Unit, now = Date.now()): ParsedInstant {
  const s = input.trim();
  if (!s) throw new TimestampError('Enter a timestamp or a date.');

  if (/^now$/i.test(s)) {
    return { ms: now, unit: 'milliseconds', inferred: false, source: s };
  }

  // A bare number, with optional sign and a decimal part (fractional epoch
  // seconds are common in logs).
  if (/^[+-]?\d+(?:\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) throw new TimestampError('That number is too large to be a timestamp.');
    const unit = forceUnit ?? inferUnit(n);
    const ms = toMs(n, unit);
    if (!isRenderable(ms)) {
      throw new TimestampError('That value is outside the range of dates a browser can represent.');
    }
    return { ms, unit, inferred: !forceUnit, source: s };
  }

  const parsed = Date.parse(s);
  if (Number.isNaN(parsed)) {
    throw new TimestampError('Not a recognised timestamp or date. Try an epoch number or an ISO 8601 string.');
  }
  return { ms: parsed, unit: 'date-string', inferred: false, source: s };
}

/** Whether a millisecond value is inside the ECMAScript Date range (±8.64e15). */
export function isRenderable(ms: number): boolean {
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15;
}

export interface Rendered {
  iso: string;
  /** RFC 7231, as seen in HTTP headers. */
  http: string;
  localIso: string;
  localHuman: string;
  utcHuman: string;
  relative: string;
  epoch: Record<Unit, string>;
  /** Day of week, ISO week number and day of year — the things a log reader wants. */
  dayOfWeek: string;
  isoWeek: string;
  dayOfYear: number;
  /** The viewer's zone, named so the local column is unambiguous. */
  timeZone: string;
  /** Offset from UTC at that instant, e.g. "+01:00". */
  offset: string;
}

function pad(n: number, width = 2): string {
  return String(Math.abs(n)).padStart(width, '0');
}

/** Local ISO 8601 with the real offset, which `toISOString` cannot give (it is
 *  always UTC) and which is what makes a local time copy-pasteable. */
function localIsoString(d: Date): string {
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const offset = `${sign}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}${offset}`
  );
}

export function utcOffsetString(d: Date): string {
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  return `${sign}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`;
}

/** ISO 8601 week number (weeks start Monday; week 1 holds the first Thursday). */
export function isoWeek(d: Date): { year: number; week: number } {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (target.getUTCDay() + 6) % 7; // Monday = 0
  target.setUTCDate(target.getUTCDate() - dayNum + 3); // the Thursday of this week
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return { year: target.getUTCFullYear(), week };
}

export function dayOfYear(d: Date): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const here = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.floor((here - start) / 86400000) + 1;
}

const RELATIVE_STEPS: [limit: number, divisor: number, unit: Intl.RelativeTimeFormatUnit][] = [
  [60_000, 1000, 'second'],
  [3_600_000, 60_000, 'minute'],
  [86_400_000, 3_600_000, 'hour'],
  [2_592_000_000, 86_400_000, 'day'],
  [31_536_000_000, 2_592_000_000, 'month'],
  [Infinity, 31_536_000_000, 'year'],
];

export function relativeTime(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 1000) return 'just now';

  for (const [limit, divisor, unit] of RELATIVE_STEPS) {
    if (abs < limit) {
      const value = Math.round(diff / divisor);
      try {
        return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(value, unit);
      } catch {
        return `${Math.abs(value)} ${unit}${Math.abs(value) === 1 ? '' : 's'} ${value < 0 ? 'ago' : 'from now'}`;
      }
    }
  }
  return 'just now';
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function render(ms: number, now = Date.now()): Rendered {
  if (!isRenderable(ms)) throw new TimestampError('That instant is outside the representable date range.');
  const d = new Date(ms);
  const week = isoWeek(d);

  let localHuman: string;
  let utcHuman: string;
  try {
    localHuman = d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long' });
    utcHuman = d.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'long', timeZone: 'UTC' });
  } catch {
    localHuman = d.toString();
    utcHuman = d.toUTCString();
  }

  let timeZone = 'local';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  } catch { /* Intl unavailable — the label stays generic */ }

  return {
    iso: d.toISOString(),
    http: d.toUTCString(),
    localIso: localIsoString(d),
    localHuman,
    utcHuman,
    relative: relativeTime(ms, now),
    epoch: {
      seconds: String(fromMs(ms, 'seconds')),
      milliseconds: String(fromMs(ms, 'milliseconds')),
      microseconds: String(fromMs(ms, 'microseconds')),
      nanoseconds: String(fromMs(ms, 'nanoseconds')),
    },
    dayOfWeek: DAY_NAMES[d.getUTCDay()],
    isoWeek: `${week.year}-W${pad(week.week)}`,
    dayOfYear: dayOfYear(d),
    timeZone,
    offset: utcOffsetString(d),
  };
}
