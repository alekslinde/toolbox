import { bench, describe, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import { cssToSass } from '@/lib/scss-converter';

const FX = join(import.meta.dirname, '../fixtures');

const cssSmall  = readFileSync(join(FX, 'css/small.css'),   'utf8');
const cssMedium = readFileSync(join(FX, 'css/medium.css'),  'utf8');
const cssForSass = readFileSync(join(FX, 'css/for-sass.css'), 'utf8');

describe('cssToSass', () => {
  bench('small CSS  (~3 KB)',  () => {
    const out = cssToSass(cssSmall);
    // SASS output must have no curly braces
    expect(out).not.toContain('{');
    expect(out).not.toContain('}');
    expect(out.length).toBeGreaterThan(0);
  });

  bench('medium CSS (~14 KB)', () => {
    const out = cssToSass(cssMedium);
    expect(out).not.toContain('{');
    expect(out).not.toContain('}');
    expect(out.length).toBeGreaterThan(0);
  });

  bench('for-sass CSS (~4 KB) — multi-level nesting', () => {
    const out = cssToSass(cssForSass);
    expect(out).not.toContain('{');
    expect(out).not.toContain('}');
    expect(out.length).toBeGreaterThan(0);
  });
});
