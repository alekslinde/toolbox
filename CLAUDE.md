# Toolbox Astro — CLAUDE.md

Browser-based developer tools by Alex Linde. Deployed at **lindetoolbox.com** via Cloudflare Workers + Assets. All tools run entirely client-side — no uploads, no backend processing.

This is the Astro rewrite of the original `toolbox` project.

## Skills (slash commands)

| Command | When to use |
|---|---|
| `/build` | Run the Astro build |
| `/ship` | Ship to production — full checklist |
| `/new-tool` | Scaffold a new tool page |
| `/deps` | Update dependencies |
| `/check-console` | Check all pages for browser console errors |

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
  components/
    Breadcrumbs.astro
    FAQAccordion.astro
    QuickTips.astro
    ToolCard.astro
  data/
    tools.ts              — Master tool registry (slug, title, description, category, tags)
    nav.ts                — Navigation structure
  lib/
    color.ts              — Colour utility functions
    utils.ts              — Shared utilities
worker/
  counter.js              — Cloudflare Worker: serves static assets + /fontpair + /u endpoints (Durable Objects)
```

## Tools (19)

| Slug | Tool |
|---|---|
| `image-compress` | Image Compressor |
| `image-resize` | Image Resizer |
| `image-convert` | Image Converter |
| `ico-generator` | ICO Favicon Generator |
| `pdf-compress` | PDF Compressor |
| `file-diff` | File Diff |
| `font-converter` | Font Format Converter (opentype.js) |
| `font-inspector` | Font Inspector — placeholder (Mixfont Lens removed; opentype.js reimplementation pending) |
| `font-pairs` | Font Pairs (AI — calls `/fontpair` worker endpoint) |
| `wcag-contrast` | WCAG Contrast Checker |
| `color-palette` | Color Palette Generator |
| `color-gradient` | CSS Gradient Builder |
| `tints-shades` | Tints & Shades Generator |
| `code-formatter` | Code Formatter |
| `code-minifier` | Code Minifier |
| `scss-compiler` | SCSS Compiler |
| `semantic-html` | Semantic HTML Converter |
| `brand-assets` | Brand Assets Extractor (CORS proxies) |
| `xd-to-figma` | XD → Figma Packager (jszip) |

## Build & deploy

```bash
npm run build      # astro build → dist/
npm run preview    # serve dist/ locally
npm run deploy     # astro build + wrangler deploy to Cloudflare
```

`wrangler deploy` publishes `dist/` via `worker/counter.js`. The Worker serves static assets and handles:
- `POST /fontpair` — AI font pairing (requires `ANTHROPIC_KEY` secret in Cloudflare dashboard)
- `GET/POST /u?k=<key>` — usage counter (Durable Objects)

## Cloudflare Worker secrets

Set in Cloudflare dashboard → Workers → lindetoolbox → Settings → Variables:
- `ANTHROPIC_KEY` — Anthropic API key for font pairing AI

## Design system

This project uses **Tailwind CSS**. Follow the utility class patterns already used in the existing tool pages. Key conventions:

- Containers: `px-8 py-10 lg:px-14`
- Cards/panels: `rounded-xl border border-slate-200 bg-white p-6`
- Inputs: `w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none`
- Primary button: `rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 px-5 py-2.5 text-sm font-medium text-white hover:opacity-90`
- Outline button: `rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:border-purple-300`

## Known constraints

- **No server-side rendering.** Astro is configured for static output. All tool logic runs in the browser via `<script>` blocks.
- **Alpine.js for some tools.** Where Alpine reactivity is used, the `MainLayout` loads it globally. Most tools use vanilla TypeScript in `<script>` blocks.
- **CORS proxies (Brand Assets).** Uses `api.allorigins.win` and `api.codetabs.com`.
- **Font pairing requires the Worker.** `font-pairs.astro` calls `POST /fontpair` — this only works when deployed (or when a local tunnel is set up). It will 404 during `npm run preview`.

## Git commits

Do not add `Co-Authored-By` trailers, session URLs, or any other metadata to commit messages. The commit hash is sufficient for traceability.

## Git workflow

`main` is the production branch.

New tools go on a feature branch:

```bash
git checkout -b feature/<tool-name>
git checkout main
git merge feature/<tool-name>
npm run deploy
```
