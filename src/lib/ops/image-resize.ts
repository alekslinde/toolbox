import { type Op, type ParamValues, OpError } from './types';
import {
  decode, dimensionsOf, release, makeCanvas, encode, placement,
  stem, MIME_BY_FORMAT, type FitMode,
} from './image-core';

export interface ResizeParams extends ParamValues {
  width: number;
  height: number;
  fit: string;
  format: string;
  padColor: string;
}

export const imageResizeOp: Op<ResizeParams> = {
  id: 'image-resize',

  accepts: {
    mime: ['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/bmp'],
    ext: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp'],
  },

  produces: (p) => MIME_BY_FORMAT[p.format] ?? 'image/jpeg',

  params: {
    width: { kind: 'int', label: 'Width', min: 1, default: 800 },
    height: { kind: 'int', label: 'Height', min: 1, default: 600 },
    fit: {
      kind: 'enum',
      label: 'Fit',
      of: [
        { value: 'contain', label: 'Contain' },
        { value: 'cover', label: 'Cover' },
        { value: 'stretch', label: 'Stretch' },
        { value: 'pad', label: 'Pad' },
      ],
      default: 'contain',
    },
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
    padColor: { kind: 'color', label: 'Pad colour', default: '#ffffff' },
  },

  batchable: true,

  async run(input, params, ctx) {
    if (input.bytes.length === 0) throw new OpError('FILE_EMPTY', 'The file is empty.');

    const tw = Math.round(params.width);
    const th = Math.round(params.height);
    if (!Number.isFinite(tw) || !Number.isFinite(th) || tw < 1 || th < 1) {
      throw new OpError('UNSUPPORTED_TYPE', 'Width and height must be positive numbers.');
    }

    ctx?.onProgress?.(0.1);
    const src = await decode(input.bytes, input.type);
    ctx?.onProgress?.(0.4);

    try {
      const { w: sw, h: sh } = dimensionsOf(src);
      const handle = makeCanvas(tw, th);

      // `pad` is the only mode that paints a backdrop; the rest leave the
      // canvas transparent, which PNG and WebP preserve and JPEG renders black.
      if (params.fit === 'pad') {
        handle.ctx.fillStyle = params.padColor;
        handle.ctx.fillRect(0, 0, tw, th);
      } else if (params.format === 'jpeg') {
        // JPEG has no alpha: without this, transparent regions come out black.
        handle.ctx.fillStyle = '#ffffff';
        handle.ctx.fillRect(0, 0, tw, th);
      }

      const { dx, dy, dw, dh } = placement(sw, sh, tw, th, params.fit as FitMode);
      handle.ctx.drawImage(src as CanvasImageSource, dx, dy, dw, dh);
      ctx?.onProgress?.(0.75);

      const mime = MIME_BY_FORMAT[params.format] ?? 'image/jpeg';
      const blob = await encode(handle, mime, params.format === 'png' ? undefined : 0.92);
      ctx?.onProgress?.(1);

      const ext = params.format === 'jpeg' ? 'jpg' : params.format;
      return {
        blob,
        name: `${stem(input.name)}_${tw}x${th}.${ext}`,
        meta: { width: tw, height: th },
      };
    } finally {
      release(src);
    }
  },
};
