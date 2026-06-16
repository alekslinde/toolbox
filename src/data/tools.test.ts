/**
 * Tool registry & navigation tests.
 *
 * Guards the data that drives the home directory and sidebar: the helper
 * lookups, plus invariants that would silently break the site if violated
 * (duplicate slugs, missing fields, nav categories that match no tool).
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import { tools, toolsByCategory, toolBySlug, type Category } from './tools.js';
import { navCategories } from './nav.js';

const CATEGORIES: Category[] = ['images', 'typography', 'code'];

describe('tools registry', () => {
  it('is non-empty', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it('has unique slugs', () => {
    const slugs = tools.map(t => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('uses url-safe slugs', () => {
    for (const t of tools) {
      expect(t.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('has every required field populated on every tool', () => {
    for (const t of tools) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.shortTitle.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.icon.length).toBeGreaterThan(0);
      expect(t.tags.length).toBeGreaterThan(0);
    }
  });

  it('only uses known categories', () => {
    for (const t of tools) {
      expect(CATEGORIES).toContain(t.category);
    }
  });
});

describe('toolsByCategory', () => {
  it('returns only tools in the requested category', () => {
    for (const cat of CATEGORIES) {
      const result = toolsByCategory(cat);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every(t => t.category === cat)).toBe(true);
    }
  });

  it('partitions the registry exactly across categories', () => {
    const total = CATEGORIES.reduce((sum, cat) => sum + toolsByCategory(cat).length, 0);
    expect(total).toBe(tools.length);
  });

  it('returns an empty array for an unknown category', () => {
    expect(toolsByCategory('nope' as Category)).toEqual([]);
  });
});

describe('toolBySlug', () => {
  it('finds an existing tool', () => {
    const first = tools[0];
    expect(toolBySlug(first.slug)).toBe(first);
  });

  it('returns undefined for an unknown slug', () => {
    expect(toolBySlug('does-not-exist')).toBeUndefined();
  });

  it('resolves every registered slug', () => {
    for (const t of tools) {
      expect(toolBySlug(t.slug)?.slug).toBe(t.slug);
    }
  });
});

describe('navCategories', () => {
  it('has a well-formed entry per nav category', () => {
    for (const c of navCategories) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.href.startsWith('/#')).toBe(true);
      expect(c.matches.length).toBeGreaterThan(0);
    }
  });

  it('every match prefix corresponds to at least one tool route', () => {
    for (const c of navCategories) {
      for (const prefix of c.matches) {
        const slugFragment = prefix.replace('/tools/', '');
        const hit = tools.some(t => t.slug.startsWith(slugFragment));
        expect(hit, `nav prefix "${prefix}" matches no tool`).toBe(true);
      }
    }
  });

  it('routes every tool to exactly one nav category', () => {
    for (const t of tools) {
      const route = `/tools/${t.slug}`;
      const owners = navCategories.filter(c => c.matches.some(m => route.startsWith(m)));
      expect(owners.length, `tool "${t.slug}" matched ${owners.length} nav categories`).toBe(1);
    }
  });
});
