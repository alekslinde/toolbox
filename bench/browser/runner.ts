/* Shared browser benchmark harness. */

export interface BenchResult {
  name: string;
  inputBytes: number;
  outputBytes: number;
  mean: number;   // ms per op
  min: number;
  max: number;
  samples: number;
  ratio: number | null;  // outputBytes / inputBytes; null if not a compression bench
  sanityOk: boolean;
  sanityNote: string;
}

export interface RunBenchOpts {
  warmup?: number;       // default 3
  durationMs?: number;   // default 2000
  maxSamples?: number;   // default 50
  innerLoops?: number;   // run fn this many times per sample (for fast ops); default 1
}

/**
 * Warm up, then collect samples for durationMs.
 * fn must return the output so we can measure outputBytes.
 */
export async function runBench(
  name: string,
  inputBytes: number,
  fn: () => Promise<string | ArrayBuffer | Uint8Array | Blob | null>,
  opts: RunBenchOpts = {},
): Promise<BenchResult> {
  const {
    warmup    = 3,
    durationMs = 2000,
    maxSamples = 50,
    innerLoops = 1,
  } = opts;

  for (let i = 0; i < warmup; i++) await fn();

  const times: number[] = [];
  let outputBytes = 0;
  const deadline = performance.now() + durationMs;

  while (performance.now() < deadline && times.length < maxSamples) {
    const t0 = performance.now();
    let last: string | ArrayBuffer | Uint8Array | Blob | null = null;
    for (let j = 0; j < innerLoops; j++) last = await fn();
    times.push((performance.now() - t0) / innerLoops);
    if (last != null) outputBytes = byteLen(last);
  }

  if (times.length === 0) times.push(0);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;

  return {
    name,
    inputBytes,
    outputBytes,
    mean,
    min: Math.min(...times),
    max: Math.max(...times),
    samples: times.length,
    ratio: outputBytes > 0 && inputBytes > 0 ? outputBytes / inputBytes : null,
    sanityOk: true,
    sanityNote: '',
  };
}

function byteLen(v: string | ArrayBuffer | Uint8Array | Blob): number {
  if (typeof v === 'string') return new TextEncoder().encode(v).byteLength;
  if (v instanceof Uint8Array) return v.byteLength;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (v instanceof Blob) return v.size;
  return 0;
}

export function throughputKBs(r: BenchResult): string {
  if (r.mean === 0) return '—';
  return ((r.inputBytes / 1024) / (r.mean / 1000)).toFixed(1);
}

export function fmtMs(n: number): string {
  if (n < 1) return n.toFixed(3);
  if (n < 10) return n.toFixed(2);
  if (n < 100) return n.toFixed(1);
  return n.toFixed(0);
}

export function fmtBytes(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}

export function renderTable(results: BenchResult[]): string {
  const rows = results.map(r => {
    const ratioCell = r.ratio != null
      ? `<span class="${r.ratio < 1 ? 'text-emerald-600 font-semibold' : 'text-amber-600'}">${(r.ratio * 100).toFixed(1)}%</span>`
      : '<span class="text-slate-400">—</span>';
    const sanityCell = r.sanityOk
      ? '<span class="text-emerald-600">✓</span>'
      : `<span class="text-rose-500" title="${r.sanityNote}">✗ ${r.sanityNote}</span>`;
    return `<tr>
      <td class="py-2 pr-4 text-slate-800">${r.name}</td>
      <td class="py-2 pr-4 text-right text-slate-600">${fmtBytes(r.inputBytes)}</td>
      <td class="py-2 pr-4 text-right text-slate-600">${fmtBytes(r.outputBytes)}</td>
      <td class="py-2 pr-4 text-right font-semibold text-slate-800">${fmtMs(r.mean)} ms</td>
      <td class="py-2 pr-4 text-right text-slate-500">${fmtMs(r.min)}–${fmtMs(r.max)} ms</td>
      <td class="py-2 pr-4 text-right text-slate-600">${throughputKBs(r)} KB/s</td>
      <td class="py-2 pr-4 text-right">${ratioCell}</td>
      <td class="py-2 text-right">${sanityCell}</td>
    </tr>`;
  }).join('');

  return `<div class="overflow-x-auto">
    <table class="w-full text-sm font-mono border-collapse">
      <thead>
        <tr class="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
          <th class="py-2 pr-4 text-left font-medium">Benchmark</th>
          <th class="py-2 pr-4 text-right font-medium">Input</th>
          <th class="py-2 pr-4 text-right font-medium">Output</th>
          <th class="py-2 pr-4 text-right font-medium">Mean</th>
          <th class="py-2 pr-4 text-right font-medium">Min–Max</th>
          <th class="py-2 pr-4 text-right font-medium">KB/s</th>
          <th class="py-2 pr-4 text-right font-medium">Ratio</th>
          <th class="py-2 text-right font-medium">OK</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100">${rows}</tbody>
    </table>
  </div>`;
}
