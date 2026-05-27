/* Pure font-conversion utilities — no DOM, no wawoff2 imports.
   Extracted from font-converter.astro for testability. */

export interface DiagResult { issues: string[]; warnings: string[] }

/* ── Structural validation ── */
export function inspectSfnt(buf: ArrayBuffer): DiagResult {
  const dv = new DataView(buf);
  const size = buf.byteLength;
  const issues: string[] = [];
  const warnings: string[] = [];

  if (size < 12) {
    issues.push('File is too small to contain a font header — it may be truncated or empty.');
    return { issues, warnings };
  }

  const magic = dv.getUint32(0);
  const sfntMagics = new Set([0x00010000, 0x4F54544F, 0x74727565, 0x74797031]);
  if (!sfntMagics.has(magic)) {
    const hex = '0x' + magic.toString(16).toUpperCase().padStart(8, '0');
    issues.push(`Unexpected file signature (${hex}). The file may have been renamed rather than converted.`);
    return { issues, warnings };
  }

  const isOTF = magic === 0x4F54544F;
  const numTables = dv.getUint16(4);
  const dirEnd = 12 + numTables * 16;

  if (size < dirEnd) {
    issues.push(`Table directory claims ${numTables} tables but the file is only ${size} bytes — it is likely truncated.`);
    return { issues, warnings };
  }

  const found = new Set<string>();
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    const tag = String.fromCharCode(dv.getUint8(o), dv.getUint8(o+1), dv.getUint8(o+2), dv.getUint8(o+3)).trimEnd();
    const offset = dv.getUint32(o + 8);
    const length = dv.getUint32(o + 12);
    found.add(tag);
    if (offset + length > size) {
      issues.push(`Table '${tag}' extends beyond the end of the file (starts at byte ${offset}, length ${length}, file is ${size} bytes).`);
    }
  }

  const required = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'post'];
  for (const t of required) {
    if (!found.has(t)) issues.push(`Required table '${t}' is missing.`);
  }

  if (!found.has('glyf') && !found.has('CFF ') && !found.has('CFF2')) {
    issues.push(`No glyph outline table found — expected 'glyf' (TrueType) or 'CFF '/'CFF2' (PostScript/OTF).`);
  }
  if (isOTF && found.has('glyf') && !found.has('CFF ')) {
    warnings.push(`File header says OTF (OTTO) but contains a 'glyf' table instead of 'CFF '. The flavour may be mislabelled.`);
  }

  return { issues, warnings };
}

/* ── Name-record repair ── */
export function repairNameRecords(font: any, fallback: string): string[] {
  const repairs: string[] = [];

  const platform: Record<string, any> =
    font.names.unicode ?? font.names.macintosh ?? font.names.windows ?? font.names;

  function patch(key: string, value: string) { platform[key] = { en: value }; }

  if (!font.getEnglishName('fontFamily')) {
    const family = font.getEnglishName('preferredFamily') ?? fallback;
    patch('fontFamily', family);
    repairs.push(`added missing 'fontFamily' → "${family}"`);
  }
  if (!font.getEnglishName('fontSubfamily')) {
    const sub = font.getEnglishName('preferredSubfamily') ?? 'Regular';
    patch('fontSubfamily', sub);
    repairs.push(`added missing 'fontSubfamily' → "${sub}"`);
  }
  if (!font.getEnglishName('postScriptName')) {
    const family = font.getEnglishName('fontFamily') ?? fallback;
    const psName = family.replace(/\s+/g, '');
    patch('postScriptName', psName);
    repairs.push(`added missing 'postScriptName' → "${psName}"`);
  }
  if (!font.getEnglishName('fullName')) {
    const family = font.getEnglishName('fontFamily') ?? fallback;
    const sub = font.getEnglishName('fontSubfamily') ?? 'Regular';
    const full = sub.toLowerCase() === 'regular' ? family : `${family} ${sub}`;
    patch('fullName', full);
    repairs.push(`added missing 'fullName' → "${full}"`);
  }
  return repairs;
}

/* ── opentype.js error → plain English ── */
export function translateParseError(msg: string): string {
  if (/unsupported opentype signature/i.test(msg))
    return 'Unrecognised font format — file signature is not TTF, OTF, or WOFF.';
  if (/cmap/i.test(msg))
    return `Corrupted 'cmap' table (character-to-glyph mapping): ${msg}`;
  if (/checksum/i.test(msg))
    return `Table checksum mismatch: ${msg}. The file may have been partially overwritten.`;
  if (/end of data/i.test(msg) || /unexpected end/i.test(msg))
    return 'File is truncated — data ends before the font is fully described.';
  if (/name table/i.test(msg))
    return `Corrupted 'name' table (font metadata): ${msg}`;
  return msg;
}

/* ── zlib decompression (used by WOFF unwrapper) ── */
export async function zlibDecompress(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  // Write and close concurrently; capture write errors so they don't
  // become unhandled rejections — the read loop will surface them.
  const writeErr: Promise<void> = writer.write(data)
    .then(() => writer.close())
    .catch(() => {});

  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  }
  await writeErr;

  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

/* ── WOFF unwrapper (extracts raw sfnt from WOFF container) ── */
export async function unwrapWOFF(woffBuf: ArrayBuffer): Promise<ArrayBuffer> {
  const dv = new DataView(woffBuf);
  const wu8 = new Uint8Array(woffBuf);
  const sfVersion = dv.getUint32(4);
  const numTables = dv.getUint16(12);

  const tables: { tag: string; checksum: number; data: Uint8Array }[] = [];
  for (let i = 0; i < numTables; i++) {
    const o = 44 + i * 20;
    const tag = String.fromCharCode(
      dv.getUint8(o), dv.getUint8(o+1), dv.getUint8(o+2), dv.getUint8(o+3)
    );
    const offset     = dv.getUint32(o + 4);
    const compLength = dv.getUint32(o + 8);
    const origLength = dv.getUint32(o + 12);
    const checksum   = dv.getUint32(o + 16);
    const raw = wu8.subarray(offset, offset + compLength);
    const data = compLength < origLength ? await zlibDecompress(raw) : raw;
    tables.push({ tag, checksum, data });
  }

  const n = numTables;
  let pow2 = 1; while (pow2 * 2 <= n) pow2 *= 2;
  const searchRange    = pow2 * 16;
  const entrySelector  = Math.log2(pow2);
  const rangeShift     = n * 16 - searchRange;

  const dirEnd = 12 + n * 16;
  let dataPos = dirEnd;
  const sfntOffsets = tables.map(t => {
    const o = dataPos; dataPos += (t.data.length + 3) & ~3; return o;
  });

  const sfnt = new ArrayBuffer(dataPos);
  const sdv = new DataView(sfnt);
  const su8 = new Uint8Array(sfnt);

  sdv.setUint32(0, sfVersion);
  sdv.setUint16(4, n);
  sdv.setUint16(6, searchRange);
  sdv.setUint16(8, entrySelector);
  sdv.setUint16(10, rangeShift);

  tables.forEach((t, i) => {
    const d = 12 + i * 16;
    for (let c = 0; c < 4; c++) sdv.setUint8(d + c, t.tag.charCodeAt(c));
    sdv.setUint32(d + 4, t.checksum);
    sdv.setUint32(d + 8, sfntOffsets[i]);
    sdv.setUint32(d + 12, t.data.length);
    su8.set(t.data, sfntOffsets[i]);
  });
  return sfnt;
}

/* ── WOFF builder (wraps raw sfnt, tables stored uncompressed) ── */
export function buildWOFF(sfntBuffer: ArrayBuffer): ArrayBuffer {
  const dv = new DataView(sfntBuffer), u8 = new Uint8Array(sfntBuffer);
  const n = dv.getUint16(4);
  const tables: { tag: string; cs: number; off: number; len: number }[] = [];
  for (let i = 0; i < n; i++) {
    const o = 12 + i * 16;
    tables.push({
      tag: String.fromCharCode(dv.getUint8(o), dv.getUint8(o+1), dv.getUint8(o+2), dv.getUint8(o+3)),
      cs: dv.getUint32(o+4), off: dv.getUint32(o+8), len: dv.getUint32(o+12)
    });
  }
  const hSz = 44 + n * 20;
  let td = 0;
  const tOff = tables.map(t => { const o = hSz + td; td += (t.len + 3) & ~3; return o; });
  const tot = hSz + td, out = new ArrayBuffer(tot), od = new DataView(out), ou = new Uint8Array(out);
  let p = 0;
  od.setUint32(p, 0x774F4646); p += 4;
  od.setUint32(p, dv.getUint32(0)); p += 4;
  od.setUint32(p, tot); p += 4;
  od.setUint16(p, n); p += 2; od.setUint16(p, 0); p += 2;
  od.setUint32(p, sfntBuffer.byteLength); p += 4;
  od.setUint16(p, 1); p += 2; od.setUint16(p, 0); p += 2;
  for (let i = 0; i < 5; i++) { od.setUint32(p, 0); p += 4; }
  tables.forEach((t, i) => {
    for (let c = 0; c < 4; c++) od.setUint8(p + c, t.tag.charCodeAt(c));
    p += 4; od.setUint32(p, tOff[i]); p += 4; od.setUint32(p, t.len); p += 4;
    od.setUint32(p, t.len); p += 4; od.setUint32(p, t.cs); p += 4;
  });
  tables.forEach((t, i) => ou.set(u8.subarray(t.off, t.off + t.len), tOff[i]));
  return out;
}

/* ── EOT builder ── */
export function buildEOT(sfntBuffer: ArrayBuffer): ArrayBuffer {
  const u8 = new Uint8Array(sfntBuffer);
  const sz = 82 + sfntBuffer.byteLength;
  const out = new ArrayBuffer(sz), dv = new DataView(out), ou = new Uint8Array(out);
  dv.setUint32(0, sz, true); dv.setUint32(4, sfntBuffer.byteLength, true);
  dv.setUint32(8, 0x00020001, true);
  for (let i = 12; i < 82; i += 4) dv.setUint32(i, 0, true);
  dv.setUint32(36, 400, true); dv.setUint16(42, 0x504C, true);
  ou.set(u8, 82);
  return out;
}

/* ── Misc helpers ── */
export function fmtBytes(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}
export function baseName(name: string): string { return name.replace(/\.[^.]+$/, ''); }
export function extOf(name: string): string { return (name.split('.').pop() ?? '').toLowerCase(); }
