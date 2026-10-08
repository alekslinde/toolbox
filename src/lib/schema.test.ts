import { describe, it, expect } from 'vitest';
import {
  slugFromPath,
  softwareApplicationSchema,
  faqSchema,
  breadcrumbSchema,
  websiteSchema,
  toolPageSchemas,
  CATEGORY_LABELS,
  SITE,
} from './schema';
import { tools, toolBySlug } from '@/data/tools';

describe('slugFromPath', () => {
  it('extracts a tool slug', () => {
    expect(slugFromPath('/tools/image-compress')).toBe('image-compress');
    expect(slugFromPath('/tools/image-compress/')).toBe('image-compress');
  });

  it('returns null off the tool routes', () => {
    expect(slugFromPath('/')).toBeNull();
    expect(slugFromPath('/legal')).toBeNull();
    expect(slugFromPath('/tools/')).toBeNull();
    expect(slugFromPath('/tools/a/b')).toBeNull();
  });

  it('rejects slugs the route pattern would not serve', () => {
    // Mirrors the Worker's own slug guard, so schema and routing agree on what
    // counts as a tool page.
    expect(slugFromPath('/tools/Image-Compress')).toBeNull();
    expect(slugFromPath('/tools/9lives')).toBeNull();
  });
});

describe('softwareApplicationSchema', () => {
  const tool = toolBySlug('image-compress')!;
  const schema = softwareApplicationSchema(tool) as Record<string, any>;

  it('is a valid typed node', () => {
    expect(schema['@context']).toBe('https://schema.org');
    expect(schema['@type']).toBe('SoftwareApplication');
  });

  it('derives its fields from the registry', () => {
    expect(schema.name).toBe(tool.title);
    expect(schema.description).toBe(tool.description);
    expect(schema.keywords).toBe(tool.tags.join(', '));
    expect(schema.url).toBe(`${SITE}/tools/${tool.slug}`);
  });

  it('declares the tool free', () => {
    // Without a zero-price Offer the entry reads as unpriced rather than free.
    expect(schema.isAccessibleForFree).toBe(true);
    expect(schema.offers.price).toBe('0');
  });
});

describe('faqSchema', () => {
  it('maps questions to Question/Answer pairs', () => {
    const s = faqSchema([{ question: 'Q1?', answer: 'A1.' }]) as Record<string, any>;
    expect(s['@type']).toBe('FAQPage');
    expect(s.mainEntity).toHaveLength(1);
    expect(s.mainEntity[0]).toMatchObject({
      '@type': 'Question',
      name: 'Q1?',
      acceptedAnswer: { '@type': 'Answer', text: 'A1.' },
    });
  });
});

describe('breadcrumbSchema', () => {
  it('numbers the trail from one', () => {
    const tool = toolBySlug('wcag-contrast')!;
    const s = breadcrumbSchema(tool, CATEGORY_LABELS[tool.category]) as Record<string, any>;
    expect(s.itemListElement.map((i: any) => i.position)).toEqual([1, 2, 3]);
    expect(s.itemListElement[2].name).toBe(tool.title);
  });
});

describe('websiteSchema', () => {
  it('reports the catalogue size it is given', () => {
    const s = websiteSchema(24) as Record<string, any>;
    expect(s['@type']).toBe('WebSite');
    expect(s.description).toContain('24');
  });
});

describe('toolPageSchemas', () => {
  it('returns the full graph for a known tool', () => {
    const got = toolPageSchemas('/tools/color-namer', [{ question: 'Q?', answer: 'A.' }], 'Typography & Color');
    expect(got?.map((s: any) => s['@type'])).toEqual([
      'SoftwareApplication',
      'BreadcrumbList',
      'FAQPage',
    ]);
  });

  it('omits FAQPage when the page has no FAQ', () => {
    // Marking up questions a reader cannot see is a guideline violation, so an
    // absent FAQ must produce no FAQPage node rather than an empty one.
    const got = toolPageSchemas('/tools/color-namer', undefined, 'Typography & Color');
    expect(got?.map((s: any) => s['@type'])).toEqual(['SoftwareApplication', 'BreadcrumbList']);

    const empty = toolPageSchemas('/tools/color-namer', [], 'Typography & Color');
    expect(empty?.map((s: any) => s['@type'])).toEqual(['SoftwareApplication', 'BreadcrumbList']);
  });

  it('returns null for an unknown slug', () => {
    // The [slug] fallback serves placeholders for tools that do not exist yet;
    // those must not claim to be a SoftwareApplication.
    expect(toolPageSchemas('/tools/not-a-tool', [], 'Code & Web')).toBeNull();
    expect(toolPageSchemas('/legal', [], 'Code & Web')).toBeNull();
  });
});

describe('registry coverage', () => {
  it('every tool produces a complete schema', () => {
    const incomplete = tools
      .map((t) => softwareApplicationSchema(t) as Record<string, any>)
      .filter((s) => !s.name || !s.description || !s.keywords || !s.url);
    expect(incomplete).toEqual([]);
  });

  it('every category has a label', () => {
    const unlabelled = tools.filter((t) => !CATEGORY_LABELS[t.category]);
    expect(unlabelled).toEqual([]);
  });

  it('every schema URL points at the canonical host', () => {
    const offsite = tools
      .map((t) => softwareApplicationSchema(t) as Record<string, any>)
      .filter((s) => !s.url.startsWith('https://toolkist.app/tools/'));
    expect(offsite).toEqual([]);
  });
});
