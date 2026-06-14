import { bench, describe, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { minifyCSS, minifyHTML, minifyJS } from '@/lib/code-minifier';

const FX = join(import.meta.dirname, '../fixtures');

const jsSmall  = readFileSync(join(FX, 'js/small.js'),   'utf8');
const jsMedium = readFileSync(join(FX, 'js/medium.js'),  'utf8');
const cssSmall = readFileSync(join(FX, 'css/small.css'), 'utf8');
const cssMed   = readFileSync(join(FX, 'css/medium.css'),'utf8');
const htmlSm   = readFileSync(join(FX, 'html/small.html'),'utf8');
const htmlMed  = readFileSync(join(FX, 'html/medium.html'),'utf8');

function ratio(output: string, input: string): number {
  return output.length / input.length;
}

describe('minifyJS', () => {
  bench('small  (~4 KB)', () => {
    const out = minifyJS(jsSmall);
    // sanity: output must be shorter and non-empty
    expect(out.length).toBeGreaterThan(0);
    expect(ratio(out, jsSmall)).toBeLessThan(1);
  });

  bench('medium (~16 KB)', () => {
    const out = minifyJS(jsMedium);
    expect(out.length).toBeGreaterThan(0);
    expect(ratio(out, jsMedium)).toBeLessThan(1);
  });
});

describe('minifyCSS', () => {
  bench('small  (~3 KB)', () => {
    const out = minifyCSS(cssSmall);
    expect(out.length).toBeGreaterThan(0);
    expect(ratio(out, cssSmall)).toBeLessThan(1);
  });

  bench('medium (~14 KB)', () => {
    const out = minifyCSS(cssMed);
    expect(out.length).toBeGreaterThan(0);
    expect(ratio(out, cssMed)).toBeLessThan(1);
  });
});

describe('minifyHTML', () => {
  bench('small  (~4 KB)', () => {
    const out = minifyHTML(htmlSm);
    expect(out.length).toBeGreaterThan(0);
    expect(ratio(out, htmlSm)).toBeLessThan(1);
  });

  bench('medium (~18 KB)', () => {
    const out = minifyHTML(htmlMed);
    expect(out.length).toBeGreaterThan(0);
    expect(ratio(out, htmlMed)).toBeLessThan(1);
  });
});
