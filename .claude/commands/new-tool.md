Checklist and constraints for scaffolding a new tool in the Astro project.

## 1. Branch

New tools are never built directly on `main`:

```bash
git checkout -b feature/<tool-name>
```

## 2. Files to create / edit

| File | What to do |
|---|---|
| `src/pages/tools/<slug>.astro` | New tool page |
| `src/data/tools.ts` | Add the tool to the `tools` array |

## 3. Tool page structure

Every tool page follows this pattern:

```astro
---
import MainLayout from '@/layouts/MainLayout.astro';
import Breadcrumbs from '@/components/Breadcrumbs.astro';
import QuickTips from '@/components/QuickTips.astro';
import FAQAccordion from '@/components/FAQAccordion.astro';

const tips = [ ... ];   // QuickTips entries
const faq  = [ ... ];   // FAQ entries
---

<MainLayout title="..." description="...">
  <div class="px-8 py-10 lg:px-8 max-w-[1440px] mx-auto">
    <!-- Breadcrumbs + title -->
    <!-- Tool UI -->
    <!-- QuickTips -->
    <!-- About section -->
    <!-- FAQAccordion -->
  </div>
</MainLayout>

<script>
  // Tool logic — plain TypeScript, no import/export of your own modules.
  // Access alpinejs, opentype, PDFLib as globals if needed (see MainLayout for how they're loaded).
</script>
```

## 4. Register in tools.ts

Add to the `tools` array in the correct category section:

```ts
{
  slug: '<slug>',
  title: '<Full Tool Name>',
  shortTitle: '<Short label for nav>',
  description: '<One-sentence description for the home page card.>',
  category: 'images' | 'typography' | 'code',
  tags: ['tag1', 'tag2'],
  icon: 'XX',
},
```

The `slug` must match the filename: `src/pages/tools/<slug>.astro`.

## 5. Register in [slug].astro exclusion list

Open `src/pages/tools/[slug].astro` and add the slug to the `implemented` Set so it uses your dedicated page instead of the fallback:

```ts
const implemented = new Set([
  // ... existing slugs ...
  '<slug>',
]);
```

## 6. Design system — Tailwind utility classes

Use the Tailwind utilities already present in the project. Common patterns from existing tools:
- Input: `class="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"`
- Button primary: `class="rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 px-5 py-2.5 text-sm font-medium text-white"`
- Button outline: `class="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:border-purple-300"`
- Status boxes: use `showSt` pattern from existing tools or inline with Tailwind

## 7. Build and verify

```bash
npm run build
npm run preview
```

Check that the new tool page loads at `/tools/<slug>/` with no console errors.
