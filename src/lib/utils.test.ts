import { describe, it, expect, vi } from 'vitest';
import { fmtBytes, baseName, extOf, replaceUntilStable, flashBtn } from './utils.js';

describe('fmtBytes', () => {
  it('formats exact bytes', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(1)).toBe('1 B');
    expect(fmtBytes(999)).toBe('999 B');
  });

  it('formats kilobytes at 1000 boundary', () => {
    expect(fmtBytes(1000)).toBe('1.0 KB');
    expect(fmtBytes(1500)).toBe('1.5 KB');
    expect(fmtBytes(999999)).toBe('1000.0 KB');
  });

  it('formats megabytes at 1000000 boundary, matching OS file size display', () => {
    expect(fmtBytes(1_000_000)).toBe('1.00 MB');
    expect(fmtBytes(2_000_000)).toBe('2.00 MB');
    expect(fmtBytes(1_500_000)).toBe('1.50 MB');
  });
});

describe('baseName', () => {
  it('strips a simple extension', () => {
    expect(baseName('file.txt')).toBe('file');
    expect(baseName('MyFont.ttf')).toBe('MyFont');
  });

  it('strips only the last extension', () => {
    expect(baseName('my.font.ttf')).toBe('my.font');
    expect(baseName('archive.tar.gz')).toBe('archive.tar');
  });

  it('returns unchanged when no extension', () => {
    expect(baseName('README')).toBe('README');
    expect(baseName('')).toBe('');
  });

  it('handles leading dot (hidden file)', () => {
    expect(baseName('.gitignore')).toBe('');
  });
});

describe('extOf', () => {
  it('returns lowercase extension', () => {
    expect(extOf('Font.TTF')).toBe('ttf');
    expect(extOf('image.PNG')).toBe('png');
    expect(extOf('style.CSS')).toBe('css');
  });

  it('returns last segment when no dot separator', () => {
    expect(extOf('font')).toBe('font');
  });

  it('returns last extension for multi-part names', () => {
    expect(extOf('archive.tar.gz')).toBe('gz');
  });

  it('returns empty string for empty input', () => {
    expect(extOf('')).toBe('');
  });

  it('handles filenames starting with a dot', () => {
    expect(extOf('.gitignore')).toBe('gitignore');
  });
});

describe('replaceUntilStable', () => {
  it('removes matches re-formed by a previous removal', () => {
    expect(replaceUntilStable('<!<!---->-- x -->a', /<!--[\s\S]*?-->/g, '')).toBe('a');
  });

  it('returns the input unchanged when nothing matches', () => {
    expect(replaceUntilStable('plain', /<!--[\s\S]*?-->/g, '')).toBe('plain');
  });
});

describe('flashBtn', () => {
  // The tests run without a DOM, so this is the minimum surface flashBtn
  // touches: a label, a class list and a dataset. Testing against a stub keeps
  // the suite dependency-free while still covering the state logic, which is
  // where the bug worth guarding lives.
  function stubButton() {
    const classes = new Set<string>();
    return {
      textContent: 'Copy',
      dataset: {} as Record<string, string>,
      classList: {
        add: (c: string) => classes.add(c),
        remove: (c: string) => classes.delete(c),
        has: (c: string) => classes.has(c),
      },
      _classes: classes,
    } as unknown as HTMLElement & { _classes: Set<string> };
  }

  it('shows the message then restores the original label', () => {
    vi.useFakeTimers();
    const btn = stubButton();

    flashBtn(btn, '✓ Copied', 1500);
    expect(btn.textContent).toBe('✓ Copied');
    expect(btn._classes.has('text-emerald-600')).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(btn.textContent).toBe('Copy');
    expect(btn._classes.has('text-emerald-600')).toBe(false);
    vi.useRealTimers();
  });

  // The regression this guards: clicking again mid-flash would capture
  // "✓ Copied" as the label to restore, leaving the button stuck on it.
  it('restores the true original label when clicked twice mid-flash', () => {
    vi.useFakeTimers();
    const btn = stubButton();

    flashBtn(btn, '✓ Copied', 1500);
    vi.advanceTimersByTime(500);
    flashBtn(btn, '✓ Copied', 1500);
    vi.advanceTimersByTime(1500);

    expect(btn.textContent).toBe('Copy');
    vi.useRealTimers();
  });

  it('clears its dataset marker so nothing leaks onto the element', () => {
    vi.useFakeTimers();
    const btn = stubButton();
    flashBtn(btn, '✓', 100);
    vi.advanceTimersByTime(100);
    expect(btn.dataset.flashLabel).toBeUndefined();
    vi.useRealTimers();
  });
});
