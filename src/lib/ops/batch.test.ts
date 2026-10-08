import { describe, it, expect, vi } from 'vitest';
import { runBatch, MAX_BATCH_FILES } from './batch';
import { type Op, type ParamValues, OpError } from './types';

// A File stand-in. node has File in recent versions, but constructing one from
// bytes with a stable arrayBuffer() is clearer written out.
function fakeFile(name: string, bytes: Uint8Array, type = 'image/png'): File {
  return {
    name,
    type,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as File;
}

/** An op that echoes its input, or fails for files whose name says so. */
function echoOp(opts: { failOn?: RegExp; throwRaw?: boolean } = {}): Op<ParamValues> {
  return {
    id: 'echo',
    accepts: { mime: ['image/png'], ext: ['png'] },
    produces: () => 'image/png',
    params: {},
    batchable: true,
    async run(input) {
      if (opts.failOn?.test(input.name)) {
        if (opts.throwRaw) throw new RangeError('array buffer allocation failed');
        throw new OpError('CORRUPT_INPUT', `bad file: ${input.name}`);
      }
      return { blob: new Blob([input.bytes as BlobPart]), name: input.name };
    },
  };
}

const bytes = (n: number) => new Uint8Array(n).fill(1);

describe('runBatch', () => {
  it('processes every file', async () => {
    const files = [fakeFile('a.png', bytes(10)), fakeFile('b.png', bytes(20))];
    const s = await runBatch(echoOp(), files, {});
    expect(s.succeeded).toBe(2);
    expect(s.failed).toBe(0);
    expect(s.bytesIn).toBe(30);
  });

  it('does not let one bad file discard the rest', async () => {
    // The single most important guarantee here: a corrupt image in a batch of
    // forty is the common case, and losing the other thirty-nine to it would
    // be worse than not offering batch at all.
    const files = [
      fakeFile('ok1.png', bytes(10)),
      fakeFile('BROKEN.png', bytes(10)),
      fakeFile('ok2.png', bytes(10)),
    ];
    const s = await runBatch(echoOp({ failOn: /BROKEN/ }), files, {});

    expect(s.succeeded).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.items.map((i) => i.ok)).toEqual([true, false, true]);
  });

  it('records a per-file code rather than one batch-wide error', async () => {
    const files = [fakeFile('BROKEN.png', bytes(5)), fakeFile('fine.png', bytes(5))];
    const s = await runBatch(echoOp({ failOn: /BROKEN/ }), files, {});
    expect(s.items[0].code).toBe('CORRUPT_INPUT');
    expect(s.items[1].code).toBeUndefined();
  });

  it('maps an allocation failure to the memory code', async () => {
    // A RangeError is how browsers surface an oversized allocation, and the
    // fix for it differs from a generic failure, so it must not be bucketed.
    const s = await runBatch(
      echoOp({ failOn: /big/, throwRaw: true }),
      [fakeFile('big.png', bytes(5))],
      {},
    );
    expect(s.items[0].code).toBe('OUT_OF_MEMORY');
  });

  it('reports progress per file, not just at the end', async () => {
    // With forty files a spinner reads as a hang; the user needs a count.
    const seen: number[] = [];
    const files = Array.from({ length: 4 }, (_, i) => fakeFile(`f${i}.png`, bytes(4)));
    await runBatch(echoOp(), files, {}, { onProgress: (p) => seen.push(p.done) });

    expect(seen[0]).toBe(0);
    expect(seen.at(-1)).toBe(4);
    expect(seen.length).toBeGreaterThan(2);
  });

  it('names the file it is working on', async () => {
    const names: string[] = [];
    const files = [fakeFile('first.png', bytes(1)), fakeFile('second.png', bytes(1))];
    await runBatch(echoOp(), files, {}, { onProgress: (p) => { if (p.current) names.push(p.current); } });
    expect(names).toEqual(['first.png', 'second.png']);
  });

  it('tracks bytes in and out so the shell need not re-derive them', async () => {
    const s = await runBatch(echoOp(), [fakeFile('a.png', bytes(100))], {});
    expect(s.bytesIn).toBe(100);
    expect(s.bytesOut).toBe(100);
    expect(s.ms).toBeGreaterThanOrEqual(0);
  });

  it('stops when aborted, keeping what already finished', async () => {
    const controller = new AbortController();
    const files = Array.from({ length: 6 }, (_, i) => fakeFile(`f${i}.png`, bytes(2)));

    const op = echoOp();
    const original = op.run.bind(op);
    let n = 0;
    op.run = async (...args) => {
      if (++n === 2) controller.abort();
      return original(...args);
    };

    const s = await runBatch(op, files, {}, { signal: controller.signal });
    expect(s.items.length).toBeLessThan(files.length);
    expect(s.items.every((i) => i.ok)).toBe(true);
  });

  it('refuses a run larger than the cap', async () => {
    const files = Array.from({ length: MAX_BATCH_FILES + 1 }, (_, i) => fakeFile(`f${i}.png`, bytes(1)));
    await expect(runBatch(echoOp(), files, {})).rejects.toMatchObject({ code: 'TOO_MANY_FILES' });
  });

  it('handles an empty selection without throwing', async () => {
    const s = await runBatch(echoOp(), [], {});
    expect(s).toMatchObject({ succeeded: 0, failed: 0, bytesIn: 0, bytesOut: 0 });
  });

  it('runs sequentially rather than all at once', async () => {
    // Decoding forty images concurrently peaks at forty decoded bitmaps in
    // memory, which is what gets a tab killed on a phone.
    let inFlight = 0;
    let peak = 0;
    const op = echoOp();
    const original = op.run.bind(op);
    op.run = async (...args) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return original(...args);
    };

    const files = Array.from({ length: 5 }, (_, i) => fakeFile(`f${i}.png`, bytes(2)));
    await runBatch(op, files, {});
    expect(peak).toBe(1);
  });

  it('passes the same params to every file', async () => {
    // One parameter set applies to the whole batch; per-file overrides are a
    // different feature and deliberately out of scope.
    const spy = vi.fn(async () => ({ blob: new Blob(), name: 'x' }));
    const op = { ...echoOp(), run: spy } as unknown as Op<ParamValues>;
    const params = { quality: 70 };
    await runBatch(op, [fakeFile('a.png', bytes(1)), fakeFile('b.png', bytes(1))], params);

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][1]).toBe(params);
    expect(spy.mock.calls[1][1]).toBe(params);
  });
});
