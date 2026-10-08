import { OpError } from './types';
import { replaceUntilStable } from '@/lib/utils';

/**
 * Image primitives shared by the image ops.
 *
 * Decode, draw and encode were re-solved in each of the three image tools,
 * with three different sets of edge cases handled. They live here once so a
 * fix reaches every tool.
 */

export const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};

export const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
};

export function isSvg(name: string, type: string): boolean {
  return type === 'image/svg+xml' || (name.split('.').pop() ?? '').toLowerCase() === 'svg';
}

export function isHeic(name: string, type: string): boolean {
  const ext = (name.split('.').pop() ?? '').toLowerCase();
  return ext === 'heic' || ext === 'heif' || type === 'image/heic' || type === 'image/heif';
}

/** Strip the extension, so an op can build its own output name. */
export function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/**
 * Decode bytes to a bitmap.
 *
 * Prefers createImageBitmap: it decodes off the main thread and avoids the
 * data-URL round trip, which matters once a batch is decoding forty files.
 * Falls back to an <img> for Safari versions that reject some types, and for
 * SVG, which createImageBitmap does not handle consistently.
 */
export async function decode(bytes: Uint8Array, type: string): Promise<ImageBitmap | HTMLImageElement> {
  const blob = new Blob([bytes as BlobPart], { type: type || 'application/octet-stream' });

  if (typeof createImageBitmap === 'function' && type !== 'image/svg+xml') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* fall through to the <img> path */
    }
  }

  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new OpError('IMAGE_DECODE_FAIL', 'The image could not be decoded.'));
    };
    img.src = url;
  });
}

export function dimensionsOf(src: ImageBitmap | HTMLImageElement): { w: number; h: number } {
  return src instanceof HTMLImageElement
    ? { w: src.naturalWidth, h: src.naturalHeight }
    : { w: src.width, h: src.height };
}

/** Release a decoded bitmap. In a batch this is the difference between
 *  finishing and being killed by the browser for memory. */
export function release(src: ImageBitmap | HTMLImageElement): void {
  if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) src.close();
}

export interface CanvasHandle {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

/**
 * A drawing surface. OffscreenCanvas where available so the work stays off the
 * main thread; a regular canvas otherwise.
 */
export function makeCanvas(w: number, h: number): CanvasHandle {
  if (w <= 0 || h <= 0) {
    throw new OpError('ENCODE_FAILED', 'Target dimensions must be positive.');
  }
  // Browsers cap canvas area; past the cap getContext returns a context that
  // silently produces blank output, which is worse than failing.
  if (w * h > 268_435_456) {
    throw new OpError('OUT_OF_MEMORY', 'The requested dimensions are too large for a canvas.');
  }

  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new OpError('CANVAS_UNAVAILABLE', 'Could not get a 2D context.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return { canvas, ctx };
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new OpError('CANVAS_UNAVAILABLE', 'Could not get a 2D context.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/**
 * Encode a canvas.
 *
 * `toBlob` reports failure by handing back null rather than throwing, and a
 * format the browser cannot write (AVIF in Safari, for one) silently falls
 * back to PNG instead of erroring. Both cases are turned into a real error
 * here, so a tool never hands the user a file in a format they did not ask for.
 */
export async function encode(
  handle: CanvasHandle,
  mime: string,
  quality?: number,
): Promise<Blob> {
  const { canvas } = handle;
  let blob: Blob | null = null;

  if (typeof OffscreenCanvas === 'function' && canvas instanceof OffscreenCanvas) {
    try {
      blob = await canvas.convertToBlob({ type: mime, quality });
    } catch {
      throw new OpError('ENCODE_FAILED', `This browser cannot write ${mime}.`);
    }
  } else {
    blob = await new Promise<Blob | null>((res) =>
      (canvas as HTMLCanvasElement).toBlob(res, mime, quality),
    );
  }

  if (!blob) throw new OpError('ENCODE_FAILED', `Encoding to ${mime} failed.`);

  // A browser that cannot write the requested type quietly returns PNG. Saying
  // so beats handing back a mislabelled file.
  if (blob.type && blob.type !== mime) {
    throw new OpError('ENCODE_FAILED', `This browser cannot write ${mime}.`);
  }

  return blob;
}

/**
 * Whether this browser can actually write `mime`.
 *
 * A browser that cannot encode a format does not say so — `toBlob` quietly
 * returns PNG instead. Without this probe the only way a user learns that
 * Safari cannot write AVIF is a batch of forty files failing at the end, so
 * the control is disabled up front instead.
 *
 * Cached: the probe costs a 1px encode, and the answer cannot change.
 */
const encoderSupport = new Map<string, Promise<boolean>>();

export function canEncode(mime: string): Promise<boolean> {
  const cached = encoderSupport.get(mime);
  if (cached) return cached;

  const probe = (async () => {
    // PNG and JPEG are universally supported; skip the work.
    if (mime === 'image/png' || mime === 'image/jpeg') return true;
    try {
      const { canvas } = makeCanvas(1, 1);
      if (typeof OffscreenCanvas === 'function' && canvas instanceof OffscreenCanvas) {
        const blob = await canvas.convertToBlob({ type: mime });
        return blob.type === mime;
      }
      const blob = await new Promise<Blob | null>((res) =>
        (canvas as HTMLCanvasElement).toBlob(res, mime),
      );
      return !!blob && blob.type === mime;
    } catch {
      return false;
    }
  })();

  encoderSupport.set(mime, probe);
  return probe;
}

/** Fit maths, shared by resize and the max-dimension clamp in compress. */
export function fitWithin(
  sw: number,
  sh: number,
  maxDim: number,
): { w: number; h: number } {
  if (sw <= maxDim && sh <= maxDim) return { w: sw, h: sh };
  const ratio = Math.min(maxDim / sw, maxDim / sh);
  return { w: Math.max(1, Math.round(sw * ratio)), h: Math.max(1, Math.round(sh * ratio)) };
}

export type FitMode = 'contain' | 'cover' | 'stretch' | 'pad';

/**
 * Where to draw a source of sw×sh inside a tw×th target.
 *
 * `contain` and `pad` differ only in what the shell paints behind — the
 * geometry is identical, which is why both land here rather than in two tools.
 */
export function placement(
  sw: number,
  sh: number,
  tw: number,
  th: number,
  mode: FitMode,
): { dx: number; dy: number; dw: number; dh: number } {
  if (mode === 'stretch') return { dx: 0, dy: 0, dw: tw, dh: th };

  const scale =
    mode === 'cover'
      ? Math.max(tw / sw, th / sh)
      : Math.min(tw / sw, th / sh);

  const dw = Math.round(sw * scale);
  const dh = Math.round(sh * scale);
  return { dx: Math.round((tw - dw) / 2), dy: Math.round((th - dh) / 2), dw, dh };
}

/**
 * Minify an SVG.
 *
 * Comment stripping runs until stable: a single pass leaves a usable comment
 * behind when one is nested inside another, which is the shape a sanitiser has
 * to defend against.
 */
export function minifySvg(svg: string): string {
  // Every element removal runs until the string stops changing. A single pass
  // leaves the outer half of a nested pair behind — `<title><title>x</title>`
  // survives one pass intact — so the element this is meant to strip is still
  // in the output. Looping is the only way the removal is actually complete.
  let out = svg;

  // HTML ends a comment on `-->` OR `--!>`. Matching only the first leaves a
  // comment closed the second way completely intact — opener included — so a
  // parser that honours `--!>` sees content this was meant to remove.
  out = replaceUntilStable(out, /<!--[\s\S]*?--!?>/g, '');

  // An over-closed comment (`<!--<!--x-->-->`) leaves a bare terminator behind
  // once the opener is gone. It is inert text rather than a tag, but emitting
  // it would be malformed output, so the orphan goes too.
  out = replaceUntilStable(out, /--!?>/g, '');

  // An opener with no terminator at all would otherwise survive and swallow
  // the rest of the document in a parser that is looking for one.
  out = out.replace(/<!--[\s\S]*$/, '');

  out = replaceUntilStable(out, /<\?xml[^>]*\?>/g, '');

  for (const tag of ['metadata', 'title', 'desc']) {
    // The lazy match pairs an opener with the *first* closer, so on a nested
    // pair it consumes the inner element and leaves the outer closer orphaned.
    // Looping removes every pair; the sweep afterwards takes the orphans, which
    // would otherwise be emitted as stray `</metadata>` text.
    out = replaceUntilStable(out, new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'g'), '');
    out = replaceUntilStable(out, new RegExp(`</?${tag}[^>]*>`, 'g'), '');
  }

  return out
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s*=\s*/g, '=')
    .replace(/"\s+/g, '" ')
    .replace(/\s+"/g, ' "')
    .replace(/\s*\/>/g, '/>')
    .trim();
}
