export function fmtBytes(b: number): string {
  if (b < 1000)      return b + ' B';
  if (b < 1_000_000) return (b / 1000).toFixed(1) + ' KB';
  return (b / 1_000_000).toFixed(2) + ' MB';
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export function extOf(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

/** Repeat a replace until the string stops changing, so removing one match
 *  can't splice the surrounding text into a new match (e.g. `<!<!---->--`). */
export function replaceUntilStable(str: string, re: RegExp, replacement: string): string {
  let prev: string;
  do {
    prev = str;
    str = str.replace(re, replacement);
  } while (str !== prev);
  return str;
}

export function dl(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
