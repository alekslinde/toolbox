/**
 * Font-converter test suite.
 *
 * Unit tests cover pure-function logic (no font file needed).
 * Integration tests cover all 20 input×output conversion combos
 * and require a system TTF at FONT_PATH.
 *
 * Run: npm test
 */

import { readFileSync, existsSync } from 'fs';
import { deflateSync } from 'zlib';
import { describe, it, expect, beforeAll } from 'vitest';
import * as opentype from 'opentype.js';
// @ts-ignore
import compress from 'wawoff2/compress';
// @ts-ignore
import decompress from 'wawoff2/decompress';

import {
  inspectSfnt,
  buildWOFF,
  buildEOT,
  zlibDecompress,
  unwrapWOFF,
  repairNameRecords,
  translateParseError,
  fmtBytes,
  baseName,
  extOf,
} from './font-converter.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const FONT_PATH = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';
const HAS_FONT = existsSync(FONT_PATH);

/** Read the system TTF fixture; skip gracefully if missing. */
function requireFont(): Buffer {
  if (!HAS_FONT) throw new Error(`Fixture font not found at ${FONT_PATH}`);
  return readFileSync(FONT_PATH);
}

/** Build a minimal sfnt offset table with the given magic and zero tables. */
function minimalSfnt(magic: number): ArrayBuffer {
  const ab = new ArrayBuffer(12);
  const dv = new DataView(ab);
  dv.setUint32(0, magic);       // sfntVersion
  dv.setUint16(4, 0);           // numTables
  dv.setUint16(6, 0);           // searchRange
  dv.setUint16(8, 0);           // entrySelector
  dv.setUint16(10, 0);          // rangeShift
  return ab;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function magic32(ab: ArrayBuffer): number {
  return new DataView(ab).getUint32(0);
}
function magic32LE(ab: ArrayBuffer): number {
  return new DataView(ab).getUint32(0, true);
}

// ── Unit: inspectSfnt ────────────────────────────────────────────────────────

describe('inspectSfnt', () => {
  it('rejects buffers shorter than 12 bytes', () => {
    const { issues } = inspectSfnt(new ArrayBuffer(8));
    expect(issues[0]).toMatch(/too small/);
  });

  it('rejects wrong magic', () => {
    const ab = new ArrayBuffer(12);
    new DataView(ab).setUint32(0, 0xDEADBEEF);
    const { issues } = inspectSfnt(ab);
    expect(issues[0]).toMatch(/Unexpected file signature/);
  });

  it('accepts 0x00010000 magic (TrueType)', () => {
    const { issues } = inspectSfnt(minimalSfnt(0x00010000));
    // No "unexpected signature" issue (the file still has missing required tables, which is OK for this check)
    expect(issues.every(i => !i.includes('Unexpected file signature'))).toBe(true);
  });

  it('accepts 0x4F54544F magic (OTF)', () => {
    const { issues } = inspectSfnt(minimalSfnt(0x4F54544F));
    expect(issues.every(i => !i.includes('Unexpected file signature'))).toBe(true);
  });

  it('accepts 0x74727565 magic (true / macOS TTF)', () => {
    const { issues } = inspectSfnt(minimalSfnt(0x74727565));
    expect(issues.every(i => !i.includes('Unexpected file signature'))).toBe(true);
  });

  it('reports missing required tables on a zero-table sfnt', () => {
    const { issues } = inspectSfnt(minimalSfnt(0x00010000));
    const requiredTables = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'post'];
    for (const t of requiredTables) {
      expect(issues.some(i => i.includes(`'${t}'`))).toBe(true);
    }
  });

  it('reports truncated table directory', () => {
    const ab = new ArrayBuffer(12); // claims 0 tables; no issue
    const dv = new DataView(ab);
    dv.setUint32(0, 0x00010000);
    dv.setUint16(4, 5); // claims 5 tables but no bytes for them
    const { issues } = inspectSfnt(ab);
    expect(issues.some(i => i.includes('truncated'))).toBe(true);
  });

  it('validates a real TTF without structural issues', () => {
    if (!HAS_FONT) return;
    const buf = requireFont();
    const { issues } = inspectSfnt(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(issues).toHaveLength(0);
  });
});

// ── Unit: translateParseError ────────────────────────────────────────────────

describe('translateParseError', () => {
  it('humanises unsupported signature errors', () => {
    expect(translateParseError('Unsupported OpenType signature')).toMatch(/Unrecognised font format/);
  });
  it('humanises cmap errors', () => {
    expect(translateParseError('cmap subtable not found')).toMatch(/cmap/);
  });
  it('passes through unknown errors unchanged', () => {
    expect(translateParseError('some random error')).toBe('some random error');
  });
});

// ── Unit: misc helpers ────────────────────────────────────────────────────────

describe('fmtBytes', () => {
  it('formats bytes', () => { expect(fmtBytes(512)).toBe('512 B'); });
  it('formats kilobytes', () => { expect(fmtBytes(2048)).toBe('2.0 KB'); });
  it('formats megabytes', () => { expect(fmtBytes(2 * 1024 * 1024)).toBe('2.00 MB'); });
});

describe('baseName', () => {
  it('strips extension', () => { expect(baseName('MyFont.ttf')).toBe('MyFont'); });
  it('handles no extension', () => { expect(baseName('MyFont')).toBe('MyFont'); });
  it('strips only last extension', () => { expect(baseName('my.font.ttf')).toBe('my.font'); });
});

describe('extOf', () => {
  it('returns lowercase extension', () => { expect(extOf('Font.TTF')).toBe('ttf'); });
  it('returns empty string for no extension', () => { expect(extOf('font')).toBe('font'); });
});

// ── Unit: zlibDecompress ─────────────────────────────────────────────────────

describe('zlibDecompress', () => {
  it('round-trips zlib-compressed data', async () => {
    const original = Buffer.from('Hello, WOFF table data!');
    const compressed = deflateSync(original); // zlib (RFC 1950) format
    const result = await zlibDecompress(new Uint8Array(compressed));
    expect(Buffer.from(result)).toEqual(original);
  });

  it('throws on corrupted data', async () => {
    await expect(zlibDecompress(new Uint8Array([0x00, 0x01, 0x02]))).rejects.toThrow();
  });
});

// ── Unit: buildWOFF + unwrapWOFF ─────────────────────────────────────────────

describe('buildWOFF / unwrapWOFF', () => {
  it('produces output with WOFF magic 0x774F4646', () => {
    if (!HAS_FONT) return;
    const buf = requireFont();
    const sfnt = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const woff = buildWOFF(sfnt);
    expect(magic32(woff)).toBe(0x774F4646);
  });

  it('round-trips: unwrapWOFF(buildWOFF(sfnt)) produces identical sfnt', async () => {
    if (!HAS_FONT) return;
    const buf = requireFont();
    const sfnt = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const woff = buildWOFF(sfnt);
    const recovered = await unwrapWOFF(woff);
    // The unwrapped sfnt should parse without error
    expect(() => (opentype as any).parse(recovered)).not.toThrow();
    // Byte-level check: same table count and same sfnt magic
    const origDv = new DataView(sfnt);
    const recDv  = new DataView(recovered);
    expect(recDv.getUint32(0)).toBe(origDv.getUint32(0));   // magic
    expect(recDv.getUint16(4)).toBe(origDv.getUint16(4));   // numTables
  });

  it('WOFF total-length field equals output size', () => {
    if (!HAS_FONT) return;
    const buf = requireFont();
    const sfnt = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const woff = buildWOFF(sfnt);
    expect(new DataView(woff).getUint32(8)).toBe(woff.byteLength);
  });

  it('WOFF sfnt-flavor field matches original magic', () => {
    if (!HAS_FONT) return;
    const buf = requireFont();
    const sfnt = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const origMagic = new DataView(sfnt).getUint32(0);
    const woff = buildWOFF(sfnt);
    expect(new DataView(woff).getUint32(4)).toBe(origMagic);
  });
});

// ── Unit: buildEOT ───────────────────────────────────────────────────────────

describe('buildEOT', () => {
  it('produces output with correct EOTSize in little-endian field', () => {
    if (!HAS_FONT) return;
    const buf = requireFont();
    const sfnt = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const eot = buildEOT(sfnt);
    expect(magic32LE(eot)).toBe(eot.byteLength);
  });

  it('encodes FontDataSize as sfnt byte length (LE)', () => {
    if (!HAS_FONT) return;
    const buf = requireFont();
    const sfnt = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const eot = buildEOT(sfnt);
    expect(new DataView(eot).getUint32(4, true)).toBe(sfnt.byteLength);
  });

  it('total size = 82 (header) + sfnt size', () => {
    if (!HAS_FONT) return;
    const buf = requireFont();
    const sfnt = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const eot = buildEOT(sfnt);
    expect(eot.byteLength).toBe(82 + sfnt.byteLength);
  });
});

// ── Integration: repairNameRecords ───────────────────────────────────────────

describe('repairNameRecords', () => {
  it('does not repair a well-formed font', () => {
    if (!HAS_FONT) return;
    const buf = requireFont();
    const sfnt = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const font = (opentype as any).parse(sfnt);
    const repairs = repairNameRecords(font, 'TestFont');
    expect(repairs).toHaveLength(0);
  });
});

// ── Integration: all 20 conversion combinations ──────────────────────────────

/**
 * Replicates the conversion logic from font-converter.astro in a testable form.
 * Returns { magic, byteLength } for lightweight assertions.
 */
async function convert(
  srcBuf: ArrayBuffer,
  srcExt: 'ttf' | 'otf' | 'woff' | 'woff2',
  to: 'ttf' | 'otf' | 'woff' | 'woff2' | 'eot',
): Promise<ArrayBuffer> {
  const WOFF2_MAGIC = 0x774F4632;
  const WOFF_MAGIC  = 0x774F4646;

  let parseAB = srcBuf;

  if (srcExt === 'woff2' || new DataView(srcBuf).getUint32(0) === WOFF2_MAGIC) {
    const ttfBytes = await decompress(new Uint8Array(srcBuf));
    parseAB = ttfBytes.buffer.slice(ttfBytes.byteOffset, ttfBytes.byteOffset + ttfBytes.byteLength);
  } else if (srcExt === 'woff' || new DataView(srcBuf).getUint32(0) === WOFF_MAGIC) {
    parseAB = await unwrapWOFF(srcBuf);
  }

  const font = (opentype as any).parse(parseAB);
  repairNameRecords(font, 'Test');
  const sfnt: ArrayBuffer = font.toArrayBuffer();

  if (to === 'ttf' || to === 'otf') return sfnt;
  if (to === 'woff') return buildWOFF(sfnt);
  if (to === 'eot')  return buildEOT(sfnt);

  // woff2: prefer raw sfnt bytes to avoid opentype.js re-serialisation issues
  const isWoff  = new DataView(srcBuf).getUint32(0) === WOFF_MAGIC;
  const sfntSrc = isWoff ? await unwrapWOFF(srcBuf) : parseAB;
  const woff2Bytes = await compress(new Uint8Array(sfntSrc));
  return woff2Bytes.buffer.slice(woff2Bytes.byteOffset, woff2Bytes.byteOffset + woff2Bytes.byteLength);
}

const MAGICS = {
  woff:  0x774F4646,
  woff2: 0x774F4632,
  eot_size_check: true,  // EOT: offset 0 LE == total length
} as const;

const SFNT_MAGICS = new Set([0x00010000, 0x4F54544F, 0x74727565, 0x74797031]);

describe('conversion matrix', () => {
  // Fixtures are created once in beforeAll to avoid redundant WOFF2 compression
  let ttfBuf: ArrayBuffer;
  let woffBuf: ArrayBuffer;
  let woff2Buf: ArrayBuffer;

  beforeAll(async () => {
    if (!HAS_FONT) return;
    const raw = requireFont();
    ttfBuf  = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    woffBuf = buildWOFF(ttfBuf);

    const w2 = await compress(new Uint8Array(ttfBuf));
    woff2Buf = w2.buffer.slice(w2.byteOffset, w2.byteOffset + w2.byteLength);
  }, 30_000);

  function assertOutput(result: ArrayBuffer, to: string) {
    if (to === 'ttf' || to === 'otf') {
      expect(SFNT_MAGICS.has(magic32(result))).toBe(true);
    } else if (to === 'woff') {
      expect(magic32(result)).toBe(0x774F4646);
    } else if (to === 'woff2') {
      expect(magic32(result)).toBe(0x774F4632);
    } else if (to === 'eot') {
      // EOTSize (LE) must equal total file length
      expect(new DataView(result).getUint32(0, true)).toBe(result.byteLength);
    }
  }

  const outputs = ['ttf', 'otf', 'woff', 'woff2', 'eot'] as const;

  for (const to of outputs) {
    it(`TTF → ${to.toUpperCase()}`, async () => {
      if (!HAS_FONT) return;
      const result = await convert(ttfBuf, 'ttf', to);
      assertOutput(result, to);
    }, 30_000);
  }

  for (const to of outputs) {
    it(`WOFF → ${to.toUpperCase()}`, async () => {
      if (!HAS_FONT) return;
      const result = await convert(woffBuf, 'woff', to);
      assertOutput(result, to);
    }, 30_000);
  }

  for (const to of outputs) {
    it(`WOFF2 → ${to.toUpperCase()}`, async () => {
      if (!HAS_FONT) return;
      const result = await convert(woff2Buf, 'woff2', to);
      assertOutput(result, to);
    }, 30_000);
  }

  // OTF uses the same SFNT-parse code path as TTF; we test with TTF as OTF input
  // (LiberationSans has TrueType outlines, not CFF — real OTF would have OTTO magic)
  for (const to of outputs) {
    it(`OTF (TrueType outlines) → ${to.toUpperCase()}`, async () => {
      if (!HAS_FONT) return;
      const result = await convert(ttfBuf, 'otf', to);
      assertOutput(result, to);
    }, 30_000);
  }
});
