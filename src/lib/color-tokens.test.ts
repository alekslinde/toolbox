import { describe, it, expect } from 'vitest';
import { toCssVars, toTailwindTheme, toJson, toScssVars, type ColorToken } from './color-tokens.js';

const tokens: ColorToken[] = [
  { name: '50', hex: '#fef2f2' },
  { name: '500', hex: '#ef4444' },
  { name: '900', hex: '#7f1d1d' },
];

describe('toCssVars', () => {
  it('emits one custom property per token, prefixed with the group name', () => {
    expect(toCssVars(tokens, 'danger')).toBe(
      ':root {\n' +
      '  --danger-50: #FEF2F2;\n' +
      '  --danger-500: #EF4444;\n' +
      '  --danger-900: #7F1D1D;\n' +
      '}',
    );
  });

  it('defaults the group name to "color"', () => {
    expect(toCssVars(tokens)).toContain('--color-50: #FEF2F2;');
  });
});

describe('toTailwindTheme', () => {
  it('emits a theme.extend.colors fragment', () => {
    expect(toTailwindTheme(tokens, 'danger')).toBe(
      "'danger': {\n" +
      "    50: '#FEF2F2',\n" +
      "    500: '#EF4444',\n" +
      "    900: '#7F1D1D',\n" +
      "},",
    );
  });
});

describe('toJson', () => {
  it('emits a flat name:hex object, uppercased', () => {
    expect(JSON.parse(toJson(tokens))).toEqual({ '50': '#FEF2F2', '500': '#EF4444', '900': '#7F1D1D' });
  });
});

describe('toScssVars', () => {
  it('emits one $variable per line', () => {
    expect(toScssVars(tokens, 'danger')).toBe(
      '$danger-50: #FEF2F2;\n$danger-500: #EF4444;\n$danger-900: #7F1D1D;',
    );
  });
});
