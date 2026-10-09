# Toolkist — CLAUDE.md

Browser-based developer tools by Aleks Linde. Deployed at **toolkist.app** via Cloudflare Workers + Assets. All tools run entirely client-side — no uploads, no backend processing.

## Skills (slash commands)

| Command | When to use |
|---|---|
| `/ship` | Ship to production — full checklist |
| `/new-tool` | Scaffold a new tool page |
| `/deps` | Update dependencies |
| `/check-console` | Check all pages for browser console errors |
| `/review-reuse` | Review changed files for duplicated logic |
| `/review-efficiency` | Review changed files for performance issues |

## Project structure

```
src/
  pages/
    index.astro           — Home page (tool directory by category)
    tools/
      [slug].astro        — Fallback route (placeholder for unimplemented tools)
      <slug>.astro        — One file per tool (19 tools)
  layouts/
    MainLayout.astro      — Shared header/sidebar/footer
  components/             — Shared .astro components (check here first)
    Breadcrumbs.astro
    FAQAccordion.astro
    HelpfulButton.astro
    QuickTips.astro
    ToolCard.astro
    ToolSEO.astro
  data/
    tools.ts              — Master tool registry (slug, title, description, category, tags)
    nav.ts                — Navigation structure
  lib/                    — Shared TS logic + colocated *.test.ts files
    color.ts              — Colour utility functions
    utils.ts              — Shared utilities (fmtBytes, dl, flashBtn, copyWithFeedback)
    code-minifier.ts, font-converter.ts, scss-converter.ts, brand-extract.ts
    ops/                  — Declared operations (file-in/file-out tools)
    text/                 — Text & data transforms (string-in/string-out)
      json-tool.ts        — Parse, format, validate, shape stats
      encoding.ts         — Base64/base64url, hex, URL, query, JWT decode
      hash.ts             — MD5/SHA/CRC32/HMAC + UUID v4/v7, ULID, Nano ID
      regex.ts            — Match, replace, backtracking-risk screening
      cron.ts             — Parse, explain, next-run calculation
      timestamp.ts        — Epoch unit inference, parsing, rendering
worker/
  counter.js              — Cloudflare Worker: serves static assets + /u endpoint (Durable Objects)
```

### Code reuse

- Check `src/components/` before building any new UI, and `src/lib/` before writing helpers.
- New shared component → `src/components/ComponentName.astro`. New shared logic → `src/lib/<name>.ts` with a colocated `<name>.test.ts`.
- Extract logic used in 2+ places into `src/lib/`.
- New tools go in `src/pages/tools/<slug>.astro` and must be registered in `src/data/tools.ts` (use `/new-tool`).

## Tools (32)

Source of truth is `src/data/tools.ts` — keep this table in sync with it.

**Images & Documents**

| Slug | Tool |
|---|---|
| `image-compress` | Image Compressor |
| `image-resize` | Image Resizer |
| `image-convert` | Image Converter (incl. HEIC via heic2any) |
| `ico-generator` | ICO Favicon Generator |
| `pdf-organiser` | PDF Organiser (reorder/merge, pdf-lib) |
| `pdf-convert` | PDF Converter (PDF↔image, extract text) |
| `pdf-compress` | PDF Compressor |
| `file-diff` | File Diff (text/code/PDF) |

**Typography & Color**

| Slug | Tool |
|---|---|
| `font-converter` | Font Format Converter (opentype.js / wawoff2) |
| `wcag-contrast` | WCAG Contrast Checker |
| `color-palette` | Color Palette Generator |
| `color-gradient` | CSS Gradient Builder |
| `tints-shades` | Tints & Shades Generator |
| `color-namer` | Color Namer (CIE Lab ΔE matching) |
| `color-extractor` | Image Dominant Color Extractor |

**Code & Web**

| Slug | Tool |
|---|---|
| `code-formatter` | Code Formatter |
| `code-minifier` | Code Minifier |
| `scss-compiler` | SCSS Compiler |
| `semantic-html` | Semantic HTML Converter |
| `brand-assets` | Brand Assets Extractor (CORS proxies) |
| `xd-to-figma` | XD → Figma Packager (jszip) |
| `svg-validator` | SVG Validator & Repair (svgo) |
| `token-saver` | Prompt Token Saver |

**Text & Data**

Pure string/number transforms. Logic lives in `src/lib/text/` with colocated
tests; the pages are thin views over it.

| Slug | Tool |
|---|---|
| `json-formatter` | JSON Formatter & Validator |
| `base64-encode` | Base64 & URL Encoder |
| `jwt-decoder` | JWT Decoder (decode only — never verifies) |
| `hash-generator` | Hash & Checksum Generator (WebCrypto + MD5/CRC32) |
| `uuid-generator` | UUID & ID Generator (v4, v7, ULID, Nano ID) |
| `regex-tester` | Regex Tester (screens for catastrophic backtracking) |
| `cron-parser` | Cron Expression Parser |
| `timestamp-converter` | Unix Timestamp Converter |

## Build & deploy

```bash
npm run dev        # astro dev server
npm run build      # astro build → dist/
npm run preview    # serve dist/ locally
npm test           # vitest run (run before committing)
npm run bench:node # benchmarks (vitest bench)
npm run deploy     # astro build + wrangler deploy to Cloudflare
```

`wrangler deploy` publishes `dist/` via `worker/counter.js`. The Worker serves static assets and handles:
- `GET/POST /u?k=<key>` — usage counter (Durable Objects)

## Design system

This project uses **Tailwind CSS**. Follow the utility class patterns already used in the existing tool pages. Key conventions:

- Containers: `px-8 py-10 lg:px-8 max-w-[1440px] mx-auto`
- Cards/panels: `rounded-xl border border-slate-200 bg-white p-6`
- Inputs: `w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none`
- Primary button: `rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 px-5 py-2.5 text-sm font-medium text-white hover:opacity-90`
- Outline button: `rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:border-purple-300`

## Known constraints

- **No server-side rendering.** Astro is configured for static output. All tool logic runs in the browser via `<script>` blocks.
- **Alpine.js for some tools.** Where Alpine reactivity is used, the `MainLayout` loads it globally. Most tools use vanilla TypeScript in `<script>` blocks.
- **CORS proxies (Brand Assets).** Uses `api.allorigins.win` and `api.codetabs.com`.

## Off limits

- **Don't add a backend.** All tools must stay 100% client-side.
- **Don't switch away from static output.** Astro is configured for no SSR.
- `worker/counter.js` handles Durable Objects (usage counter) — edit carefully.
- **The JWT decoder must never verify a signature.** Verification needs the
  signing key, and asking a user for that asks for the one secret that makes
  their tokens forgeable. The page states decode ≠ verify above the input;
  keep it there.
- **Don't drop the regex backtracking screen.** Once the engine starts on a
  pathological pattern nothing in JS can interrupt it, so a risky pattern is
  refused *before* running rather than timed out after.
- **Don't detect regex problems with a regex.** The screener in
  `src/lib/text/regex.ts` is a single-pass tokenizer because the regex version
  of it was itself a ReDoS vector — it ran on every keystroke, and a
  45-character pattern froze the tab for 44 seconds. Anything inspecting
  pattern structure stays linear and non-backtracking.
- **Don't make UUID v7 or ULID re-randomise per call.** They share a monotonic
  counter so a batch generated inside one millisecond stays strictly ordered —
  which is the only reason to choose either over v4.

## Git commits

Do not add `Co-Authored-By` trailers, session URLs, or any other metadata to commit messages. The commit hash is sufficient for traceability.

**Commit scopes:** `(ui)` components/layouts/pages · `(tools)` tool logic · `(lib)` shared utilities · `(data)` tools.ts/nav.ts · `(worker)` counter.js · `(config)` build/wrangler/deps

## Git workflow

`main` is the production branch.

New tools go on a feature branch:

```bash
git checkout -b feature/<tool-name>
git checkout main
git merge feature/<tool-name>
npm run deploy
```
