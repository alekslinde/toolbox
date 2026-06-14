/* Pure minification functions — no DOM, no imports. */

export function minifyCSS(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{};:,>~+])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

export function minifyHTML(src: string): string {
  return src
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
}

export function minifyJS(src: string): string {
  let out = '';
  let i = 0;
  const len = src.length;
  while (i < len) {
    const c = src[i], n = src[i + 1];

    if (c === '"' || c === "'" || c === '`') {
      let s = c; i++;
      while (i < len) {
        const sc = src[i];
        if (sc === '\\' && i + 1 < len) { s += sc + src[i + 1]; i += 2; continue; }
        s += sc; i++;
        if (sc === c) break;
      }
      out += s; continue;
    }

    if (c === '/' && n === '/') {
      while (i < len && src[i] !== '\n') i++;
      continue;
    }

    if (c === '/' && n === '*') {
      const isLic = src[i + 2] === '!';
      i += 2;
      let block = '/*';
      while (i < len - 1 && !(src[i] === '*' && src[i + 1] === '/')) block += src[i++];
      block += '*/'; i += 2;
      if (isLic) out += block;
      continue;
    }

    if (/\s/.test(c)) {
      const last = out[out.length - 1] || '';
      if (/[\w$]/.test(last)) {
        let j = i;
        while (j < len && /\s/.test(src[j])) j++;
        if (j < len && /[\w$]/.test(src[j])) out += ' ';
        i = j;
      } else {
        while (i < len && /\s/.test(src[i])) i++;
      }
      continue;
    }

    out += c; i++;
  }
  return out.trim();
}
