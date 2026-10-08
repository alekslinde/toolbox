import type { ErrorCode } from '@/lib/telemetry-codes';

/**
 * A tool, declared rather than hand-built.
 *
 * The point of the declaration is that everything the UI needs is derivable
 * from it: which files the dropzone accepts, which controls to render, what to
 * call the download, and what the result bar reports. A tool author writes a
 * schema and a `run()`; the shell renders it.
 *
 * `run()` is a pure async function over bytes. It never touches the DOM, never
 * downloads anything and never reports telemetry — which is what makes it
 * unit-testable, batchable, chainable, and movable into a worker thread
 * without the call sites changing.
 */

export type ParamSpec =
  | { kind: 'range'; label: string; min: number; max: number; step?: number; default: number; suffix?: string }
  | { kind: 'enum'; label: string; of: readonly { value: string; label: string }[]; default: string }
  | { kind: 'bool'; label: string; default: boolean }
  | { kind: 'int'; label: string; min?: number; max?: number; default: number | null; placeholder?: string }
  | { kind: 'color'; label: string; default: string };

export type ParamsSchema = Record<string, ParamSpec>;

/** Resolved parameter values, as the shell collects them from the controls. */
export type ParamValues = Record<string, string | number | boolean | null>;

/** One input to an operation: bytes plus the little we know about them. */
export interface OpInput {
  bytes: Uint8Array;
  /** Original filename. Used for the output name — never transmitted. */
  name: string;
  /** MIME type, as reported by the file or sniffed from the bytes. */
  type: string;
}

/** What an operation produces. */
export interface OpOutput {
  blob: Blob;
  /** Filename for the download, derived by the op from the input name. */
  name: string;
  /**
   * Optional facts the shell renders in the result bar. Every op reports its
   * byte counts the same way so the UI does not re-solve "before/after" per
   * tool, which it currently does in three places.
   */
  meta?: {
    width?: number;
    height?: number;
    /** Set when the op deliberately returned the input untouched. */
    unchanged?: boolean;
    /** A short note worth surfacing, e.g. why nothing was gained. */
    note?: string;
  };
}

/** Progress within a single run, 0..1. Optional — many ops are atomic. */
export type ProgressFn = (fraction: number) => void;

export interface OpContext {
  onProgress?: ProgressFn;
  /** Aborts a long-running op. The shell wires this to navigation away. */
  signal?: AbortSignal;
}

export interface Op<P extends ParamValues = ParamValues> {
  id: string;
  /** MIME types and extensions this op accepts. Drives the dropzone. */
  accepts: {
    mime: readonly string[];
    ext: readonly string[];
  };
  /** The MIME type this op will produce, given its params. Drives chaining. */
  produces: (params: P) => string;
  params: ParamsSchema;
  /**
   * Whether several files can be run in one go. Single-input ops (a diff needs
   * exactly two, a palette reads one) declare false and the shell hides batch.
   */
  batchable: boolean;
  run: (input: OpInput, params: P, ctx?: OpContext) => Promise<OpOutput>;
}

/**
 * An error carrying a code from the closed telemetry enum.
 *
 * Ops throw this rather than a bare Error so the catch site has something
 * transmittable without reading `.message` — the message may name the user's
 * file, and a filename discloses more than its contents would.
 */
export class OpError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'OpError';
    this.code = code;
  }
}

/** Default values pulled straight off the schema. */
export function defaultParams(schema: ParamsSchema): ParamValues {
  const out: ParamValues = {};
  for (const [key, spec] of Object.entries(schema)) out[key] = spec.default;
  return out;
}

/**
 * Whether an op can take this file. Checked against both MIME and extension,
 * because browsers report an empty or wrong type often enough that trusting
 * either alone rejects valid files.
 */
export function accepts(op: Op<never>, file: { name: string; type: string }): boolean {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  if (op.accepts.ext.includes(ext)) return true;
  return !!file.type && op.accepts.mime.includes(file.type);
}

/**
 * Which ops can consume what this one produces. This is the whole chaining
 * mechanism: the graph is computed from the declarations rather than
 * maintained by hand, so it cannot go stale as tools are added.
 */
export function chainableTo<P extends ParamValues>(
  from: Op<P>,
  params: P,
  all: readonly Op<never>[],
): Op<never>[] {
  const mime = from.produces(params);
  return all.filter((op) => op.id !== from.id && op.accepts.mime.includes(mime));
}
