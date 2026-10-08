import { PDFDocument, PDFName, PDFDict, PDFString, PDFRawStream, PDFRef } from 'pdf-lib';

/**
 * PDF compression internals.
 *
 * Extracted verbatim from the tool page so the logic can be tested and reused.
 * The work is image re-encoding inside the PDF's object graph: embedded JPEG
 * and Flate images are decoded, optionally scaled, and written back as JPEG.
 *
 * Every per-image step is wrapped in try/catch and falls back to leaving the
 * original stream alone — a PDF where one image cannot be re-encoded should
 * still compress the rest rather than fail outright.
 */

export interface PdfLevel {
  label: string;
  imgQ: number;
  maxPx: number;
  strip: boolean;
}

export const PDF_LEVELS: Record<string, PdfLevel> = {
  screen:   { label: 'Screen',   imgQ: 0.40, maxPx: 1280, strip: true  },
  ebook:    { label: 'eBook',    imgQ: 0.60, maxPx: 1920, strip: true  },
  printer:  { label: 'Printer',  imgQ: 0.78, maxPx: 2560, strip: true  },
  prepress: { label: 'Prepress', imgQ: 0.92, maxPx: 4096, strip: false },
  default:  { label: 'Default',  imgQ: 1.00, maxPx: 9999, strip: false },
};

/**
 * Rough size prediction, used to populate the level picker before any work
 * happens. It reads the first megabyte for an XMP packet rather than parsing
 * the document, so it stays cheap enough to run for every level on load.
 */
export function estimateLevelSize(bytes: Uint8Array, levelKey: string): number {
  const cfg = PDF_LEVELS[levelKey];
  const origSize = bytes.length;
  const imgSavingFactor = cfg.imgQ >= 1.0 ? 0 : (1 - cfg.imgQ) * 0.65;
  const scan = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(origSize, 1 << 20)));
  const xs = scan.indexOf('<?xpacket begin');
  const xe = xs !== -1 ? scan.indexOf('<?xpacket end', xs) : -1;
  const xmpSize = xe !== -1 ? xe - xs + 60 : 0;
  const metaSavings = cfg.strip ? Math.min(origSize * 0.01, 2048) + xmpSize : 0;
  return Math.max(Math.round(origSize * (1 - imgSavingFactor) - metaSavings), Math.round(origSize * 0.05));
}

function collectImgRefs(pdfDoc: any, node: any, visited: Set<string>, depth: number): any[] {
  const refs: any[] = [];
  if (depth > 4) return refs;
  try {
    const resources = pdfDoc.context.lookup(node.get(PDFName.of('Resources')), PDFDict);
    if (!resources) return refs;
    const xobjDict = pdfDoc.context.lookup(resources.get(PDFName.of('XObject')), PDFDict);
    if (!xobjDict) return refs;
    xobjDict.entries().forEach(([, val]: [any, any]) => {
      if (!(val instanceof PDFRef)) return;
      const obj = pdfDoc.context.lookup(val);
      if (!(obj instanceof PDFRawStream)) return;
      const sub = obj.dict.get(PDFName.of('Subtype'))?.toString();
      if (sub === '/Image') {
        refs.push(val);
      } else if (sub === '/Form' && !visited.has(val.toString())) {
        visited.add(val.toString());
        refs.push(...collectImgRefs(pdfDoc, obj.dict, visited, depth + 1));
      }
    });
  } catch {}
  return refs;
}

async function inflateBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new (DecompressionStream as any)('deflate');
  const wr = ds.writable.getWriter(), rd = ds.readable.getReader();
  wr.write(bytes); wr.close();
  const chunks: Uint8Array[] = [];
  for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); }
  const out = new Uint8Array(chunks.reduce((n: number, c: Uint8Array) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export function pngDefilter(raw: Uint8Array, w: number, h: number, bpp: number): Uint8Array {
  const stride = w * bpp;
  const out = new Uint8Array(h * stride);
  let ri = 0;
  for (let y = 0; y < h; y++) {
    const f    = raw[ri++];
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    const cur  = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const b = raw[ri++], a = x >= bpp ? cur[x - bpp] : 0;
      const c = prev[x],   d = x >= bpp ? prev[x - bpp] : 0;
      switch (f) {
        case 0: cur[x] = b; break;
        case 1: cur[x] = (b + a) & 0xFF; break;
        case 2: cur[x] = (b + c) & 0xFF; break;
        case 3: cur[x] = (b + ((a + c) >> 1)) & 0xFF; break;
        case 4: { const p = a+c-d, pa = Math.abs(p-a), pb = Math.abs(p-c), pc = Math.abs(p-d);
          cur[x] = (b + (pa <= pb && pa <= pc ? a : pb <= pc ? c : d)) & 0xFF; break; }
        default: cur[x] = b;
      }
    }
  }
  return out;
}

async function reencodeFlate(stream: any, w: number, h: number, quality: number, maxPx: number): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const csStr = (stream.dict.get(PDFName.of('ColorSpace')) ?? '').toString();
  const isGray = csStr === '/DeviceGray' || csStr.includes('Gray');
  const isRGB  = csStr === '/DeviceRGB'  || csStr.includes('RGB') || csStr === '';
  if (!isGray && !isRGB) return null;
  const channels = isGray ? 1 : 3;
  if (parseInt(stream.dict.get(PDFName.of('BitsPerComponent'))?.toString() || '8', 10) !== 8) return null;

  const dpRaw = stream.dict.get(PDFName.of('DecodeParms'));
  const dp = dpRaw?.get ? dpRaw : (dpRaw?.array?.[0]?.get ? dpRaw.array[0] : null);
  const predictor = dp ? parseInt(dp.get?.(PDFName.of('Predictor'))?.toString() || '1', 10) : 1;

  let raw: Uint8Array;
  try { raw = await inflateBytes(stream.contents); } catch { return null; }
  if (predictor >= 10) { try { raw = pngDefilter(raw, w, h, channels); } catch { return null; } }

  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const imgData = src.getContext('2d')!.createImageData(w, h);
  for (let i = 0, n = w * h; i < n; i++) {
    const s = i * channels, d = i * 4;
    imgData.data[d]   = raw[s];
    imgData.data[d+1] = isGray ? raw[s] : raw[s + 1];
    imgData.data[d+2] = isGray ? raw[s] : raw[s + 2];
    imgData.data[d+3] = 255;
  }
  src.getContext('2d')!.putImageData(imgData, 0, 0);

  let out: HTMLCanvasElement = src;
  if (Math.max(w, h) > maxPx) {
    const sc = maxPx / Math.max(w, h);
    out = document.createElement('canvas');
    out.width = Math.round(w * sc); out.height = Math.round(h * sc);
    out.getContext('2d')!.drawImage(src, 0, 0, out.width, out.height);
  }
  return new Promise(res => {
    out.toBlob(blob => {
      if (!blob) { res(null); return; }
      blob.arrayBuffer().then(
        buf => res({ bytes: new Uint8Array(buf), width: out.width, height: out.height }),
        ()  => res(null)
      );
    }, 'image/jpeg', quality);
  });
}

function reencodeJpeg(jpegBytes: Uint8Array, origW: number, origH: number, quality: number, maxPx: number): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  return new Promise(resolve => {
    let binary = '';
    for (let i = 0; i < jpegBytes.length; i += 0x8000)
      binary += String.fromCharCode(...(jpegBytes.subarray(i, i + 0x8000) as any));
    const dataUrl = 'data:image/jpeg;base64,' + btoa(binary);

    const img = new Image();
    img.onload = () => {
      let w = img.naturalWidth || origW, h = img.naturalHeight || origH;
      if (Math.max(w, h) > maxPx) {
        if (w >= h) { h = Math.round(h * maxPx / w); w = maxPx; }
        else        { w = Math.round(w * maxPx / h); h = maxPx; }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob => {
        if (!blob) { resolve(null); return; }
        blob.arrayBuffer().then(
          buf => resolve({ bytes: new Uint8Array(buf), width: w, height: h }),
          ()  => resolve(null)
        );
      }, 'image/jpeg', quality);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

export async function compressPdf(bytes: Uint8Array, levelKey: string, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const cfg = PDF_LEVELS[levelKey];
  const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });

  if (cfg.strip) {
    try {
      const infoRef = (pdfDoc.context as any).trailerInfo.Info;
      if (infoRef) {
        const info = pdfDoc.context.lookup(infoRef, PDFDict);
        for (const k of ['Title', 'Author', 'Subject', 'Keywords', 'Creator'])
          info.delete(PDFName.of(k));
        info.set(PDFName.of('Producer'), PDFString.of('Toolkist'));
      }
    } catch {}
    (pdfDoc.catalog as any).delete(PDFName.of('Metadata'));
    for (const page of pdfDoc.getPages())
      (page.node as any).delete(PDFName.of('Thumb'));
  }

  if (cfg.imgQ < 1.0) {
    const seen = new Set<string>();
    const allRefs: any[] = [];
    for (const page of pdfDoc.getPages()) {
      for (const ref of collectImgRefs(pdfDoc, (page as any).node, new Set(), 0)) {
        const key = `${ref.objectNumber}/${ref.generationNumber}`;
        if (seen.has(key)) continue;
        seen.add(key);
        allRefs.push(ref);
      }
    }

    for (let i = 0; i < allRefs.length; i++) {
      onProgress?.(i + 1, allRefs.length);
      const ref = allRefs[i];
      const stream = pdfDoc.context.lookup(ref);
      if (!(stream instanceof PDFRawStream)) continue;

      const subtype = stream.dict.get(PDFName.of('Subtype'))?.toString();
      if (subtype !== '/Image') continue;

      const filter = stream.dict.get(PDFName.of('Filter'));
      if (!filter) continue;
      const filterStr = filter.toString();
      const isJpeg  = filterStr === '/DCTDecode';
      const isFlate = filterStr === '/FlateDecode';
      if (!isJpeg && !isFlate) continue;

      const w = parseInt(stream.dict.get(PDFName.of('Width'))?.toString()  || '0', 10);
      const h = parseInt(stream.dict.get(PDFName.of('Height'))?.toString() || '0', 10);
      if (!w || !h) continue;

      try {
        const result = isJpeg
          ? await reencodeJpeg(stream.contents, w, h, cfg.imgQ, cfg.maxPx)
          : await reencodeFlate(stream, w, h, cfg.imgQ, cfg.maxPx);
        if (!result || result.bytes.length >= stream.contents.length) continue;

        const newDict = pdfDoc.context.obj({});
        stream.dict.entries().forEach(([k, v]: [any, any]) => newDict.set(k, v));
        newDict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
        newDict.set(PDFName.of('Length'), pdfDoc.context.obj(result.bytes.length));
        newDict.set(PDFName.of('Width'),  pdfDoc.context.obj(result.width));
        newDict.set(PDFName.of('Height'), pdfDoc.context.obj(result.height));
        newDict.delete(PDFName.of('DecodeParms'));
        if (isFlate) {
          newDict.set(PDFName.of('ColorSpace'),       PDFName.of('DeviceRGB'));
          newDict.set(PDFName.of('BitsPerComponent'), pdfDoc.context.obj(8));
        }

        pdfDoc.context.assign(ref, PDFRawStream.of(newDict, result.bytes));
      } catch { /* leave original */ }
    }
  }

  return pdfDoc.save({ useObjectStreams: true, addDefaultPage: false });
}

