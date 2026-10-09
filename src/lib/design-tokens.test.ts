import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

// Guards the token layer against the two ways it silently decays: markup that
// hardcodes a colour instead of referencing a token, and a token defined for
// light mode but forgotten in the dark blocks.
//
// These match *shapes*, not a list of offending values — a denylist of specific
// hexes would go stale the moment someone added a new one, and would make this
// file the one place they all appear.

const ROOT = join(import.meta.dirname, '../..');
const TOKENS = join(ROOT, 'src/styles/global.css');

function markupFiles(): { path: string; text: string }[] {
  return execFileSync('git', ['ls-files', '-z', 'src'], { cwd: ROOT })
    .toString('utf8')
    .split('\0')
    .filter(p => p.endsWith('.astro'))
    .map(p => ({ path: p, text: readFileSync(join(ROOT, p), 'utf8') }));
}

function css(): string {
  return readFileSync(TOKENS, 'utf8');
}

/** The raw token values declared in a `:root`-like block, by name. */
function declaredIn(block: string): Set<string> {
  const names = new Set<string>();
  for (const m of block.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) names.add(m[1]);
  return names;
}

describe('design tokens', () => {
  it('defines every light-mode surface token in both dark blocks', () => {
    const text = css();

    // The three theme blocks: :root, the prefers-color-scheme query, and the
    // explicit [data-theme="dark"] opt-in.
    const light = text.slice(text.indexOf(':root {'), text.indexOf('@media (prefers-color-scheme: dark)'));
    const queryStart = text.indexOf('@media (prefers-color-scheme: dark)');
    const explicitStart = text.indexOf(':root[data-theme="dark"]');
    const query = text.slice(queryStart, explicitStart);
    const explicit = text.slice(explicitStart, text.indexOf('@theme inline'));

    const lightNames = declaredIn(light);
    const queryNames = declaredIn(query);
    const explicitNames = declaredIn(explicit);

    // Spacing, radius, gutter and tap are theme-independent by design — only
    // the colour tokens must be redefined for dark.
    const colourish = [...lightNames].filter(
      n => !/^--(space|radius|gutter|tap|text|font|ease)/.test(n),
    );

    expect({
      missingFromQuery: colourish.filter(n => !queryNames.has(n)),
      missingFromExplicit: colourish.filter(n => !explicitNames.has(n)),
    }).toEqual({ missingFromQuery: [], missingFromExplicit: [] });
  });

  it('keeps the two dark blocks in sync', () => {
    const text = css();
    const queryStart = text.indexOf('@media (prefers-color-scheme: dark)');
    const explicitStart = text.indexOf(':root[data-theme="dark"]');

    // Compare name:value pairs, so a value edited in one block but not the
    // other is caught rather than just a missing name.
    const pairs = (block: string) => {
      const out = new Map<string, string>();
      for (const m of block.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gim)) {
        out.set(m[1], m[2].trim());
      }
      return out;
    };

    const q = pairs(text.slice(queryStart, explicitStart));
    const e = pairs(text.slice(explicitStart, text.indexOf('@theme inline')));

    const drift = [...q.entries()]
      .filter(([k, v]) => e.get(k) !== v)
      .map(([k]) => k);

    expect(drift).toEqual([]);
  });

  it('has no hardcoded hex colours in page chrome', () => {
    // A hex in a class attribute or inline style bypasses the token layer and
    // will not respond to the dark theme.
    //
    // The colour tools are the deliberate exception: a swatch, a gradient
    // preview or a contrast sample renders a colour as *content*. Tokenising
    // those would break the tool — a contrast checker whose sample shifted with
    // the page theme would report the wrong ratio. So the rule is scoped to
    // chrome, and the exemption is by file, not by a blanket ignore.
    const COLOUR_TOOLS = /^src\/pages\/tools\/(color-|wcag-contrast|svg-validator|ico-generator|brand-assets)/;

    const found: string[] = [];
    for (const { path, text } of markupFiles()) {
      if (COLOUR_TOOLS.test(path)) continue;
      for (const line of text.split('\n')) {
        if (/(?:class|style)=["'][^"']*#[0-9a-fA-F]{3,8}\b/.test(line)) {
          found.push(`${path}: ${line.trim().slice(0, 100)}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('uses no opaque bg-white in markup', () => {
    // An opaque white panel stays white on a dark page. The alpha forms
    // (bg-white/10 and friends) are deliberate overlays on the dark sidebar,
    // so only the bare utility is an error.
    const found: string[] = [];
    for (const { path, text } of markupFiles()) {
      for (const line of text.split('\n')) {
        if (/\bbg-white\b(?!\/)/.test(line)) found.push(`${path}: ${line.trim().slice(0, 100)}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('uses the shared page shell rather than per-page container padding', () => {
    // The fluid gutter lives in one utility. A reintroduced breakpoint pair
    // would regress narrow viewports without anyone noticing.
    const found: string[] = [];
    for (const { path, text } of markupFiles()) {
      for (const line of text.split('\n')) {
        if (/px-\d+\s+py-\d+\s+lg:px-\d+/.test(line)) found.push(`${path}: ${line.trim().slice(0, 100)}`);
      }
    }
    expect(found).toEqual([]);
  });

  it('declares no gradient primary buttons', () => {
    // The flat accent is the primary. The two surviving gradients are a
    // wordmark and a progress bar, neither of which is a button.
    const found: string[] = [];
    for (const { path, text } of markupFiles()) {
      for (const line of text.split('\n')) {
        if (/<button[^>]*bg-gradient-to/.test(line)) found.push(`${path}: ${line.trim().slice(0, 100)}`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe('status colour scales', () => {
  // emerald/rose/amber carry success, failure and caution across the pages.
  // They are retargeted at tokens like slate-* and purple-* are, because the
  // raw Tailwind values do not flip with the theme — an unmapped step renders
  // a near-white panel on a dark page, which is how this broke the first time.
  const SCALES = ['emerald', 'rose', 'amber'] as const;

  /** Every step actually referenced by a utility class anywhere in src/. */
  function usedSteps(scale: string): Set<string> {
    const used = new Set<string>();
    const re = new RegExp(`\\b(?:bg|text|border|ring|divide|from|to|via|fill|stroke|accent|outline|shadow|decoration)-${scale}-(\\d+)\\b`, 'g');
    for (const { text } of markupFiles()) {
      for (const m of text.matchAll(re)) used.add(m[1]);
    }
    return used;
  }

  function mappedSteps(scale: string): Set<string> {
    const mapped = new Set<string>();
    const re = new RegExp(`--color-${scale}-(\\d+)\\s*:`, 'g');
    for (const m of css().matchAll(re)) mapped.add(m[1]);
    return mapped;
  }

  it('maps every status step the markup actually uses', () => {
    const unmapped: string[] = [];
    for (const scale of SCALES) {
      const mapped = mappedSteps(scale);
      for (const step of usedSteps(scale)) {
        if (!mapped.has(step)) unmapped.push(`${scale}-${step}`);
      }
    }
    expect(unmapped, 'these resolve to raw Tailwind values and will not theme').toEqual([]);
  });

  it('maps each status step to a theme token rather than a literal', () => {
    const literals: string[] = [];
    for (const scale of SCALES) {
      const re = new RegExp(`--color-${scale}-\\d+\\s*:\\s*([^;]+);`, 'g');
      for (const m of css().matchAll(re)) {
        if (!m[1].trim().startsWith('var(--')) literals.push(`${scale}: ${m[1].trim()}`);
      }
    }
    expect(literals).toEqual([]);
  });
});
