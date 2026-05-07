export function fmtBytes(b: number): string {
  if (b < 1024)    return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}

export function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

export function extOf(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
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
