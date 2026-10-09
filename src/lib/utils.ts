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

/**
 * Briefly swap a button's label to confirm an action, then restore it.
 *
 * Restores from the label captured at call time rather than from the live
 * element, so a double-click while the confirmation is showing cannot leave
 * the button permanently reading "✓ Copied". The timer is tracked per element
 * for the same reason.
 */
const flashTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

export function flashBtn(
  btn: HTMLElement,
  message = '✓ Copied',
  ms = 1500,
  className = 'text-emerald-600',
): void {
  const existing = flashTimers.get(btn);
  // A second click mid-flash must not capture "✓ Copied" as the label to
  // restore; clearing first leaves the original still stored below.
  if (existing !== undefined) clearTimeout(existing);
  else btn.dataset.flashLabel = btn.textContent ?? '';

  btn.textContent = message;
  if (className) btn.classList.add(className);

  flashTimers.set(btn, setTimeout(() => {
    btn.textContent = btn.dataset.flashLabel ?? '';
    if (className) btn.classList.remove(className);
    delete btn.dataset.flashLabel;
    flashTimers.delete(btn);
  }, ms));
}

/**
 * Copy text and confirm on the button that triggered it. Returns false when
 * there was nothing to copy or the clipboard refused — a denied permission
 * should not look like a successful copy.
 */
export async function copyWithFeedback(
  btn: HTMLElement,
  text: string,
  message = '✓ Copied',
): Promise<boolean> {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    flashBtn(btn, message);
    return true;
  } catch {
    flashBtn(btn, '✕ Copy failed', 2000, 'text-rose-600');
    return false;
  }
}
