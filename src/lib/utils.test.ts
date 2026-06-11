import { describe, it, expect } from 'vitest';
import { fmtBytes, baseName, extOf } from './utils.js';

describe('fmtBytes', () => {
  it('formats exact bytes', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(1)).toBe('1 B');
    expect(fmtBytes(1023)).toBe('1023 B');
  });

  it('formats kilobytes at 1024 boundary', () => {
    expect(fmtBytes(1024)).toBe('1.0 KB');
    expect(fmtBytes(1536)).toBe('1.5 KB');
    expect(fmtBytes(1048575)).toBe('1024.0 KB');
  });

  it('formats megabytes at 1048576 boundary', () => {
    expect(fmtBytes(1048576)).toBe('1.00 MB');
    expect(fmtBytes(2 * 1048576)).toBe('2.00 MB');
    expect(fmtBytes(1.5 * 1048576)).toBe('1.50 MB');
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
