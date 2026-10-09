import { describe, it, expect } from 'vitest';
import {
  bytesToBase64, base64ToBytes, encodeBase64Text, decodeBase64Text,
  bytesToHex, hexToBytes, hexDump,
  encodeUrlComponent, decodeUrlComponent, parseQuery,
  decodeJwt, jwtClaimNotes, jwtValidity,
  utf8Bytes, utf8String, EncodingError,
} from './encoding';

const bytes = (...n: number[]) => new Uint8Array(n);

describe('base64', () => {
  it('matches the RFC 4648 test vectors', () => {
    expect(encodeBase64Text('')).toBe('');
    expect(encodeBase64Text('f')).toBe('Zg==');
    expect(encodeBase64Text('fo')).toBe('Zm8=');
    expect(encodeBase64Text('foo')).toBe('Zm9v');
    expect(encodeBase64Text('foob')).toBe('Zm9vYg==');
    expect(encodeBase64Text('fooba')).toBe('Zm9vYmE=');
    expect(encodeBase64Text('foobar')).toBe('Zm9vYmFy');
  });

  it('decodes those vectors back', () => {
    for (const s of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      expect(decodeBase64Text(encodeBase64Text(s)).text).toBe(s);
    }
  });

  it('handles non-ASCII, which atob/btoa cannot', () => {
    const s = 'café 日本語 🎉';
    const encoded = encodeBase64Text(s);
    expect(decodeBase64Text(encoded).text).toBe(s);
  });

  it('round-trips arbitrary bytes including 0x00 and 0xff', () => {
    const b = bytes(0, 1, 127, 128, 254, 255);
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });

  it('emits base64url without padding and with - and _', () => {
    const b = bytes(0xfb, 0xff, 0xbe);
    expect(bytesToBase64(b)).toBe('+/++');
    expect(bytesToBase64(b, true)).toBe('-_--');
    expect(bytesToBase64(bytes(0xff), true)).toBe('_w'); // padding stripped
  });

  it('accepts either alphabet on decode', () => {
    expect(base64ToBytes('-_--')).toEqual(bytes(0xfb, 0xff, 0xbe));
    expect(base64ToBytes('+/++')).toEqual(bytes(0xfb, 0xff, 0xbe));
  });

  it('tolerates missing padding and embedded whitespace', () => {
    expect(decodeBase64Text('Zm9v').text).toBe('foo');
    expect(decodeBase64Text('Zm9vYg').text).toBe('foob');
    expect(decodeBase64Text('Zm9v\nYmFy').text).toBe('foobar');
  });

  it('rejects a character outside both alphabets', () => {
    expect(() => base64ToBytes('Zm9v$')).toThrow(EncodingError);
  });

  it('rejects a length that cannot encode whole bytes', () => {
    // A remainder of 1 encodes 6 bits — no byte count produces that.
    expect(() => base64ToBytes('Zm9vY')).toThrow(/truncated/i);
  });

  it('reports binary content as binary rather than returning mojibake', () => {
    const png = bytesToBase64(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
    const r = decodeBase64Text(png);
    expect(r.binary).toBe(true);
    expect(r.text).toMatch(/PNG/);
  });
});

describe('utf8', () => {
  it('throws on an invalid sequence instead of emitting U+FFFD', () => {
    expect(() => utf8String(bytes(0xff, 0xfe))).toThrow();
  });

  it('round-trips', () => {
    expect(utf8String(utf8Bytes('a—b'))).toBe('a—b');
  });
});

describe('hex', () => {
  it('encodes with and without a separator', () => {
    expect(bytesToHex(bytes(0, 15, 255))).toBe('000fff');
    expect(bytesToHex(bytes(0, 15, 255), ':')).toBe('00:0f:ff');
  });

  it('decodes, ignoring common separators and a 0x prefix', () => {
    expect(hexToBytes('000fff')).toEqual(bytes(0, 15, 255));
    expect(hexToBytes('00:0f:ff')).toEqual(bytes(0, 15, 255));
    expect(hexToBytes('0x00 0f-ff')).toEqual(bytes(0, 15, 255));
  });

  it('rejects an odd digit count and non-hex digits', () => {
    expect(() => hexToBytes('abc')).toThrow(/odd/i);
    expect(() => hexToBytes('zz')).toThrow(/non-hex/i);
  });

  it('dumps with offset, hex and ascii columns', () => {
    const dump = hexDump(utf8Bytes('hello'));
    expect(dump).toMatch(/^00000000  68 65 6c 6c 6f/);
    expect(dump).toMatch(/hello$/);
  });

  it('renders unprintable bytes as dots in the ascii column', () => {
    expect(hexDump(bytes(0, 1, 2))).toMatch(/\.\.\.$/);
  });
});

describe('url encoding', () => {
  it('escapes the characters encodeURIComponent leaves behind', () => {
    expect(encodeUrlComponent("a!b'c(d)e*f")).toBe('a%21b%27c%28d%29e%2Af');
  });

  it('decodes + as a space, because form data arrives that way', () => {
    expect(decodeUrlComponent('a+b%20c')).toBe('a b c');
  });

  it('reports a stray percent rather than throwing a URIError', () => {
    expect(() => decodeUrlComponent('%zz')).toThrow(EncodingError);
  });

  it('round-trips non-ASCII', () => {
    expect(decodeUrlComponent(encodeUrlComponent('café/日本'))).toBe('café/日本');
  });
});

describe('parseQuery', () => {
  it('splits a full URL', () => {
    expect(parseQuery('https://example.com/p?a=1&b=two')).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: 'two' },
    ]);
  });

  it('accepts a bare query string with or without the leading ?', () => {
    expect(parseQuery('?a=1')).toEqual([{ key: 'a', value: '1' }]);
    expect(parseQuery('a=1')).toEqual([{ key: 'a', value: '1' }]);
  });

  it('keeps duplicate keys, which an object would drop', () => {
    expect(parseQuery('tag=a&tag=b')).toEqual([
      { key: 'tag', value: 'a' },
      { key: 'tag', value: 'b' },
    ]);
  });

  it('stops at the fragment', () => {
    expect(parseQuery('https://x.test/?a=1#b=2')).toEqual([{ key: 'a', value: '1' }]);
  });

  it('handles a valueless key and a value containing =', () => {
    expect(parseQuery('flag&t=a=b')).toEqual([
      { key: 'flag', value: '' },
      { key: 't', value: 'a=b' },
    ]);
  });

  it('decodes percent-escapes in both key and value', () => {
    expect(parseQuery('a%20b=c%2Bd')).toEqual([{ key: 'a b', value: 'c+d' }]);
  });

  it('leaves an undecodable value as-is rather than failing the whole parse', () => {
    expect(parseQuery('a=%zz')).toEqual([{ key: 'a', value: '%zz' }]);
  });

  it('returns nothing for an empty query', () => {
    expect(parseQuery('https://x.test/')).toEqual([]);
    expect(parseQuery('')).toEqual([]);
  });
});

// A token with alg HS256, iat/exp/sub claims. Signature is not a real one —
// nothing here verifies it, deliberately.
function makeJwt(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' }): string {
  const seg = (o: unknown) => bytesToBase64(utf8Bytes(JSON.stringify(o)), true);
  return `${seg(header)}.${seg(payload)}.c2lnbmF0dXJl`;
}

describe('decodeJwt', () => {
  it('decodes header and payload', () => {
    const token = makeJwt({ sub: '123', name: 'Ada' });
    const parts = decodeJwt(token);
    expect(parts.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(parts.payload).toEqual({ sub: '123', name: 'Ada' });
    expect(parts.signature).toBe('c2lnbmF0dXJl');
    expect(parts.signingInput.split('.')).toHaveLength(2);
  });

  it('strips a Bearer prefix, since that is how tokens get copied', () => {
    const token = 'Bearer ' + makeJwt({ a: 1 });
    expect(decodeJwt(token).payload).toEqual({ a: 1 });
  });

  it('accepts a two-part unsecured token', () => {
    const seg = (o: unknown) => bytesToBase64(utf8Bytes(JSON.stringify(o)), true);
    const parts = decodeJwt(`${seg({ alg: 'none' })}.${seg({ a: 1 })}`);
    expect(parts.signature).toBe('');
  });

  it('reports the part count when the shape is wrong', () => {
    expect(() => decodeJwt('onlyonepart')).toThrow(/three dot-separated parts/);
    expect(() => decodeJwt('a.b.c.d')).toThrow(/4/);
  });

  it('names which segment failed', () => {
    expect(() => decodeJwt('!!!.e30.sig')).toThrow(/header is not valid base64url/);
    expect(() => decodeJwt('e30.bm90anNvbg.sig')).toThrow(/payload is not valid JSON/);
  });

  it('rejects a payload that is valid JSON but not an object', () => {
    const seg = (o: unknown) => bytesToBase64(utf8Bytes(JSON.stringify(o)), true);
    expect(() => decodeJwt(`${seg({ alg: 'none' })}.${seg([1, 2])}.s`)).toThrow(/must be a JSON object/);
  });
});

describe('jwtClaimNotes', () => {
  const now = Date.UTC(2026, 0, 1); // 2026-01-01T00:00:00Z

  it('renders epoch claims as ISO timestamps', () => {
    const notes = jwtClaimNotes({ iat: 1767225600 }, now);
    expect(notes[0]).toMatchObject({ claim: 'iat', value: '2026-01-01T00:00:00Z' });
  });

  it('marks an expired token expired', () => {
    const notes = jwtClaimNotes({ exp: Math.floor(now / 1000) - 60 }, now);
    expect(notes.find((n) => n.claim === 'exp')?.state).toBe('expired');
  });

  it('marks a not-yet-valid token', () => {
    const notes = jwtClaimNotes({ nbf: Math.floor(now / 1000) + 3600 }, now);
    expect(notes.find((n) => n.claim === 'nbf')?.state).toBe('not-yet-valid');
  });

  it('joins an array audience', () => {
    const notes = jwtClaimNotes({ aud: ['a', 'b'] }, now);
    expect(notes.find((n) => n.claim === 'aud')?.value).toBe('a, b');
  });

  it('skips a time claim that is not a number', () => {
    expect(jwtClaimNotes({ exp: 'soon' }, now)).toEqual([]);
  });
});

describe('jwtValidity', () => {
  const now = Date.UTC(2026, 0, 1);
  const sec = Math.floor(now / 1000);

  it('reports unbounded when neither exp nor nbf is present', () => {
    expect(jwtValidity({ sub: 'x' }, now)).toBe('unbounded');
  });

  it('reports expired, not-yet-valid and ok', () => {
    expect(jwtValidity({ exp: sec - 1 }, now)).toBe('expired');
    expect(jwtValidity({ nbf: sec + 1 }, now)).toBe('not-yet-valid');
    expect(jwtValidity({ exp: sec + 60 }, now)).toBe('ok');
  });

  it('treats expiry as decisive when both claims are set', () => {
    expect(jwtValidity({ nbf: sec - 60, exp: sec - 1 }, now)).toBe('expired');
  });
});
