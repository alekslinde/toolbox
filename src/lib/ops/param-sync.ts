import { defaultParams, type ParamsSchema, type ParamValues } from './types';
import { flashBtn, copyWithFeedback } from '@/lib/utils';

/**
 * Presets and shareable parameter links for op-backed tools.
 *
 * Params never carry the file, only values the schema already declares — so
 * both the query string and localStorage are safe to put them in without
 * touching the "no uploads" claim.
 */

const PRESET_KEY_PREFIX = 'toolkist-preset:';
const MAX_PRESETS_PER_OP = 20;

export interface Preset {
  name: string;
  values: ParamValues;
}

/** Coerce a URL/stored string back to the type its schema entry declares. */
function coerce(spec: ParamsSchema[string], raw: string): string | number | boolean | null {
  switch (spec.kind) {
    case 'range':
      return clampNum(Number(raw), spec.min, spec.max, spec.default);
    case 'int': {
      if (raw === '') return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) return spec.default;
      return clampNum(n, spec.min ?? -Infinity, spec.max ?? Infinity, spec.default);
    }
    case 'bool':
      return raw === 'true';
    case 'enum':
      return spec.of.some((o) => o.value === raw) ? raw : spec.default;
    case 'color':
      return raw;
  }
}

function clampNum(n: number, min: number, max: number, fallback: number | null): number | null {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Serialise only the keys the schema declares, skipping defaults to keep URLs short. */
export function paramsToQuery(opId: string, values: ParamValues, schema: ParamsSchema): string {
  const q = new URLSearchParams();
  q.set('op', opId);
  for (const [key, spec] of Object.entries(schema)) {
    const v = values[key];
    if (v === spec.default) continue;
    if (v === null || v === undefined) continue;
    q.set(key, String(v));
  }
  return q.toString();
}

/** Reads params for this op from the current URL. Returns null if the URL names a different op or none at all. */
export function paramsFromUrl(opId: string, schema: ParamsSchema): ParamValues | null {
  const q = new URLSearchParams(location.search);
  if (q.get('op') !== opId) return null;

  const out: ParamValues = {};
  let found = false;
  for (const [key, spec] of Object.entries(schema)) {
    const raw = q.get(key);
    if (raw === null) continue;
    out[key] = coerce(spec, raw);
    found = true;
  }
  return found ? out : null;
}

/** Puts the current params into the URL as a shareable query string, without a navigation or reload. */
export function syncUrl(opId: string, values: ParamValues, schema: ParamsSchema): void {
  const query = paramsToQuery(opId, values, schema);
  const next = `${location.pathname}?${query}`;
  if (next !== location.pathname + location.search) {
    history.replaceState(null, '', next);
  }
}

function presetKey(opId: string): string {
  return `${PRESET_KEY_PREFIX}${opId}`;
}

export function loadPresets(opId: string): Preset[] {
  try {
    const raw = localStorage.getItem(presetKey(opId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Saves (or overwrites, by name) a preset. Oldest is dropped past the per-op cap. */
export function savePreset(opId: string, name: string, values: ParamValues): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const existing = loadPresets(opId).filter((p) => p.name !== trimmed);
  const next = [...existing, { name: trimmed, values }].slice(-MAX_PRESETS_PER_OP);
  try {
    localStorage.setItem(presetKey(opId), JSON.stringify(next));
  } catch {
    /* storage can be full or disabled — presets are a convenience, not required */
  }
}

export function deletePreset(opId: string, name: string): void {
  const next = loadPresets(opId).filter((p) => p.name !== name);
  try {
    localStorage.setItem(presetKey(opId), JSON.stringify(next));
  } catch {
    /* same as above */
  }
}

export interface PresetBarOptions {
  op: { id: string; params: ParamsSchema };
  /** Reads the current control values, the same closure passed to wireBatchUi. */
  getParams: () => ParamValues;
  /** Pushes values into the page's own controls — the inverse of getParams. */
  applyParams: (values: ParamValues) => void;
}

/**
 * Wires a preset dropdown, a save button and a "copy link" button into a
 * container the page provides. Expects `<container>-select`, `<container>-save`
 * and `<container>-copy` elements — a page that omits one simply does not get
 * that affordance, matching the convention `wireBatchUi` already uses.
 *
 * On load, this also applies params from the URL if the page was opened with
 * a shared link, so a pasted `?op=…&quality=50` link reproduces the sender's
 * settings before the user touches anything.
 */
export function wirePresetBar(containerId: string, opts: PresetBarOptions): void {
  const { op, getParams, applyParams } = opts;

  const fromUrl = paramsFromUrl(op.id, op.params);
  if (fromUrl) applyParams({ ...defaultParams(op.params), ...fromUrl });

  const select = document.getElementById(`${containerId}-select`) as HTMLSelectElement | null;
  const saveBtn = document.getElementById(`${containerId}-save`) as HTMLButtonElement | null;
  const copyBtn = document.getElementById(`${containerId}-copy`) as HTMLButtonElement | null;

  function renderOptions() {
    if (!select) return;
    const presets = loadPresets(op.id);
    select.innerHTML = '<option value="">Load preset…</option>';
    for (const p of presets) {
      const option = document.createElement('option');
      option.value = p.name;
      option.textContent = p.name;
      select.appendChild(option);
    }
  }

  select?.addEventListener('change', () => {
    const name = select.value;
    if (!name) return;
    const preset = loadPresets(op.id).find((p) => p.name === name);
    if (preset) applyParams({ ...defaultParams(op.params), ...preset.values });
    select.value = '';
  });

  saveBtn?.addEventListener('click', () => {
    const name = prompt('Name this preset:');
    if (!name) return;
    savePreset(op.id, name, getParams());
    renderOptions();
    flashBtn(saveBtn, '✓ Saved');
  });

  copyBtn?.addEventListener('click', () => {
    syncUrl(op.id, getParams(), op.params);
    void copyWithFeedback(copyBtn, location.href, '✓ Link copied');
  });

  renderOptions();
}
