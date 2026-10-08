import { describe, it, expect } from 'vitest';
import { minifyCSS, minifyHTML, minifyJS } from './code-minifier';

describe('minifyHTML', () => {
  it('strips ordinary comments', () => {
    expect(minifyHTML('<div><!-- note --><p>x</p></div>')).toBe('<div><p>x</p></div>');
  });

  it('honours both HTML comment terminators', () => {
    // HTML ends a comment on `-->` or `--!>`. Matching only the first left a
    // comment closed the second way completely intact, opener and all — so the
    // content this exists to remove still reached a parser that honours it.
    expect(minifyHTML('<div><!-- note --!><p>x</p></div>')).toBe('<div><p>x</p></div>');
  });

  it('removes nested comments completely', () => {
    // One pass leaves a usable comment behind when one is nested in another.
    expect(minifyHTML('<div><!--<!--inner--><p>x</p></div>')).toBe('<div><p>x</p></div>');
  });

  it('drops an unterminated comment rather than letting it through', () => {
    // An opener with no terminator swallows the rest of the document in a
    // parser looking for one.
    expect(minifyHTML('<div><p>x</p><!-- never closed')).toBe('<div><p>x</p>');
  });

  it('preserves conditional comments', () => {
    // These are load-bearing markup for old IE, not commentary, so stripping
    // them changes what the page does.
    const src = '<!--[if lt IE 9]><script src="shim.js"></script><![endif]-->';
    expect(minifyHTML(src)).toContain('[if lt IE 9]');
  });

  it('collapses whitespace between tags', () => {
    expect(minifyHTML('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>')).toBe('<ul><li>a</li><li>b</li></ul>');
  });

  it('leaves markup without comments unchanged', () => {
    expect(minifyHTML('<p>hello</p>')).toBe('<p>hello</p>');
  });
});

describe('minifyCSS', () => {
  it('strips comments and collapses space', () => {
    expect(minifyCSS('a { color : red ; }  /* note */')).toBe('a{color:red}');
  });

  it('drops the final semicolon in a block', () => {
    expect(minifyCSS('a{color:red;}')).toBe('a{color:red}');
  });

  it('tightens combinators', () => {
    expect(minifyCSS('a > b ~ c + d { x : 1 }')).toBe('a>b~c+d{x:1}');
  });
});

describe('minifyJS', () => {
  it('removes line and block comments', () => {
    expect(minifyJS('var a = 1; // note\nvar b = 2; /* block */')).not.toContain('note');
    expect(minifyJS('var a = 1; /* block */ var b = 2;')).not.toContain('block');
  });

  it('does not corrupt a string that contains comment markers', () => {
    // The common failure for a regex-based minifier: treating text inside a
    // string literal as syntax.
    const out = minifyJS('var s = "http://example.com";');
    expect(out).toContain('http://example.com');
  });

  it('preserves a regex literal containing a slash', () => {
    const out = minifyJS('var re = /a\\/b/g;');
    expect(out).toContain('a\\/b');
  });
});
