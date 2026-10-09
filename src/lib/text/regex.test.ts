import { describe, it, expect } from 'vitest';
import {
  compile, run, replace, segments, explain, validateFlags,
  backtrackingRisk, RegexError, MATCH_CAP, MAX_INPUT_LENGTH,
} from './regex';

describe('validateFlags', () => {
  it('accepts the valid flags', () => {
    expect(validateFlags('gimsu')).toBe('gimsu');
    expect(validateFlags('imsy')).toBe('imsy');
    expect(validateFlags('')).toBe('');
  });

  it('rejects an unknown flag, a repeat, and the mutually exclusive pairs', () => {
    expect(() => validateFlags('q')).toThrow(/not a valid regex flag/);
    expect(() => validateFlags('gg')).toThrow(/repeated/);
    expect(() => validateFlags('uv')).toThrow(/cannot both be set/);
    expect(() => validateFlags('gy')).toThrow(/cannot both be set/);
  });
});

describe('compile', () => {
  it('compiles a valid pattern', () => {
    expect(compile('a+', 'g')).toBeInstanceOf(RegExp);
  });

  it('requires a pattern', () => {
    expect(() => compile('', 'g')).toThrow(/Enter a pattern/);
  });

  it('reports a syntax error without echoing the whole pattern back', () => {
    try {
      compile('(unclosed', '');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(RegexError);
      expect((e as Error).message).not.toMatch(/^Invalid regular expression/);
    }
  });
});

describe('backtrackingRisk', () => {
  it('flags a nested quantifier', () => {
    expect(backtrackingRisk('(a+)+b')).not.toHaveLength(0);
    expect(backtrackingRisk('(a*)*')).not.toHaveLength(0);
  });

  it('flags a repeated alternation', () => {
    expect(backtrackingRisk('(a|ab)+')).not.toHaveLength(0);
  });

  it('flags adjacent open-ended quantifiers', () => {
    expect(backtrackingRisk('.*.*=.*')).not.toHaveLength(0);
  });

  it('leaves ordinary patterns alone', () => {
    expect(backtrackingRisk('^\\d{3}-\\d{4}$')).toEqual([]);
    expect(backtrackingRisk('[a-z]+@[a-z]+\\.[a-z]{2,}')).toEqual([]);
    expect(backtrackingRisk('(foo|bar)')).toEqual([]);
  });

  it('carries the offending construct so a message can point at it', () => {
    const [first] = backtrackingRisk('(a+)+b');
    expect(first.construct).toContain('+');
    expect(first.message.length).toBeGreaterThan(10);
  });
});

describe('run', () => {
  it('returns the first match without the g flag', () => {
    const r = run('\\d+', '', 'a1b22c333');
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ text: '1', index: 1 });
  });

  it('returns every match with the g flag', () => {
    const r = run('\\d+', 'g', 'a1b22c333');
    expect(r.matches.map((m) => m.text)).toEqual(['1', '22', '333']);
    expect(r.matches.map((m) => m.index)).toEqual([1, 3, 6]);
  });

  it('captures numbered and named groups', () => {
    const r = run('(?<y>\\d{4})-(\\d{2})', '', '2026-01');
    expect(r.matches[0].groups).toEqual(['2026', '01']);
    expect(r.matches[0].named).toEqual({ y: '2026' });
  });

  it('reports a non-participating group as undefined rather than dropping it', () => {
    const r = run('(a)|(b)', '', 'b');
    expect(r.matches[0].groups).toEqual([undefined, 'b']);
  });

  it('terminates on a zero-length global match', () => {
    // Without the lastIndex nudge this loops forever and freezes the tab.
    const r = run('(?:)', 'g', 'abc');
    expect(r.matches.length).toBeLessThanOrEqual(MATCH_CAP);
    expect(r.matches.length).toBeGreaterThan(0);
  });

  it('terminates on a pattern that can match empty at each position', () => {
    const r = run('a*', 'g', 'bbb');
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.matches.every((m) => m.text === '')).toBe(true);
  });

  it('caps matches and says it truncated', () => {
    const r = run('a', 'g', 'a'.repeat(MATCH_CAP + 50));
    expect(r.matches).toHaveLength(MATCH_CAP);
    expect(r.truncated).toBe(true);
  });

  it('does not claim truncation when the cap landed exactly on the end', () => {
    const r = run('a', 'g', 'a'.repeat(MATCH_CAP));
    expect(r.matches).toHaveLength(MATCH_CAP);
    expect(r.truncated).toBe(false);
  });

  it('refuses a risky pattern until the risk is confirmed', () => {
    expect(() => run('(a+)+b', '', 'aaaaaaaaaaaaaaaaaaaaaaaaaaa!')).toThrow(/Confirm to run it anyway/);
  });

  it('runs a risky pattern once confirmed', () => {
    const r = run('(a+)+', 'g', 'aaa', { confirmRisk: true });
    expect(r.matches[0].text).toBe('aaa');
  });

  it('refuses input above the length cap', () => {
    expect(() => run('a', 'g', 'a'.repeat(MAX_INPUT_LENGTH + 1))).toThrow(/capped at/);
  });

  it('reports a duration', () => {
    expect(run('a', 'g', 'aaa').ms).toBeGreaterThanOrEqual(0);
  });

  it('returns no matches rather than failing when nothing matches', () => {
    expect(run('z+', 'g', 'abc').matches).toEqual([]);
  });
});

describe('segments', () => {
  it('splits into matched and unmatched runs', () => {
    const r = run('\\d+', 'g', 'a1b22c');
    expect(segments('a1b22c', r.matches)).toEqual([
      { text: 'a', match: null },
      { text: '1', match: 0 },
      { text: 'b', match: null },
      { text: '22', match: 1 },
      { text: 'c', match: null },
    ]);
  });

  it('handles a match at the very start and end', () => {
    const r = run('\\d', 'g', '1a2');
    expect(segments('1a2', r.matches)).toEqual([
      { text: '1', match: 0 },
      { text: 'a', match: null },
      { text: '2', match: 1 },
    ]);
  });

  it('returns the whole input as one unmatched run when nothing matched', () => {
    expect(segments('abc', [])).toEqual([{ text: 'abc', match: null }]);
  });

  it('returns nothing for empty input', () => {
    expect(segments('', [])).toEqual([]);
  });

  it('skips zero-length matches rather than emitting empty spans', () => {
    const r = run('a*', 'g', 'bb');
    const segs = segments('bb', r.matches);
    expect(segs.every((s) => s.text !== '')).toBe(true);
    expect(segs.map((s) => s.text).join('')).toBe('bb');
  });

  it('reconstructs the input exactly', () => {
    const input = 'the year 2026 and the year 2027';
    const r = run('\\d{4}', 'g', input);
    expect(segments(input, r.matches).map((s) => s.text).join('')).toBe(input);
  });
});

describe('replace', () => {
  it('replaces with group references', () => {
    expect(replace('(\\w+)@(\\w+)', 'g', 'me@here', '$2:$1')).toBe('here:me');
  });

  it('replaces globally only with the g flag', () => {
    expect(replace('a', '', 'aaa', 'b')).toBe('baa');
    expect(replace('a', 'g', 'aaa', 'b')).toBe('bbb');
  });

  it('refuses a risky pattern and an oversized input', () => {
    expect(() => replace('(a+)+', '', 'aaa', 'x')).toThrow(/backtrack/);
    expect(() => replace('a', 'g', 'a'.repeat(MAX_INPUT_LENGTH + 1), 'b')).toThrow(/capped at/);
  });
});

describe('explain', () => {
  it('names the constructs present', () => {
    const notes = explain('(?<year>\\d{4})\\b');
    const tokens = notes.map((n) => n.token);
    expect(tokens).toContain('(?<name>…)');
    expect(tokens).toContain('\\d');
    expect(tokens).toContain('\\b');
  });

  it('distinguishes the four lookaround forms', () => {
    expect(explain('(?=a)').map((n) => n.token)).toContain('(?=…)');
    expect(explain('(?!a)').map((n) => n.token)).toContain('(?!…)');
    expect(explain('(?<=a)').map((n) => n.token)).toContain('(?<=…)');
    expect(explain('(?<!a)').map((n) => n.token)).toContain('(?<!…)');
  });

  it('does not repeat a construct that appears twice', () => {
    const notes = explain('\\d\\d\\d');
    expect(notes.filter((n) => n.token === '\\d')).toHaveLength(1);
  });

  it('returns nothing for a pattern with no notable constructs', () => {
    expect(explain('abc')).toEqual([]);
  });
});
