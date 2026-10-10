import { describe, it, expect, beforeEach } from 'vitest';
import type { ParamsSchema } from './types';

// This module runs only in the browser, so the module under test reaches
// `localStorage`/`location`/`history` as ambient globals the same way a page
// script does. The suite runs under node (see vitest.config.ts — every lib
// module here is stack-agnostic), so those globals need a minimal stand-in
// rather than pulling in a DOM library for one file.
class FakeStorage {
  private store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
  clear() { this.store.clear(); }
}

let currentUrl = new URL('http://localhost/tools/image-compress');

(globalThis as unknown as { localStorage: FakeStorage }).localStorage = new FakeStorage();
(globalThis as unknown as { location: { pathname: string; search: string } }).location = {
  get pathname() { return currentUrl.pathname; },
  get search() { return currentUrl.search; },
};
(globalThis as unknown as { history: { replaceState: (data: unknown, title: string, url: string) => void } }).history = {
  replaceState: (_data, _title, url) => { currentUrl = new URL(url, currentUrl); },
};

const { paramsToQuery, paramsFromUrl, syncUrl, savePreset, loadPresets, deletePreset } =
  await import('./param-sync');

const schema: ParamsSchema = {
  format: { kind: 'enum', label: 'Format', of: [{ value: 'jpeg', label: 'JPEG' }, { value: 'png', label: 'PNG' }], default: 'jpeg' },
  quality: { kind: 'range', label: 'Quality', min: 1, max: 100, default: 82 },
  maxDim: { kind: 'int', label: 'Max dim', min: 1, default: null },
  reduce: { kind: 'bool', label: 'Reduce', default: false },
};

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/tools/image-compress');
});

describe('paramsToQuery', () => {
  it('omits keys equal to their default', () => {
    const q = paramsToQuery('image-compress', { format: 'jpeg', quality: 82, maxDim: null, reduce: false }, schema);
    expect(q).toBe('op=image-compress');
  });

  it('includes changed values only', () => {
    const q = paramsToQuery('image-compress', { format: 'png', quality: 50, maxDim: 1200, reduce: true }, schema);
    const params = new URLSearchParams(q);
    expect(params.get('format')).toBe('png');
    expect(params.get('quality')).toBe('50');
    expect(params.get('maxDim')).toBe('1200');
    expect(params.get('reduce')).toBe('true');
  });
});

describe('paramsFromUrl', () => {
  it('returns null when the URL names a different op', () => {
    history.replaceState(null, '', '/tools/image-compress?op=image-convert&quality=10');
    expect(paramsFromUrl('image-compress', schema)).toBeNull();
  });

  it('returns null when there is no op param at all', () => {
    history.replaceState(null, '', '/tools/image-compress');
    expect(paramsFromUrl('image-compress', schema)).toBeNull();
  });

  it('coerces and clamps values from matching keys', () => {
    history.replaceState(null, '', '/tools/image-compress?op=image-compress&format=png&quality=500&reduce=true');
    const v = paramsFromUrl('image-compress', schema);
    expect(v).toEqual({ format: 'png', quality: 100, reduce: true });
  });

  it('rejects an enum value outside the schema, falling back to default', () => {
    history.replaceState(null, '', '/tools/image-compress?op=image-compress&format=bogus');
    const v = paramsFromUrl('image-compress', schema);
    expect(v?.format).toBe('jpeg');
  });

  it('treats an empty int as null rather than NaN', () => {
    history.replaceState(null, '', '/tools/image-compress?op=image-compress&maxDim=');
    const v = paramsFromUrl('image-compress', schema);
    expect(v?.maxDim).toBeNull();
  });
});

describe('syncUrl', () => {
  it('writes the query string without navigating', () => {
    syncUrl('image-compress', { format: 'webp', quality: 82, maxDim: null, reduce: false }, schema);
    expect(location.search).toBe('?op=image-compress&format=webp');
  });
});

describe('presets', () => {
  it('round-trips a saved preset', () => {
    savePreset('image-compress', 'Web photos', { format: 'webp', quality: 75, maxDim: 1600, reduce: false });
    const presets = loadPresets('image-compress');
    expect(presets).toHaveLength(1);
    expect(presets[0]).toEqual({ name: 'Web photos', values: { format: 'webp', quality: 75, maxDim: 1600, reduce: false } });
  });

  it('overwrites a preset with the same name', () => {
    savePreset('image-compress', 'Web photos', { quality: 75 });
    savePreset('image-compress', 'Web photos', { quality: 90 });
    const presets = loadPresets('image-compress');
    expect(presets).toHaveLength(1);
    expect(presets[0].values.quality).toBe(90);
  });

  it('keeps presets scoped per op', () => {
    savePreset('image-compress', 'A', { quality: 75 });
    savePreset('image-convert', 'B', { format: 'png' });
    expect(loadPresets('image-compress')).toHaveLength(1);
    expect(loadPresets('image-convert')).toHaveLength(1);
  });

  it('deletes a preset by name', () => {
    savePreset('image-compress', 'A', {});
    savePreset('image-compress', 'B', {});
    deletePreset('image-compress', 'A');
    expect(loadPresets('image-compress').map((p) => p.name)).toEqual(['B']);
  });

  it('ignores a blank name', () => {
    savePreset('image-compress', '   ', { quality: 1 });
    expect(loadPresets('image-compress')).toHaveLength(0);
  });

  it('drops the oldest preset past the per-op cap', () => {
    for (let i = 0; i < 25; i++) savePreset('image-compress', `p${i}`, { quality: i });
    const presets = loadPresets('image-compress');
    expect(presets).toHaveLength(20);
    expect(presets[0].name).toBe('p5');
    expect(presets.at(-1)?.name).toBe('p24');
  });
});
