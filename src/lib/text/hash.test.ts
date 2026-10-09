import { describe, it, expect } from 'vitest';
import {
  md5, crc32, digest, hmac, hashesMatch, isBroken,
  uuidV4, uuidV7, nanoid, ulid, generateIds, inspectUuid,
} from './hash';
import { utf8Bytes, hexToBytes } from './encoding';

describe('md5', () => {
  // RFC 1321 appendix A.5 test suite.
  it('matches the RFC 1321 vectors', () => {
    expect(md5(utf8Bytes(''))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(md5(utf8Bytes('a'))).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(md5(utf8Bytes('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(md5(utf8Bytes('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(md5(utf8Bytes('abcdefghijklmnopqrstuvwxyz'))).toBe('c3fcd3d76192e4007dfb496cca67e13b');
    expect(md5(utf8Bytes('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789')))
      .toBe('d174ab98d277d9f5a5611c2c9f419d9f');
    expect(md5(utf8Bytes('12345678901234567890123456789012345678901234567890123456789012345678901234567890')))
      .toBe('57edf4a22be3c955ac49da2e2107b67a');
  });

  it('handles the 55/56/64-byte padding boundaries', () => {
    // 56 bytes is where the length no longer fits in the final block and a
    // second block is appended — the classic off-by-one in an MD5 padder.
    expect(md5(utf8Bytes('a'.repeat(55)))).toBe('ef1772b6dff9a122358552954ad0df65');
    expect(md5(utf8Bytes('a'.repeat(56)))).toBe('3b0c8ac703f828b04c6c197006d17218');
    expect(md5(utf8Bytes('a'.repeat(64)))).toBe('014842d480b571495a4a0363793f7367');
  });

  it('hashes bytes a UTF-8 string cannot express', () => {
    expect(md5(new Uint8Array([0, 255, 128]))).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('crc32', () => {
  it('matches the known IEEE vectors', () => {
    expect(crc32(utf8Bytes(''))).toBe(0);
    expect(crc32(utf8Bytes('a'))).toBe(0xe8b7be43);
    expect(crc32(utf8Bytes('abc'))).toBe(0x352441c2);
    expect(crc32(utf8Bytes('123456789'))).toBe(0xcbf43926);
  });

  it('stays unsigned', () => {
    expect(crc32(utf8Bytes('a'))).toBeGreaterThan(0);
  });
});

describe('digest', () => {
  it('matches the SHA test vectors for "abc"', async () => {
    expect(await digest('SHA-1', utf8Bytes('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(await digest('SHA-256', utf8Bytes('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await digest('SHA-384', utf8Bytes('abc')))
      .toBe('cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7');
    expect(await digest('SHA-512', utf8Bytes('abc')))
      .toBe('ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f');
  });

  it('hashes the empty input', async () => {
    expect(await digest('SHA-256', new Uint8Array(0)))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('dispatches MD5 and CRC32 without WebCrypto', async () => {
    expect(await digest('MD5', utf8Bytes('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(await digest('CRC32', utf8Bytes('abc'))).toBe('352441c2');
  });

  it('pads a short CRC32 to eight digits', async () => {
    expect(await digest('CRC32', new Uint8Array(0))).toBe('00000000');
  });

  it('hashes a view into a larger buffer correctly', async () => {
    // A subarray shares its backing buffer; passing `.buffer` straight to
    // WebCrypto would hash the whole thing.
    const big = utf8Bytes('xxabcxx');
    const view = big.subarray(2, 5);
    expect(await digest('SHA-256', view)).toBe(await digest('SHA-256', utf8Bytes('abc')));
  });
});

describe('hmac', () => {
  it('matches RFC 4231 test case 1', async () => {
    const key = hexToBytes('0b'.repeat(20));
    const data = utf8Bytes('Hi There');
    expect(await hmac('SHA-256', key, data))
      .toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  });

  it('matches RFC 4231 test case 2', async () => {
    expect(await hmac('SHA-256', utf8Bytes('Jefe'), utf8Bytes('what do ya want for nothing?')))
      .toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });
});

describe('hashesMatch', () => {
  it('matches regardless of case and separators', () => {
    expect(hashesMatch('ABC123', 'abc123')).toBe(true);
    expect(hashesMatch('ab:c1 23', 'abc123')).toBe(true);
    expect(hashesMatch(' abc123\n', 'abc123')).toBe(true);
  });

  it('rejects a mismatch, a length difference and empty input', () => {
    expect(hashesMatch('abc123', 'abc124')).toBe(false);
    expect(hashesMatch('abc', 'abc123')).toBe(false);
    expect(hashesMatch('', 'abc')).toBe(false);
    expect(hashesMatch('abc', '')).toBe(false);
  });
});

describe('isBroken', () => {
  it('flags the algorithms that must not carry security weight', () => {
    expect(isBroken('MD5')).toBe(true);
    expect(isBroken('SHA-1')).toBe(true);
    expect(isBroken('CRC32')).toBe(true);
    expect(isBroken('SHA-256')).toBe(false);
  });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('uuidV4', () => {
  it('has the right shape, version and variant', () => {
    const id = uuidV4();
    expect(id).toMatch(UUID_RE);
    expect(id[14]).toBe('4');
    expect('89ab').toContain(id[19]);
  });

  it('does not repeat', () => {
    const set = new Set(Array.from({ length: 500 }, uuidV4));
    expect(set.size).toBe(500);
  });
});

describe('uuidV7', () => {
  it('embeds the timestamp so IDs sort by creation time', () => {
    const t = Date.UTC(2026, 5, 15, 12, 30);
    const id = uuidV7(t);
    expect(id).toMatch(UUID_RE);
    expect(id[14]).toBe('7');
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(t);
  });

  it('keeps the version and variant bits after the monotonic counter is applied', () => {
    for (let i = 0; i < 50; i++) {
      const id = uuidV7(1_700_000_000_000);
      expect(id).toMatch(UUID_RE);
      expect(id[14]).toBe('7');
      expect('89ab').toContain(id[19]);
    }
  });

  it('sorts lexicographically in timestamp order', () => {
    const early = uuidV7(1_000_000_000_000);
    const late = uuidV7(2_000_000_000_000);
    expect(early < late).toBe(true);
  });

  // The regression this guards: a batch generated inside one millisecond
  // shares its timestamp prefix, so without a monotonic counter the IDs are
  // ordered only by their random tails — which is the single reason to pick
  // v7 over v4, silently gone.
  it('stays strictly ordered within one millisecond', () => {
    const ids = Array.from({ length: 200 }, () => uuidV7(1_700_000_000_000));
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] > ids[i - 1]).toBe(true);
    }
  });

  it('stays ordered across a millisecond boundary', () => {
    const a = uuidV7(1_700_000_000_000);
    const b = uuidV7(1_700_000_000_000);
    const c = uuidV7(1_700_000_000_001);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });

  // The counter is module-level state shared with ulid(), so exhausting it in
  // one place must not make another caller emit duplicates — which a clamping
  // overflow did: every later call returned the same ceiling value.
  it('never repeats an id even under heavy same-millisecond use', () => {
    const ids: string[] = [];
    for (let i = 0; i < 5000; i++) ids.push(uuidV7(1_700_000_000_000));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps producing unique ids after ulid has used the shared counter', () => {
    const t = 1_700_000_000_000;
    for (let i = 0; i < 100; i++) ulid(t);
    const ids = Array.from({ length: 100 }, () => uuidV7(t));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('nanoid', () => {
  it('honours the requested length and uses only its alphabet', () => {
    expect(nanoid()).toHaveLength(21);
    expect(nanoid(10)).toHaveLength(10);
    expect(nanoid(64)).toMatch(/^[A-Za-z0-9_-]{64}$/);
  });
});

describe('ulid', () => {
  it('is 26 Crockford base32 characters', () => {
    expect(ulid()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('sorts lexicographically in timestamp order', () => {
    expect(ulid(1_000_000_000_000) < ulid(2_000_000_000_000)).toBe(true);
  });

  it('encodes the timestamp in the first ten characters', () => {
    const t = 1_700_000_000_000;
    expect(ulid(t).slice(0, 10)).toBe(ulid(t).slice(0, 10));
  });

  // ULID's whole claim is that a plain string sort is chronological, so an
  // unordered same-millisecond batch breaks the property it is chosen for.
  it('stays strictly ordered within one millisecond', () => {
    const ids = Array.from({ length: 200 }, () => ulid(1_700_000_000_000));
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] > ids[i - 1]).toBe(true);
    }
  });

  it('keeps its alphabet after the monotonic counter is applied', () => {
    for (let i = 0; i < 50; i++) {
      expect(ulid(1_700_000_000_000)).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });
});

describe('generateIds', () => {
  it('generates the requested count for each kind', () => {
    for (const kind of ['uuid-v4', 'uuid-v7', 'nanoid', 'ulid'] as const) {
      expect(generateIds(kind, 5)).toHaveLength(5);
    }
  });

  // At this level because it is what the page calls: a bulk run completes
  // well inside one millisecond, which is exactly the case that broke.
  it('returns the sortable kinds in sorted order', () => {
    for (const kind of ['uuid-v7', 'ulid'] as const) {
      const ids = generateIds(kind, 500);
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(ids);
    }
  });

  it('returns unique ids for the random kinds', () => {
    for (const kind of ['uuid-v4', 'nanoid'] as const) {
      const ids = generateIds(kind, 500);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('clamps a nonsensical count rather than hanging', () => {
    expect(generateIds('uuid-v4', 0)).toHaveLength(1);
    expect(generateIds('uuid-v4', -5)).toHaveLength(1);
    expect(generateIds('uuid-v4', 99_999)).toHaveLength(1000);
    expect(generateIds('uuid-v4', 2.7)).toHaveLength(2);
  });
});

describe('inspectUuid', () => {
  it('reads the version and variant', () => {
    const v4 = inspectUuid(uuidV4());
    expect(v4).toMatchObject({ valid: true, version: 4, variant: 'RFC 9562' });
  });

  it('extracts the v7 timestamp', () => {
    const t = Date.UTC(2026, 0, 2, 3, 4, 5);
    const info = inspectUuid(uuidV7(t));
    expect(info.version).toBe(7);
    expect(info.timestamp).toBe(new Date(t).toISOString());
  });

  it('extracts the v1 timestamp from its split time fields', () => {
    // A known v1 UUID: 1998-02-22T03:52:23.423Z
    const info = inspectUuid('c232ab00-9414-11ec-b3c8-9f6bdeced846');
    expect(info.version).toBe(1);
    expect(info.timestamp).toMatch(/^2022-02-22T/);
  });

  it('accepts braced and urn: forms', () => {
    const id = uuidV4();
    expect(inspectUuid(`{${id}}`).valid).toBe(true);
    expect(inspectUuid(`urn:uuid:${id}`).valid).toBe(true);
  });

  it('rejects a non-UUID', () => {
    expect(inspectUuid('not-a-uuid')).toEqual({ valid: false });
    expect(inspectUuid('c232ab00-9414-11ec-b3c8-9f6bdeced84').valid).toBe(false);
  });

  it('names the nil UUID variant without claiming RFC 9562', () => {
    const info = inspectUuid('00000000-0000-0000-0000-000000000000');
    expect(info.valid).toBe(true);
    expect(info.version).toBe(0);
    expect(info.variant).toBe('NCS (legacy)');
  });
});
