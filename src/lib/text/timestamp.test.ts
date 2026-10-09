import { describe, it, expect } from 'vitest';
import {
  inferUnit, toMs, fromMs, parseInstant, render, relativeTime,
  isoWeek, dayOfYear, isRenderable, TimestampError,
} from './timestamp';

describe('inferUnit', () => {
  it('reads a ten-digit value as seconds', () => {
    expect(inferUnit(1_700_000_000)).toBe('seconds');
  });

  it('reads a thirteen-digit value as milliseconds', () => {
    expect(inferUnit(1_700_000_000_000)).toBe('milliseconds');
  });

  it('reads microseconds and nanoseconds', () => {
    expect(inferUnit(1_700_000_000_000_000)).toBe('microseconds');
    expect(inferUnit(1_700_000_000_000_000_000)).toBe('nanoseconds');
  });

  it('treats a small number as seconds, duration-like though it is', () => {
    expect(inferUnit(0)).toBe('seconds');
    expect(inferUnit(60)).toBe('seconds');
  });

  it('ignores the sign, so pre-1970 dates infer the same way', () => {
    expect(inferUnit(-1_700_000_000_000)).toBe('milliseconds');
  });
});

describe('toMs / fromMs', () => {
  it('round-trips every unit', () => {
    for (const unit of ['seconds', 'milliseconds', 'microseconds', 'nanoseconds'] as const) {
      const ms = 1_700_000_000_000;
      expect(toMs(fromMs(ms, unit), unit)).toBeCloseTo(ms, 0);
    }
  });

  it('floors rather than rounds when converting down to seconds', () => {
    expect(fromMs(1999, 'seconds')).toBe(1);
  });
});

describe('parseInstant', () => {
  const now = Date.UTC(2026, 0, 1);

  it('resolves "now"', () => {
    expect(parseInstant('now', undefined, now).ms).toBe(now);
    expect(parseInstant('NOW', undefined, now).ms).toBe(now);
  });

  it('infers the unit of a bare epoch number and says it inferred', () => {
    const r = parseInstant('1700000000');
    expect(r.unit).toBe('seconds');
    expect(r.inferred).toBe(true);
    expect(r.ms).toBe(1_700_000_000_000);
  });

  it('honours a forced unit over the inference', () => {
    const r = parseInstant('1700000000', 'milliseconds');
    expect(r.unit).toBe('milliseconds');
    expect(r.inferred).toBe(false);
    expect(r.ms).toBe(1_700_000_000);
  });

  it('accepts fractional epoch seconds, as logs emit them', () => {
    expect(parseInstant('1700000000.5').ms).toBe(1_700_000_000_500);
  });

  it('accepts a negative epoch for a pre-1970 date', () => {
    expect(parseInstant('-86400').ms).toBe(-86_400_000);
  });

  it('parses an ISO 8601 string', () => {
    const r = parseInstant('2026-01-01T00:00:00Z');
    expect(r.unit).toBe('date-string');
    expect(r.ms).toBe(now);
  });

  it('parses an HTTP date', () => {
    expect(parseInstant('Thu, 01 Jan 2026 00:00:00 GMT').ms).toBe(now);
  });

  it('rejects empty input and unparseable text', () => {
    expect(() => parseInstant('')).toThrow(TimestampError);
    expect(() => parseInstant('   ')).toThrow(/Enter a timestamp/);
    expect(() => parseInstant('not a date')).toThrow(/Not a recognised/);
  });

  it('rejects a number that lands outside the representable range', () => {
    // Seconds large enough to overflow once multiplied into milliseconds.
    expect(() => parseInstant('99999999999999', 'seconds')).toThrow(/outside the range/);
  });

  it('infers a huge bare number as nanoseconds, which divides back into range', () => {
    // The magnitude rule is what saves this: read as seconds it would
    // overflow, and a tool that threw on a pasted nanosecond timestamp would
    // look broken on perfectly good input.
    const r = parseInstant('1700000000000000000');
    expect(r.unit).toBe('nanoseconds');
    expect(r.ms).toBe(1_700_000_000_000);
  });
});

describe('isRenderable', () => {
  it('accepts the Date range and rejects beyond it', () => {
    expect(isRenderable(0)).toBe(true);
    expect(isRenderable(8.64e15)).toBe(true);
    expect(isRenderable(8.64e15 + 1)).toBe(false);
    expect(isRenderable(NaN)).toBe(false);
    expect(isRenderable(Infinity)).toBe(false);
  });
});

describe('isoWeek', () => {
  it('puts 2026-01-01 in week 1', () => {
    expect(isoWeek(new Date('2026-01-01T00:00:00Z'))).toEqual({ year: 2026, week: 1 });
  });

  it('assigns a year-start to the previous year when the week belongs there', () => {
    // 2027-01-01 is a Friday, so that week's Thursday is in 2026 → 2026-W53.
    expect(isoWeek(new Date('2027-01-01T00:00:00Z'))).toEqual({ year: 2026, week: 53 });
  });

  it('assigns a late-December date to week 1 of the next year when it belongs there', () => {
    // 2024-12-30 is a Monday whose Thursday is 2025-01-02 → 2025-W01.
    expect(isoWeek(new Date('2024-12-30T00:00:00Z'))).toEqual({ year: 2025, week: 1 });
  });
});

describe('dayOfYear', () => {
  it('counts from 1', () => {
    expect(dayOfYear(new Date('2026-01-01T00:00:00Z'))).toBe(1);
    expect(dayOfYear(new Date('2026-12-31T00:00:00Z'))).toBe(365);
  });

  it('accounts for a leap day', () => {
    expect(dayOfYear(new Date('2024-12-31T00:00:00Z'))).toBe(366);
  });
});

describe('relativeTime', () => {
  const now = Date.UTC(2026, 0, 1);

  it('says "just now" inside a second', () => {
    expect(relativeTime(now, now)).toBe('just now');
    expect(relativeTime(now + 500, now)).toBe('just now');
  });

  it('describes past and future', () => {
    expect(relativeTime(now - 5 * 60_000, now)).toMatch(/5 minutes ago|ago/);
    expect(relativeTime(now + 2 * 3_600_000, now)).toMatch(/in 2 hours|hours/);
  });

  it('scales up to years', () => {
    expect(relativeTime(now - 3 * 31_536_000_000, now)).toMatch(/year/);
  });
});

describe('render', () => {
  const ms = Date.UTC(2026, 0, 2, 3, 4, 5, 678);

  it('renders the UTC forms', () => {
    const r = render(ms, ms);
    expect(r.iso).toBe('2026-01-02T03:04:05.678Z');
    expect(r.http).toBe('Fri, 02 Jan 2026 03:04:05 GMT');
  });

  it('reports every epoch unit as a string', () => {
    const r = render(Date.UTC(2026, 0, 1), ms);
    expect(r.epoch.seconds).toBe('1767225600');
    expect(r.epoch.milliseconds).toBe('1767225600000');
    expect(r.epoch.microseconds).toBe('1767225600000000');
    expect(r.epoch.nanoseconds).toBe('1767225600000000000');
  });

  it('reports the calendar facts a log reader wants', () => {
    const r = render(ms, ms);
    expect(r.dayOfWeek).toBe('Friday');
    expect(r.isoWeek).toBe('2026-W01');
    expect(r.dayOfYear).toBe(2);
  });

  it('includes a local ISO string carrying a real offset', () => {
    const r = render(ms, ms);
    expect(r.localIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
    expect(r.offset).toMatch(/^[+-]\d{2}:\d{2}$/);
  });

  it('refuses an instant outside the Date range', () => {
    expect(() => render(9e15)).toThrow(TimestampError);
  });

  it('renders the epoch itself', () => {
    expect(render(0, 0).iso).toBe('1970-01-01T00:00:00.000Z');
  });
});
