import {
  classifyUa,
  isValidCode,
  sizeBucket,
  type ErrorCode,
  type EventKind,
  type FrictionCode,
  type ReportCode,
} from './telemetry-codes';

/**
 * Client-side telemetry.
 *
 * The one rule this module exists to enforce: a payload carries a CODE and a
 * SHAPE, never CONTENT. No filename, no file bytes, no user-entered text, no
 * exception message, no stack. Everything below is built so that the only way
 * to send something is through `send()`, and `send()` cannot be handed a free
 * string field.
 *
 * This is what keeps "nothing is uploaded" literally true: a crash reporter
 * that quietly shipped processing context would make the site's central claim
 * false, and the claim is the product.
 */

export interface EventPayload {
  kind: EventKind;
  tool: string;
  code: string;
  /** Input magnitude as a bucket, never a byte count that could identify a file. */
  size?: string;
  /** MIME type only — a type is a category, a filename is an identifier. */
  mime?: string;
  /** Duration in ms, rounded, for slow-run grouping. */
  ms?: number;
}

const ENDPOINT = '/ev';

/** Opt-out, honoured before anything else. */
const OPT_OUT_KEY = 'telemetry-opt-out';

export function hasOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false; // private mode: storage throws, treat as not opted out
  }
}

export function setOptOut(on: boolean): void {
  try {
    if (on) localStorage.setItem(OPT_OUT_KEY, '1');
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* storage unavailable — the setting simply does not persist */
  }
}

/**
 * Respect Do Not Track and Global Privacy Control. Neither is legally binding
 * here, but ignoring an explicit "do not track me" while advertising a
 * privacy-first tool would be dishonest.
 */
function signalsNoTracking(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string };
  if (nav.globalPrivacyControl === true) return true;
  if (nav.doNotTrack === '1') return true;
  return false;
}

export function telemetryEnabled(): boolean {
  return !hasOptedOut() && !signalsNoTracking();
}

/**
 * Fire-and-forget. Never throws, never blocks, never retries — telemetry that
 * can break a tool is worse than no telemetry.
 */
export function send(payload: EventPayload): void {
  if (!telemetryEnabled()) return;
  if (!isValidCode(payload.kind, payload.code)) return; // unknown code: drop it

  const body = JSON.stringify({
    kind: payload.kind,
    tool: payload.tool,
    code: payload.code,
    size: payload.size,
    mime: payload.mime,
    ms: payload.ms,
    ua: classifyUa(navigator.userAgent),
  });

  try {
    // sendBeacon survives the page being closed, which is exactly when an
    // abandonment event needs to get out.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      return;
    }
  } catch {
    /* fall through to fetch */
  }

  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* telemetry must never surface to the user */
  }
}

export function reportError(tool: string, code: ErrorCode, shape?: { bytes?: number; mime?: string }): void {
  send({
    kind: 'error',
    tool,
    code,
    size: shape?.bytes === undefined ? undefined : sizeBucket(shape.bytes),
    mime: shape?.mime,
  });
}

export function reportFriction(
  tool: string,
  code: FrictionCode,
  shape?: { bytes?: number; mime?: string; ms?: number },
): void {
  send({
    kind: 'friction',
    tool,
    code,
    size: shape?.bytes === undefined ? undefined : sizeBucket(shape.bytes),
    mime: shape?.mime,
    ms: shape?.ms === undefined ? undefined : Math.round(shape.ms),
  });
}

export function reportFeedback(tool: string, code: ReportCode): void {
  send({ kind: 'report', tool, code });
}

/**
 * A typed error carrying a transmittable code. Throw this from tool logic so
 * the catch site has a code to report without ever reading `.message`.
 */
export class ToolError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    // The message is for the developer console and the user-facing string the
    // page chooses to show. It is never transmitted.
    super(message ?? code);
    this.name = 'ToolError';
    this.code = code;
  }
}

/** Extract a transmittable code from an unknown thrown value. */
export function codeOf(e: unknown): ErrorCode {
  if (e instanceof ToolError) return e.code;
  // A RangeError from an oversized allocation is the common out-of-memory
  // shape in browsers, and is worth separating from the generic bucket.
  if (e instanceof RangeError) return 'OUT_OF_MEMORY';
  return 'UNKNOWN';
}

/**
 * Install global handlers. Uncaught errors report only that something failed
 * on a given tool — the message and stack are deliberately discarded, since a
 * minified stack is useless for debugging and a message may contain a filename.
 */
export function installGlobalHandlers(tool: string): void {
  if (!telemetryEnabled()) return;

  window.addEventListener('error', () => {
    send({ kind: 'error', tool, code: 'UNCAUGHT' });
  });

  window.addEventListener('unhandledrejection', () => {
    send({ kind: 'error', tool, code: 'UNCAUGHT' });
  });
}

/**
 * Track one run of a tool. Returns handles the caller uses to mark the outcome.
 *
 * The abandonment signal is the valuable one: a user who loads a file and
 * leaves without an output had a problem the error log will never show.
 */
export function trackRun(tool: string, shape?: { bytes?: number; mime?: string }) {
  const started = performance.now();
  let settled = false;

  const onLeave = () => {
    if (settled) return;
    settled = true;
    reportFriction(tool, 'ABANDONED', shape);
  };

  // pagehide is the reliable one on iOS Safari, where unload often never fires.
  window.addEventListener('pagehide', onLeave, { once: true });

  return {
    /** The run produced output. */
    ok(outBytes?: number) {
      if (settled) return;
      settled = true;
      window.removeEventListener('pagehide', onLeave);

      const ms = performance.now() - started;
      if (shape?.bytes !== undefined && outBytes !== undefined && outBytes >= shape.bytes) {
        reportFriction(tool, 'NO_SAVING', { ...shape, ms });
      }
    },
    /** The run failed with a known code. */
    fail(code: ErrorCode) {
      if (settled) return;
      settled = true;
      window.removeEventListener('pagehide', onLeave);
      reportError(tool, code, shape);
    },
  };
}
