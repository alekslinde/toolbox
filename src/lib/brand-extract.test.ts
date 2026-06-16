/**
 * Brand Assets Extractor — unit tests.
 *
 * Covers the pure (non-DOM) logic: colour conversion, CSS colour/font/pair
 * extraction, WCAG scoring, the Ionic palette builder, semantic colour
 * detection, button-style and internal-link parsing.
 *
 * DOM-dependent helpers (extractMeta, extractLogoUrl, extractInternalLinks)
 * require a Document; jsdom is not installed, so they're exercised with a
 * minimal hand-rolled stub where practical and otherwise left to integration.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import {
  toAbsolute,
  isBrandStylesheet,
  hexNorm,
  rgbToHex,
  hslToHex,
  hexToRgb,
  colourDist,
  relativeLuminance,
  contrastRatio,
  wcagLabel,
  isSkippable,
  contrastText,
  extractAllColoursFromCSS,
  dedupeColours,
  firstHex,
  extractColourPairs,
  extractFontsFromCSS,
  darkenHex,
  lightenHex,
  buildIonicColor,
  buildAllIonicColors,
  detectSemanticBrandColor,
  extractButtonStyle,
  CORS_PROXIES,
  IONIC_SEMANTIC_DEFAULTS,
  type BrandColor,
} from './brand-extract.js';

// ── URL helpers ───────────────────────────────────────────────────────────

describe('toAbsolute', () => {
  it('returns empty string for falsy href', () => {
    expect(toAbsolute('', 'https://x.com')).toBe('');
  });

  it('passes through already-absolute URLs', () => {
    expect(toAbsolute('https://cdn.x.com/a.css', 'https://x.com')).toBe('https://cdn.x.com/a.css');
    expect(toAbsolute('http://x.com/a.css', 'https://y.com')).toBe('http://x.com/a.css');
  });

  it('resolves a relative path against the base', () => {
    expect(toAbsolute('/css/main.css', 'https://x.com/page')).toBe('https://x.com/css/main.css');
    expect(toAbsolute('a.css', 'https://x.com/dir/')).toBe('https://x.com/dir/a.css');
  });

  it('resolves protocol-relative URLs', () => {
    expect(toAbsolute('//cdn.x.com/a.css', 'https://x.com')).toBe('https://cdn.x.com/a.css');
  });

  it('returns the href unchanged when base is unparseable', () => {
    expect(toAbsolute('a.css', 'not a url')).toBe('a.css');
  });
});

describe('isBrandStylesheet', () => {
  const base = 'https://acme.com';
  const domain = 'acme.com';

  it('accepts stylesheets on the same domain', () => {
    expect(isBrandStylesheet('/main.css', base, domain)).toBe(true);
    expect(isBrandStylesheet('https://acme.com/a.css', base, domain)).toBe(true);
  });

  it('accepts subdomains of the brand domain', () => {
    expect(isBrandStylesheet('https://static.acme.com/a.css', base, domain)).toBe(true);
  });

  it('rejects known generic CDN/framework hosts', () => {
    expect(isBrandStylesheet('https://maxcdn.bootstrapcdn.com/x.css', base, domain)).toBe(false);
    expect(isBrandStylesheet('https://cdn.jsdelivr.net/x.css', base, domain)).toBe(false);
    expect(isBrandStylesheet('https://unpkg.com/x.css', base, domain)).toBe(false);
  });

  it('accepts unknown third-party hosts (could be brand CDN)', () => {
    expect(isBrandStylesheet('https://assets.acmecdn.io/a.css', base, domain)).toBe(true);
  });

  it('rejects empty href', () => {
    expect(isBrandStylesheet('', base, domain)).toBe(false);
  });
});

// ── Colour conversion ───────────────────────────────────────────────────────

describe('hexNorm', () => {
  it('lowercases and prefixes a hash', () => {
    expect(hexNorm('FF0000')).toBe('#ff0000');
    expect(hexNorm('#AABBCC')).toBe('#aabbcc');
  });

  it('expands 3-digit shorthand', () => {
    expect(hexNorm('#f00')).toBe('#ff0000');
    expect(hexNorm('abc')).toBe('#aabbcc');
  });
});

describe('rgbToHex', () => {
  it('accepts numbers and string components', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex('255', '128', '0')).toBe('#ff8000');
  });

  it('zero-pads single hex digits', () => {
    expect(rgbToHex(1, 2, 3)).toBe('#010203');
  });
});

describe('hslToHex', () => {
  it('converts primary hues', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(hslToHex(120, 100, 50)).toBe('#00ff00');
    expect(hslToHex(240, 100, 50)).toBe('#0000ff');
  });

  it('converts greyscale (zero handled via lightness)', () => {
    expect(hslToHex(0, 0, 100)).toBe('#ffffff');
    expect(hslToHex(0, 0, 0)).toBe('#000000');
  });
});

describe('hexToRgb', () => {
  it('parses a 6-digit hex', () => {
    expect(hexToRgb('#ff8000')).toEqual({ r: 255, g: 128, b: 0 });
  });

  it('tolerates a missing hash', () => {
    expect(hexToRgb('00ff00')).toEqual({ r: 0, g: 255, b: 0 });
  });
});

describe('colourDist', () => {
  it('returns 0 for identical colours', () => {
    expect(colourDist('#123456', '#123456')).toBe(0);
  });

  it('returns the sum of absolute channel differences', () => {
    // red vs green: |255-0| + |0-255| + |0-0| = 510
    expect(colourDist('#ff0000', '#00ff00')).toBe(510);
  });
});

// ── Luminance / WCAG ─────────────────────────────────────────────────────────

describe('relativeLuminance', () => {
  it('is ~0 for black and ~1 for white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1);
  });
});

describe('contrastRatio', () => {
  it('returns ~21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('returns 1 for identical colours', () => {
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#111111', '#eeeeee')).toBeCloseTo(contrastRatio('#eeeeee', '#111111'), 10);
  });
});

describe('wcagLabel', () => {
  it('labels AAA at >= 7', () => {
    expect(wcagLabel(7)).toEqual({ level: 'AAA', cls: 'combo-aaa' });
    expect(wcagLabel(21)).toEqual({ level: 'AAA', cls: 'combo-aaa' });
  });

  it('labels AA between 4.5 and 7', () => {
    expect(wcagLabel(4.5).level).toBe('AA');
    expect(wcagLabel(6.99).level).toBe('AA');
  });

  it('labels AA Large between 3 and 4.5', () => {
    expect(wcagLabel(3).level).toBe('AA Large');
    expect(wcagLabel(4.49).level).toBe('AA Large');
  });

  it('labels Fail below 3', () => {
    expect(wcagLabel(2.99)).toEqual({ level: 'Fail', cls: 'combo-fail' });
    expect(wcagLabel(1)).toEqual({ level: 'Fail', cls: 'combo-fail' });
  });
});

describe('isSkippable', () => {
  it('skips malformed hex (wrong length)', () => {
    expect(isSkippable('')).toBe(true);
    expect(isSkippable('#fff')).toBe(true);
    expect(isSkippable('#1234567')).toBe(true);
  });

  it('skips near-white and near-black', () => {
    expect(isSkippable('#ffffff')).toBe(true);
    expect(isSkippable('#000000')).toBe(true);
    expect(isSkippable('#fefefe')).toBe(true); // mean 254 > 245
  });

  it('keeps mid-tone brand colours', () => {
    expect(isSkippable('#3880ff')).toBe(false);
    expect(isSkippable('#808080')).toBe(false);
  });
});

describe('contrastText', () => {
  it('returns dark text on light backgrounds', () => {
    expect(contrastText('#ffffff')).toBe('#1a1817');
    expect(contrastText('#ffe000')).toBe('#1a1817');
  });

  it('returns white text on dark backgrounds', () => {
    expect(contrastText('#000000')).toBe('#ffffff');
    expect(contrastText('#1a1817')).toBe('#ffffff');
  });
});

// ── CSS colour extraction ────────────────────────────────────────────────────

describe('extractAllColoursFromCSS', () => {
  it('extracts hex colours and orders by frequency', () => {
    const css = `
      .a { color: #3880ff; }
      .b { color: #3880ff; background: #eb445a; }
    `;
    const out = extractAllColoursFromCSS(css);
    expect(out[0]).toBe('#3880ff'); // appears twice → first
    expect(out).toContain('#eb445a');
  });

  it('parses rgb() and rgba() values', () => {
    const css = '.a { color: rgb(56, 128, 255); border: 1px solid rgba(235, 68, 90, 0.5); }';
    const out = extractAllColoursFromCSS(css);
    expect(out).toContain('#3880ff');
    expect(out).toContain('#eb445a');
  });

  it('parses legacy and modern hsl() syntax', () => {
    const legacy = '.a { color: hsl(0, 100%, 50%); }';
    const modern = '.a { color: hsl(120deg 100% 50%); }';
    expect(extractAllColoursFromCSS(legacy)).toContain('#ff0000');
    expect(extractAllColoursFromCSS(modern)).toContain('#00ff00');
  });

  it('parses --*-hsl component custom properties', () => {
    const css = ':root { --accent-hsl: 0, 100%, 50%; }';
    expect(extractAllColoursFromCSS(css)).toContain('#ff0000');
  });

  it('skips near-white/near-black noise', () => {
    const css = '.a { color: #ffffff; background: #000000; border-color: #3880ff; }';
    const out = extractAllColoursFromCSS(css);
    expect(out).toEqual(['#3880ff']);
  });

  it('returns an empty array for colourless CSS', () => {
    expect(extractAllColoursFromCSS('.a { display: flex; }')).toEqual([]);
  });
});

describe('dedupeColours', () => {
  it('removes perceptually-close colours', () => {
    // #3880ff and #3881ff differ by 1 → collapsed
    const out = dedupeColours(['#3880ff', '#3881ff', '#eb445a']);
    expect(out).toEqual(['#3880ff', '#eb445a']);
  });

  it('respects the max cap', () => {
    const input = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
    expect(dedupeColours(input, 2)).toEqual(['#ff0000', '#00ff00']);
  });

  it('keeps distinct colours', () => {
    const input = ['#ff0000', '#00ff00', '#0000ff'];
    expect(dedupeColours(input)).toEqual(input);
  });
});

describe('firstHex', () => {
  it('extracts a hex value', () => {
    expect(firstHex('1px solid #3880ff')).toBe('#3880ff');
  });

  it('extracts and converts an rgb value', () => {
    expect(firstHex('rgb(56, 128, 255)')).toBe('#3880ff');
  });

  it('extracts and converts an hsl value', () => {
    expect(firstHex('hsl(0, 100%, 50%)')).toBe('#ff0000');
  });

  it('returns null when no colour is present', () => {
    expect(firstHex('inherit')).toBeNull();
  });
});

describe('extractColourPairs', () => {
  it('pairs foreground colour with background within a rule', () => {
    const css = '.btn { color: #1a1a1a; background: #3880ff; }';
    const pairs = extractColourPairs(css, []);
    expect(pairs).toContainEqual({ fg: '#1a1a1a', bg: '#3880ff', count: 1 });
  });

  it('skips rules with fewer than two non-skippable colours', () => {
    // white is skippable, so only one usable colour remains → rule ignored
    const css = '.a { color: #ffffff; background: #3880ff; }';
    expect(extractColourPairs(css, [])).toEqual([]);
  });

  it('skips rules with only a single colour', () => {
    const css = '.a { color: #3880ff; }';
    expect(extractColourPairs(css, [])).toEqual([]);
  });

  it('filters out pairs with near-zero contrast', () => {
    const css = '.a { color: #3880ff; background: #3881ff; }';
    expect(extractColourPairs(css, [])).toEqual([]);
  });
});

// ── Font extraction ──────────────────────────────────────────────────────────

describe('extractFontsFromCSS', () => {
  it('reads font-family declarations and ignores generic stacks', () => {
    const css = `body { font-family: "Inter", Arial, sans-serif; }`;
    const fonts = extractFontsFromCSS(css, []);
    expect(fonts.map(f => f.name)).toContain('Inter');
    expect(fonts.map(f => f.name)).not.toContain('Arial');
    expect(fonts.map(f => f.name)).not.toContain('sans-serif');
  });

  it('marks heading fonts from h1–h6 rules', () => {
    const css = `
      body { font-family: "Body Font"; }
      h1 { font-family: "Display Font"; }
    `;
    const fonts = extractFontsFromCSS(css, []);
    const display = fonts.find(f => f.name === 'Display Font');
    expect(display?.role).toBe('heading');
  });

  it('marks monospace fonts from code/pre rules', () => {
    const css = `
      body { font-family: "Body Font"; }
      code { font-family: "Mono Font"; }
    `;
    const fonts = extractFontsFromCSS(css, []);
    expect(fonts.find(f => f.name === 'Mono Font')?.role).toBe('mono');
  });

  it('picks up Google Fonts from link hrefs', () => {
    const links = ['https://fonts.googleapis.com/css2?family=Roboto+Slab:wght@400&display=swap'];
    const fonts = extractFontsFromCSS('', links);
    const rs = fonts.find(f => f.name === 'Roboto Slab');
    expect(rs).toBeTruthy();
    expect(rs?.source).toBe('Google Fonts');
  });

  it('picks up Google Fonts from @import', () => {
    const css = `@import url('https://fonts.googleapis.com/css2?family=Open+Sans');`;
    const fonts = extractFontsFromCSS(css, []);
    expect(fonts.find(f => f.name === 'Open Sans')?.source).toBe('Google Fonts');
  });

  it('promotes the sole font to heading role', () => {
    const css = `body { font-family: "Only Font"; }`;
    const fonts = extractFontsFromCSS(css, []);
    expect(fonts).toHaveLength(1);
    expect(fonts[0].role).toBe('heading');
  });

  it('caps the result at five fonts', () => {
    const css = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
      .map(n => `.${n.toLowerCase()} { font-family: "Font ${n}"; }`)
      .join('\n');
    expect(extractFontsFromCSS(css, []).length).toBeLessThanOrEqual(5);
  });

  it('attaches a sample string to each font', () => {
    const fonts = extractFontsFromCSS(`body { font-family: "Inter"; }`, []);
    expect(fonts[0].sample).toBe('Aa Bb Cc 123');
  });
});

// ── Ionic palette ────────────────────────────────────────────────────────────

describe('darkenHex / lightenHex', () => {
  it('darkenHex reduces each channel', () => {
    expect(darkenHex('#ffffff', 0.5)).toBe('#808080');
  });

  it('lightenHex moves each channel toward white', () => {
    expect(lightenHex('#000000', 0.5)).toBe('#808080');
  });

  it('lightenHex never overflows 255', () => {
    expect(lightenHex('#ffffff', 0.9)).toBe('#ffffff');
  });
});

describe('buildIonicColor', () => {
  it('produces uppercased base/shade/tint and rgb triple', () => {
    const c = buildIonicColor('primary', '#3880ff');
    expect(c.name).toBe('primary');
    expect(c.base).toBe('#3880FF');
    expect(c.shade).toBe(darkenHex('#3880ff').toUpperCase());
    expect(c.tint).toBe(lightenHex('#3880ff').toUpperCase());
    expect(c.rgb).toBe('56, 128, 255');
  });

  it('computes a contrast colour and its rgb', () => {
    const c = buildIonicColor('primary', '#3880ff');
    expect(c.contrast).toBe('#FFFFFF');
    expect(c.contrastRgb).toBe('255, 255, 255');
  });
});

describe('buildAllIonicColors', () => {
  it('always returns nine colours (3 brand roles + 6 semantic)', () => {
    const out = buildAllIonicColors([]);
    expect(out).toHaveLength(9);
    expect(out.map(c => c.name)).toEqual([
      'primary', 'secondary', 'tertiary',
      'success', 'warning', 'danger', 'dark', 'medium', 'light',
    ]);
  });

  it('falls back to Ionic defaults when no brand colours given', () => {
    const out = buildAllIonicColors([]);
    expect(out.find(c => c.name === 'primary')?.fromBrand).toBe(false);
    expect(out.find(c => c.name === 'success')?.base).toBe(IONIC_SEMANTIC_DEFAULTS.success.toUpperCase());
  });

  it('marks brand-derived roles as fromBrand', () => {
    const colors: BrandColor[] = [
      { hex: '#aa0000', name: 'Red', role: 'brand' },
      { hex: '#00aa00', name: 'Green', role: 'brand' },
      { hex: '#0000aa', name: 'Blue', role: 'brand' },
    ];
    const out = buildAllIonicColors(colors);
    expect(out.find(c => c.name === 'primary')?.fromBrand).toBe(true);
    expect(out.find(c => c.name === 'primary')?.base).toBe('#AA0000');
  });
});

// ── Semantic colour detection ────────────────────────────────────────────────

describe('detectSemanticBrandColor', () => {
  const mk = (hex: string): BrandColor => ({ hex, name: '', role: '' });

  it('detects a green in the success hue range (only beyond the first 3)', () => {
    const colors = [mk('#111111'), mk('#222222'), mk('#333333'), mk('#2dd36f')];
    expect(detectSemanticBrandColor(colors, 'success')).toBe('#2dd36f');
  });

  it('detects a red in the danger hue range (wrap-around)', () => {
    const colors = [mk('#111111'), mk('#222222'), mk('#333333'), mk('#eb445a')];
    expect(detectSemanticBrandColor(colors, 'danger')).toBe('#eb445a');
  });

  it('detects a yellow in the warning hue range', () => {
    const colors = [mk('#111111'), mk('#222222'), mk('#333333'), mk('#ffc409')];
    expect(detectSemanticBrandColor(colors, 'warning')).toBe('#ffc409');
  });

  it('ignores low-saturation candidates for hue-based roles', () => {
    const colors = [mk('#111111'), mk('#222222'), mk('#333333'), mk('#8a908a')];
    expect(detectSemanticBrandColor(colors, 'success')).toBeNull();
  });

  it('does not consider the first three (brand) colours', () => {
    const colors = [mk('#2dd36f'), mk('#222222'), mk('#333333')];
    expect(detectSemanticBrandColor(colors, 'success')).toBeNull();
  });

  it('detects a very-dark colour for the dark role', () => {
    const colors = [mk('#020203'), mk('#3880ff')];
    expect(detectSemanticBrandColor(colors, 'dark')).toBe('#020203');
  });

  it('detects a very-light colour for the light role', () => {
    const colors = [mk('#f4f5f8'), mk('#3880ff')];
    expect(detectSemanticBrandColor(colors, 'light')).toBe('#f4f5f8');
  });

  it('detects a desaturated colour for the medium role', () => {
    const colors = [mk('#92949c'), mk('#3880ff')];
    expect(detectSemanticBrandColor(colors, 'medium')).toBe('#92949c');
  });
});

// ── Button style ─────────────────────────────────────────────────────────────

describe('extractButtonStyle', () => {
  it('reads bg and fg from a .btn rule', () => {
    const css = '.btn { background: #3880ff; color: #ffffff; }';
    expect(extractButtonStyle(css)).toEqual({ bg: '#3880ff', fg: '#ffffff' });
  });

  it('matches a .button class selector', () => {
    const css = '.button { background-color: #eb445a; color: #ffffff; }';
    expect(extractButtonStyle(css)).toEqual({ bg: '#eb445a', fg: '#ffffff' });
  });

  it('matches a [type=submit] selector', () => {
    const css = 'input[type="submit"] { background: #3880ff; color: #ffffff; }';
    expect(extractButtonStyle(css)).toEqual({ bg: '#3880ff', fg: '#ffffff' });
  });

  it('derives a contrast fg when only bg is declared', () => {
    const css = '.button { background: #3880ff; }';
    expect(extractButtonStyle(css)).toEqual({ bg: '#3880ff', fg: contrastText('#3880ff') });
  });

  it('returns null when no button rule has a usable background', () => {
    expect(extractButtonStyle('.btn { padding: 8px; }')).toBeNull();
    expect(extractButtonStyle('.card { background: #3880ff; }')).toBeNull();
  });
});

// ── Constants ────────────────────────────────────────────────────────────────

describe('CORS_PROXIES', () => {
  it('produces encoded proxy URLs', () => {
    const target = 'https://acme.com/?a=b';
    for (const make of CORS_PROXIES) {
      const url = make(target);
      expect(url).toContain(encodeURIComponent(target));
      expect(url.startsWith('https://')).toBe(true);
    }
  });
});
