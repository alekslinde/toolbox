/**
 * Cron expression parsing, explanation and next-run calculation.
 *
 * Two things make a cron tool worth having. First, nobody can read
 * `*\/15 9-17 * * 1-5` with confidence, and a wrong guess means a job that
 * runs 96 times a day instead of 36. Second, the next few fire times are the
 * only real proof the expression means what you think — an English gloss can
 * be convincing and still wrong.
 *
 * Supported: standard 5-field cron, optional 6th seconds field, `*`, ranges,
 * steps, lists, names for months and weekdays, `?` as a synonym for `*`, and
 * the `@hourly`-style macros. Deliberately not supported: `L`, `W` and `#`,
 * which are Quartz extensions that most schedulers do not accept — claiming
 * them would mislead someone into shipping an expression their scheduler
 * rejects.
 *
 * All times are computed in UTC. A cron expression has no timezone of its own,
 * and quietly applying the viewer's zone would make the preview disagree with
 * the server that runs the job.
 */

export type FieldName = 'second' | 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek';

interface FieldSpec {
  name: FieldName;
  min: number;
  max: number;
  names?: Record<string, number>;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const WEEKDAYS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const FIELDS: Record<FieldName, FieldSpec> = {
  second:     { name: 'second',     min: 0, max: 59 },
  minute:     { name: 'minute',     min: 0, max: 59 },
  hour:       { name: 'hour',       min: 0, max: 23 },
  dayOfMonth: { name: 'dayOfMonth', min: 1, max: 31 },
  month:      { name: 'month',      min: 1, max: 12, names: MONTHS },
  dayOfWeek:  { name: 'dayOfWeek',  min: 0, max: 7, names: WEEKDAYS }, // 7 = Sunday too
};

export const MACROS: Record<string, string> = {
  '@yearly':   '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly':  '0 0 1 * *',
  '@weekly':   '0 0 * * 0',
  '@daily':    '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly':   '0 * * * *',
};

export class CronError extends Error {
  /** Which field failed, when the failure is field-specific. */
  readonly field?: FieldName;

  constructor(message: string, field?: FieldName) {
    super(message);
    this.name = 'CronError';
    this.field = field;
  }
}

export interface ParsedCron {
  seconds: number[];
  minutes: number[];
  hours: number[];
  daysOfMonth: number[];
  months: number[];
  daysOfWeek: number[];
  /** True when both day fields are restricted, which makes them an OR. */
  dayUnion: boolean;
  /** Whether the input carried a seconds field. */
  hasSeconds: boolean;
  /** The expression after macro expansion, as parsed. */
  normalised: string;
}

function parseField(raw: string, spec: FieldSpec): number[] {
  const text = raw.trim();
  if (text === '') throw new CronError(`The ${spec.name} field is empty`, spec.name);

  const resolve = (token: string): number => {
    const t = token.trim().toLowerCase();
    if (spec.names && t in spec.names) return spec.names[t];
    if (!/^\d+$/.test(t)) {
      throw new CronError(`"${token}" is not a valid ${spec.name}`, spec.name);
    }
    const n = Number(t);
    if (n < spec.min || n > spec.max) {
      throw new CronError(`${spec.name} must be ${spec.min}–${spec.max}, got ${n}`, spec.name);
    }
    return n;
  };

  const values = new Set<number>();

  for (const part of text.split(',')) {
    const piece = part.trim();
    if (piece === '') throw new CronError(`The ${spec.name} field has an empty list entry`, spec.name);

    // Split off a step. `*/5`, `10-30/5` and `5/10` are all valid forms.
    const slash = piece.indexOf('/');
    const rangePart = slash >= 0 ? piece.slice(0, slash) : piece;
    const stepPart = slash >= 0 ? piece.slice(slash + 1) : null;

    let step = 1;
    if (stepPart !== null) {
      if (!/^\d+$/.test(stepPart.trim())) {
        throw new CronError(`"${stepPart}" is not a valid step for ${spec.name}`, spec.name);
      }
      step = Number(stepPart.trim());
      if (step === 0) throw new CronError(`A step of 0 never matches (${spec.name})`, spec.name);
      if (step > spec.max - spec.min + 1) {
        throw new CronError(
          `A step of ${step} is larger than the ${spec.name} range, so only the first value matches`,
          spec.name,
        );
      }
    }

    let from: number;
    let to: number;
    if (rangePart === '*' || rangePart === '?') {
      from = spec.min;
      to = spec.max;
    } else if (rangePart.includes('-')) {
      const [a, b] = rangePart.split('-');
      if (b === undefined || b.trim() === '') {
        throw new CronError(`"${rangePart}" is an incomplete range in ${spec.name}`, spec.name);
      }
      from = resolve(a);
      to = resolve(b);
      if (from > to) {
        // Wrapping ranges (fri-mon) are not portable; rejecting beats guessing.
        throw new CronError(
          `${spec.name} range ${rangePart} runs backwards — write it as two entries instead`,
          spec.name,
        );
      }
    } else {
      from = resolve(rangePart);
      // A bare value with a step means "from here to the end of the range",
      // which is how Vixie cron reads `5/10`.
      to = stepPart !== null ? spec.max : from;
    }

    for (let v = from; v <= to; v += step) values.add(v);
  }

  // Weekday 7 and 0 both mean Sunday; collapse so matching needs one check.
  if (spec.name === 'dayOfWeek' && values.has(7)) {
    values.delete(7);
    values.add(0);
  }

  return [...values].sort((a, b) => a - b);
}

export function parseCron(input: string): ParsedCron {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) throw new CronError('Enter a cron expression.');

  if (trimmed.startsWith('@')) {
    if (trimmed === '@reboot') {
      throw new CronError('@reboot fires on daemon start, so it has no schedule to predict.');
    }
    const expanded = MACROS[trimmed];
    if (!expanded) throw new CronError(`"${trimmed}" is not a recognised macro`);
    return parseCron(expanded);
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    throw new CronError(
      `A cron expression has 5 fields (or 6 with seconds); this has ${parts.length}`,
    );
  }

  const hasSeconds = parts.length === 6;
  const [sec, min, hour, dom, mon, dow] = hasSeconds
    ? parts
    : ['0', ...parts];

  const daysOfMonth = parseField(dom, FIELDS.dayOfMonth);
  const daysOfWeek = parseField(dow, FIELDS.dayOfWeek);

  // The POSIX rule, and the one that surprises everyone: when BOTH day fields
  // are restricted, cron fires when EITHER matches, not both. `0 0 13 * 5` is
  // "the 13th, and every Friday" — not "Friday the 13th".
  const domRestricted = dom !== '*' && dom !== '?';
  const dowRestricted = dow !== '*' && dow !== '?';

  return {
    seconds: parseField(sec, FIELDS.second),
    minutes: parseField(min, FIELDS.minute),
    hours: parseField(hour, FIELDS.hour),
    daysOfMonth,
    months: parseField(mon, FIELDS.month),
    daysOfWeek,
    dayUnion: domRestricted && dowRestricted,
    hasSeconds,
    normalised: hasSeconds ? parts.join(' ') : parts.join(' '),
  };
}

function matchesDay(c: ParsedCron, date: Date): boolean {
  const domMatch = c.daysOfMonth.includes(date.getUTCDate());
  const dowMatch = c.daysOfWeek.includes(date.getUTCDay());
  // Union when both are restricted; otherwise the unrestricted field matches
  // everything anyway, so AND gives the right answer.
  return c.dayUnion ? domMatch || dowMatch : domMatch && dowMatch;
}

/**
 * The next N fire times at or after `from`, in UTC.
 *
 * Walks forward a second at a time conceptually, but skips whole days and
 * hours when they cannot match — otherwise a yearly schedule would need
 * 31 million iterations. The iteration cap is a safety net for an expression
 * that matches nothing reachable (February 30th), which parses fine and fires
 * never.
 */
export function nextRuns(c: ParsedCron, from: Date | number = Date.now(), count = 5): Date[] {
  const start = new Date(typeof from === 'number' ? from : from.getTime());
  // Start from the next whole second: a schedule should not report the instant
  // you are standing on as a future run.
  start.setUTCMilliseconds(0);
  start.setUTCSeconds(start.getUTCSeconds() + 1);

  const out: Date[] = [];
  const cursor = new Date(start.getTime());
  // A cron schedule repeats on at most a 4-year cycle (the leap cycle), so no
  // reachable run is ever more than ~1461 days past the previous one. The
  // budget is therefore per result rather than per call: a shared budget would
  // find the first 29 February and then give up before the next one, which is
  // four years further on.
  const limitPerRun = 366 * 5;
  let daysExamined = 0;

  while (out.length < count && daysExamined <= limitPerRun) {
    if (!c.months.includes(cursor.getUTCMonth() + 1) || !matchesDay(c, cursor)) {
      // Skip to the start of the next day.
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
      daysExamined++;
      continue;
    }

    if (!c.hours.includes(cursor.getUTCHours())) {
      cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0);
      if (cursor.getUTCHours() === 0) daysExamined++;
      continue;
    }

    if (!c.minutes.includes(cursor.getUTCMinutes())) {
      cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0);
      if (cursor.getUTCHours() === 0 && cursor.getUTCMinutes() === 0) daysExamined++;
      continue;
    }

    if (!c.seconds.includes(cursor.getUTCSeconds())) {
      cursor.setUTCSeconds(cursor.getUTCSeconds() + 1, 0);
      continue;
    }

    out.push(new Date(cursor.getTime()));
    daysExamined = 0; // the budget is per result; see above
    cursor.setUTCSeconds(cursor.getUTCSeconds() + 1, 0);
  }

  return out;
}

/** How many times the schedule fires in a 365-day year. Useful for the
 *  "is this going to run far more often than I meant" check. */
export function runsPerYear(c: ParsedCron): number {
  // Count day matches over a non-leap year, then multiply by the per-day count.
  const perDay = c.seconds.length * c.minutes.length * c.hours.length;
  let days = 0;
  const d = new Date(Date.UTC(2025, 0, 1)); // a non-leap year
  for (let i = 0; i < 365; i++) {
    if (c.months.includes(d.getUTCMonth() + 1) && matchesDay(c, d)) days++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days * perDay;
}

// ── English explanation ─────────────────────────────────────────────────────

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Whether a value list is a clean arithmetic step over the full range, so the
 *  gloss can say "every 15 minutes" instead of listing four numbers. */
function asStep(values: number[], min: number, max: number): number | null {
  if (values.length < 2) return null;
  if (values[0] !== min) return null;
  const step = values[1] - values[0];
  if (step <= 1) return null;
  for (let i = 1; i < values.length; i++) {
    if (values[i] - values[i - 1] !== step) return null;
  }
  // The last value must be the final one the step reaches within the range.
  return values[values.length - 1] + step > max ? step : null;
}

function isFullRange(values: number[], min: number, max: number): boolean {
  return values.length === max - min + 1;
}

/** Whether a list is every value from its first to its last with no gaps. */
function isContiguous(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) {
    if (values[i] - values[i - 1] !== 1) return false;
  }
  return values.length > 1;
}

/**
 * How the hour field reads on its own.
 *
 * Kept separate from the minute clause because the two are independent, and
 * the earlier version could not express that: a gapped list like `8,20` fell
 * into the same branch as a true range and was glossed "between 08:00 and
 * 20:59" — a twice-daily job described as a thirteen-hour window, which is
 * exactly the misreading this module exists to prevent.
 */
function describeHours(c: ParsedCron): { phrase: string; everyHour: boolean } {
  if (isFullRange(c.hours, 0, 23)) return { phrase: '', everyHour: true };

  const step = asStep(c.hours, 0, 23);
  if (step) return { phrase: `every ${step} hours`, everyHour: false };

  if (c.hours.length === 1) {
    return { phrase: `at ${pad2(c.hours[0])}:00`, everyHour: false };
  }

  // Only a gapless run may be stated as a range; anything else is listed, so
  // the gaps stay visible.
  if (isContiguous(c.hours)) {
    return {
      phrase: `between ${pad2(c.hours[0])}:00 and ${pad2(c.hours[c.hours.length - 1])}:59`,
      everyHour: false,
    };
  }

  return { phrase: `at ${joinList(c.hours.map((h) => `${pad2(h)}:00`))}`, everyHour: false };
}

function describeTime(c: ParsedCron): string {
  const everySecond = isFullRange(c.seconds, 0, 59);
  const everyMinute = isFullRange(c.minutes, 0, 59);
  const { phrase: hourPhrase, everyHour } = describeHours(c);

  // Sub-minute schedules read best as a frequency.
  if (c.hasSeconds && (everySecond || c.seconds.length > 1)) {
    const secStep = asStep(c.seconds, 0, 59);
    const freq = everySecond
      ? 'every second'
      : secStep
        ? `every ${secStep} seconds`
        : `at ${joinList(c.seconds.map(String))} seconds past the minute`;
    if (everyMinute && everyHour) return freq;
  }

  const minStep = asStep(c.minutes, 0, 59);

  // The minute clause, and whether it has already accounted for the hours.
  // Tracking that explicitly is what the previous version lacked: it appended
  // an hour suffix behind a condition that could not tell the two cases
  // apart, producing "at 0 minutes past , every 6 hours".
  let minutePhrase: string;
  let hoursCovered = false;

  if (everyMinute) {
    minutePhrase = 'every minute';
  } else if (minStep) {
    minutePhrase = `every ${minStep} minutes`;
  } else if (c.minutes.length === 1 && !everyHour) {
    // One minute value and specific hours is a list of clock times, so say
    // them as clock times. Splitting it into a minute clause plus an hour
    // clause gives "at 0 minutes past at 08:00 and 20:00", and listing the
    // hours alone would drop the minute entirely.
    const minute = c.minutes[0];
    const hourStep = asStep(c.hours, 0, 23);
    if (hourStep) {
      return withSeconds(c, `at ${minute} minutes past every ${hourStep} hours`);
    }
    // A gapless run of hours is hourly over a window; listing nine clock times
    // is accurate but harder to read than the shape it describes.
    if (c.hours.length > 2 && isContiguous(c.hours)) {
      const first = `${pad2(c.hours[0])}:${pad2(minute)}`;
      const last = `${pad2(c.hours[c.hours.length - 1])}:${pad2(minute)}`;
      return withSeconds(c, `hourly from ${first} to ${last}`);
    }
    const times = c.hours.map((h) => `${pad2(h)}:${pad2(minute)}`);
    return withSeconds(c, `at ${joinList(times)}`);
  } else if (c.minutes.length === 1) {
    minutePhrase = c.minutes[0] === 0
      ? 'every hour on the hour'
      : `at ${c.minutes[0]} minutes past every hour`;
    hoursCovered = true;
  } else {
    minutePhrase = `at ${joinList(c.minutes.map(String))} minutes past`;
    if (everyHour) {
      // "At 15 and 45 minutes past." leaves the reader asking "past what?".
      minutePhrase += ' every hour';
      hoursCovered = true;
    }
  }

  const parts = [minutePhrase];
  if (!everyHour && !hoursCovered && hourPhrase) parts.push(hourPhrase);

  return withSeconds(c, parts.join(' '));
}

/** Append the seconds offset, for a 6-field expression that names one. */
function withSeconds(c: ParsedCron, phrase: string): string {
  if (c.hasSeconds && c.seconds.length === 1 && c.seconds[0] !== 0) {
    return `${phrase} and ${c.seconds[0]} seconds`;
  }
  return phrase;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function describeDays(c: ParsedCron): string {
  const everyDom = isFullRange(c.daysOfMonth, 1, 31);
  const everyDow = c.daysOfWeek.length === 7;

  const parts: string[] = [];

  if (!everyDow) {
    const isWeekdays = c.daysOfWeek.length === 5 && c.daysOfWeek.every((d) => d >= 1 && d <= 5);
    const isWeekend = c.daysOfWeek.length === 2 && c.daysOfWeek.includes(0) && c.daysOfWeek.includes(6);
    if (isWeekdays) parts.push('on weekdays');
    else if (isWeekend) parts.push('at weekends');
    else parts.push(`on ${joinList(c.daysOfWeek.map((d) => DAY_LABELS[d]))}`);
  }

  if (!everyDom) {
    const domStep = asStep(c.daysOfMonth, 1, 31);
    parts.push(domStep ? `every ${domStep} days of the month` : `on the ${joinList(c.daysOfMonth.map(ordinal))}`);
  }

  if (parts.length === 2) {
    // Name the OR explicitly: this is the rule people get wrong, and a gloss
    // that reads as "and" would confirm the wrong reading.
    return `${parts[1]} and ${parts[0]} (either one, not both)`;
  }
  return parts[0] ?? '';
}

/**
 * A plain-English gloss of the schedule.
 *
 * Paired with `nextRuns()` in the UI on purpose — the sentence is a summary
 * and the fire times are the evidence. A gloss alone can read correctly and
 * still be a misreading of the expression.
 */
export function explainCron(c: ParsedCron): string {
  const time = describeTime(c);
  const days = describeDays(c);
  const months = isFullRange(c.months, 1, 12)
    ? ''
    : ` in ${joinList(c.months.map((m) => MONTH_LABELS[m - 1]))}`;

  const sentence = [time, days, months.trim() ? months.trim() : ''].filter(Boolean).join(' ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1) + '.';
}

export interface CronPreset {
  label: string;
  expression: string;
}

export const CRON_PRESETS: readonly CronPreset[] = [
  { label: 'Every minute',              expression: '* * * * *' },
  { label: 'Every 15 minutes',          expression: '*/15 * * * *' },
  { label: 'Hourly, on the hour',       expression: '0 * * * *' },
  { label: 'Daily at midnight',         expression: '0 0 * * *' },
  { label: 'Weekdays at 09:00',         expression: '0 9 * * 1-5' },
  { label: 'Every Monday at 08:30',     expression: '30 8 * * 1' },
  { label: 'First of the month',        expression: '0 0 1 * *' },
  { label: 'Quarterly',                 expression: '0 0 1 1,4,7,10 *' },
  { label: 'Every 6 hours',             expression: '0 */6 * * *' },
  { label: 'Twice daily (08:00, 20:00)', expression: '0 8,20 * * *' },
];
