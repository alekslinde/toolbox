/**
 * The closed set of telemetry codes.
 *
 * Why a closed enum and not free text: these codes are produced while
 * processing a user's own file, and an exception message can carry the
 * filename with it. A filename leaks — "Q3-redundancies-draft.pdf" discloses
 * more than the document's contents would. So the rule is absolute:
 *
 *   The CODE is transmitted. The MESSAGE never is.
 *
 * A closed enum also keeps the dashboard legible. Grouping only works if the
 * same failure reports the same string every time, and a long tail of one-off
 * messages cannot be ranked or turned into an issue.
 *
 * Adding a code is deliberate: name it here, and the guard test confirms
 * nothing reports a code that is not in this list.
 */

export const ERROR_CODES = [
  // ── Input rejected before any work started ────────────────────────────────
  'UNSUPPORTED_TYPE',      // the file is not a type this tool accepts
  'FILE_TOO_LARGE',        // over the tool's size ceiling
  'FILE_EMPTY',            // zero bytes
  'TOO_MANY_FILES',        // batch exceeds the per-run cap

  // ── The file claimed a format it did not honour ───────────────────────────
  'DECODE_FAILED',         // the bytes are not decodable as their stated type
  'CORRUPT_INPUT',         // structurally invalid
  'ENCRYPTED_INPUT',       // password-protected; we cannot and will not crack it
  'HEIC_DECODE_FAIL',      // HEIC specifically — its decoder fails differently
  'PDF_PARSE_FAIL',
  'FONT_PARSE_FAIL',
  'SVG_PARSE_FAIL',
  'IMAGE_DECODE_FAIL',

  // ── The work itself failed ────────────────────────────────────────────────
  'ENCODE_FAILED',         // could not write the output format
  'OUT_OF_MEMORY',         // the device could not hold the decoded file
  'CANVAS_UNAVAILABLE',    // canvas or its context could not be obtained
  'WORKER_FAILED',         // the worker thread died
  'TIMEOUT',               // exceeded the operation's time budget

  // ── Network, for the one tool that reaches out ────────────────────────────
  'FETCH_FAILED',          // the remote page could not be retrieved
  'PROXY_FAILED',          // every CORS proxy failed
  'INVALID_URL',

  // ── Anything not yet classified ───────────────────────────────────────────
  'UNCAUGHT',              // window.onerror / unhandledrejection
  'UNKNOWN',               // a thrown value that carried no code
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const ERROR_CODE_SET: ReadonlySet<string> = new Set(ERROR_CODES);

export function isErrorCode(v: unknown): v is ErrorCode {
  return typeof v === 'string' && ERROR_CODE_SET.has(v);
}

/**
 * Friction codes: not failures, but signals that the tool did not serve the
 * user well. These are cheaper to collect than errors and say more, because a
 * tool can "succeed" and still waste someone's time.
 */
export const FRICTION_CODES = [
  'ABANDONED',             // a file was loaded, no output was ever produced
  'RETRIED',               // same tool, same input type, inside a short window
  'NO_SAVING',             // a compressor returned output >= its input
  'REJECTED_TYPE',         // a file was dropped that the tool does not accept
  'SLOW_RUN',              // the run exceeded this tool's slow threshold
  'BATCH_PARTIAL',         // some files in a batch failed
] as const;

export type FrictionCode = (typeof FRICTION_CODES)[number];

const FRICTION_CODE_SET: ReadonlySet<string> = new Set(FRICTION_CODES);

export function isFrictionCode(v: unknown): v is FrictionCode {
  return typeof v === 'string' && FRICTION_CODE_SET.has(v);
}

/**
 * Reason chips for the negative feedback control. Fixed options, not prose:
 * chips aggregate into something rankable, and prose is where personal data
 * arrives — a free-text box invites someone to paste the very content this
 * project promises never to transmit.
 */
export const REPORT_CODES = [
  'WRONG_OUTPUT',
  'TOO_SLOW',
  'CONFUSING',
  'FAILED',
] as const;

export type ReportCode = (typeof REPORT_CODES)[number];

const REPORT_CODE_SET: ReadonlySet<string> = new Set(REPORT_CODES);

export function isReportCode(v: unknown): v is ReportCode {
  return typeof v === 'string' && REPORT_CODE_SET.has(v);
}

export type EventKind = 'error' | 'friction' | 'report';

export const EVENT_KINDS: readonly EventKind[] = ['error', 'friction', 'report'];

/** Whether `code` is valid for `kind`. The Worker rejects anything else. */
export function isValidCode(kind: string, code: unknown): boolean {
  if (kind === 'error') return isErrorCode(code);
  if (kind === 'friction') return isFrictionCode(code);
  if (kind === 'report') return isReportCode(code);
  return false;
}

/**
 * Coarse browser classes. Deliberately coarse: a full user-agent string is a
 * fingerprinting surface, and "which engine, roughly, on which form factor" is
 * all that is needed to tell "this fails on iOS Safari" from "this fails
 * everywhere".
 */
export const UA_CLASSES = [
  'ios-safari',
  'android-chrome',
  'desktop-safari',
  'desktop-chrome',
  'desktop-firefox',
  'other',
] as const;

export type UaClass = (typeof UA_CLASSES)[number];

const UA_CLASS_SET: ReadonlySet<string> = new Set(UA_CLASSES);

export function isUaClass(v: unknown): v is UaClass {
  return typeof v === 'string' && UA_CLASS_SET.has(v);
}

/** Bucket a user-agent string into one of the coarse classes above. */
export function classifyUa(ua: string): UaClass {
  const s = ua.toLowerCase();
  const mobile = /iphone|ipad|ipod|android/.test(s);

  if (/iphone|ipad|ipod/.test(s)) return 'ios-safari'; // all iOS browsers are WebKit
  if (/android/.test(s)) return mobile && /firefox/.test(s) ? 'other' : 'android-chrome';
  if (/firefox|fxios/.test(s)) return 'desktop-firefox';
  if (/edg\//.test(s)) return 'desktop-chrome'; // Edge is Chromium
  if (/chrome|chromium/.test(s)) return 'desktop-chrome';
  if (/safari/.test(s)) return 'desktop-safari';
  return 'other';
}

/**
 * Group fingerprint. Events sharing a fingerprint are the same problem, which
 * is what makes 500 rows collapse into a dozen rankable groups.
 *
 * Deliberately excludes anything per-user: no IP, no timestamp, no file
 * identity. Two different people hitting the same bug must produce the same
 * fingerprint, or the count means nothing.
 */
export function fingerprint(kind: string, tool: string, code: string, uaClass: string): string {
  return `${kind}:${tool}:${code}:${uaClass}`;
}

/** Size buckets, so a payload carries magnitude without carrying a file. */
export function sizeBucket(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown';
  if (bytes === 0) return '0';
  if (bytes < 100 * 1024) return '<100KB';
  if (bytes < 1024 * 1024) return '<1MB';
  if (bytes < 10 * 1024 * 1024) return '<10MB';
  if (bytes < 50 * 1024 * 1024) return '<50MB';
  return '>=50MB';
}
