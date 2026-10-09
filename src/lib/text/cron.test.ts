import { describe, it, expect } from 'vitest';
import {
  parseCron, nextRuns, explainCron, runsPerYear, CronError, CRON_PRESETS, MACROS,
} from './cron';

const iso = (d: Date) => d.toISOString();

describe('parseCron', () => {
  it('expands * to the whole range', () => {
    const c = parseCron('* * * * *');
    expect(c.minutes).toHaveLength(60);
    expect(c.hours).toHaveLength(24);
    expect(c.daysOfMonth).toHaveLength(31);
    expect(c.months).toHaveLength(12);
    expect(c.daysOfWeek).toHaveLength(7);
    expect(c.hasSeconds).toBe(false);
    expect(c.seconds).toEqual([0]); // a 5-field expression fires at :00
  });

  it('parses steps, ranges and lists', () => {
    expect(parseCron('*/15 * * * *').minutes).toEqual([0, 15, 30, 45]);
    expect(parseCron('0 9-17 * * *').hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(parseCron('0 0 1,15 * *').daysOfMonth).toEqual([1, 15]);
    expect(parseCron('0 10-20/5 * * *').hours).toEqual([10, 15, 20]);
  });

  it('reads a bare value with a step as "from here onward"', () => {
    // Vixie cron reads 5/10 as 5,15,25,35,45,55.
    expect(parseCron('5/10 * * * *').minutes).toEqual([5, 15, 25, 35, 45, 55]);
  });

  it('accepts month and weekday names', () => {
    expect(parseCron('0 0 1 jan,jul *').months).toEqual([1, 7]);
    expect(parseCron('0 0 * * mon-fri').daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(parseCron('0 0 * * SUN').daysOfWeek).toEqual([0]);
  });

  it('collapses weekday 7 onto 0, since both mean Sunday', () => {
    expect(parseCron('0 0 * * 7').daysOfWeek).toEqual([0]);
    expect(parseCron('0 0 * * 0,7').daysOfWeek).toEqual([0]);
  });

  it('treats ? as a synonym for *', () => {
    expect(parseCron('0 0 ? * *').daysOfMonth).toHaveLength(31);
  });

  it('accepts a 6-field expression with seconds', () => {
    const c = parseCron('30 * * * * *');
    expect(c.hasSeconds).toBe(true);
    expect(c.seconds).toEqual([30]);
  });

  it('expands the macros', () => {
    expect(parseCron('@daily').hours).toEqual([0]);
    expect(parseCron('@hourly').minutes).toEqual([0]);
    expect(parseCron('@weekly').daysOfWeek).toEqual([0]);
    expect(parseCron('@monthly').daysOfMonth).toEqual([1]);
    expect(parseCron('@yearly').months).toEqual([1]);
  });

  it('every documented macro parses', () => {
    for (const macro of Object.keys(MACROS)) {
      expect(() => parseCron(macro)).not.toThrow();
    }
  });

  it('flags the day-field union when both day fields are restricted', () => {
    expect(parseCron('0 0 13 * 5').dayUnion).toBe(true);
    expect(parseCron('0 0 13 * *').dayUnion).toBe(false);
    expect(parseCron('0 0 * * 5').dayUnion).toBe(false);
  });

  it('rejects the wrong field count', () => {
    expect(() => parseCron('* * *')).toThrow(/5 fields/);
    expect(() => parseCron('* * * * * * *')).toThrow(/7/);
    expect(() => parseCron('')).toThrow(/Enter a cron expression/);
  });

  it('rejects an out-of-range value, naming the field', () => {
    expect(() => parseCron('99 * * * *')).toThrow(/minute must be 0–59/);
    expect(() => parseCron('* 25 * * *')).toThrow(/hour must be 0–23/);
    expect(() => parseCron('* * 32 * *')).toThrow(/dayOfMonth must be 1–31/);
    expect(() => parseCron('* * * 13 *')).toThrow(/month must be 1–12/);
  });

  it('rejects a zero step, which would never match', () => {
    expect(() => parseCron('*/0 * * * *')).toThrow(/step of 0/);
  });

  it('rejects a step larger than its range, which silently means "once"', () => {
    expect(() => parseCron('*/99 * * * *')).toThrow(/larger than the minute range/);
  });

  it('rejects a backwards range rather than guessing at a wrap', () => {
    expect(() => parseCron('0 0 * * fri-mon')).toThrow(/runs backwards/);
  });

  it('rejects garbage, an empty list entry and an incomplete range', () => {
    expect(() => parseCron('abc * * * *')).toThrow(/not a valid minute/);
    expect(() => parseCron('1,,2 * * * *')).toThrow(/empty list entry/);
    expect(() => parseCron('1- * * * *')).toThrow(/incomplete range/);
  });

  it('rejects @reboot, which has no predictable schedule', () => {
    expect(() => parseCron('@reboot')).toThrow(/no schedule to predict/);
  });

  it('rejects an unknown macro', () => {
    expect(() => parseCron('@fortnightly')).toThrow(/not a recognised macro/);
  });

  it('rejects the Quartz extensions rather than mis-parsing them', () => {
    // Claiming L/W/# would let someone ship an expression their scheduler
    // rejects, which is worse than refusing it here.
    expect(() => parseCron('0 0 L * *')).toThrow(CronError);
    expect(() => parseCron('0 0 15W * *')).toThrow(CronError);
    expect(() => parseCron('0 0 * * 5#2')).toThrow(CronError);
  });
});

describe('nextRuns', () => {
  const from = new Date('2026-01-01T00:00:00Z'); // a Thursday

  it('never returns the instant it was given', () => {
    const runs = nextRuns(parseCron('* * * * *'), from, 1);
    expect(runs[0].getTime()).toBeGreaterThan(from.getTime());
  });

  it('steps minute by minute for * * * * *', () => {
    const runs = nextRuns(parseCron('* * * * *'), from, 3).map(iso);
    expect(runs).toEqual([
      '2026-01-01T00:01:00.000Z',
      '2026-01-01T00:02:00.000Z',
      '2026-01-01T00:03:00.000Z',
    ]);
  });

  it('honours a minute step', () => {
    expect(nextRuns(parseCron('*/15 * * * *'), from, 3).map(iso)).toEqual([
      '2026-01-01T00:15:00.000Z',
      '2026-01-01T00:30:00.000Z',
      '2026-01-01T00:45:00.000Z',
    ]);
  });

  it('honours an hour and minute pair', () => {
    expect(nextRuns(parseCron('30 9 * * *'), from, 2).map(iso)).toEqual([
      '2026-01-01T09:30:00.000Z',
      '2026-01-02T09:30:00.000Z',
    ]);
  });

  it('skips to the matching weekday', () => {
    // From Thursday 2026-01-01, the next Monday is the 5th.
    expect(nextRuns(parseCron('0 9 * * mon'), from, 2).map(iso)).toEqual([
      '2026-01-05T09:00:00.000Z',
      '2026-01-12T09:00:00.000Z',
    ]);
  });

  it('skips to the matching month, which needs the day-level skip to be cheap', () => {
    expect(nextRuns(parseCron('0 0 1 7 *'), from, 2).map(iso)).toEqual([
      '2026-07-01T00:00:00.000Z',
      '2027-07-01T00:00:00.000Z',
    ]);
  });

  it('applies the day-field union, not an intersection', () => {
    // "the 13th, OR any Friday" — 2026-01-02 is a Friday, so it fires before
    // the 13th. An AND reading would give Friday the 13th only.
    const runs = nextRuns(parseCron('0 0 13 * 5'), from, 3).map(iso);
    expect(runs[0]).toBe('2026-01-02T00:00:00.000Z');
    expect(runs).toContain('2026-01-09T00:00:00.000Z');
    expect(runs).toContain('2026-01-13T00:00:00.000Z');
  });

  it('handles seconds', () => {
    expect(nextRuns(parseCron('*/30 * * * * *'), from, 3).map(iso)).toEqual([
      '2026-01-01T00:00:30.000Z',
      '2026-01-01T00:01:00.000Z',
      '2026-01-01T00:01:30.000Z',
    ]);
  });

  it('finds 29 February only in a leap year', () => {
    const runs = nextRuns(parseCron('0 0 29 2 *'), new Date('2026-03-01T00:00:00Z'), 2).map(iso);
    expect(runs[0]).toBe('2028-02-29T00:00:00.000Z');
    expect(runs[1]).toBe('2032-02-29T00:00:00.000Z');
  });

  it('returns fewer than asked rather than hanging on an unmatchable schedule', () => {
    // 30 February parses but never occurs.
    expect(nextRuns(parseCron('0 0 30 2 *'), from, 5)).toEqual([]);
  });

  it('accepts a number as the start time', () => {
    expect(nextRuns(parseCron('0 * * * *'), from.getTime(), 1).map(iso))
      .toEqual(['2026-01-01T01:00:00.000Z']);
  });

  it('crosses a year boundary', () => {
    expect(nextRuns(parseCron('0 0 1 1 *'), new Date('2026-06-01T00:00:00Z'), 1).map(iso))
      .toEqual(['2027-01-01T00:00:00.000Z']);
  });

  it('starts from the next whole second when given a mid-second instant', () => {
    const runs = nextRuns(parseCron('* * * * *'), new Date('2026-01-01T00:00:00.500Z'), 1);
    expect(iso(runs[0])).toBe('2026-01-01T00:01:00.000Z');
  });
});

describe('runsPerYear', () => {
  it('counts the obvious schedules', () => {
    expect(runsPerYear(parseCron('* * * * *'))).toBe(365 * 24 * 60);
    expect(runsPerYear(parseCron('0 * * * *'))).toBe(365 * 24);
    expect(runsPerYear(parseCron('0 0 * * *'))).toBe(365);
    expect(runsPerYear(parseCron('0 0 1 1 *'))).toBe(1);
  });

  it('counts weekday-only schedules', () => {
    // 2025 has 261 weekdays.
    expect(runsPerYear(parseCron('0 9 * * 1-5'))).toBe(261);
  });
});

describe('explainCron', () => {
  it('glosses the common schedules in plain English', () => {
    expect(explainCron(parseCron('* * * * *')).toLowerCase()).toContain('every minute');
    expect(explainCron(parseCron('*/15 * * * *')).toLowerCase()).toContain('every 15 minutes');
    expect(explainCron(parseCron('0 0 * * *')).toLowerCase()).toContain('00:00');
    expect(explainCron(parseCron('0 9 * * 1-5')).toLowerCase()).toContain('weekday');
    expect(explainCron(parseCron('0 0 * * 0,6')).toLowerCase()).toContain('weekend');
  });

  it('names the months when they are restricted', () => {
    expect(explainCron(parseCron('0 0 1 1,4,7,10 *'))).toContain('January');
    expect(explainCron(parseCron('0 0 1 1,4,7,10 *'))).toContain('October');
  });

  it('says the day fields are an OR, which is the rule people misread', () => {
    expect(explainCron(parseCron('0 0 13 * 5')).toLowerCase()).toContain('either one, not both');
  });

  it('uses ordinals for days of the month', () => {
    const text = explainCron(parseCron('0 0 1,2,3,21 * *'));
    expect(text).toContain('1st');
    expect(text).toContain('2nd');
    expect(text).toContain('3rd');
    expect(text).toContain('21st');
  });

  it('ends in a full stop and starts capitalised', () => {
    const text = explainCron(parseCron('*/5 * * * *'));
    expect(text.endsWith('.')).toBe(true);
    expect(text[0]).toBe(text[0].toUpperCase());
  });

  it('produces a non-empty sentence for every preset', () => {
    for (const preset of CRON_PRESETS) {
      const text = explainCron(parseCron(preset.expression));
      expect(text.length).toBeGreaterThan(3);
    }
  });

  // A gapped hour list must never be stated as a range. `0 8,20 * * *` ran
  // twice a day and was glossed "between 08:00 and 20:59" — a thirteen-hour
  // window, the exact misreading this gloss exists to prevent.
  it('lists gapped hours instead of spanning them as a range', () => {
    const text = explainCron(parseCron('0 8,20 * * *'));
    expect(text).toContain('08:00');
    expect(text).toContain('20:00');
    expect(text).not.toMatch(/between/i);
  });

  it('states a gapless run of hours as a window', () => {
    expect(explainCron(parseCron('0 9-17 * * *')).toLowerCase()).toContain('hourly from 09:00 to 17:00');
  });

  it('reads one minute across several hours as clock times', () => {
    expect(explainCron(parseCron('30 2,14 1 * *'))).toContain('02:30');
    expect(explainCron(parseCron('30 2,14 1 * *'))).toContain('14:30');
  });

  // Guards the malformed output "At 0 minutes past , every 6 hours." — an
  // hour clause appended behind a condition that could not tell whether the
  // minute clause had already accounted for the hours.
  it('never emits a dangling clause or stray punctuation', () => {
    const expressions = [
      '0 */6 * * *', '0 0,12 * * *', '30 */4 * * *', '0 8,20 * * *',
      '0 9-17 * * *', '5 * * * *', '15,45 * * * *', '*/5 8,12,18 * * *',
      '0 0 * * *', '* * * * *', '30 0 * * *', '15,45 9-17 * * *',
      ...CRON_PRESETS.map((p) => p.expression),
    ];
    for (const expr of expressions) {
      const text = explainCron(parseCron(expr));
      expect(text, expr).not.toMatch(/\s,/);           // " ," — a clause vanished
      expect(text, expr).not.toMatch(/past\s+[,.]/);   // "past ." / "past ,"
      expect(text, expr).not.toMatch(/\bat at\b/);
      expect(text, expr).not.toMatch(/past at\b/);
      expect(text, expr).not.toMatch(/ {2}/);
      expect(text, expr).toMatch(/^[A-Z].*\.$/s);
    }
  });
});

describe('CRON_PRESETS', () => {
  it('every preset parses and has a reachable next run', () => {
    for (const preset of CRON_PRESETS) {
      const parsed = parseCron(preset.expression);
      expect(nextRuns(parsed, new Date('2026-01-01T00:00:00Z'), 1)).toHaveLength(1);
    }
  });
});
