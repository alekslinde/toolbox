import { describe, it, expect } from 'vitest';
import {
  parseJson, formatValue, formatJson, jsonStats, lineColumnAt,
  escapeJsonString, unescapeJsonString,
} from './json-tool';

describe('lineColumnAt', () => {
  it('reports 1-based line and column', () => {
    expect(lineColumnAt('abc', 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumnAt('abc', 2)).toEqual({ line: 1, column: 3 });
  });

  it('counts lines across newlines', () => {
    const src = 'a\nbb\nccc';
    expect(lineColumnAt(src, 2)).toEqual({ line: 2, column: 1 });
    expect(lineColumnAt(src, 5)).toEqual({ line: 3, column: 1 });
  });

  it('clamps an out-of-range offset rather than throwing', () => {
    expect(lineColumnAt('ab', 99)).toEqual({ line: 1, column: 3 });
    expect(lineColumnAt('ab', -5)).toEqual({ line: 1, column: 1 });
  });
});

describe('parseJson', () => {
  it('parses valid JSON', () => {
    const r = parseJson('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
  });

  it('parses the scalar and array roots too', () => {
    expect(parseJson('42')).toEqual({ ok: true, value: 42 });
    expect(parseJson('null')).toEqual({ ok: true, value: null });
    expect(parseJson('[1,2]')).toEqual({ ok: true, value: [1, 2] });
  });

  it('reports a line number for an error, which is the point of it', () => {
    const src = '{\n  "a": 1,\n  "bee": oops\n}';
    const r = parseJson(src);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      // The fault is on line 3. V8 reports this form with no position at all,
      // only a quoted excerpt — falling back to offset 0 would say "line 1"
      // and send the reader to the wrong place with full confidence.
      expect(r.error.line).toBe(3);
      expect(r.error.excerpt).toContain('"bee"');
    }
  });

  it('locates a fault deep in a multi-line document', () => {
    const src = '[\n' + '  1,\n'.repeat(40) + '  @\n]';
    const r = parseJson(src);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBe(42);
      expect(r.error.excerpt).toContain('@');
    }
  });

  it('locates a fault reported with an explicit position', () => {
    const r = parseJson('{');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.line).toBe(1);
  });

  // The engine gives three different kinds of message and none of them is a
  // plain position, so these are the cases that actually exercise the
  // locator. Checked against the real engine rather than a mocked message.
  it.each([
    ['a trailing comma',        '{\n  "a": 1,\n  "b": 2,\n}',      4],
    ['a missing colon',         '{\n  "a" 1\n}',                    2],
    ['an unquoted key',         '{\n  "ok": 1,\n  bad: 2\n}',       3],
    ['an unterminated string',  '{\n  "a": "oops\n}',               2],
    ['a NaN literal',           '{\n  "a": NaN\n}',                 2],
    ['an undefined literal',    '{\n "a": 1,\n "b": undefined\n}',  3],
    ['a single-quoted key',     "{\n 'a': 1\n}",                    2],
    ['a stray character',       '[\n 1,\n @\n]',                    3],
  ])('locates %s', (_label, src, line) => {
    const r = parseJson(src);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.line).toBe(line);
  });

  it('reports an unresolvable position as null rather than guessing line 1', () => {
    // `,` occurs on three lines here and the engine names only the token, so
    // which comma it stopped at is genuinely unknown. A confident "line 1"
    // (or "line 2") sends the reader to a comma that is perfectly valid —
    // worse than admitting the line is unknown, because they trust it.
    for (const src of ['[\n 1,\n 2,,\n 3\n]', '{\n "a": 1,\n "b": ,\n}']) {
      const r = parseJson(src);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.line).toBeNull();
        expect(r.error.column).toBeNull();
        expect(r.error.offset).toBeNull();
      }
    }
  });

  it('still reports a message when the position is unknown', () => {
    const r = parseJson('[\n 1,\n 2,,\n 3\n]');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message.length).toBeGreaterThan(0);
  });

  it('leaves the engine excerpt out of the message, since the input is on screen', () => {
    const r = parseJson('{\n  "a": 1,\n  "b": ,\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).not.toMatch(/is not valid JSON/);
      expect(r.error.message.length).toBeGreaterThan(0);
    }
  });

  it('strips the engine position from the message so only one position shows', () => {
    const r = parseJson('{');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).not.toMatch(/position \d+/i);
      expect(r.error.message.length).toBeGreaterThan(0);
    }
  });

  it('truncates a very long offending line', () => {
    const r = parseJson('{"a": ' + '"x"'.repeat(200) + '}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.excerpt.length).toBeLessThanOrEqual(201);
  });
});

describe('formatValue', () => {
  it('indents with spaces', () => {
    expect(formatValue({ a: 1 }, { indent: 2 })).toBe('{\n  "a": 1\n}');
  });

  it('indents with a tab', () => {
    expect(formatValue({ a: 1 }, { indent: 'tab' })).toBe('{\n\t"a": 1\n}');
  });

  it('minifies at indent 0', () => {
    expect(formatValue({ a: 1, b: [2, 3] }, { indent: 0 })).toBe('{"a":1,"b":[2,3]}');
  });

  it('sorts object keys recursively when asked', () => {
    const out = formatValue({ b: { d: 1, c: 2 }, a: 3 }, { indent: 0, sort: 'keys' });
    expect(out).toBe('{"a":3,"b":{"c":2,"d":1}}');
  });

  it('leaves array order alone when sorting keys — order is data in an array', () => {
    const out = formatValue({ xs: [3, 1, 2] }, { indent: 0, sort: 'keys' });
    expect(out).toBe('{"xs":[3,1,2]}');
  });

  it('sorts keys inside objects nested in arrays', () => {
    const out = formatValue([{ b: 1, a: 2 }], { indent: 0, sort: 'keys' });
    expect(out).toBe('[{"a":2,"b":1}]');
  });
});

describe('formatJson', () => {
  it('returns formatted text for valid input', () => {
    const r = formatJson('{"a":1}', { indent: 2 });
    expect(r.ok).toBe(true);
    expect(r.text).toBe('{\n  "a": 1\n}');
  });

  it('propagates the parse error and emits no text', () => {
    const r = formatJson('{bad}', { indent: 2 });
    expect(r.ok).toBe(false);
    expect(r.text).toBeUndefined();
  });
});

describe('jsonStats', () => {
  it('counts each value type', () => {
    const s = jsonStats({ a: 'x', b: 1, c: true, d: null, e: [1, 2], f: {} });
    expect(s.objects).toBe(2); // the root and `f`
    expect(s.arrays).toBe(1);
    expect(s.strings).toBe(1);
    expect(s.numbers).toBe(3); // b, and the two array members
    expect(s.booleans).toBe(1);
    expect(s.nulls).toBe(1);
    expect(s.keys).toBe(6);
  });

  it('measures depth', () => {
    expect(jsonStats(1).depth).toBe(0);
    expect(jsonStats({ a: { b: { c: 1 } } }).depth).toBe(3);
    expect(jsonStats([[[1]]]).depth).toBe(3);
  });

  it('survives a document deep enough to blow a recursive walk', () => {
    // Build 50k levels of nesting. A recursive implementation would throw
    // RangeError here, and "valid JSON the validator crashed on" is the one
    // failure a validator must not have.
    let node: unknown = 1;
    for (let i = 0; i < 50_000; i++) node = [node];
    const s = jsonStats(node);
    expect(s.arrays).toBe(50_000);
    expect(s.depth).toBe(50_000);
  });
});

describe('escapeJsonString / unescapeJsonString', () => {
  it('round-trips quotes, backslashes and newlines', () => {
    const raw = 'he said "hi"\\ok\nnext\ttab';
    expect(unescapeJsonString(escapeJsonString(raw))).toBe(raw);
  });

  it('escapes without adding surrounding quotes', () => {
    expect(escapeJsonString('a"b')).toBe('a\\"b');
  });

  it('round-trips non-ASCII', () => {
    const raw = 'café — 日本語 🎉';
    expect(unescapeJsonString(escapeJsonString(raw))).toBe(raw);
  });
});
