/**
 * Regex testing against a sample string.
 *
 * The non-obvious hazard here is that a user-supplied pattern can hang the
 * tab. `/(a+)+b/` against forty `a`s backtracks for longer than anyone will
 * wait, and because the match runs inside the regex engine there is no way to
 * interrupt it from JavaScript. So this module does two things: it screens for
 * the structural shape that causes catastrophic backtracking *before*
 * executing anything, and it bounds the work it attempts. A tester that can
 * freeze the page is worse than no tester.
 */

export interface RegexMatch {
  /** Full match text. */
  text: string;
  index: number;
  /** Numbered groups, index 0 being group 1. Undefined for non-participating groups. */
  groups: (string | undefined)[];
  named: Record<string, string | undefined>;
}

export interface RegexResult {
  matches: RegexMatch[];
  /** True when the match cap was hit and more matches exist. */
  truncated: boolean;
  /** Milliseconds the match took, for surfacing a slow pattern. */
  ms: number;
}

export class RegexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegexError';
  }
}

export const FLAG_INFO: readonly { flag: string; label: string; detail: string }[] = [
  { flag: 'g', label: 'global',      detail: 'Find every match, not just the first.' },
  { flag: 'i', label: 'ignore case', detail: 'Match regardless of upper or lower case.' },
  { flag: 'm', label: 'multiline',   detail: '^ and $ match at each line break, not just the ends of the string.' },
  { flag: 's', label: 'dot all',     detail: 'Let . match newlines too.' },
  { flag: 'u', label: 'unicode',     detail: 'Treat the pattern as Unicode code points; required for \\p{…}.' },
  { flag: 'y', label: 'sticky',      detail: 'Match only at lastIndex — anchored to the search position.' },
];

const VALID_FLAGS = new Set(['g', 'i', 'm', 's', 'u', 'y', 'd', 'v']);

/** Cap on matches collected. A global match against a large input can produce
 *  more results than any UI can render, and the user reads the first few. */
export const MATCH_CAP = 1000;

/** Inputs above this are refused rather than matched: the backtracking cost of
 *  a bad pattern scales with input length, and this is the cheap half of the
 *  defence. */
export const MAX_INPUT_LENGTH = 100_000;

export interface RiskWarning {
  /** The construct found, so the message can point at it. */
  construct: string;
  message: string;
}

/**
 * Screen a pattern for catastrophic-backtracking shapes.
 *
 * This is a heuristic and says so: it detects nested quantifiers and
 * alternations inside a quantified group, which covers the overwhelming
 * majority of real exponential patterns. It will occasionally warn about a
 * pattern that is actually fine. That trade is deliberate — a false warning
 * costs a sentence of explanation, and a missed one costs the tab.
 */
export function backtrackingRisk(pattern: string): RiskWarning[] {
  const warnings: RiskWarning[] = [];

  // A quantified group whose body is itself quantified: (a+)+ (a*)* (a+)*
  const nested = /\((?:\?[:<=!][^)]*|[^)])*?[+*}]\s*\)\s*[+*]/.exec(pattern);
  if (nested) {
    warnings.push({
      construct: nested[0],
      message: 'A repeated group that already repeats inside can take exponential time on input that nearly matches.',
    });
  }

  // An alternation inside a quantified group where branches can match the same
  // text: (a|ab)+ — the engine tries every division of the input.
  const altInQuant = /\((?:\?[:<=!])?[^)]*\|[^)]*\)\s*[+*]/.exec(pattern);
  if (altInQuant) {
    warnings.push({
      construct: altInQuant[0],
      message: 'A repeated alternation can retry every possible split of the input if the branches overlap.',
    });
  }

  // Two adjacent open-ended quantifiers over overlapping classes: .*.*
  const adjacent = /(\.\*|\.\+|\[[^\]]*\][*+])\s*(\.\*|\.\+|\[[^\]]*\][*+])/.exec(pattern);
  if (adjacent) {
    warnings.push({
      construct: adjacent[0],
      message: 'Two open-ended quantifiers in a row multiply the ways the input can be divided between them.',
    });
  }

  return warnings;
}

export function validateFlags(flags: string): string {
  const seen = new Set<string>();
  for (const f of flags) {
    if (!VALID_FLAGS.has(f)) throw new RegexError(`"${f}" is not a valid regex flag`);
    if (seen.has(f)) throw new RegexError(`Flag "${f}" is repeated`);
    seen.add(f);
  }
  if (seen.has('u') && seen.has('v')) throw new RegexError('The u and v flags cannot both be set');
  if (seen.has('g') && seen.has('y')) throw new RegexError('The g and y flags cannot both be set');
  return flags;
}

/** Compile a pattern, turning the engine's error into something readable. */
export function compile(pattern: string, flags: string): RegExp {
  if (!pattern) throw new RegexError('Enter a pattern.');
  validateFlags(flags);
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    // Engine messages are prefixed with the whole pattern, which is noise when
    // the pattern is already on screen above the error.
    throw new RegexError(raw.replace(/^Invalid regular expression:\s*\/.*\/[a-z]*:\s*/i, ''));
  }
}

/**
 * Run a pattern over the input and collect matches.
 *
 * `confirmRisk` must be true for a pattern the screener flagged — the caller
 * is expected to have asked. Without it the pattern is refused rather than
 * run, which is the only reliable protection: once the engine starts, nothing
 * can stop it.
 */
export function run(
  pattern: string,
  flags: string,
  input: string,
  opts: { confirmRisk?: boolean } = {},
): RegexResult {
  if (input.length > MAX_INPUT_LENGTH) {
    throw new RegexError(
      `Test input is capped at ${MAX_INPUT_LENGTH.toLocaleString()} characters; this is ${input.length.toLocaleString()}.`,
    );
  }

  if (!opts.confirmRisk) {
    const risks = backtrackingRisk(pattern);
    if (risks.length) {
      throw new RegexError(
        `This pattern contains ${risks[0].construct} — ${risks[0].message} Confirm to run it anyway.`,
      );
    }
  }

  const re = compile(pattern, flags);
  const global = flags.includes('g') || flags.includes('y');
  const matches: RegexMatch[] = [];
  const started = performance.now();
  let truncated = false;

  const push = (m: RegExpExecArray) => {
    matches.push({
      text: m[0],
      index: m.index,
      groups: m.slice(1),
      named: m.groups ? { ...m.groups } : {},
    });
  };

  if (!global) {
    const m = re.exec(input);
    if (m) push(m);
  } else {
    let m: RegExpExecArray | null;
    while ((m = re.exec(input)) !== null) {
      push(m);
      // A zero-length match does not advance lastIndex, so the loop would spin
      // forever on a pattern like /(?:)/g.
      if (m[0] === '') re.lastIndex++;
      if (matches.length >= MATCH_CAP) {
        truncated = re.exec(input) !== null;
        break;
      }
    }
  }

  return { matches, truncated, ms: performance.now() - started };
}

export interface Segment {
  text: string;
  /** Match index this segment belongs to, or null for unmatched text. */
  match: number | null;
}

/**
 * Split the input into matched and unmatched runs, for highlighting.
 *
 * Returning segments rather than HTML keeps the escaping decision at the
 * boundary where it belongs: the caller sets `textContent` on each span, so
 * input containing markup cannot become markup.
 */
export function segments(input: string, matches: RegexMatch[]): Segment[] {
  if (!matches.length) return input ? [{ text: input, match: null }] : [];
  const out: Segment[] = [];
  let cursor = 0;

  matches.forEach((m, i) => {
    // Overlapping or out-of-order matches cannot be rendered as a flat run;
    // skipping them is better than emitting negative-length slices.
    if (m.index < cursor) return;
    if (m.index > cursor) out.push({ text: input.slice(cursor, m.index), match: null });
    if (m.text.length) out.push({ text: m.text, match: i });
    cursor = m.index + m.text.length;
  });

  if (cursor < input.length) out.push({ text: input.slice(cursor), match: null });
  return out;
}

/**
 * Apply a replacement, with `$1`-style references working as the engine
 * defines them.
 */
export function replace(pattern: string, flags: string, input: string, replacement: string, opts: { confirmRisk?: boolean } = {}): string {
  if (input.length > MAX_INPUT_LENGTH) {
    throw new RegexError(`Test input is capped at ${MAX_INPUT_LENGTH.toLocaleString()} characters.`);
  }
  if (!opts.confirmRisk && backtrackingRisk(pattern).length) {
    throw new RegexError('This pattern may backtrack catastrophically. Confirm to run it anyway.');
  }
  return input.replace(compile(pattern, flags), replacement);
}

export interface TokenNote {
  token: string;
  meaning: string;
}

/**
 * Annotate the constructs present in a pattern.
 *
 * Not a parser and not a syntax tree — a lookup of what the user is already
 * looking at. Someone debugging `(?<=\bfoo)` wants to be told it is a lookbehind,
 * not shown a railroad diagram.
 */
export function explain(pattern: string): TokenNote[] {
  const notes: TokenNote[] = [];
  const seen = new Set<string>();
  const add = (token: string, meaning: string) => {
    if (seen.has(token)) return;
    seen.add(token);
    notes.push({ token, meaning });
  };

  const checks: [RegExp, string, string][] = [
    [/\(\?<[a-z_$][\w$]*>/i, '(?<name>…)', 'Named capture group — available as groups.name'],
    [/\(\?:/,                '(?:…)',      'Non-capturing group — groups without capturing'],
    [/\(\?=/,                '(?=…)',      'Lookahead — the following text must match, but is not consumed'],
    [/\(\?!/,                '(?!…)',      'Negative lookahead — the following text must not match'],
    [/\(\?<=/,               '(?<=…)',     'Lookbehind — the preceding text must match'],
    [/\(\?<!/,               '(?<!…)',     'Negative lookbehind — the preceding text must not match'],
    [/\\b/,                  '\\b',        'Word boundary — between a word character and a non-word character'],
    [/\\B/,                  '\\B',        'Not a word boundary'],
    [/\\d/,                  '\\d',        'Any digit, 0–9'],
    [/\\D/,                  '\\D',        'Any character that is not a digit'],
    [/\\w/,                  '\\w',        'Word character — letter, digit or underscore'],
    [/\\W/,                  '\\W',        'Any character that is not a word character'],
    [/\\s/,                  '\\s',        'Whitespace — space, tab, newline and friends'],
    [/\\S/,                  '\\S',        'Any non-whitespace character'],
    [/\\p\{/,                '\\p{…}',     'Unicode property escape — needs the u or v flag'],
    [/\\[1-9]/,              '\\1',        'Backreference — matches whatever that group captured'],
    [/\[\^/,                 '[^…]',       'Negated character class — any character not listed'],
    [/\{\d+,\d*\}/,          '{n,m}',      'Repeat between n and m times'],
    [/\+\?|\*\?|\}\?/,       '+? *?',      'Lazy quantifier — match as few characters as possible'],
    [/\$$|\$\|/,             '$',          'End of input, or end of line with the m flag'],
    [/^\^|\|\^/,             '^',          'Start of input, or start of line with the m flag'],
  ];

  for (const [re, token, meaning] of checks) {
    if (re.test(pattern)) add(token, meaning);
  }
  return notes;
}
