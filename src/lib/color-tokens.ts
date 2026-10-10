/**
 * Export formats for a named set of colours.
 *
 * `color-palette`, `tints-shades` and `color-extractor` each independently
 * hand-rolled the same three serialisations (CSS custom properties, a
 * Tailwind config fragment, JSON) with slightly different quirks. This is
 * that logic written once.
 */

export interface ColorToken {
  /** Used as the variable/key suffix — kept as given, not slugified, so a
   *  caller controls the exact output (e.g. "50" vs "color-1"). */
  name: string;
  hex: string;
}

/**
 * CSS custom properties, scoped to :root.
 *
 * `groupName` prefixes every variable (`--${groupName}-${token.name}`) so a
 * palette named "primary" and one named "accent" don't collide once both are
 * pasted into the same stylesheet.
 */
export function toCssVars(tokens: readonly ColorToken[], groupName = 'color'): string {
  const lines = tokens.map((t) => `  --${groupName}-${t.name}: ${t.hex.toUpperCase()};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

/** A `tailwind.config.js` theme.extend.colors fragment: `'<groupName>': { ... }`. */
export function toTailwindTheme(tokens: readonly ColorToken[], groupName = 'color'): string {
  const inner = tokens.map((t) => `    ${t.name}: '${t.hex.toUpperCase()}',`).join('\n');
  return `'${groupName}': {\n${inner}\n},`;
}

/** `{ name: HEX, ... }`, flat — the shape every tool already produced independently. */
export function toJson(tokens: readonly ColorToken[]): string {
  const obj: Record<string, string> = {};
  for (const t of tokens) obj[t.name] = t.hex.toUpperCase();
  return JSON.stringify(obj, null, 2);
}

/** `$<groupName>-<name>: HEX;` — Sass variables, one assignment per line. */
export function toScssVars(tokens: readonly ColorToken[], groupName = 'color'): string {
  return tokens.map((t) => `$${groupName}-${t.name}: ${t.hex.toUpperCase()};`).join('\n');
}
