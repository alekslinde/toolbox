/* Pure CSS → SASS indented-syntax converter — no DOM, no imports. */

export function cssToSass(css: string): string {
  const lines = css.split('\n');
  const result: string[] = [];
  let depth = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (result.length && result[result.length - 1] !== '') result.push('');
      continue;
    }
    if (line.startsWith('//') || line.startsWith('/*')) {
      result.push('  '.repeat(depth) + line); continue;
    }
    if (line.endsWith('{')) {
      result.push('  '.repeat(depth) + line.slice(0, -1).trim()); depth++; continue;
    }
    if (line === '}') { depth = Math.max(0, depth - 1); continue; }
    result.push('  '.repeat(depth) + line.replace(/;$/, ''));
  }
  return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
