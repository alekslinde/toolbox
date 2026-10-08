import { type Op, type OpInput, type OpOutput, type ParamValues, OpError } from './types';
import type { ErrorCode } from '@/lib/telemetry-codes';

/**
 * The batch runner.
 *
 * Implemented once, here, rather than per tool: because `run()` is a pure
 * function over one input, no op needs to know it is being batched. Every tool
 * that becomes an op inherits this for free.
 *
 * The constraints below are the whole job — a naive `for … await` loop gets
 * all of them wrong.
 */

/** Above this many files, results are bundled rather than downloaded singly. */
export const ZIP_THRESHOLD = 3;

/** Hard ceiling per run. Past this the browser is the thing that fails. */
export const MAX_BATCH_FILES = 100;

export interface BatchItem {
  file: File;
  ok: boolean;
  output?: OpOutput;
  code?: ErrorCode;
}

export interface BatchSummary {
  items: BatchItem[];
  succeeded: number;
  failed: number;
  bytesIn: number;
  bytesOut: number;
  ms: number;
}

export interface BatchProgress {
  /** Files finished, successful or not. */
  done: number;
  total: number;
  /** The file currently being worked on. */
  current: string;
}

export interface RunBatchOptions {
  onProgress?: (p: BatchProgress) => void;
  signal?: AbortSignal;
}

function codeOf(e: unknown): ErrorCode {
  if (e instanceof OpError) return e.code;
  // An oversized allocation surfaces as a RangeError in most browsers, and is
  // worth separating from the generic bucket because the fix is different.
  if (e instanceof RangeError) return 'OUT_OF_MEMORY';
  return 'UNKNOWN';
}

/**
 * Run `op` over every file.
 *
 * Sequential by design. Decoding forty images concurrently peaks at forty
 * decoded bitmaps in memory, which is what gets a tab killed on a phone —
 * exactly the device this project is mobile-first for. One at a time, each
 * released before the next, trades a little wall-clock for actually finishing.
 */
export async function runBatch<P extends ParamValues>(
  op: Op<P>,
  files: File[],
  params: P,
  opts: RunBatchOptions = {},
): Promise<BatchSummary> {
  if (files.length > MAX_BATCH_FILES) {
    throw new OpError('TOO_MANY_FILES', `At most ${MAX_BATCH_FILES} files at once.`);
  }

  const started = performance.now();
  const items: BatchItem[] = [];
  let bytesIn = 0;
  let bytesOut = 0;

  for (const [i, file] of files.entries()) {
    if (opts.signal?.aborted) break;
    opts.onProgress?.({ done: i, total: files.length, current: file.name });

    try {
      const input: OpInput = {
        bytes: new Uint8Array(await file.arrayBuffer()),
        name: file.name,
        type: file.type,
      };
      bytesIn += input.bytes.length;

      const output = await op.run(input, params, { signal: opts.signal });
      bytesOut += output.blob.size;
      items.push({ file, ok: true, output });
    } catch (e) {
      // One bad file must never discard the rest. A corrupt image in a batch of
      // forty is the common case, not the exceptional one.
      items.push({ file, ok: false, code: codeOf(e) });
    }
  }

  opts.onProgress?.({ done: files.length, total: files.length, current: '' });

  const succeeded = items.filter((r) => r.ok).length;
  return {
    items,
    succeeded,
    failed: items.length - succeeded,
    bytesIn,
    bytesOut,
    ms: performance.now() - started,
  };
}

/** Bundle the successful outputs. Names are de-duplicated, since two folders
 *  can easily contribute the same filename to one batch. */
export async function zipOutputs(items: BatchItem[], zipName: string): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const used = new Set<string>();

  for (const item of items) {
    if (!item.ok || !item.output) continue;
    let name = item.output.name;
    if (used.has(name)) {
      const dot = name.lastIndexOf('.');
      const stem = dot === -1 ? name : name.slice(0, dot);
      const ext = dot === -1 ? '' : name.slice(dot);
      let n = 2;
      while (used.has(`${stem}_${n}${ext}`)) n++;
      name = `${stem}_${n}${ext}`;
    }
    used.add(name);
    zip.file(name, item.output.blob);
  }

  void zipName;
  return zip.generateAsync({ type: 'blob' });
}

/**
 * Whether to bundle. Two files should not force the user to unzip; twenty
 * should not fire twenty download prompts.
 */
export function shouldZip(successCount: number): boolean {
  return successCount > ZIP_THRESHOLD;
}

/** Human summary of a finished batch, for the result bar. */
export function summarise(s: BatchSummary): string {
  if (s.failed === 0) return `${s.succeeded} file${s.succeeded === 1 ? '' : 's'} processed`;
  if (s.succeeded === 0) return `All ${s.failed} file${s.failed === 1 ? '' : 's'} failed`;
  return `${s.succeeded} processed, ${s.failed} failed`;
}
