import { type Op, type ParamValues, OpError } from './types';
import {
  decode, dimensionsOf, release, makeCanvas, encode, fitWithin,
  isSvg, minifySvg, stem, MIME_BY_FORMAT,
} from './image-core';

export interface CompressParams extends ParamValues {
  format: string;
  quality: number;
  maxDim: number | null;
  pngReduce: boolean;
  pngColors: number;
}

export const imageCompressOp: Op<CompressParams> = {
  id: 'image-compress',

  accepts: {
    mime: ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'],
    ext: ['png', 'jpg', 'jpeg', 'webp', 'svg'],
  },

  produces: (p) => (p.format === 'svg' ? 'image/svg+xml' : MIME_BY_FORMAT[p.format] ?? 'image/jpeg'),

  params: {
    format: {
      kind: 'enum',
      label: 'Output format',
      of: [
        { value: 'jpeg', label: 'JPEG' },
        { value: 'png', label: 'PNG' },
        { value: 'webp', label: 'WebP' },
      ],
      default: 'jpeg',
    },
    quality: { kind: 'range', label: 'Quality', min: 1, max: 100, default: 82, suffix: '%' },
    maxDim: { kind: 'int', label: 'Max dimension', min: 1, default: null, placeholder: 'Original' },
    pngReduce: { kind: 'bool', label: 'Reduce colors (PNG)', default: false },
    pngColors: { kind: 'range', label: 'PNG colors', min: 2, max: 256, default: 256 },
  },

  batchable: true,

  async run(input, params, ctx) {
    if (input.bytes.length === 0) throw new OpError('FILE_EMPTY', 'The file is empty.');
    ctx?.onProgress?.(0.1);

    // ── SVG: a text transform, no canvas involved ────────────────────────────
    if (isSvg(input.name, input.type)) {
      const text = new TextDecoder().decode(input.bytes);
      const min = minifySvg(text);
      const out = new TextEncoder().encode(min);
      ctx?.onProgress?.(1);

      // Minifying can enlarge an already-minified file. Hand back the original
      // rather than a larger "optimised" one.
      if (out.length >= input.bytes.length) {
        return {
          blob: new Blob([input.bytes as BlobPart], { type: 'image/svg+xml' }),
          name: input.name,
          meta: { unchanged: true, note: 'Already minified — kept as-is.' },
        };
      }

      return {
        blob: new Blob([min], { type: 'image/svg+xml' }),
        name: `${stem(input.name)}_min.svg`,
      };
    }

    // ── Raster ───────────────────────────────────────────────────────────────
    const src = await decode(input.bytes, input.type);
    ctx?.onProgress?.(0.3);

    try {
      const { w: sw, h: sh } = dimensionsOf(src);
      const { w, h } = params.maxDim ? fitWithin(sw, sh, params.maxDim) : { w: sw, h: sh };
      const resized = w !== sw || h !== sh;

      const handle = makeCanvas(w, h);
      handle.ctx.drawImage(src as CanvasImageSource, 0, 0, w, h);
      ctx?.onProgress?.(0.6);

      let blob: Blob;
      if (params.format === 'png' && params.pngReduce) {
        // Palette quantisation via UPNG. This is the one path that genuinely
        // shrinks a flat-colour PNG; a lossless re-encode usually will not.
        const { default: UPNG } = await import('upng-js');
        const rgba = handle.ctx.getImageData(0, 0, w, h).data;
        const colors = Math.min(256, Math.max(2, params.pngColors || 256));
        const png = UPNG.encode([rgba.buffer as ArrayBuffer], w, h, colors);
        blob = new Blob([png], { type: 'image/png' });
      } else {
        const mime = MIME_BY_FORMAT[params.format] ?? 'image/jpeg';
        const q = params.format === 'png' ? undefined : params.quality / 100;
        blob = await encode(handle, mime, q);
      }

      ctx?.onProgress?.(0.9);

      // Keep-smaller guard: re-encoding an already-optimised file can enlarge
      // it. When we stayed in the same format at full resolution and gained
      // nothing, return the input untouched — a "compressed" file that is
      // bigger than the original is a worse outcome than doing nothing.
      const srcExt = (input.name.split('.').pop() ?? '').toLowerCase();
      const outExt = params.format === 'jpeg' ? 'jpg' : params.format;
      const sameFormat = srcExt === outExt || (params.format === 'jpeg' && srcExt === 'jpeg');

      if (blob.size >= input.bytes.length && sameFormat && !resized) {
        ctx?.onProgress?.(1);
        return {
          blob: new Blob([input.bytes as BlobPart], { type: input.type }),
          name: input.name,
          meta: { width: w, height: h, unchanged: true, note: 'Already optimal — kept as-is.' },
        };
      }

      ctx?.onProgress?.(1);
      return {
        blob,
        name: `${stem(input.name)}_opt.${outExt}`,
        meta: { width: w, height: h },
      };
    } finally {
      release(src);
    }
  },
};
