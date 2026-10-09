/**
 * Hashing and ID generation.
 *
 * SHA-1/256/384/512 come from WebCrypto, which is in every target browser and
 * is both faster and more trustworthy than a hand-rolled implementation. MD5
 * and CRC32 are implemented here because WebCrypto deliberately omits them —
 * they are not secure and should not be, but checksums in the wild are still
 * published as MD5 and CRC32, so verifying a download needs them.
 *
 * WebCrypto needs a secure context. On http:// `crypto.subtle` is undefined,
 * so `digest()` says so rather than throwing something unreadable.
 */

export type SecureAlgo = 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';
export type HashAlgo = SecureAlgo | 'MD5' | 'CRC32';

export const HASH_ALGOS: readonly HashAlgo[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512', 'CRC32'];

/** Algorithms that must not be used for anything security-bearing. */
export const BROKEN_ALGOS: readonly HashAlgo[] = ['MD5', 'SHA-1', 'CRC32'];

export function isBroken(algo: HashAlgo): boolean {
  return BROKEN_ALGOS.includes(algo);
}

export class HashError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HashError';
  }
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

// ── CRC32 ───────────────────────────────────────────────────────────────────

let crcTable: Uint32Array | null = null;

function crc32Table(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  crcTable = table;
  return table;
}

/** CRC32 (IEEE 802.3, as used by zip and PNG) as an unsigned 32-bit number. */
export function crc32(bytes: Uint8Array): number {
  const table = crc32Table();
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── MD5 ─────────────────────────────────────────────────────────────────────

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

let md5K: Int32Array | null = null;
function md5Constants(): Int32Array {
  if (md5K) return md5K;
  const k = new Int32Array(64);
  for (let i = 0; i < 64; i++) k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  md5K = k;
  return k;
}

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

/** MD5 (RFC 1321). Present for checksum verification only — it is broken for
 *  any use where an attacker chooses the input. */
export function md5(bytes: Uint8Array): string {
  const K = md5Constants();

  // Pad: 0x80, then zeros to 56 mod 64, then the bit length little-endian.
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLen >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Int32Array(16);

  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) M[i] = view.getInt32(chunk + i * 4, true);

    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number, g: number;
      if (i < 16)      { F = (B & C) | (~B & D);          g = i; }
      else if (i < 32) { F = (D & B) | (~D & C);          g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D;                   g = (3 * i + 5) % 16; }
      else             { F = C ^ (B | ~D);                g = (7 * i) % 16; }

      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, MD5_S[i])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }

  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setInt32(0, a0, true); ov.setInt32(4, b0, true);
  ov.setInt32(8, c0, true); ov.setInt32(12, d0, true);
  return hex(out);
}

// ── Dispatch ────────────────────────────────────────────────────────────────

/** Hash bytes with any supported algorithm. Hex-encoded lowercase output. */
export async function digest(algo: HashAlgo, bytes: Uint8Array): Promise<string> {
  if (algo === 'CRC32') return crc32(bytes).toString(16).padStart(8, '0');
  if (algo === 'MD5') return md5(bytes);

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new HashError(
      'SHA hashing needs WebCrypto, which browsers only expose over HTTPS or on localhost.',
    );
  }
  // `bytes.buffer` may be a view into a larger buffer; slice to the view.
  const buf = await subtle.digest(algo, bytes.slice().buffer as ArrayBuffer);
  return hex(new Uint8Array(buf));
}

/**
 * HMAC, for verifying signed webhooks — the one place a hash tool is used with
 * a key. The key stays in the tab like everything else.
 */
export async function hmac(algo: SecureAlgo, key: Uint8Array, bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new HashError('HMAC needs WebCrypto, which browsers only expose over HTTPS or on localhost.');
  }
  const cryptoKey = await subtle.importKey(
    'raw',
    key.slice().buffer as ArrayBuffer,
    { name: 'HMAC', hash: algo },
    false,
    ['sign'],
  );
  const sig = await subtle.sign('HMAC', cryptoKey, bytes.slice().buffer as ArrayBuffer);
  return hex(new Uint8Array(sig));
}

/**
 * Constant-time-ish string comparison for the "does my hash match theirs"
 * check. Not defending against timing attacks in a browser tab — it compares
 * case-insensitively and ignores separators, which is what makes a pasted
 * checksum from a release page actually compare equal.
 */
export function hashesMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/[\s:-]/g, '');
  const x = norm(a);
  const y = norm(b);
  if (!x || !y || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

// ── UUID / ID generation ────────────────────────────────────────────────────

export type IdKind = 'uuid-v4' | 'uuid-v7' | 'nanoid' | 'ulid';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = globalThis.crypto;
  if (!c?.getRandomValues) {
    // Never fall back to Math.random for an ID someone may use as a key.
    throw new HashError('Secure random numbers are unavailable in this browser context.');
  }
  c.getRandomValues(out);
  return out;
}

export function uuidV4(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 1
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Monotonic counter state, shared by UUID v7 and ULID.
 *
 * Needed because the timestamp only has millisecond resolution, and generating
 * a batch takes far less than a millisecond. Several IDs then share a
 * timestamp prefix and are ordered only by their random tails — which is to
 * say not ordered at all, defeating the single reason to choose v7 or ULID
 * over v4. RFC 9562 §6.2 calls this the "monotonic random" method: within the
 * same millisecond, increment the random field instead of redrawing it.
 */
let lastMs = -1;
let lastCounter = 0n;

/**
 * Next counter value for a timestamp, as a bigint over the random field.
 *
 * `bits` is the width of the field being made monotonic: 74 for UUID v7 (the
 * bytes after the version and variant nibbles) and 80 for ULID.
 *
 * Returns the counter together with the timestamp to encode, which may be
 * later than the one asked for: see the overflow note below.
 */
function monotonicRandom(ms: number, bits: number): { ms: number; counter: bigint } {
  const max = (1n << BigInt(bits)) - 1n;

  const drawn = randomBytes(Math.ceil(bits / 8));
  let value = 0n;
  for (const byte of drawn) value = (value << 8n) | BigInt(byte);
  value &= max;

  if (ms !== lastMs) {
    // A new millisecond: seed from fresh randomness. Seeding in the lower half
    // of the range leaves room to count upward without overflowing, which a
    // full-range seed would do almost immediately.
    lastMs = ms;
    lastCounter = value >> 1n;
    return { ms, counter: lastCounter };
  }

  // Same millisecond: step past the previous value so the order is strict. A
  // small random step rather than +1 keeps the low bits unpredictable while
  // preserving the ordering.
  const next = lastCounter + 1n + (value & 0xffn);

  if (next > max) {
    // The field is exhausted for this millisecond. Clamping here would hand
    // every later call the same ceiling value — identical IDs, which is worse
    // than unsorted ones. Borrowing from the next millisecond keeps both
    // uniqueness and order; the timestamp runs at most a few milliseconds
    // ahead, and only under a generation rate this tool cannot reach.
    lastMs = ms + 1;
    lastCounter = value >> 1n;
    return { ms: lastMs, counter: lastCounter };
  }

  lastCounter = next;
  return { ms, counter: lastCounter };
}

/**
 * UUID v7 (RFC 9562): a 48-bit millisecond timestamp followed by randomness,
 * so IDs sort by creation time. This is what you want for a database primary
 * key — v4 keys scatter across an index and v7 keys append.
 *
 * IDs generated inside the same millisecond stay strictly ordered, per the
 * monotonic method above. Without that, a batch is unsorted and v7 buys
 * nothing over v4.
 */
export function uuidV7(now = Date.now()): string {
  // 74 bits of monotonic randomness: 12 bits in bytes 6–7 (minus the version
  // nibble) and 62 bits in bytes 8–15 (minus the two variant bits). The
  // timestamp comes back from the counter because an exhausted field borrows
  // from the next millisecond.
  const { ms: ts, counter: rand } = monotonicRandom(Math.floor(now), 74);
  const b = new Uint8Array(16);

  b[0] = (ts / 2 ** 40) & 0xff;
  b[1] = (ts / 2 ** 32) & 0xff;
  b[2] = (ts / 2 ** 24) & 0xff;
  b[3] = (ts / 2 ** 16) & 0xff;
  b[4] = (ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;
  const hi12 = Number((rand >> 62n) & 0xfffn);
  b[6] = 0x70 | ((hi12 >> 8) & 0x0f); // version 7 in the high nibble
  b[7] = hi12 & 0xff;

  const lo62 = rand & ((1n << 62n) - 1n);
  b[8] = 0x80 | Number((lo62 >> 56n) & 0x3fn); // variant 1 in the top two bits
  for (let i = 0; i < 7; i++) {
    b[9 + i] = Number((lo62 >> BigInt((6 - i) * 8)) & 0xffn);
  }

  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const NANOID_ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

export function nanoid(size = 21): string {
  const bytes = randomBytes(size);
  let out = '';
  // 64-character alphabet, so 6 bits per character and no modulo bias.
  for (const b of bytes) out += NANOID_ALPHABET[b & 63];
  return out;
}

const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

/**
 * ULID: 48-bit timestamp + 80 bits of randomness, base32, lexicographically
 * sortable as a string — which is its advantage over UUID v7.
 *
 * The ULID spec requires the monotonic behaviour for IDs sharing a
 * millisecond, and it matters more here than for v7: the whole point of ULID
 * is that a plain string sort is chronological, so an unordered batch breaks
 * the one property it is chosen for.
 */
export function ulid(now = Date.now()): string {
  // As in uuidV7, the timestamp comes back from the counter because an
  // exhausted random field borrows from the next millisecond.
  const { ms: msValue, counter: rand } = monotonicRandom(Math.floor(now), 80);

  let ts = msValue;
  let time = '';
  for (let i = 0; i < 10; i++) {
    time = ULID_ALPHABET[ts % 32] + time;
    ts = Math.floor(ts / 32);
  }

  // 80 bits of monotonic randomness as 16 base32 characters, most significant
  // group first. Appending while shifting down is what makes the string's
  // character order match the number's bit order — build it the other way
  // round and incrementing the counter changes the *leading* character, which
  // destroys the sort rather than preserving it.
  let tail = '';
  for (let i = 15; i >= 0; i--) {
    tail += ULID_ALPHABET[Number((rand >> BigInt(i * 5)) & 31n)];
  }
  return time + tail;
}

export function generateId(kind: IdKind, now = Date.now()): string {
  switch (kind) {
    case 'uuid-v4': return uuidV4();
    case 'uuid-v7': return uuidV7(now);
    case 'nanoid':  return nanoid();
    case 'ulid':    return ulid(now);
  }
}

export function generateIds(kind: IdKind, count: number, now = Date.now()): string[] {
  const n = Math.max(1, Math.min(Math.floor(count) || 1, 1000));
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(generateId(kind, now));
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface UuidInfo {
  valid: boolean;
  version?: number;
  variant?: string;
  /** Embedded creation time, for the versions that have one. */
  timestamp?: string;
}

/** Inspect a pasted UUID. Reading the version out of a UUID by eye is
 *  possible but nobody remembers which nibble it is. */
export function inspectUuid(s: string): UuidInfo {
  const t = s.trim().replace(/^urn:uuid:/i, '').replace(/^\{|\}$/g, '');
  if (!UUID_RE.test(t)) return { valid: false };

  const h = t.replace(/-/g, '').toLowerCase();

  // The nil and max UUIDs are special-cased by RFC 9562 §5.9–5.10: they are
  // defined values rather than UUIDs carrying a version and variant. Reading
  // their nibbles gives "version 0, NCS (legacy)" for nil and "version 15,
  // reserved" for max — both real historical schemes, and neither is what the
  // reader is holding.
  if (/^0{32}$/.test(h)) {
    return { valid: true, version: 0, variant: 'nil UUID (RFC 9562 §5.9)' };
  }
  if (/^f{32}$/.test(h)) {
    return { valid: true, version: 15, variant: 'max UUID (RFC 9562 §5.10)' };
  }

  const version = parseInt(h[12], 16);
  const variantNibble = parseInt(h[16], 16);
  const variant =
    (variantNibble & 0b1100) === 0b1000 ? 'RFC 9562' :
    (variantNibble & 0b1110) === 0b1100 ? 'Microsoft' :
    variantNibble < 8 ? 'NCS (legacy)' : 'reserved';

  const info: UuidInfo = { valid: true, version, variant };

  if (version === 7) {
    info.timestamp = new Date(parseInt(h.slice(0, 12), 16)).toISOString();
  } else if (version === 1) {
    // v1 counts 100-nanosecond intervals since 1582-10-15.
    const timeHex = h.slice(13, 16) + h.slice(8, 12) + h.slice(0, 8);
    const intervals = BigInt('0x' + timeHex);
    const ms = Number(intervals / 10000n) - 12219292800000;
    if (Number.isFinite(ms)) info.timestamp = new Date(ms).toISOString();
  }
  return info;
}
