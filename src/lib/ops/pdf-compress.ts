import { type Op, type ParamValues, OpError } from './types';
import { compressPdf, PDF_LEVELS } from './pdf-core';
import { stem } from './image-core';

export interface PdfCompressParams extends ParamValues {
  level: string;
}

/** A PDF always starts with %PDF-. Anything else cannot be loaded. */
function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export const pdfCompressOp: Op<PdfCompressParams> = {
  id: 'pdf-compress',

  accepts: { mime: ['application/pdf'], ext: ['pdf'] },
  produces: () => 'application/pdf',

  params: {
    level: {
      kind: 'enum',
      label: 'Compression level',
      of: Object.entries(PDF_LEVELS).map(([value, cfg]) => ({ value, label: cfg.label })),
      default: 'ebook',
    },
  },

  batchable: true,

  async run(input, params, ctx) {
    if (input.bytes.length === 0) throw new OpError('FILE_EMPTY', 'The file is empty.');
    if (!looksLikePdf(input.bytes)) {
      throw new OpError('UNSUPPORTED_TYPE', 'This file is not a PDF.');
    }
    if (!PDF_LEVELS[params.level]) {
      throw new OpError('UNSUPPORTED_TYPE', `Unknown compression level: ${params.level}`);
    }

    ctx?.onProgress?.(0.05);

    let out: Uint8Array;
    try {
      out = await compressPdf(input.bytes, params.level, (done, total) => {
        // Image re-encoding is the bulk of the work, so progress tracks it
        // between the load and the final save.
        ctx?.onProgress?.(total ? 0.1 + (done / total) * 0.8 : 0.5);
      });
    } catch (e) {
      // pdf-lib throws for encrypted documents it cannot open even with
      // ignoreEncryption, which is worth separating from a parse failure
      // because the user can do something about it.
      const msg = e instanceof Error ? e.message : '';
      if (/encrypt/i.test(msg)) {
        throw new OpError('ENCRYPTED_INPUT', 'This PDF is password-protected.');
      }
      throw new OpError('PDF_PARSE_FAIL', 'This PDF could not be read.');
    }

    ctx?.onProgress?.(1);

    // Re-serialising can enlarge an already-optimised PDF. Hand back the
    // original rather than a larger "compressed" file.
    if (out.length >= input.bytes.length) {
      return {
        blob: new Blob([input.bytes as BlobPart], { type: 'application/pdf' }),
        name: input.name,
        meta: { unchanged: true, note: 'Already optimal — kept as-is.' },
      };
    }

    return {
      blob: new Blob([out as BlobPart], { type: 'application/pdf' }),
      name: `${stem(input.name)}_compressed.pdf`,
    };
  },
};
