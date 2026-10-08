import type { Op } from './types';
import { imageCompressOp } from './image-compress';
import { imageResizeOp } from './image-resize';
import { imageConvertOp } from './image-convert';
import { pdfCompressOp } from './pdf-compress';
import { metadataCleanOp } from './metadata-clean';
import { fontConvertOp } from './font-convert';

export * from './types';
export * from './batch';
export { imageCompressOp, imageResizeOp, imageConvertOp, pdfCompressOp, metadataCleanOp, fontConvertOp };

/**
 * Every declared op.
 *
 * Tools are migrated here one at a time; a tool absent from this list still
 * works from its own page. The list is what the chaining graph is computed
 * from, so adding an op makes it reachable from every compatible step without
 * anyone maintaining a table of routes.
 */
export const OPS: readonly Op<never>[] = [
  imageCompressOp as unknown as Op<never>,
  imageResizeOp as unknown as Op<never>,
  imageConvertOp as unknown as Op<never>,
  pdfCompressOp as unknown as Op<never>,
  metadataCleanOp as unknown as Op<never>,
  fontConvertOp as unknown as Op<never>,
];

export function opById(id: string): Op<never> | undefined {
  return OPS.find((op) => op.id === id);
}

/** Ops that accept this file, for "what can I do with this?". */
export function opsAccepting(file: { name: string; type: string }): Op<never>[] {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();
  return OPS.filter(
    (op) => op.accepts.ext.includes(ext) || (!!file.type && op.accepts.mime.includes(file.type)),
  );
}
