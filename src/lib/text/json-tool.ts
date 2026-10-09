/**
 * JSON formatting, validation and conversion.
 *
 * `JSON.parse` already validates, but its error messages are the one thing it
 * does badly: "Unexpected token } in JSON at position 417" tells you nothing
 * about *which* line, and position 417 of a minified payload is unfindable by
 * hand. So the parse result here carries a line/column and the offending
 * excerpt, which is the whole reason a validator beats a bare try/catch.
 *
 * Pure string→string. No DOM, no network.
 */

export interface JsonError {
  message: string;
  /**
   * 1-based, for display against a line-numbered gutter. Null when the engine
   * gave no usable position — the UI must then say the location is unknown
   * rather than point at line 1, which would send the reader to the wrong
   * place with full confidence.
   */
  line: number | null;
  column: number | null;
  /** Character offset into the source, or null when unknown. */
  offset: number | null;
  /** The source line, so the UI can point at the fault without re-splitting. */
  excerpt: string;
}

export type JsonResult =
  | { ok: true; value: unknown }
  | { ok: false; error: JsonError };

/** Line and column for a character offset. Clamped, so a bad offset is safe. */
export function lineColumnAt(src: string, offset: number): { line: number; column: number } {
  const at = Math.max(0, Math.min(offset, src.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < at; i++) {
    if (src.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: at - lineStart + 1 };
}

/**
 * Locate a `JSON.parse` failure in the source.
 *
 * Engines word this differently, and V8 changed it: some errors carry
 * "at position 12 (line 3 column 5)", but the common "Unexpected token"
 * form carries **no position at all** and instead quotes an excerpt of the
 * source around the fault:
 *
 *   Unexpected token ',', ..."1,\n  "b": ,\n}" is not valid JSON
 *
 * So there are three strategies, tried in order of reliability, and a
 * null result when none of them applies. Returning null rather than 0 matters:
 * offset 0 is a real position, and reporting "line 1" for a fault on line 40
 * is worse than admitting the line is unknown, because the user trusts it and
 * looks in the wrong place.
 */
function offsetFromParseError(msg: string, src: string): number | null {
  // V8 / JSC, when the position is stated outright.
  const pos = /position (\d+)/i.exec(msg);
  if (pos) return Number(pos[1]);

  // SpiderMonkey: "JSON.parse: ... at line 3 column 5 of the JSON data".
  const lineCol = /at line (\d+) column (\d+)/i.exec(msg);
  if (lineCol) {
    const line = Number(lineCol[1]);
    const column = Number(lineCol[2]);
    const lines = src.split('\n');
    let offset = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) offset += lines[i].length + 1;
    return offset + column - 1;
  }

  // Newer V8: the message names the offending token and quotes an excerpt of
  // the source around it:
  //
  //   Unexpected token '@', ..."1,\n  1,\n  @\n]" is not valid JSON
  //
  // When that token occurs exactly once in the whole source, it *is* the
  // fault and no search ambiguity exists. This is the strongest signal
  // available and worth trying before the excerpt, which carries context on
  // both sides of the fault and so does not pinpoint it.
  const tokenMatch = /^Unexpected token '(.+?)'/.exec(msg);
  if (tokenMatch) {
    const token = tokenMatch[1];
    const occurrences: number[] = [];
    for (let at = src.indexOf(token); at >= 0; at = src.indexOf(token, at + 1)) {
      occurrences.push(at);
      if (occurrences.length > 64) break; // enough to know it is ambiguous
    }

    if (occurrences.length === 1) return occurrences[0];

    // Several occurrences: the column is unknowable, but the *line* still is
    // not if every occurrence sits on one line. `NaN` reports token 'N', which
    // occurs twice within the same literal — the line is certain even though
    // which 'N' is not. Returning the first of them gives the right line, and
    // the line is what the reader needs.
    if (occurrences.length > 1 && occurrences.length <= 64) {
      const lineOf = (at: number) => lineColumnAt(src, at).line;
      const firstLine = lineOf(occurrences[0]);
      if (occurrences.every((at) => lineOf(at) === firstLine)) return occurrences[0];
    }

    // Otherwise the token is punctuation spread across the document — `,` in
    // `[1,\n2,,\n3]` occurs three times on three lines and only one of them is
    // the fault. Nothing in the message says which, so fall through to the
    // excerpt rather than picking one and sounding certain.
  }

  const excerptMatch = /"((?:[^"\\]|\\.)*)"\s+is not valid JSON/.exec(msg);
  if (excerptMatch) {
    let excerpt = excerptMatch[1];
    // The message JSON-escapes the excerpt; unescape so it can be found.
    try {
      excerpt = JSON.parse(`"${excerpt}"`);
    } catch {
      /* leave it as-is and try the raw form */
    }
    // Strip the elision markers that say the excerpt was cut from the source.
    const trimmed = excerpt.replace(/^\.\.\./, '').replace(/\.\.\.$/, '');

    // An excerpt that spans the whole source locates nothing — its start is
    // just the start of the document, and reporting line 1 from it would be a
    // guess wearing a line number. Only a genuinely elided excerpt narrows
    // anything down.
    const elided = excerpt.startsWith('...') || excerpt.endsWith('...');
    if (trimmed && elided) {
      // `lastIndexOf`, not `indexOf`: a short excerpt from repetitive input is
      // ambiguous, and a parser stops *at* the fault, so the occurrence
      // nearest the end of the source is the one it was looking at.
      const excerptAt = src.lastIndexOf(trimmed);
      if (excerptAt >= 0) return excerptAt + trimmed.length - 1;
    }
  }

  // "Unexpected end of JSON input" and anything else unrecognised: the fault
  // is at the end of the source, which is at least true rather than guessed.
  if (/unexpected end of (?:json input|data)/i.test(msg)) return src.length;

  return null;
}

/**
 * Reduce an engine parse error to the part worth showing.
 *
 * The engine appends a quoted excerpt of the source: `Unexpected token ',',
 * ..."1,\n  "b": ,\n}" is not valid JSON`. That excerpt has to go — it repeats
 * input already on screen, and it arrives with literal `\n` escapes in it.
 *
 * It cannot be matched as a quoted string, which is the trap: a JSON excerpt
 * contains unescaped interior quotes almost by definition, so a
 * `"(?:[^"\\]|\\.)*"` pattern stops at the first interior quote and strips
 * only a trailing sliver, leaving a half-quoted fragment behind. The excerpt
 * instead starts at the first quote after the token and runs to the end of
 * the message, so cutting from there is both simpler and correct.
 */
function cleanParseMessage(raw: string): string {
  let msg = raw;

  // V8's "Unexpected token 'x', <excerpt> is not valid JSON". The token is
  // single-quoted and may itself be a comma, so the quotes are matched
  // explicitly rather than lazily up to the first comma — which would cut the
  // message to "Unexpected token '" whenever the offending token was a comma,
  // the single most common malformed-JSON case.
  const tokenForm = /^(Unexpected token '(?:[^']|'')*'|Unexpected token .)/.exec(msg);
  if (tokenForm && /is not valid JSON\s*$/i.test(msg)) {
    msg = tokenForm[1];
  } else if (/is not valid JSON\s*$/i.test(msg)) {
    // No token named — the whole message is `"<excerpt>" is not valid JSON`,
    // which says nothing a reader cannot see. Replace it rather than emit a
    // quoted copy of their own input.
    msg = 'Not valid JSON';
  }

  return (
    msg
      .replace(/\s*at position \d+.*$/i, '')
      .replace(/\s*at line \d+ column \d+.*$/i, '')
      .replace(/\s*in JSON$/i, '')
      .replace(/[\s,]+$/, '')
      .trim() || 'Invalid JSON'
  );
}

export function parseJson(src: string): JsonResult {
  try {
    return { ok: true, value: JSON.parse(src) };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const offset = offsetFromParseError(raw, src);
    const pos = offset === null ? null : lineColumnAt(src, offset);
    const lineText = pos ? src.split('\n')[pos.line - 1] ?? '' : '';
    return {
      ok: false,
      error: {
        // Strip the engine's own position and source excerpt: we render our
        // own position, and two disagreeing positions in one message reads as
        // a bug. The excerpt also repeats input already on screen.
        message: cleanParseMessage(raw),
        line: pos?.line ?? null,
        column: pos?.column ?? null,
        offset,
        excerpt: lineText.length > 200 ? lineText.slice(0, 200) + '…' : lineText,
      },
    };
  }
}

export type SortMode = 'none' | 'keys';

export interface FormatOptions {
  /** Spaces per level, or 'tab'. 0 means minify. */
  indent: number | 'tab';
  sort?: SortMode;
}

/**
 * Recursively sort object keys. Arrays keep their order — array order is data,
 * object key order is not.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Format a parsed value. Separated from parsing so the UI can do one without the other. */
export function formatValue(value: unknown, opts: FormatOptions): string {
  const prepared = opts.sort === 'keys' ? sortKeys(value) : value;
  const indent = opts.indent === 'tab' ? '\t' : opts.indent;
  return JSON.stringify(prepared, null, indent);
}

/** Parse then format in one step, propagating the error. */
export function formatJson(src: string, opts: FormatOptions): JsonResult & { text?: string } {
  const res = parseJson(src);
  if (!res.ok) return res;
  return { ...res, text: formatValue(res.value, opts) };
}

export interface JsonStats {
  objects: number;
  arrays: number;
  strings: number;
  numbers: number;
  booleans: number;
  nulls: number;
  /** Deepest nesting level. 0 for a scalar at the root. */
  depth: number;
  /** Total keys across all objects, duplicates counted once per object. */
  keys: number;
}

/**
 * Walk the parsed value and count what it contains.
 *
 * Worth having because the common JSON question is not "is this valid" but
 * "what is in here" — a 4 MB response is unreadable and a shape summary is
 * what the user actually wanted.
 */
export function jsonStats(value: unknown): JsonStats {
  const s: JsonStats = {
    objects: 0, arrays: 0, strings: 0, numbers: 0,
    booleans: 0, nulls: 0, depth: 0, keys: 0,
  };

  // Iterative walk with an explicit stack: a deeply nested document would
  // blow the call stack on recursion, and "valid JSON the tool crashed on"
  // is exactly the failure a validator must not have.
  const stack: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop()!;
    if (depth > s.depth) s.depth = depth;

    if (node === null) { s.nulls++; continue; }
    if (Array.isArray(node)) {
      s.arrays++;
      for (const item of node) stack.push({ node: item, depth: depth + 1 });
      continue;
    }
    switch (typeof node) {
      case 'object': {
        s.objects++;
        const entries = Object.entries(node as Record<string, unknown>);
        s.keys += entries.length;
        for (const [, v] of entries) stack.push({ node: v, depth: depth + 1 });
        break;
      }
      case 'string':  s.strings++;  break;
      case 'number':  s.numbers++;  break;
      case 'boolean': s.booleans++; break;
    }
  }
  return s;
}

/**
 * Escape a string for embedding in JSON, without the surrounding quotes.
 * `JSON.stringify` does the escaping correctly; slicing the quotes off is
 * safe because it always emits them.
 */
export function escapeJsonString(s: string): string {
  return JSON.stringify(s).slice(1, -1);
}

/**
 * Reverse of the above. Throws on malformed escapes, same as the parser.
 *
 * The input is already-escaped text, so a bare `"` in it is a user error while
 * a `\"` is correct. Escaping every quote would turn `\"` into `\\"` — a
 * literal backslash followed by the end of the string — so only quotes that
 * are not already escaped get one, counting the preceding backslashes to tell
 * which is which (`\\"` ends in an unescaped quote; `\\\"` does not).
 */
export function unescapeJsonString(s: string): string {
  let body = '';
  let pendingBackslashes = 0;
  for (const ch of s) {
    if (ch === '\\') {
      pendingBackslashes++;
      body += ch;
      continue;
    }
    if (ch === '"' && pendingBackslashes % 2 === 0) body += '\\';
    body += ch;
    pendingBackslashes = 0;
  }
  const parsed = JSON.parse(`"${body}"`);
  return typeof parsed === 'string' ? parsed : String(parsed);
}
