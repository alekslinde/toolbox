import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  rgbToHex,
  rgbToHsl,
  hslToRgb,
  relativeLuminance,
  contrastRatio,
  isLight,
  isValidHex,
  mixColors,
} from './color.js';

describe('hexToRgb', () => {
  it('parses a 6-digit hex color', () => {
    expect(hexToRgb('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('expands a 3-digit shorthand', () => {
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 });
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#abc')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('works without leading hash', () => {
    expect(hexToRgb('ff0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('is case-insensitive', () => {
    expect(hexToRgb('#FF8800')).toEqual(hexToRgb('#ff8800'));
  });
});

describe('rgbToHex', () => {
  it('converts RGB to lowercase hex with leading #', () => {
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(0, 255, 0)).toBe('#00ff00');
    expect(rgbToHex(0, 0, 255)).toBe('#0000ff');
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
  });

  it('rounds fractional values', () => {
    expect(rgbToHex(254.6, 0, 0)).toBe('#ff0000');
    expect(rgbToHex(254.4, 0, 0)).toBe('#fe0000');
  });

  it('round-trips with hexToRgb', () => {
    const original = '#1a2b3c';
    const { r, g, b } = hexToRgb(original);
    expect(rgbToHex(r, g, b)).toBe(original);
  });
});

describe('rgbToHsl', () => {
  it('converts pure red', () => {
    expect(rgbToHsl(255, 0, 0)).toEqual({ h: 0, s: 100, l: 50 });
  });

  it('converts pure green', () => {
    expect(rgbToHsl(0, 255, 0)).toEqual({ h: 120, s: 100, l: 50 });
  });

  it('converts pure blue', () => {
    expect(rgbToHsl(0, 0, 255)).toEqual({ h: 240, s: 100, l: 50 });
  });

  it('converts white', () => {
    expect(rgbToHsl(255, 255, 255)).toEqual({ h: 0, s: 0, l: 100 });
  });

  it('converts black', () => {
    expect(rgbToHsl(0, 0, 0)).toEqual({ h: 0, s: 0, l: 0 });
  });

  it('converts a mid-grey', () => {
    const { h, s, l } = rgbToHsl(128, 128, 128);
    expect(s).toBe(0);
    expect(l).toBeCloseTo(50, 0);
  });
});

describe('hslToRgb', () => {
  it('converts pure red', () => {
    expect(hslToRgb(0, 100, 50)).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('converts pure green', () => {
    expect(hslToRgb(120, 100, 50)).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('converts pure blue', () => {
    expect(hslToRgb(240, 100, 50)).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('converts white', () => {
    expect(hslToRgb(0, 0, 100)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('converts black', () => {
    expect(hslToRgb(0, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('round-trips with rgbToHsl within rounding tolerance', () => {
    const r = 100, g = 150, b = 200;
    const { h, s, l } = rgbToHsl(r, g, b);
    const back = hslToRgb(h, s, l);
    expect(back.r).toBeCloseTo(r, -1);
    expect(back.g).toBeCloseTo(g, -1);
    expect(back.b).toBeCloseTo(b, -1);
  });
});

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0);
  });

  it('returns 1 for white', () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1);
  });

  it('is in [0, 1] range for arbitrary colors', () => {
    const l = relativeLuminance(128, 64, 200);
    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThanOrEqual(1);
  });
});

describe('contrastRatio', () => {
  it('returns ~21 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('returns 1 for identical colors', () => {
    expect(contrastRatio('#ff0000', '#ff0000')).toBeCloseTo(1);
  });

  it('is symmetric (order of arguments does not matter)', () => {
    const a = contrastRatio('#123456', '#abcdef');
    const b = contrastRatio('#abcdef', '#123456');
    expect(a).toBeCloseTo(b, 10);
  });

  it('returns a value >= 1', () => {
    expect(contrastRatio('#336699', '#99ccff')).toBeGreaterThanOrEqual(1);
  });

  it('meets WCAG AA for black on white (>= 4.5)', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('isLight', () => {
  it('identifies white as light', () => {
    expect(isLight(255, 255, 255)).toBe(true);
  });

  it('identifies black as dark', () => {
    expect(isLight(0, 0, 0)).toBe(false);
  });

  it('identifies a light yellow as light', () => {
    expect(isLight(255, 255, 0)).toBe(true);
  });

  it('identifies a dark navy as dark', () => {
    expect(isLight(0, 0, 128)).toBe(false);
  });
});

describe('isValidHex', () => {
  it('accepts 6-digit hex with hash', () => {
    expect(isValidHex('#ff0000')).toBe(true);
    expect(isValidHex('#AABBCC')).toBe(true);
    expect(isValidHex('#123456')).toBe(true);
  });

  it('accepts 3-digit shorthand', () => {
    expect(isValidHex('#f00')).toBe(true);
    expect(isValidHex('#ABC')).toBe(true);
  });

  it('rejects hex without hash', () => {
    expect(isValidHex('ff0000')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidHex('#ff00')).toBe(false);
    expect(isValidHex('#ff00000')).toBe(false);
  });

  it('rejects invalid characters', () => {
    expect(isValidHex('#gggggg')).toBe(false);
    expect(isValidHex('#xyz')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(isValidHex('')).toBe(false);
  });
});

describe('mixColors', () => {
  it('returns first color at t=0', () => {
    expect(mixColors('#ff0000', '#0000ff', 0)).toBe('#ff0000');
  });

  it('returns second color at t=1', () => {
    expect(mixColors('#ff0000', '#0000ff', 1)).toBe('#0000ff');
  });

  it('returns midpoint at t=0.5', () => {
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('interpolates correctly for a known value', () => {
    // #ff0000 → #0000ff at 0.25: r=191, g=0, b=64 (Math.round(255*0.25)=64)
    expect(mixColors('#ff0000', '#0000ff', 0.25)).toBe('#bf0040');
  });
});
