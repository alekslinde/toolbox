import { type Op, type ParamValues, OpError } from './types';
import {
  decode, dimensionsOf, release, makeCanvas, encode,
  isHeic, isSvg, stem, MIME_BY_FORMAT,
} from './image-core';

export interface ConvertParams extends ParamValues {
  format: string;
  quality: number;
}

/** Lazily load the HEIC decoder, once per page. */
let heicPromise: Promise<void> | null = null;
function loadHeic(): Promise<void> {
  const w = window as unknown as { heic2any?: unknown };
  if (w.heic2any) return Promise.resolve();
  if (heicPromise) return heicPromise;

  heicPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/heic2any.min.js';
    s.onload = () => resolve();
    s.onerror = () => {
      heicPromise = null;
      reject(new OpError('HEIC_DECODE_FAIL', 'Could not load the HEIC decoder.'));
    };
    document.head.appendChild(s);
  });
  return heicPromise;
}

/**
 * BMP writer: 24-bit uncompressed, bottom-up.
 *
 * No browser encodes BMP, so the bytes are assembled by hand. Rows are padded
 * to a 4-byte boundary and written bottom-up, which is what the format
 * requires and what every reader assumes.
 */
function encodeBmp(rgba: Uint8ClampedArray, w: number, h: number): Blob {
  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const pixelArraySize = rowSize * h;
  const fileSize = 54 + pixelArraySize;

  const buf = new ArrayBuffer(fileSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // BITMAPFILEHEADER
  bytes[0] = 0x42; bytes[1] = 0x4d;         // "BM"
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);             // pixel data offset

  // BITMAPINFOHEADER
  view.setUint32(14, 40, true);
  view.setInt32(18, w, true);
  view.setInt32(22, h, true);               // positive: bottom-up
  view.setUint16(26, 1, true);              // planes
  view.setUint16(28, 24, true);             // bits per pixel
  view.setUint32(34, pixelArraySize, true);

  for (let y = 0; y < h; y++) {
    const srcY = h - 1 - y;                 // flip vertically
    let p = 54 + y * rowSize;
    for (let x = 0; x < w; x++) {
      const i = (srcY * w + x) * 4;
      bytes[p++] = rgba[i + 2];             // B
      bytes[p++] = rgba[i + 1];             // G
      bytes[p++] = rgba[i];                 // R
    }
  }

  return new Blob([buf], { type: 'image/bmp' });
}

/** ICO container wrapping a PNG payload, which every modern reader accepts. */
async function encodeIco(png: Blob, size: number): Promise<Blob> {
  const pngBytes = new Uint8Array(await png.arrayBuffer());
  const header = new ArrayBuffer(22);
  const view = new DataView(header);

  view.setUint16(0, 0, true);               // reserved
  view.setUint16(2, 1, true);               // type: icon
  view.setUint16(4, 1, true);               // image count
  view.setUint8(6, size >= 256 ? 0 : size); // 0 means 256
  view.setUint8(7, size >= 256 ? 0 : size);
  view.setUint8(8, 0);                      // palette size
  view.setUint8(9, 0);                      // reserved
  view.setUint16(10, 1, true);              // colour planes
  view.setUint16(12, 32, true);             // bits per pixel
  view.setUint32(14, pngBytes.length, true);
  view.setUint32(18, 22, true);             // offset to payload

  return new Blob([header, pngBytes as BlobPart], { type: 'image/x-icon' });
}

export const imageConvertOp: Op<ConvertParams> = {
  id: 'image-convert',

  accepts: {
    mime: [
      'image/png', 'image/jpeg', 'image/webp', 'image/avif',
      'image/bmp', 'image/gif', 'image/svg+xml', 'image/heic', 'image/heif',
    ],
    ext: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'gif', 'svg', 'heic', 'heif'],
  },

  produces: (p) => MIME_BY_FORMAT[p.format] ?? 'image/png',

  params: {
    format: {
      kind: 'enum',
      label: 'Convert to',
      of: [
        { value: 'png', label: 'PNG' },
        { value: 'jpeg', label: 'JPEG' },
        { value: 'webp', label: 'WebP' },
        { value: 'avif', label: 'AVIF' },
        { value: 'bmp', label: 'BMP' },
        { value: 'ico', label: 'ICO' },
      ],
      default: 'png',
    },
    quality: { kind: 'range', label: 'Quality', min: 1, max: 100, default: 92, suffix: '%' },
  },

  batchable: true,

  async run(input, params, ctx) {
    if (input.bytes.length === 0) throw new OpError('FILE_EMPTY', 'The file is empty.');
    ctx?.onProgress?.(0.1);

    let bytes = input.bytes;
    let type = input.type;

    // HEIC has no native decoder, so it is converted to JPEG first and then
    // follows the normal path.
    if (isHeic(input.name, input.type)) {
      await loadHeic();
      const heic2any = (window as unknown as { heic2any: (o: unknown) => Promise<Blob | Blob[]> }).heic2any;
      try {
        const result = await heic2any({
          blob: new Blob([input.bytes as BlobPart], { type: 'image/heic' }),
          toType: 'image/jpeg',
          quality: 0.92,
        });
        const jpeg = Array.isArray(result) ? result[0] : result;
        bytes = new Uint8Array(await jpeg.arrayBuffer());
        type = 'image/jpeg';
      } catch {
        throw new OpError('HEIC_DECODE_FAIL', 'This HEIC file could not be decoded.');
      }
    }

    ctx?.onProgress?.(0.35);

    // SVG in, raster out: it must be rasterised at a concrete size, and an SVG
    // without intrinsic dimensions has none to read.
    const src = await decode(bytes, type);
    ctx?.onProgress?.(0.6);

    try {
      const { w, h } = dimensionsOf(src);
      if (!w || !h) {
        throw new OpError('IMAGE_DECODE_FAIL', 'The image reported no dimensions.');
      }

      const handle = makeCanvas(w, h);

      // Formats without alpha need a backdrop, or transparency renders black.
      if (params.format === 'jpeg' || params.format === 'bmp') {
        handle.ctx.fillStyle = '#ffffff';
        handle.ctx.fillRect(0, 0, w, h);
      }
      handle.ctx.drawImage(src as CanvasImageSource, 0, 0);
      ctx?.onProgress?.(0.8);

      const q = params.quality / 100;
      let blob: Blob;
      let ext: string;

      if (params.format === 'bmp') {
        blob = encodeBmp(handle.ctx.getImageData(0, 0, w, h).data, w, h);
        ext = 'bmp';
      } else if (params.format === 'ico') {
        const png = await encode(handle, 'image/png');
        blob = await encodeIco(png, Math.max(w, h));
        ext = 'ico';
      } else {
        const mime = MIME_BY_FORMAT[params.format] ?? 'image/png';
        blob = await encode(handle, mime, params.format === 'png' ? undefined : q);
        ext = params.format === 'jpeg' ? 'jpg' : params.format;
      }

      ctx?.onProgress?.(1);
      return { blob, name: `${stem(input.name)}.${ext}`, meta: { width: w, height: h } };
    } finally {
      release(src);
    }
  },
};

export { isSvg };
