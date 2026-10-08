import { type Op, type ParamValues, OpError } from './types';
import {
  inspectSfnt, repairNameRecords, translateParseError,
  unwrapWOFF, buildWOFF, buildEOT,
} from '@/lib/font-converter';
import { stem } from './image-core';

export interface FontConvertParams extends ParamValues {
  ttf: boolean;
  otf: boolean;
  woff: boolean;
  woff2: boolean;
  eot: boolean;
}

/**
 * The WOFF2 codec, supplied by the page.
 *
 * wawoff2 must be imported *statically* so the dep-optimizer pre-bundles its
 * CJS modules: that keeps creation of its `runtimeInit` promise synchronous
 * relative to WASM loading. A dynamic `import()` here breaks that ordering and
 * `runtimeInit` never resolves, so WOFF2 conversion hangs and then fails
 * silently in a production build. The page holds the static import and hands
 * the functions in.
 */
export interface Woff2Codec {
  compress: (bytes: Uint8Array) => Promise<Uint8Array>;
  decompress: (bytes: Uint8Array) => Promise<Uint8Array>;
}

let codec: Woff2Codec | null = null;

export function setWoff2Codec(c: Woff2Codec): void {
  codec = c;
}

export const FONT_MIMES: Record<string, string> = {
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  eot: 'application/vnd.ms-fontobject',
};

/**
 * Font format conversion.
 *
 * One input fans out to several outputs, which the Op contract cannot express
 * directly — `run()` returns a single blob. So a multi-format run bundles into
 * a ZIP named after the input font, and a single-format run returns the font
 * itself. Because output names derive from the input, batching several fonts
 * works: nothing collides.
 *
 * Per-format failure does not fail the file. A font that cannot be written as
 * EOT can usually still be written as WOFF2, and returning the formats that
 * worked beats returning nothing.
 */
export const fontConvertOp: Op<FontConvertParams> = {
  id: 'font-converter',

  accepts: {
    mime: ['font/ttf', 'font/otf', 'font/woff', 'font/woff2',
           'application/x-font-ttf', 'application/x-font-otf', 'application/octet-stream'],
    ext: ['ttf', 'otf', 'woff', 'woff2'],
  },

  // The output is a ZIP unless exactly one format was asked for; either way it
  // is a terminal step, so nothing chains from it.
  produces: () => 'application/zip',

  params: {
    woff2: { kind: 'bool', label: 'WOFF2', default: true },
    woff: { kind: 'bool', label: 'WOFF', default: true },
    ttf: { kind: 'bool', label: 'TTF', default: false },
    otf: { kind: 'bool', label: 'OTF', default: false },
    eot: { kind: 'bool', label: 'EOT', default: false },
  },

  batchable: true,

  async run(input, params, ctx) {
    if (input.bytes.length === 0) throw new OpError('FILE_EMPTY', 'The file is empty.');

    const formats = (['ttf', 'otf', 'woff', 'woff2', 'eot'] as const).filter((f) => params[f]);
    if (formats.length === 0) {
      throw new OpError('UNSUPPORTED_TYPE', 'Choose at least one output format.');
    }

    ctx?.onProgress?.(0.1);

    const ab = input.bytes.buffer.slice(
      input.bytes.byteOffset,
      input.bytes.byteOffset + input.bytes.byteLength,
    ) as ArrayBuffer;

    // WOFF2 input has to be decompressed before opentype can read it.
    const ext = (input.name.split('.').pop() ?? '').toLowerCase();
    let parseAB: ArrayBuffer = ab;
    if (ext === 'woff2' || isWoff2(ab)) {
      if (!codec) throw new OpError('WORKER_FAILED', 'The WOFF2 codec is unavailable.');
      try {
        const out = await codec.decompress(new Uint8Array(ab));
        parseAB = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
      } catch {
        throw new OpError('FONT_PARSE_FAIL', 'This WOFF2 file could not be decompressed.');
      }
    }

    ctx?.onProgress?.(0.3);

    const opentype = await import('opentype.js');
    let font: { toArrayBuffer(): ArrayBuffer };
    try {
      font = opentype.parse(parseAB) as { toArrayBuffer(): ArrayBuffer };
    } catch (e) {
      // inspectSfnt explains *why* a font is unreadable, but its findings
      // describe the file and so stay on the page rather than in telemetry.
      inspectSfnt(parseAB);
      throw new OpError(
        'FONT_PARSE_FAIL',
        translateParseError(e instanceof Error ? e.message : 'Unknown parse error'),
      );
    }

    const base = stem(input.name);
    repairNameRecords(font, base);
    const sfnt = font.toArrayBuffer();

    // WOFF2 compresses the original bytes rather than re-serialised ones:
    // wawoff2 hangs on output from toArrayBuffer().
    let sfntForWoff2: ArrayBuffer | undefined;
    if (formats.includes('woff2')) {
      sfntForWoff2 = isWoff(ab) ? await unwrapWOFF(ab) : parseAB;
    }

    ctx?.onProgress?.(0.5);

    const results: { fmt: string; buf: ArrayBuffer }[] = [];
    for (const [i, fmt] of formats.entries()) {
      try {
        let buf: ArrayBuffer;
        if (fmt === 'ttf' || fmt === 'otf') {
          buf = sfnt;
        } else if (fmt === 'woff') {
          buf = buildWOFF(sfnt);
        } else if (fmt === 'woff2') {
          if (!codec) throw new Error('WOFF2 codec unavailable');
          const out = await codec.compress(new Uint8Array(sfntForWoff2!));
          buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
        } else {
          buf = buildEOT(sfnt);
        }
        results.push({ fmt, buf });
      } catch {
        // One format failing must not lose the others.
      }
      ctx?.onProgress?.(0.5 + ((i + 1) / formats.length) * 0.45);
    }

    if (results.length === 0) {
      throw new OpError('ENCODE_FAILED', 'No output format could be written.');
    }

    ctx?.onProgress?.(1);

    if (results.length === 1) {
      const { fmt, buf } = results[0];
      return {
        blob: new Blob([buf], { type: FONT_MIMES[fmt] }),
        name: `${base}.${fmt}`,
        meta: { note: `Converted to ${fmt.toUpperCase()}` },
      };
    }

    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    for (const { fmt, buf } of results) zip.file(`${base}.${fmt}`, buf);

    return {
      blob: await zip.generateAsync({ type: 'blob' }),
      name: `${base}-fonts.zip`,
      meta: {
        note: results.length < formats.length
          ? `${results.length} of ${formats.length} formats written`
          : `${results.length} formats written`,
      },
    };
  },
};

function isWoff(ab: ArrayBuffer): boolean {
  return ab.byteLength > 4 && new DataView(ab).getUint32(0) === 0x774f4646; // 'wOFF'
}

function isWoff2(ab: ArrayBuffer): boolean {
  return ab.byteLength > 4 && new DataView(ab).getUint32(0) === 0x774f4632; // 'wOF2'
}
