/**
 * Base64, base64url, URL and hex encoding, plus JWT inspection.
 *
 * Why these belong on a client-side site specifically: the common way to
 * decode a JWT is to paste it into a web page, and a JWT is a live credential.
 * Pasting one into a server you do not control hands over whatever it
 * authorises. Everything here runs in the tab and nothing is transmitted, so
 * "decode this token without giving it to a stranger" is a real distinction
 * rather than a marketing line.
 *
 * All functions are pure and work on strings or `Uint8Array`. `atob`/`btoa`
 * are deliberately not used directly: they are latin1-only, so any non-ASCII
 * character round-trips wrong. UTF-8 goes through TextEncoder/TextDecoder.
 */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export class EncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncodingError';
  }
}

export function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** Decode UTF-8 bytes. Throws on invalid sequences rather than emitting U+FFFD
 *  silently — a decoder that quietly returns mojibake looks like it worked. */
export function utf8String(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function bytesToBase64(bytes: Uint8Array, urlSafe = false): string {
  const alphabet = urlSafe ? B64URL_ALPHABET : B64_ALPHABET;
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);

    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += b1 === undefined ? '=' : alphabet[(triple >> 6) & 63];
    out += b2 === undefined ? '=' : alphabet[triple & 63];
  }
  // base64url omits padding by convention (RFC 4648 §5).
  return urlSafe ? out.replace(/=+$/, '') : out;
}

const B64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < 64; i++) {
  B64_LOOKUP[B64_ALPHABET[i]] = i;
  B64_LOOKUP[B64URL_ALPHABET[i]] = i; // both alphabets decode through one table
}

/**
 * Decode base64 or base64url. Accepts either alphabet and tolerates missing
 * padding, because real-world tokens arrive both ways and refusing one of them
 * would just make the tool look broken.
 */
export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[\s\r\n]+/g, '').replace(/=+$/, '');
  if (clean === '') return new Uint8Array(0);

  for (const ch of clean) {
    if (!(ch in B64_LOOKUP)) {
      throw new EncodingError(`Not valid base64: unexpected character "${ch === '\0' ? '\\0' : ch}"`);
    }
  }
  // A base64 group is 4 chars → 3 bytes. A remainder of 1 cannot occur: it
  // would encode 6 bits, and no byte count produces that.
  if (clean.length % 4 === 1) {
    throw new EncodingError('Not valid base64: truncated — the length cannot encode whole bytes');
  }

  const outLen = Math.floor((clean.length * 6) / 8);
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_LOOKUP[clean[i]];
    const c1 = B64_LOOKUP[clean[i + 1]] ?? 0;
    const c2 = B64_LOOKUP[clean[i + 2]];
    const c3 = B64_LOOKUP[clean[i + 3]];
    const triple = (c0 << 18) | (c1 << 12) | ((c2 ?? 0) << 6) | (c3 ?? 0);

    if (o < outLen) out[o++] = (triple >> 16) & 255;
    if (o < outLen) out[o++] = (triple >> 8) & 255;
    if (o < outLen) out[o++] = triple & 255;
  }
  return out;
}

export function encodeBase64Text(text: string, urlSafe = false): string {
  return bytesToBase64(utf8Bytes(text), urlSafe);
}

/**
 * Decode base64 to text. Reports binary content as such instead of returning
 * replacement characters: a decoded PNG is a successful decode of a thing that
 * is not text, and saying so is more useful than showing garbage.
 */
export function decodeBase64Text(s: string): { text: string; binary: boolean } {
  const bytes = base64ToBytes(s);
  try {
    return { text: utf8String(bytes), binary: false };
  } catch {
    return { text: hexDump(bytes), binary: true };
  }
}

export function bytesToHex(bytes: Uint8Array, separator = ''): string {
  const parts: string[] = [];
  for (const b of bytes) parts.push(b.toString(16).padStart(2, '0'));
  return parts.join(separator);
}

export function hexToBytes(s: string): Uint8Array {
  const clean = s.replace(/(?:0x|[\s:,-])/gi, '');
  if (clean.length % 2 !== 0) throw new EncodingError('Hex input has an odd number of digits');
  if (/[^0-9a-f]/i.test(clean)) throw new EncodingError('Hex input contains a non-hex digit');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A classic 16-byte-per-row dump, for showing bytes that are not text. */
export function hexDump(bytes: Uint8Array, perRow = 16): string {
  const rows: string[] = [];
  for (let i = 0; i < bytes.length; i += perRow) {
    const slice = bytes.subarray(i, i + perRow);
    const hex = bytesToHex(slice, ' ').padEnd(perRow * 3 - 1, ' ');
    let ascii = '';
    for (const b of slice) ascii += b >= 32 && b < 127 ? String.fromCharCode(b) : '.';
    rows.push(`${i.toString(16).padStart(8, '0')}  ${hex}  ${ascii}`);
  }
  return rows.join('\n');
}

// ── URL encoding ────────────────────────────────────────────────────────────

/** `encodeURIComponent`, but also escaping the characters it leaves alone
 *  (`!'()*`) which are reserved in some contexts and bite people in practice. */
export function encodeUrlComponent(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export function decodeUrlComponent(s: string): string {
  try {
    // `+` means space in form-encoded data, which is where most pasted
    // query strings come from.
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    throw new EncodingError('Not a valid percent-encoded string — check for a stray "%"');
  }
}

export interface QueryParam {
  key: string;
  value: string;
}

/**
 * Split a URL or bare query string into decoded pairs.
 *
 * Returns pairs rather than an object because duplicate keys are meaningful
 * (`?tag=a&tag=b`) and an object would silently drop one.
 */
export function parseQuery(input: string): QueryParam[] {
  const qIndex = input.indexOf('?');
  const hashIndex = input.indexOf('#');

  let query: string;
  if (qIndex >= 0) {
    query = hashIndex > qIndex ? input.slice(qIndex + 1, hashIndex) : input.slice(qIndex + 1);
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) || input.includes('/')) {
    // A URL with no "?" has no query at all. Without this check the whole URL
    // becomes one key, which looks like a parse rather than a no-op.
    return [];
  } else {
    query = input; // a bare query string, pasted without its "?"
  }

  query = query.replace(/^[?&]+/, '');
  if (!query) return [];

  return query.split('&').filter(Boolean).map((pair) => {
    const eq = pair.indexOf('=');
    const rawKey = eq < 0 ? pair : pair.slice(0, eq);
    const rawVal = eq < 0 ? '' : pair.slice(eq + 1);
    const safe = (v: string) => { try { return decodeUrlComponent(v); } catch { return v; } };
    return { key: safe(rawKey), value: safe(rawVal) };
  });
}

// ── JWT ─────────────────────────────────────────────────────────────────────

export interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  /** Raw base64url signature, undefined for an unsecured (`alg: none`) token. */
  signature: string;
  /** The `header.payload` string the signature covers. */
  signingInput: string;
}

export interface JwtClaimNote {
  claim: string;
  label: string;
  /** Rendered value — an ISO timestamp for time claims, the raw value otherwise. */
  value: string;
  /** Set for time claims: whether the token is outside its validity window. */
  state?: 'ok' | 'expired' | 'not-yet-valid';
}

/**
 * Decode a JWT's header and payload.
 *
 * **This does not verify the signature, and deliberately so.** Verification
 * needs the signing key, and a tool that asked for your signing key would be
 * asking for the one secret that makes the token forgeable. Decoding proves
 * nothing about authenticity — which the UI has to say plainly, because
 * treating a decoded token as a verified one is the actual security mistake
 * people make with these tools.
 */
export function decodeJwt(token: string): JwtParts {
  const trimmed = token.trim().replace(/^Bearer\s+/i, '');
  const segments = trimmed.split('.');
  if (segments.length < 2 || segments.length > 3) {
    throw new EncodingError(
      `A JWT has three dot-separated parts; this has ${segments.length}`,
    );
  }
  const [h, p, s = ''] = segments;

  const decodeSegment = (seg: string, what: string): Record<string, unknown> => {
    let json: string;
    try {
      json = utf8String(base64ToBytes(seg));
    } catch {
      throw new EncodingError(`The ${what} is not valid base64url`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new EncodingError(`The ${what} is not valid JSON`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new EncodingError(`The ${what} must be a JSON object`);
    }
    return parsed as Record<string, unknown>;
  };

  return {
    header: decodeSegment(h, 'header'),
    payload: decodeSegment(p, 'payload'),
    signature: s,
    signingInput: `${h}.${p}`,
  };
}

/**
 * Interpret the registered claims (RFC 7519 §4.1) so the user does not have to
 * convert epoch seconds by hand — which is the single most tedious part of
 * reading a token.
 */
export function jwtClaimNotes(payload: Record<string, unknown>, now = Date.now()): JwtClaimNote[] {
  const notes: JwtClaimNote[] = [];
  const nowSec = now / 1000;

  const timeClaim = (claim: string, label: string, state?: (v: number) => JwtClaimNote['state']) => {
    const v = payload[claim];
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    notes.push({
      claim,
      label,
      value: new Date(v * 1000).toISOString().replace('.000Z', 'Z'),
      state: state?.(v),
    });
  };

  timeClaim('iat', 'Issued at');
  timeClaim('nbf', 'Not valid before', (v) => (v > nowSec ? 'not-yet-valid' : 'ok'));
  timeClaim('exp', 'Expires', (v) => (v <= nowSec ? 'expired' : 'ok'));

  for (const [claim, label] of [['iss', 'Issuer'], ['sub', 'Subject'], ['aud', 'Audience'], ['jti', 'Token ID']] as const) {
    const v = payload[claim];
    if (v === undefined || v === null) continue;
    notes.push({ claim, label, value: Array.isArray(v) ? v.join(', ') : String(v) });
  }
  return notes;
}

/** Whether a decoded token is currently within its validity window. */
export function jwtValidity(payload: Record<string, unknown>, now = Date.now()): 'ok' | 'expired' | 'not-yet-valid' | 'unbounded' {
  const nowSec = now / 1000;
  const exp = payload.exp;
  const nbf = payload.nbf;
  if (typeof exp === 'number' && exp <= nowSec) return 'expired';
  if (typeof nbf === 'number' && nbf > nowSec) return 'not-yet-valid';
  if (typeof exp !== 'number' && typeof nbf !== 'number') return 'unbounded';
  return 'ok';
}
