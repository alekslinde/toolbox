import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  ERROR_CODES,
  FRICTION_CODES,
  REPORT_CODES,
  UA_CLASSES,
  EVENT_KINDS,
  isErrorCode,
  isFrictionCode,
  isReportCode,
  isUaClass,
  isValidCode,
  classifyUa,
  fingerprint,
  sizeBucket,
} from './telemetry-codes';

const WORKER = readFileSync(join(import.meta.dirname, '../../worker/counter.js'), 'utf8');

/** Pull a quoted string list out of a `new Set([...])` in the Worker source. */
function workerSet(label: string): string[] {
  // Matches `label: new Set([ ... ])` or `const LABEL = new Set([ ... ])`.
  const re = new RegExp(`${label}\\s*[:=]\\s*new Set\\(\\[([^\\]]*)\\]`, 's');
  const m = WORKER.match(re);
  if (!m) throw new Error(`could not find set "${label}" in worker/counter.js`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('worker vocabulary stays in sync with the enum', () => {
  // The Worker is plain JS and cannot import the TypeScript enum, so the lists
  // are duplicated. A drift would silently reject real events or admit
  // unvalidated ones, and neither failure is visible from the outside.

  it('error codes match', () => {
    expect(workerSet('error').sort()).toEqual([...ERROR_CODES].sort());
  });

  it('friction codes match', () => {
    expect(workerSet('friction').sort()).toEqual([...FRICTION_CODES].sort());
  });

  it('report codes match', () => {
    expect(workerSet('report').sort()).toEqual([...REPORT_CODES].sort());
  });

  it('ua classes match', () => {
    expect(workerSet('UA_CLASSES').sort()).toEqual([...UA_CLASSES].sort());
  });

  it('size buckets match the bucketing function', () => {
    const produced = new Set([
      sizeBucket(NaN), sizeBucket(0), sizeBucket(1), sizeBucket(200 * 1024),
      sizeBucket(5 * 1024 * 1024), sizeBucket(20 * 1024 * 1024), sizeBucket(100 * 1024 * 1024),
    ]);
    const accepted = new Set(workerSet('SIZE_BUCKETS'));
    const unaccepted = [...produced].filter((b) => !accepted.has(b));
    expect(unaccepted).toEqual([]);
  });
});

describe('code guards', () => {
  it('accept only their own vocabulary', () => {
    expect(isErrorCode('HEIC_DECODE_FAIL')).toBe(true);
    expect(isErrorCode('ABANDONED')).toBe(false);
    expect(isFrictionCode('ABANDONED')).toBe(true);
    expect(isFrictionCode('UNKNOWN')).toBe(false);
    expect(isReportCode('TOO_SLOW')).toBe(true);
    expect(isReportCode('WRONG')).toBe(false);
    expect(isUaClass('ios-safari')).toBe(true);
    expect(isUaClass('netscape')).toBe(false);
  });

  it('rejects a free-text code', () => {
    // The whole point of the enum: an arbitrary string must never be reportable.
    expect(isValidCode('error', 'Cannot read file tax-return.pdf')).toBe(false);
    expect(isValidCode('error', '')).toBe(false);
    expect(isValidCode('nonsense', 'UNKNOWN')).toBe(false);
  });

  it('pairs each kind with the right vocabulary', () => {
    expect(isValidCode('error', 'TIMEOUT')).toBe(true);
    expect(isValidCode('friction', 'TIMEOUT')).toBe(false);
    expect(isValidCode('report', 'CONFUSING')).toBe(true);
    expect(isValidCode('error', 'CONFUSING')).toBe(false);
  });

  it('covers every declared kind', () => {
    expect([...EVENT_KINDS].sort()).toEqual(['error', 'friction', 'report']);
  });
});

describe('classifyUa', () => {
  it('treats every iOS browser as WebKit', () => {
    // Chrome on iOS is Safari underneath, so a WebKit bug reported from it must
    // group with the Safari one rather than look like a Chrome bug.
    const iosChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120';
    const iosSafari = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1';
    expect(classifyUa(iosChrome)).toBe('ios-safari');
    expect(classifyUa(iosSafari)).toBe('ios-safari');
  });

  it('separates desktop engines', () => {
    expect(classifyUa('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120 Safari/537.36')).toBe('desktop-chrome');
    expect(classifyUa('Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15')).toBe('desktop-safari');
    expect(classifyUa('Mozilla/5.0 (X11; Linux) Gecko/20100101 Firefox/121.0')).toBe('desktop-firefox');
  });

  it('counts Edge as Chromium', () => {
    expect(classifyUa('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120')).toBe('desktop-chrome');
  });

  it('classifies Android', () => {
    expect(classifyUa('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile')).toBe('android-chrome');
  });

  it('falls back rather than throwing', () => {
    expect(classifyUa('')).toBe('other');
    expect(classifyUa('curl/8.4.0')).toBe('other');
  });

  it('only ever returns a declared class', () => {
    const samples = ['', 'curl/8', 'Mozilla/5.0 (iPhone)', 'Chrome/1', 'Firefox/1', 'Safari/1', 'Android'];
    const bad = samples.map(classifyUa).filter((c) => !isUaClass(c));
    expect(bad).toEqual([]);
  });
});

describe('fingerprint', () => {
  it('is identical for the same problem seen by different people', () => {
    // Two users hitting one bug must produce one group, or the count is
    // meaningless. Nothing per-user may enter the fingerprint.
    const a = fingerprint('error', 'image-convert', 'HEIC_DECODE_FAIL', 'ios-safari');
    const b = fingerprint('error', 'image-convert', 'HEIC_DECODE_FAIL', 'ios-safari');
    expect(a).toBe(b);
  });

  it('separates different tools, codes and browser classes', () => {
    const base = fingerprint('error', 'image-convert', 'HEIC_DECODE_FAIL', 'ios-safari');
    expect(fingerprint('error', 'pdf-compress', 'HEIC_DECODE_FAIL', 'ios-safari')).not.toBe(base);
    expect(fingerprint('error', 'image-convert', 'TIMEOUT', 'ios-safari')).not.toBe(base);
    expect(fingerprint('error', 'image-convert', 'HEIC_DECODE_FAIL', 'desktop-chrome')).not.toBe(base);
  });

  it('matches the fingerprint the worker builds', () => {
    // Both sides must agree or groups split in half.
    expect(WORKER).toContain('const fp = `${kind}:${tool}:${code}:${ua}`');
    expect(fingerprint('error', 'x', 'TIMEOUT', 'other')).toBe('error:x:TIMEOUT:other');
  });
});

describe('sizeBucket', () => {
  it('buckets rather than reporting an exact size', () => {
    // An exact byte count is close to a file identifier; a bucket is not.
    expect(sizeBucket(0)).toBe('0');
    expect(sizeBucket(50_000)).toBe('<100KB');
    expect(sizeBucket(500_000)).toBe('<1MB');
    expect(sizeBucket(5_000_000)).toBe('<10MB');
    expect(sizeBucket(20_000_000)).toBe('<50MB');
    expect(sizeBucket(80_000_000)).toBe('>=50MB');
  });

  it('handles nonsense without throwing', () => {
    expect(sizeBucket(NaN)).toBe('unknown');
    expect(sizeBucket(-1)).toBe('unknown');
    expect(sizeBucket(Infinity)).toBe('unknown');
  });
});

describe('worker privacy guarantees', () => {
  it('stores no free-text column on events', () => {
    // The events table must have no column that could hold a filename, a note
    // or an exception message. Shape and code only.
    const schema = WORKER.match(/CREATE TABLE IF NOT EXISTS events \(([^)]*)\)/s)?.[1] ?? '';
    expect(schema).toBeTruthy();
    const columns = schema
      .split('\n')
      .map((l) => l.trim().split(/\s+/)[0])
      .filter((c) => c && !/^(id|ts|day|ip_hash|kind|tool|code|size|mime|ms|ua_class|fp)$/.test(c));
    expect(columns).toEqual([]);
  });

  it('hashes the IP before it is stored', () => {
    expect(WORKER).toMatch(/const ipHash = await hashIP\(ip\)/);
  });

  it('validates the mime field as a type, not a filename', () => {
    const m = WORKER.match(/const MIME_RE = (\/.*\/);/);
    expect(m).toBeTruthy();
    const re = new RegExp(m![1].slice(1, -1));
    expect(re.test('image/png')).toBe(true);
    expect(re.test('application/pdf')).toBe(true);
    // A filename, a path or anything with a space must not pass.
    expect(re.test('tax-return-2024.pdf')).toBe(false);
    expect(re.test('../private/photo.jpg')).toBe(false);
    expect(re.test('image/png; name=secret.png')).toBe(false);
  });

  it('prunes on a retention window rather than keeping rows forever', () => {
    expect(WORKER).toMatch(/EVENT_RETENTION_DAYS\s*=\s*\d+/);
    expect(WORKER).toMatch(/DELETE FROM events WHERE day < \?/);
  });

  it('actually invokes the prune on a schedule', () => {
    // The prune action existed from the start but nothing called it, so the
    // retention window was a promise rather than a mechanism. A handler that
    // is never invoked deletes nothing.
    expect(WORKER).toMatch(/async scheduled\(/);
    const handler = WORKER.slice(WORKER.indexOf('async scheduled('));
    expect(handler.slice(0, handler.indexOf('async fetch('))).toContain("action=prune");

    const cfg = readFileSync(join(import.meta.dirname, '../../wrangler.toml'), 'utf8');
    expect(cfg).toMatch(/\[triggers\]/);
    expect(cfg).toMatch(/crons\s*=\s*\[/);
  });

  it('keeps the original reports table intact', () => {
    // It holds live data and its endpoint still works; the events table is a
    // sibling, not a replacement.
    expect(WORKER).toContain('CREATE TABLE IF NOT EXISTS reports');
    expect(WORKER).toContain("action === 'submit'");
    expect(WORKER).toContain("action === 'list'");
  });

  it('guards the admin and prune routes behind the bearer token', () => {
    const ev = WORKER.slice(WORKER.indexOf("url.pathname === '/ev'"));
    const block = ev.slice(0, ev.indexOf('Page-view counter'));
    // Both the read and the destructive sweep check the secret.
    expect(block.match(/FEEDBACK_SECRET/g)?.length).toBeGreaterThanOrEqual(2);
    expect(block).toContain("request.method === 'DELETE'");
  });
});
