import { bench, describe, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';

// @ts-ignore
import compress   from 'wawoff2/compress';
// @ts-ignore
import decompress from 'wawoff2/decompress';

import {
  buildWOFF,
  buildEOT,
  inspectSfnt,
  unwrapWOFF,
} from '@/lib/font-converter';

const FONT_PATH = '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf';
const HAS_FONT  = existsSync(FONT_PATH);

function skip() { if (!HAS_FONT) return true; return false; }

let ttfBuf: ArrayBuffer;
let woffBuf: ArrayBuffer;
let woff2Buf: ArrayBuffer;

function magic32(ab: ArrayBuffer): number {
  return new DataView(ab).getUint32(0);
}

// Build all fixture variants once; WOFF2 compression takes ~3 s for a 400 KB font.
beforeAll(async () => {
  if (!HAS_FONT) return;
  const raw = readFileSync(FONT_PATH);
  ttfBuf   = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
  woffBuf  = buildWOFF(ttfBuf);
  const w2 = await compress(new Uint8Array(ttfBuf));
  woff2Buf = w2.buffer.slice(w2.byteOffset, w2.byteOffset + w2.byteLength);
}, 60_000);

// ── inspectSfnt ───────────────────────────────────────────────────────────────

describe('inspectSfnt', () => {
  bench('validate LiberationSans-Regular.ttf', () => {
    if (skip()) return;
    const { issues } = inspectSfnt(ttfBuf);
    expect(issues).toHaveLength(0);
  });
});

// ── buildWOFF ─────────────────────────────────────────────────────────────────

describe('buildWOFF', () => {
  bench('TTF → WOFF (~401 KB input)', () => {
    if (skip()) return;
    const woff = buildWOFF(ttfBuf);
    expect(magic32(woff)).toBe(0x774F4646);
  });
});

// ── buildEOT ──────────────────────────────────────────────────────────────────

describe('buildEOT', () => {
  bench('TTF → EOT (~401 KB input)', () => {
    if (skip()) return;
    const eot = buildEOT(ttfBuf);
    // EOTSize (LE uint32) must equal total file size
    expect(new DataView(eot).getUint32(0, true)).toBe(eot.byteLength);
  });
});

// ── unwrapWOFF ────────────────────────────────────────────────────────────────

describe('unwrapWOFF', () => {
  bench('WOFF → sfnt (~401 KB)', async () => {
    if (skip()) return;
    const sfnt = await unwrapWOFF(woffBuf);
    const m = magic32(sfnt);
    const SFNT_MAGICS = new Set([0x00010000, 0x4F54544F, 0x74727565, 0x74797031]);
    expect(SFNT_MAGICS.has(m)).toBe(true);
  });
});

// ── wawoff2 compress / decompress ─────────────────────────────────────────────

describe('wawoff2', () => {
  bench('compress   TTF → WOFF2 (~401 KB)', async () => {
    if (skip()) return;
    const out = await compress(new Uint8Array(ttfBuf));
    // WOFF2 magic
    expect(out[0]).toBe(0x77);
    expect(out[1]).toBe(0x4F);
    expect(out[2]).toBe(0x46);
    expect(out[3]).toBe(0x32);
  }, { time: 5000 });

  bench('decompress WOFF2 → sfnt (~160 KB)', async () => {
    if (skip()) return;
    const out = await decompress(new Uint8Array(woff2Buf));
    expect(out.byteLength).toBeGreaterThan(0);
  });
});
