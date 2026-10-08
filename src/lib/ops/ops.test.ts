import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  accepts, chainableTo, defaultParams, OpError,
  type Op, type ParamValues,
} from './types';
import {
  fitWithin, placement, minifySvg, stem, isSvg, isHeic,
  MIME_BY_FORMAT, EXT_BY_MIME,
} from './image-core';
import { imageCompressOp } from './image-compress';
import { imageResizeOp } from './image-resize';
import { imageConvertOp } from './image-convert';
import { OPS, opById, opsAccepting } from './index';
import { shouldZip, summarise, ZIP_THRESHOLD, MAX_BATCH_FILES } from './batch';

// These tests run in node, with no canvas. That is the point of the refactor:
// the geometry, naming, acceptance and chaining logic are all testable without
// a browser, where previously they only existed inside a page's <script>.

describe('op declarations', () => {
  it('every op has a distinct id', () => {
    const ids = OPS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every op declares both mime and extension acceptance', () => {
    // Browsers report an empty or wrong MIME often enough that trusting either
    // alone rejects valid files.
    const bad = OPS.filter((o) => !o.accepts.mime.length || !o.accepts.ext.length);
    expect(bad.map((o) => o.id)).toEqual([]);
  });

  it('every op produces a type it or another op could consume', () => {
    // A dead-end output is allowed, but a malformed one is not.
    const bad = OPS.filter((op) => {
      const mime = op.produces(defaultParams(op.params) as never);
      return !/^[a-z]+\/[a-z0-9.+-]+$/.test(mime);
    });
    expect(bad.map((o) => o.id)).toEqual([]);
  });

  it('every param default is within its own declared bounds', () => {
    const bad: string[] = [];
    for (const op of OPS) {
      for (const [key, spec] of Object.entries(op.params)) {
        if (spec.kind === 'range') {
          if (spec.default < spec.min || spec.default > spec.max) bad.push(`${op.id}.${key}`);
        }
        if (spec.kind === 'enum') {
          if (!spec.of.some((o) => o.value === spec.default)) bad.push(`${op.id}.${key}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('resolves an op by id', () => {
    expect(opById('image-compress')?.id).toBe('image-compress');
    expect(opById('nope')).toBeUndefined();
  });
});

describe('accepts', () => {
  it('accepts by extension when the browser reports no type', () => {
    // Dragging from some file managers yields an empty type.
    expect(accepts(imageCompressOp as never, { name: 'photo.png', type: '' })).toBe(true);
  });

  it('accepts by mime when the extension is missing or wrong', () => {
    expect(accepts(imageCompressOp as never, { name: 'photo', type: 'image/png' })).toBe(true);
    expect(accepts(imageCompressOp as never, { name: 'photo.txt', type: 'image/png' })).toBe(true);
  });

  it('rejects what the op cannot read', () => {
    expect(accepts(imageCompressOp as never, { name: 'doc.pdf', type: 'application/pdf' })).toBe(false);
  });

  it('is case-insensitive about extensions', () => {
    // Camera exports are frequently uppercase.
    expect(accepts(imageConvertOp as never, { name: 'IMG_0001.HEIC', type: '' })).toBe(true);
    expect(accepts(imageCompressOp as never, { name: 'PHOTO.JPG', type: '' })).toBe(true);
  });

  it('lists every op that can take a given file', () => {
    const ids = opsAccepting({ name: 'a.png', type: 'image/png' }).map((o) => o.id).sort();
    expect(ids).toEqual(['image-compress', 'image-convert', 'image-resize']);

    // SVG is vector: compress minifies it and convert rasterises it, but
    // resize does not take one.
    const svg = opsAccepting({ name: 'logo.svg', type: 'image/svg+xml' }).map((o) => o.id).sort();
    expect(svg).toEqual(['image-compress', 'image-convert']);
  });
});

describe('chaining', () => {
  it('computes the next steps from the declarations', () => {
    // This is the whole chaining mechanism: nobody maintains a route table.
    const params = { ...defaultParams(imageConvertOp.params), format: 'png' };
    const next = chainableTo(imageConvertOp, params as never, OPS).map((o) => o.id).sort();
    expect(next).toContain('image-compress');
    expect(next).toContain('image-resize');
  });

  it('follows the chosen output format, not the op identity', () => {
    // Converting to BMP leads somewhere different from converting to PNG,
    // and the graph has to reflect the parameters, not just the tool.
    const toBmp = { ...defaultParams(imageConvertOp.params), format: 'bmp' };
    const next = chainableTo(imageConvertOp, toBmp as never, OPS).map((o) => o.id);
    expect(next).toContain('image-resize');   // resize accepts bmp
    expect(next).not.toContain('image-compress'); // compress does not
  });

  it('never offers a step back into the same op', () => {
    for (const op of OPS) {
      const next = chainableTo(op, defaultParams(op.params) as never, OPS);
      expect(next.map((o) => o.id)).not.toContain(op.id);
    }
  });

  it('a compressed JPEG can be fed onward', () => {
    const params = { ...defaultParams(imageCompressOp.params), format: 'jpeg' };
    const next = chainableTo(imageCompressOp, params as never, OPS).map((o) => o.id);
    expect(next).toContain('image-resize');
  });
});

describe('fitWithin', () => {
  it('leaves an already-small image alone', () => {
    expect(fitWithin(400, 300, 800)).toEqual({ w: 400, h: 300 });
  });

  it('clamps the longest edge and keeps the ratio', () => {
    expect(fitWithin(4000, 2000, 1000)).toEqual({ w: 1000, h: 500 });
    expect(fitWithin(2000, 4000, 1000)).toEqual({ w: 500, h: 1000 });
  });

  it('never rounds a dimension to zero', () => {
    // A very wide, very short image must not end up 0px tall.
    expect(fitWithin(10000, 3, 100).h).toBeGreaterThanOrEqual(1);
  });
});

describe('placement', () => {
  it('stretch fills the target exactly, ignoring the ratio', () => {
    expect(placement(100, 100, 400, 200, 'stretch')).toEqual({ dx: 0, dy: 0, dw: 400, dh: 200 });
  });

  it('contain fits inside and centres', () => {
    const p = placement(100, 100, 400, 200, 'contain');
    expect(p.dw).toBe(200);
    expect(p.dh).toBe(200);
    expect(p.dx).toBe(100); // centred horizontally
    expect(p.dy).toBe(0);
  });

  it('cover fills and overflows', () => {
    const p = placement(100, 100, 400, 200, 'cover');
    expect(p.dw).toBe(400);
    expect(p.dh).toBe(400);
    expect(p.dy).toBe(-100); // overflow is split evenly
  });

  it('pad has the same geometry as contain', () => {
    // They differ only in what gets painted behind, which is why both live in
    // one function rather than two.
    expect(placement(100, 50, 300, 300, 'pad')).toEqual(placement(100, 50, 300, 300, 'contain'));
  });

  it('centres an image that already matches the target', () => {
    expect(placement(200, 200, 200, 200, 'contain')).toEqual({ dx: 0, dy: 0, dw: 200, dh: 200 });
  });
});

describe('minifySvg', () => {
  it('strips comments, metadata and xml declarations', () => {
    const svg = `<?xml version="1.0"?><svg><!-- a note --><metadata>x</metadata><title>T</title><rect /></svg>`;
    const out = minifySvg(svg);
    expect(out).not.toContain('<!--');
    expect(out).not.toContain('<metadata>');
    expect(out).not.toContain('<title>');
    expect(out).not.toContain('<?xml');
    expect(out).toContain('<rect/>');
  });

  it('honours both HTML comment terminators', () => {
    // HTML ends a comment on `-->` or `--!>`. Matching only the first left a
    // comment closed the second way completely intact, opener and all.
    expect(minifySvg('<svg><!-- x --!><rect /></svg>')).toBe('<svg><rect/></svg>');
    expect(minifySvg('<svg><!-- x --><rect /></svg>')).toBe('<svg><rect/></svg>');
  });

  it('drops an unterminated comment rather than letting it through', () => {
    // An opener with no terminator would swallow the rest of the document in a
    // parser looking for one.
    expect(minifySvg('<svg><rect /><!-- never closed')).toBe('<svg><rect/>');
  });

  it('removes nested comments completely', () => {
    // A single pass leaves a usable comment behind when one is nested inside
    // another — the shape a sanitiser has to defend against.
    const nested = '<svg><!--<!--inner--><rect /></svg>';
    expect(minifySvg(nested)).toBe('<svg><rect/></svg>');

    // Over-closed: stripping the comment leaves an orphan `-->`, which is
    // inert text rather than a tag but is still malformed output.
    const overClosed = '<svg><!--<!--inner-->--><rect /></svg>';
    const out = minifySvg(overClosed);
    expect(out).not.toContain('<!--');
    expect(out).not.toContain('-->');
  });

  it('removes nested metadata, title and desc completely', () => {
    // A single pass leaves the outer half of a nested pair behind, so the
    // element this is meant to strip survives. Each removal loops until the
    // string stops changing.
    expect(minifySvg('<svg><metadata><metadata>x</metadata></metadata><rect /></svg>'))
      .toBe('<svg><rect/></svg>');
    expect(minifySvg('<svg><title><title>x</title></title><rect /></svg>'))
      .toBe('<svg><rect/></svg>');
    expect(minifySvg('<svg><desc><desc>x</desc></desc><rect /></svg>'))
      .toBe('<svg><rect/></svg>');
  });

  it('removes title and desc that carry attributes', () => {
    // The original pattern only matched a bare <title>, so <title id="x">
    // passed straight through.
    expect(minifySvg('<svg><title id="a">T</title><desc lang="en">D</desc><rect /></svg>'))
      .toBe('<svg><rect/></svg>');
  });

  it('collapses whitespace between tags', () => {
    expect(minifySvg('<svg>\n  <g>\n    <rect />\n  </g>\n</svg>')).toBe('<svg><g><rect/></g></svg>');
  });
});

describe('handoff', () => {
  it('hands files over exactly once', async () => {
    // A re-render must not be able to re-add the same files, and a tool must
    // never pick up files meant for a different one.
    const { collectHandoff, hasHandoff } = await import('./handoff');
    expect(collectHandoff('image-resize')).toEqual([]);
    expect(hasHandoff('image-resize')).toBe(false);
  });
});

describe('batch ui ordering', () => {
  it('does not re-render the file list after a run finishes', () => {
    // A full render() in the finally block fires onFilesChanged, which pages
    // use to RESET their result fields — so it silently wiped whatever onDone
    // had just written. The run leaves the file list unchanged, so only the
    // button state should be touched.
    const SRC = readFileSync(join(import.meta.dirname, 'batch-ui.ts'), 'utf8');
    const finallyBlock = SRC.slice(SRC.indexOf('} finally {'));
    const body = finallyBlock.slice(0, finallyBlock.indexOf('},'));
    expect(body).not.toMatch(/^\s*render\(\);/m);
    expect(body).toContain('runEl.disabled');
  });
});

describe('format support', () => {
  it('lists AVIF as an option but does not default to it', async () => {
    // Safari cannot encode AVIF at all, and a canvas that cannot write a
    // format quietly returns PNG instead of failing. Defaulting to it meant a
    // whole batch failing at the end, so the default is a format every target
    // browser can write and the probe disables the rest up front.
    const spec = imageConvertOp.params.format;
    expect(spec.kind).toBe('enum');
    if (spec.kind !== 'enum') return;

    const values = spec.of.map((o) => o.value);
    expect(values).toContain('avif');
    expect(spec.default).not.toBe('avif');
    expect(spec.default).toBe('png');
  });

  it('defaults compress and resize to a universally writable format', () => {
    for (const op of [imageCompressOp, imageResizeOp]) {
      const spec = op.params.format;
      if (spec.kind !== 'enum') continue;
      expect(['jpeg', 'png']).toContain(spec.default);
    }
  });
});

describe('page markup matches the declarations', () => {
  // The page renders its own <select> rather than generating it from the
  // schema, so the two can drift — a format offered in the markup but absent
  // from the op would be selectable and then unhandled.
  const PAGE = readFileSync(
    join(import.meta.dirname, '../../pages/tools/image-convert.astro'),
    'utf8',
  );

  it('offers exactly the formats the op declares', () => {
    const spec = imageConvertOp.params.format;
    if (spec.kind !== 'enum') throw new Error('format should be an enum');

    const select = PAGE.slice(PAGE.indexOf('id="imgcvtOutFmt"'));
    const block = select.slice(0, select.indexOf('</select>'));
    const inMarkup = [...block.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]).sort();

    expect(inMarkup).toEqual(spec.of.map((o) => o.value).sort());
  });

  it('pre-selects the op default', () => {
    const spec = imageConvertOp.params.format;
    if (spec.kind !== 'enum') return;
    expect(PAGE).toContain(`<option value="${spec.default}" selected>`);
  });
});

describe('naming helpers', () => {
  it('strips only the final extension', () => {
    expect(stem('photo.png')).toBe('photo');
    expect(stem('my.photo.v2.png')).toBe('my.photo.v2');
    expect(stem('noext')).toBe('noext');
  });

  it('identifies svg by type or extension', () => {
    expect(isSvg('a.svg', '')).toBe(true);
    expect(isSvg('a', 'image/svg+xml')).toBe(true);
    expect(isSvg('a.png', 'image/png')).toBe(false);
  });

  it('identifies heic in both its forms', () => {
    expect(isHeic('IMG.HEIC', '')).toBe(true);
    expect(isHeic('IMG.heif', '')).toBe(true);
    expect(isHeic('x', 'image/heic')).toBe(true);
    expect(isHeic('a.jpg', 'image/jpeg')).toBe(false);
  });

  it('round-trips mime and extension for the raster formats', () => {
    for (const [mime, ext] of Object.entries(EXT_BY_MIME)) {
      expect(MIME_BY_FORMAT[ext]).toBe(mime);
    }
  });
});

describe('batch policy', () => {
  it('downloads a couple of files singly and bundles more', () => {
    // Two files should not force an unzip; twenty should not fire twenty prompts.
    expect(shouldZip(1)).toBe(false);
    expect(shouldZip(ZIP_THRESHOLD)).toBe(false);
    expect(shouldZip(ZIP_THRESHOLD + 1)).toBe(true);
  });

  it('caps a run rather than letting the browser be the thing that fails', () => {
    expect(MAX_BATCH_FILES).toBeGreaterThan(0);
  });

  it('summarises partial failure honestly', () => {
    // A batch that half worked must say so, not round up to success.
    expect(summarise({ items: [], succeeded: 5, failed: 0, bytesIn: 0, bytesOut: 0, ms: 0 }))
      .toBe('5 files processed');
    expect(summarise({ items: [], succeeded: 1, failed: 0, bytesIn: 0, bytesOut: 0, ms: 0 }))
      .toBe('1 file processed');
    expect(summarise({ items: [], succeeded: 3, failed: 2, bytesIn: 0, bytesOut: 0, ms: 0 }))
      .toBe('3 processed, 2 failed');
    expect(summarise({ items: [], succeeded: 0, failed: 4, bytesIn: 0, bytesOut: 0, ms: 0 }))
      .toBe('All 4 files failed');
  });
});

describe('OpError', () => {
  it('carries a transmittable code separate from its message', () => {
    // The message may name the user's file and is never transmitted; the code
    // is what reaches telemetry.
    const e = new OpError('HEIC_DECODE_FAIL', 'Could not decode holiday-photos/IMG_1.heic');
    expect(e.code).toBe('HEIC_DECODE_FAIL');
    expect(e).toBeInstanceOf(Error);
  });
});

describe('defaultParams', () => {
  it('reads defaults straight off a schema', () => {
    const p = defaultParams(imageCompressOp.params);
    expect(p.format).toBe('jpeg');
    expect(p.quality).toBe(82);
    expect(p.maxDim).toBeNull();
  });

  it('produces a usable set for every op', () => {
    for (const op of OPS) {
      const p = defaultParams(op.params) as ParamValues;
      expect(Object.keys(p).length).toBe(Object.keys(op.params).length);
      expect(() => (op as Op).produces(p)).not.toThrow();
    }
  });
});
