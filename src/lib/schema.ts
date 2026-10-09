import { toolBySlug, type Tool } from '@/data/tools';

export const SITE = 'https://toolkist.app';
export const AUTHOR = 'Aleks Linde';

export interface FaqItem {
  question: string;
  answer: string;
}

/** Pull the tool slug out of a /tools/<slug> pathname, or null elsewhere. */
export function slugFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/tools\/([a-z][a-z0-9-]*)\/?$/);
  return m ? m[1] : null;
}

/**
 * JSON-LD for one tool page.
 *
 * `SoftwareApplication` is the type search engines use for the "free online
 * <x> converter" result shape this site competes for. The registry already
 * carries everything it needs — title, description and tags — so the schema is
 * derived rather than hand-written per page and cannot drift from the catalogue.
 *
 * `offers` at zero price is not decoration: without it the entry is treated as
 * unpriced rather than free, and the free-tool result shape is what we want.
 */
export function softwareApplicationSchema(tool: Tool) {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: tool.title,
    url: `${SITE}/tools/${tool.slug}`,
    description: tool.description,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any',
    browserRequirements: 'Requires JavaScript. Runs in any modern browser.',
    keywords: tool.tags.join(', '),
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    author: {
      '@type': 'Person',
      name: AUTHOR,
      url: 'https://alekslinde.com/',
    },
    publisher: {
      '@type': 'Organization',
      name: 'Toolkist',
      url: SITE,
    },
  };
}

/**
 * JSON-LD for the FAQ already rendered on the page. Every tool page defines the
 * same `faq` array for its visible accordion, so emitting it as structured data
 * costs nothing and makes the answers eligible as rich results.
 *
 * Only emitted when the questions are actually on the page — marking up unseen
 * content is a guideline violation, not a shortcut.
 */
export function faqSchema(faq: FaqItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

/** Breadcrumb trail matching the visible one: All Tools → Category → Tool. */
export function breadcrumbSchema(tool: Tool, categoryLabel: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'All Tools', item: SITE },
      { '@type': 'ListItem', position: 2, name: categoryLabel, item: `${SITE}/#${tool.category}` },
      { '@type': 'ListItem', position: 3, name: tool.title, item: `${SITE}/tools/${tool.slug}` },
    ],
  };
}

/** The site itself, with the on-site search endpoint. Home page only. */
export function websiteSchema(toolCount: number) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Toolkist',
    url: SITE,
    description: `${toolCount} browser-based developer tools. Everything runs locally — no uploads, no account.`,
    author: { '@type': 'Person', name: AUTHOR, url: 'https://alekslinde.com/' },
  };
}

/** The full graph for a tool page, or null when the slug is not a known tool. */
export function toolPageSchemas(
  pathname: string,
  faq: FaqItem[] | undefined,
  categoryLabel: string,
): object[] | null {
  const slug = slugFromPath(pathname);
  if (!slug) return null;
  const tool = toolBySlug(slug);
  if (!tool) return null;

  const graph: object[] = [softwareApplicationSchema(tool), breadcrumbSchema(tool, categoryLabel)];
  if (faq && faq.length) graph.push(faqSchema(faq));
  return graph;
}

export const CATEGORY_LABELS: Record<Tool['category'], string> = {
  images: 'Images & Documents',
  typography: 'Typography & Color',
  code: 'Code & Web',
  text: 'Text & Data',
};
