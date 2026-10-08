import { describe, it, expect } from 'vitest';
import { pdfCompressOp } from './pdf-compress';
import { PDF_LEVELS, estimateLevelSize, pngDefilter } from './pdf-core';
import { accepts, defaultParams, chainableTo } from './types';
import { OPS } from './index';

const PDF_HEADER = new TextEncoder().encode('%PDF-1.7\n');

function fakePdf(extra = 2048): Uint8Array {
  const out = new Uint8Array(PDF_HEADER.length + extra);
  out.set(PDF_HEADER, 0);
  return out;
}

describe('pdf-compress op', () => {
  it('accepts PDFs by extension and by mime', () => {
    expect(accepts(pdfCompressOp as never, { name: 'a.pdf', type: '' })).toBe(true);
    expect(accepts(pdfCompressOp as never, { name: 'a', type: 'application/pdf' })).toBe(true);
    expect(accepts(pdfCompressOp as never, { name: 'a.png', type: 'image/png' })).toBe(false);
  });

  it('offers every level the engine knows about', () => {
    const spec = pdfCompressOp.params.level;
    if (spec.kind !== 'enum') throw new Error('level should be an enum');
    expect(spec.of.map((o) => o.value).sort()).toEqual(Object.keys(PDF_LEVELS).sort());
  });

  it('defaults to a level that re-encodes something', () => {
    // 'default' does no image work at all, so defaulting to it would make the
    // tool look broken on its first run.
    const spec = pdfCompressOp.params.level;
    if (spec.kind !== 'enum') return;
    expect(PDF_LEVELS[spec.default as string].imgQ).toBeLessThan(1);
  });

  it('rejects a file that is not a PDF before doing any work', async () => {
    // pdf-lib's own failure for this is a parse error deep in the loader; the
    // magic-number check turns it into something the user can act on.
    const notPdf = new TextEncoder().encode('this is plainly not a pdf at all');
    await expect(
      pdfCompressOp.run({ bytes: notPdf, name: 'x.pdf', type: 'application/pdf' },
        defaultParams(pdfCompressOp.params) as never),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });

  it('rejects an empty file', async () => {
    await expect(
      pdfCompressOp.run({ bytes: new Uint8Array(0), name: 'x.pdf', type: 'application/pdf' },
        defaultParams(pdfCompressOp.params) as never),
    ).rejects.toMatchObject({ code: 'FILE_EMPTY' });
  });

  it('rejects an unknown level rather than silently picking one', async () => {
    await expect(
      pdfCompressOp.run({ bytes: fakePdf(), name: 'x.pdf', type: 'application/pdf' },
        { level: 'nonsense' } as never),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });

  it('produces application/pdf regardless of level', () => {
    for (const level of Object.keys(PDF_LEVELS)) {
      expect(pdfCompressOp.produces({ level } as never)).toBe('application/pdf');
    }
  });

  it('chains only to ops that take a PDF', () => {
    // The graph must not offer an image op for a PDF. Metadata cleaning is
    // the one valid next step, and it exists because it accepts application/pdf.
    const next = chainableTo(pdfCompressOp, { level: 'ebook' } as never, OPS).map((o) => o.id);
    expect(next).toEqual(['metadata-cleaner']);
  });
});

describe('estimateLevelSize', () => {
  const bytes = fakePdf(100_000);

  it('predicts a smaller file for a more aggressive level', () => {
    // The ordering is what makes the picker meaningful; the absolute numbers
    // are a prediction and are allowed to be wrong.
    const screen = estimateLevelSize(bytes, 'screen');
    const ebook = estimateLevelSize(bytes, 'ebook');
    const prepress = estimateLevelSize(bytes, 'prepress');
    expect(screen).toBeLessThan(ebook);
    expect(ebook).toBeLessThan(prepress);
  });

  it('never predicts a negative or absurdly small size', () => {
    for (const level of Object.keys(PDF_LEVELS)) {
      const est = estimateLevelSize(bytes, level);
      expect(est).toBeGreaterThan(0);
      expect(est).toBeGreaterThanOrEqual(Math.round(bytes.length * 0.05));
    }
  });

  it('predicts no image saving for the pass-through level', () => {
    expect(estimateLevelSize(bytes, 'default')).toBe(bytes.length);
  });
});

describe('pngDefilter', () => {
  // The PNG predictor is the fiddliest part of the Flate image path: a wrong
  // filter case produces a visibly corrupted image rather than an error.
  const W = 2, H = 2, BPP = 3;

  it('passes through filter type 0 (None) unchanged', () => {
    const raw = new Uint8Array([
      0, 10, 20, 30, 40, 50, 60,
      0, 70, 80, 90, 100, 110, 120,
    ]);
    expect(Array.from(pngDefilter(raw, W, H, BPP)))
      .toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
  });

  it('adds the left neighbour for filter type 1 (Sub)', () => {
    const raw = new Uint8Array([
      1, 10, 20, 30, 5, 5, 5,
      0, 0, 0, 0, 0, 0, 0,
    ]);
    const out = pngDefilter(raw, W, H, BPP);
    // Second pixel = its own bytes plus the first pixel's.
    expect(Array.from(out.subarray(0, 6))).toEqual([10, 20, 30, 15, 25, 35]);
  });

  it('adds the pixel above for filter type 2 (Up)', () => {
    const raw = new Uint8Array([
      0, 10, 20, 30, 40, 50, 60,
      2, 1, 1, 1, 1, 1, 1,
    ]);
    const out = pngDefilter(raw, W, H, BPP);
    expect(Array.from(out.subarray(6))).toEqual([11, 21, 31, 41, 51, 61]);
  });

  it('wraps at 255 rather than overflowing', () => {
    // Byte arithmetic is modulo 256; without the mask this silently corrupts.
    const raw = new Uint8Array([
      0, 250, 250, 250, 0, 0, 0,
      2, 10, 10, 10, 0, 0, 0,
    ]);
    const out = pngDefilter(raw, W, H, BPP);
    expect(Array.from(out.subarray(6, 9))).toEqual([4, 4, 4]);
  });

  it('returns the expected buffer size for any filter byte', () => {
    for (const f of [0, 1, 2, 3, 4, 9]) {
      const raw = new Uint8Array([f, 1, 2, 3, 4, 5, 6, f, 1, 2, 3, 4, 5, 6]);
      expect(pngDefilter(raw, W, H, BPP).length).toBe(W * H * BPP);
    }
  });
});

describe('metadata-cleaner op', () => {
  it('refuses HEIC and AVIF rather than returning them labelled clean', async () => {
    // Their container cannot be safely rewritten in the browser. Handing back
    // a file called "_clean" that still carries its GPS tags would be worse
    // than refusing, because the user would stop worrying about it.
    const { metadataCleanOp } = await import('./metadata-clean');
    const heic = new Uint8Array(32);
    // ftyp box declaring 'heic'
    heic.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63], 0);
    await expect(
      metadataCleanOp.run({ bytes: heic, name: 'IMG.heic', type: 'image/heic' }, {}),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });

  it('rejects a type it cannot read', async () => {
    const { metadataCleanOp } = await import('./metadata-clean');
    await expect(
      metadataCleanOp.run(
        { bytes: new TextEncoder().encode('plain text'), name: 'notes.txt', type: 'text/plain' },
        {},
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });

  it('is format-preserving, so its output type comes from the input', async () => {
    // produces() returns null for an op that edits in place; the chain graph
    // reads the type from the file instead of from the params.
    const { metadataCleanOp } = await import('./metadata-clean');
    expect(metadataCleanOp.produces({})).toBeNull();

    const next = chainableTo(metadataCleanOp, {}, OPS, 'image/png').map((o) => o.id);
    expect(next).toContain('image-compress');
    expect(next).toContain('image-resize');

    // A cleaned PDF leads nowhere an image op can take it.
    const fromPdf = chainableTo(metadataCleanOp, {}, OPS, 'application/pdf').map((o) => o.id);
    expect(fromPdf).toEqual(['pdf-compress']);
  });

  it('returns no chain options when the input type is unknown', async () => {
    const { metadataCleanOp } = await import('./metadata-clean');
    expect(chainableTo(metadataCleanOp, {}, OPS)).toEqual([]);
  });
});
