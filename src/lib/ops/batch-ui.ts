import { runBatch, shouldZip, zipOutputs, summarise, MAX_BATCH_FILES, type BatchSummary } from './batch';
import { accepts, chainableTo, type Op, type ParamValues } from './types';
import { OPS } from './index';
import { handoff, collectHandoff } from './handoff';
import { fmtBytes } from '@/lib/utils';
import { reportError, reportFriction } from '@/lib/telemetry';

/** Display names for the chain buttons. */
const TOOL_LABELS: Record<string, string> = {
  'image-compress': 'Compress',
  'image-resize': 'Resize',
  'image-convert': 'Convert',
  'pdf-compress': 'Compress PDF',
  'metadata-cleaner': 'Strip metadata',
  'font-converter': 'Convert font',
};

/**
 * The batch controller shared by every op-backed tool page.
 *
 * Written once here rather than per page: the file list, the progress count,
 * the partial-failure summary and the zip-or-not decision are the same problem
 * for every tool, and were previously re-solved (or simply absent) in each.
 */

export interface BatchUiOptions {
  op: Op<ParamValues>;
  /** Reads the current control values at the moment Run is pressed. */
  getParams: () => ParamValues;
  /** Called whenever the file list changes, so the page can enable its button. */
  onFilesChanged?: (files: File[]) => void;
  /** Called when a run finishes, for the page's own result rendering. */
  onDone?: (summary: BatchSummary) => void;
}

export interface BatchUi {
  add(files: File[]): void;
  remove(index: number): void;
  clear(): void;
  files(): File[];
  run(): Promise<void>;
  busy(): boolean;
}

function el(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke late: Safari cancels an in-flight download if the URL dies early.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Wire a batch UI.
 *
 * Expects these ids on the page: `<p>-list`, `<p>-count`, `<p>-progress`,
 * `<p>-status`, `<p>-run`. Each is optional — a page that omits one simply
 * does not get that affordance.
 */
export function wireBatchUi(prefix: string, opts: BatchUiOptions): BatchUi {
  let files: File[] = [];
  let running = false;

  const listEl = el(`${prefix}-list`);
  const countEl = el(`${prefix}-count`);
  const progressEl = el(`${prefix}-progress`);
  const statusEl = el(`${prefix}-status`);
  const runEl = el(`${prefix}-run`) as HTMLButtonElement | null;
  const chainEl = el(`${prefix}-chain`);

  function setStatus(msg: string, tone: 'ok' | 'err' | 'info' = 'info') {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.dataset.tone = tone;
  }

  function render() {
    if (countEl) {
      countEl.textContent = files.length
        ? `${files.length} file${files.length === 1 ? '' : 's'} · ${fmtBytes(files.reduce((n, f) => n + f.size, 0))}`
        : '';
    }
    if (runEl) runEl.disabled = files.length === 0 || running;

    if (listEl) {
      listEl.innerHTML = '';
      files.forEach((file, i) => {
        const row = document.createElement('div');
        row.className =
          'flex items-center gap-3 rounded-md border border-slate-200 bg-surface px-3 py-2 text-sm';

        const name = document.createElement('span');
        name.className = 'min-w-0 flex-1 truncate text-slate-700';
        name.textContent = file.name;

        const size = document.createElement('span');
        size.className = 'shrink-0 text-xs text-slate-400';
        size.textContent = fmtBytes(file.size);

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'shrink-0 rounded px-1.5 text-xs text-slate-400 hover:text-rose-600';
        remove.setAttribute('aria-label', `Remove ${file.name}`);
        remove.textContent = '✕';
        remove.addEventListener('click', () => api.remove(i));

        row.append(name, size, remove);
        listEl.appendChild(row);
      });
    }

    opts.onFilesChanged?.(files);
  }

  /**
   * Offer the steps this output can feed into.
   *
   * The list is computed from the declarations — which ops accept the MIME
   * type this run just produced — rather than from a hand-kept table, so it
   * cannot go stale as tools are added. Choosing one loads the results back in
   * as the new input, which is the part that previously required downloading
   * and re-uploading between every step.
   */
  function offerChain(summary: BatchSummary, params: ParamValues) {
    if (!chainEl) return;
    chainEl.innerHTML = '';
    chainEl.hidden = true;

    const outputs = summary.items.filter((i) => i.ok && i.output);
    if (outputs.length === 0) return;

    const next = chainableTo(opts.op, params, OPS, outputs[0].output!.blob.type || undefined);
    if (next.length === 0) return;

    const label = document.createElement('span');
    label.className = 'text-xs text-slate-500';
    label.textContent = 'Next:';
    chainEl.appendChild(label);

    for (const target of next) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 transition-colors hover:border-purple-300 hover:text-purple-600';
      btn.textContent = TOOL_LABELS[target.id] ?? target.id;
      btn.addEventListener('click', () => {
        // Hand the produced files to the next tool as real File objects, so it
        // starts from the output rather than the original input.
        const carried = outputs.map(
          (i) => new File([i.output!.blob], i.output!.name, { type: i.output!.blob.type }),
        );
        sessionStorage.setItem('chain-from', opts.op.id);
        void handoff(target.id, carried);
      });
      chainEl.appendChild(btn);
    }

    chainEl.hidden = false;
  }

  const api: BatchUi = {
    files: () => files,
    busy: () => running,

    add(incoming) {
      const rejected: File[] = [];
      for (const f of incoming) {
        if (!accepts(opts.op as unknown as Op<never>, f)) {
          rejected.push(f);
          continue;
        }
        // Same name and size twice is a re-drop, not two files.
        if (files.some((x) => x.name === f.name && x.size === f.size)) continue;
        files.push(f);
      }

      if (files.length > MAX_BATCH_FILES) {
        files = files.slice(0, MAX_BATCH_FILES);
        setStatus(`Limited to ${MAX_BATCH_FILES} files per run.`, 'info');
      }

      if (rejected.length) {
        // A rejected drop means either the copy is wrong or the format should
        // be supported — both worth knowing, and invisible in an error log.
        reportFriction(opts.op.id, 'REJECTED_TYPE', { mime: rejected[0].type || undefined });
        setStatus(
          `${rejected.length} file${rejected.length === 1 ? '' : 's'} skipped — unsupported type.`,
          'err',
        );
      }

      render();
    },

    remove(index) {
      files.splice(index, 1);
      if (chainEl) chainEl.hidden = true;
      render();
    },

    clear() {
      files = [];
      setStatus('');
      if (progressEl) progressEl.textContent = '';
      if (chainEl) chainEl.hidden = true;
      render();
    },

    async run() {
      if (running || files.length === 0) return;
      running = true;
      render();
      setStatus('');

      const params = opts.getParams();

      try {
        const summary = await runBatch(opts.op, files, params, {
          onProgress: ({ done, total, current }) => {
            if (!progressEl) return;
            // A count, not a spinner: with forty files a spinner reads as a hang.
            progressEl.textContent = current
              ? `${done} / ${total} — ${current}`
              : `${done} / ${total}`;
          },
        });

        const successes = summary.items.filter((i) => i.ok && i.output);

        if (successes.length === 0) {
          setStatus(summarise(summary), 'err');
        } else if (shouldZip(successes.length)) {
          const zip = await zipOutputs(summary.items, `${opts.op.id}.zip`);
          download(zip, `${opts.op.id}-${successes.length}-files.zip`);
          setStatus(`${summarise(summary)} — downloaded as ZIP.`, summary.failed ? 'info' : 'ok');
        } else {
          for (const item of successes) download(item.output!.blob, item.output!.name);
          setStatus(summarise(summary), summary.failed ? 'info' : 'ok');
        }

        offerChain(summary, params);

        // Telemetry: one event per distinct failure code, not one per file, so
        // a forty-file batch cannot flood the store.
        const codes = new Set(summary.items.filter((i) => !i.ok && i.code).map((i) => i.code!));
        for (const code of codes) reportError(opts.op.id, code);
        if (summary.failed > 0 && summary.succeeded > 0) {
          reportFriction(opts.op.id, 'BATCH_PARTIAL', { ms: summary.ms });
        }
        if (summary.bytesOut >= summary.bytesIn && summary.bytesIn > 0) {
          reportFriction(opts.op.id, 'NO_SAVING', { ms: summary.ms });
        }

        opts.onDone?.(summary);
      } catch (e) {
        const code = (e as { code?: string }).code;
        setStatus(
          code === 'TOO_MANY_FILES'
            ? `At most ${MAX_BATCH_FILES} files at once.`
            : 'Something went wrong. Nothing was uploaded.',
          'err',
        );
        reportError(opts.op.id, code === 'TOO_MANY_FILES' ? 'TOO_MANY_FILES' : 'UNKNOWN');
      } finally {
        running = false;
        if (progressEl) progressEl.textContent = '';
        // Only re-enable the button. A full render() here would fire
        // onFilesChanged and overwrite the result the page just wrote in
        // onDone, since the file list is unchanged by a run.
        if (runEl) runEl.disabled = files.length === 0;
      }
    },
  };

  runEl?.addEventListener('click', () => void api.run());

  // Files handed over from a previous step, if this page was reached by one.
  const incoming = collectHandoff(opts.op.id);
  if (incoming.length) {
    api.add(incoming);
    const from = sessionStorage.getItem('chain-from');
    sessionStorage.removeItem('chain-from');
    setStatus(
      `${incoming.length} file${incoming.length === 1 ? '' : 's'} carried over${
        from ? ` from ${TOOL_LABELS[from] ?? from}` : ''
      }.`,
      'info',
    );
  }

  render();
  return api;
}
