import { type Op, type ParamValues, OpError } from './types';
import { processImage, type MetaField } from '@/lib/metadata';
import { stem } from './image-core';

export type MetadataCleanParams = ParamValues;

/**
 * Metadata removal as an op.
 *
 * Unlike the image ops, the *report* is the product here as much as the file:
 * a user wants to know that their holiday photo carried GPS coordinates, not
 * just receive a cleaned copy. So `run()` attaches what it found to the output
 * meta, and the page renders it.
 *
 * HEIC and AVIF are detect-only. Their container cannot be safely rewritten in
 * the browser, and handing back a file labelled "cleaned" that still carries
 * its GPS tags would be worse than refusing — so the op throws rather than
 * quietly returning the original.
 */

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'avif'];

export interface MetaReport {
  fields: MetaField[];
  changed: boolean;
}

/** Side-channel for the report, keyed by output name. */
export const lastReport = new Map<string, MetaReport>();

async function cleanPdf(bytes: Uint8Array): Promise<{ fields: MetaField[]; cleaned: Uint8Array; changed: boolean }> {
  const { PDFDocument, PDFName } = await import('pdf-lib');
  const doc = await PDFDocument.load(bytes as Uint8Array<ArrayBuffer>, { updateMetadata: false });
  const fields: MetaField[] = [];

  const push = (label: string, value: string | undefined | null, category: MetaField['category']) => {
    if (value && String(value).trim()) {
      fields.push({ category, label, value: String(value), source: 'PDF info' });
    }
  };

  try { push('Title', doc.getTitle(), 'other'); } catch { /* absent */ }
  try { push('Author', doc.getAuthor(), 'other'); } catch { /* absent */ }
  try { push('Subject', doc.getSubject(), 'other'); } catch { /* absent */ }
  try { push('Keywords', doc.getKeywords(), 'other'); } catch { /* absent */ }
  try { push('Producer', doc.getProducer(), 'software'); } catch { /* absent */ }
  try { push('Creator', doc.getCreator(), 'software'); } catch { /* absent */ }
  try { const d = doc.getCreationDate(); if (d) push('Creation date', d.toISOString(), 'timestamp'); } catch { /* absent */ }
  try { const d = doc.getModificationDate(); if (d) push('Modification date', d.toISOString(), 'timestamp'); } catch { /* absent */ }

  // The catalog's /Metadata object holds an RDF/XMP packet that duplicates and
  // often exceeds the info dictionary. pdf-lib's setters do not touch it.
  // Detected by catalog reference rather than a byte scan, because the packet
  // can sit anywhere in the file.
  const hasXmp = doc.catalog.has(PDFName.of('Metadata'));
  if (hasXmp) fields.push({ category: 'other', label: 'XMP metadata stream', value: null, source: 'PDF' });

  if (fields.length === 0) return { fields, cleaned: bytes, changed: false };

  doc.setTitle(''); doc.setAuthor(''); doc.setSubject('');
  doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
  const epoch = new Date(0);
  doc.setCreationDate(epoch); doc.setModificationDate(epoch);

  // Deleting only the catalog reference leaves the orphaned stream — GPS and
  // author bytes included — recoverable by grepping the saved file. The object
  // itself has to go for "removed" to be truthful.
  if (hasXmp) {
    const ref = doc.catalog.get(PDFName.of('Metadata'));
    doc.catalog.delete(PDFName.of('Metadata'));
    if (ref) doc.context.delete(ref as never);
  }

  return { fields, cleaned: await doc.save({ useObjectStreams: false }), changed: true };
}

export const metadataCleanOp: Op<MetadataCleanParams> = {
  id: 'metadata-cleaner',

  accepts: {
    mime: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/avif', 'application/pdf'],
    ext: [...IMAGE_EXT, 'pdf'],
  },

  // Format-preserving: whatever went in comes back out, so the chain graph
  // reads the type from the input rather than from these params.
  produces: () => null,

  params: {},
  batchable: true,

  async run(input, _params, ctx) {
    if (input.bytes.length === 0) throw new OpError('FILE_EMPTY', 'The file is empty.');
    ctx?.onProgress?.(0.2);

    const ext = (input.name.split('.').pop() ?? '').toLowerCase();
    const isPdf = ext === 'pdf' || input.type === 'application/pdf';

    let fields: MetaField[];
    let cleaned: Uint8Array;
    let changed: boolean;
    let outType: string;

    if (isPdf) {
      try {
        const r = await cleanPdf(input.bytes);
        fields = r.fields; cleaned = r.cleaned; changed = r.changed;
      } catch {
        throw new OpError('PDF_PARSE_FAIL', 'This PDF could not be read.');
      }
      outType = 'application/pdf';
    } else if (IMAGE_EXT.includes(ext) || input.type.startsWith('image/')) {
      const r = processImage(input.bytes);
      if (r.format === 'unknown') {
        throw new OpError('UNSUPPORTED_TYPE', 'JPG, PNG, WebP, HEIC, AVIF and PDF only.');
      }
      // Refusing beats handing back a file labelled "cleaned" that still
      // carries its GPS tags.
      if (r.detectOnly) {
        throw new OpError(
          'UNSUPPORTED_TYPE',
          'HEIC and AVIF cannot be rewritten in the browser — convert to JPG or PNG first.',
        );
      }
      fields = r.fields; cleaned = r.cleaned; changed = r.changed;
      outType = input.type || `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    } else {
      throw new OpError('UNSUPPORTED_TYPE', 'JPG, PNG, WebP, HEIC, AVIF and PDF only.');
    }

    ctx?.onProgress?.(1);

    const name = changed ? `${stem(input.name)}_clean.${ext}` : input.name;
    lastReport.set(name, { fields, changed });

    return {
      blob: new Blob([cleaned as BlobPart], { type: outType }),
      name,
      meta: changed
        ? { note: `${fields.length} metadata field${fields.length === 1 ? '' : 's'} removed` }
        : { unchanged: true, note: 'No metadata found — already clean.' },
    };
  },
};
