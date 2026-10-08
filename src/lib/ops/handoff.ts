/**
 * Carrying files from one tool to the next.
 *
 * Tools are separate pages, so a chain step is a navigation. The files have to
 * survive it — and they have to do so without touching a server, which rules
 * out the obvious approach and is the whole reason chaining is worth building
 * here: nowhere else can it be done without a round trip per step.
 *
 * The files live in a module-level variable and are handed over during an
 * in-app View Transition, which keeps the JS context alive. A full page load
 * clears them, which is correct — a reload should not resurrect someone's
 * files from a previous visit.
 */

let pending: File[] | null = null;
let pendingFor: string | null = null;

/** Hand `files` to the tool at `toolId` and navigate there. */
export async function handoff(toolId: string, files: File[]): Promise<void> {
  pending = files;
  pendingFor = toolId;

  const url = `/tools/${toolId}`;
  // Astro's client router keeps the JS context across the transition, so the
  // files survive. Without it, navigation reloads the document and they do not
  // — which is why the receiving page treats an empty handoff as normal.
  const navigate = (globalThis as { navigate?: (href: string) => Promise<void> }).navigate;
  if (typeof navigate === 'function') {
    await navigate(url);
    return;
  }

  const router = await import('astro:transitions/client').catch(() => null);
  if (router?.navigate) {
    router.navigate(url);
    return;
  }

  // No client router: the files cannot survive, so do not pretend otherwise.
  pending = null;
  pendingFor = null;
  window.location.href = url;
}

/**
 * Collect files handed to `toolId`, if any. Returns them once — a second call
 * gets nothing, so a re-render cannot re-add the same files.
 */
export function collectHandoff(toolId: string): File[] {
  if (pendingFor !== toolId || !pending) return [];
  const files = pending;
  pending = null;
  pendingFor = null;
  return files;
}

/** Whether something is waiting for this tool. */
export function hasHandoff(toolId: string): boolean {
  return pendingFor === toolId && !!pending?.length;
}
