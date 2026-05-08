export type Category = 'images' | 'typography' | 'code';

export type Tool = {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  category: Category;
  tags: string[];
  icon: string;
};

export const tools: Tool[] = [
  // ── Images & Documents ────────────────────────────────────────────────────
  {
    slug: 'image-compress',
    title: 'Image Compressor',
    shortTitle: 'Image Tools',
    description: 'Compress PNG, JPG, WebP and SVG files in-browser with live before/after size comparison. No uploads.',
    category: 'images',
    tags: ['compress', 'PNG', 'JPG', 'WebP', 'SVG', 'optimise'],
    icon: 'IMG',
  },
  {
    slug: 'image-resize',
    title: 'Image Resizer',
    shortTitle: 'Image Tools',
    description: 'Resize images to exact pixel dimensions with contain, cover, stretch or pad fit modes.',
    category: 'images',
    tags: ['resize', 'dimensions', 'aspect ratio', 'PNG', 'JPG'],
    icon: 'IMG',
  },
  {
    slug: 'image-convert',
    title: 'Image Converter',
    shortTitle: 'Image Tools',
    description: 'Convert between PNG, JPEG, WebP, AVIF, SVG, HEIC and BMP. All processing happens locally.',
    category: 'images',
    tags: ['convert', 'WebP', 'AVIF', 'HEIC', 'format', 'PNG'],
    icon: 'IMG',
  },
  {
    slug: 'ico-generator',
    title: 'ICO Favicon Generator',
    shortTitle: 'ICO Favicon',
    description: 'Generate a multi-size .ico favicon from PNG, JPG, SVG or WebP. Choose preset or custom sizes.',
    category: 'images',
    tags: ['favicon', 'ICO', 'icon', '16px', '32px', 'browser icon'],
    icon: 'ICO',
  },
  {
    slug: 'pdf-compress',
    title: 'PDF Compressor',
    shortTitle: 'PDF Compress',
    description: 'Compress PDFs across four quality levels with live estimated size shown as you switch.',
    category: 'images',
    tags: ['PDF', 'compress', 'reduce', 'file size', 'deflate'],
    icon: 'PDF',
  },
  {
    slug: 'file-diff',
    title: 'File Diff',
    shortTitle: 'File Diff',
    description: 'Compare any two text, code or PDF files. Highlights every addition, removal and change with inline precision.',
    category: 'images',
    tags: ['diff', 'compare', 'code review', 'text', 'PDF'],
    icon: 'DIFF',
  },
  // ── Typography & Color ────────────────────────────────────────────────────
  {
    slug: 'font-converter',
    title: 'Font Format Converter',
    shortTitle: 'Font Tools',
    description: 'Convert TTF, OTF, WOFF and WOFF2 font files in-browser. Download all formats in one click.',
    category: 'typography',
    tags: ['font', 'TTF', 'OTF', 'WOFF', 'WOFF2', 'convert'],
    icon: 'Aa',
  },
  {
    slug: 'font-inspector',
    title: 'Font Inspector',
    shortTitle: 'Font Tools',
    description: 'Inspect OpenType metadata: classification, weight, designer, license and full glyph set.',
    category: 'typography',
    tags: ['font', 'OpenType', 'metadata', 'glyphs', 'inspect'],
    icon: 'Aa',
  },
  {
    slug: 'font-pairs',
    title: 'Font Pairing Explorer',
    shortTitle: 'Font Tools',
    description: 'Browse curated Google Fonts pairings with live preview text to find the perfect type combination.',
    category: 'typography',
    tags: ['font pairing', 'Google Fonts', 'typography', 'heading', 'body'],
    icon: 'Aa',
  },
  {
    slug: 'wcag-contrast',
    title: 'WCAG Contrast Checker',
    shortTitle: 'Color & WCAG',
    description: 'Check WCAG 2.1 AA and AAA contrast ratios between any two colours with shade suggestions.',
    category: 'typography',
    tags: ['WCAG', 'accessibility', 'a11y', 'contrast', 'HEX', 'colour'],
    icon: 'CLR',
  },
  {
    slug: 'color-palette',
    title: 'Color Palette Generator',
    shortTitle: 'Color & WCAG',
    description: 'Generate harmonious colour palettes from a base colour using HSL-based colour theory rules.',
    category: 'typography',
    tags: ['palette', 'colour', 'HSL', 'complementary', 'analogous'],
    icon: 'CLR',
  },
  {
    slug: 'color-gradient',
    title: 'CSS Gradient Builder',
    shortTitle: 'Color & WCAG',
    description: 'Build linear and radial CSS gradients with a visual editor and copy-ready CSS output.',
    category: 'typography',
    tags: ['gradient', 'CSS', 'linear', 'radial', 'colour stops'],
    icon: 'CLR',
  },
  {
    slug: 'tints-shades',
    title: 'Tints & Shades Generator',
    shortTitle: 'Tints & Shades',
    description: 'Generate tints and shades from any colour with CSS variable and JSON export for design tokens.',
    category: 'typography',
    tags: ['tints', 'shades', 'design tokens', 'CSS variables', 'palette'],
    icon: '◑',
  },
  {
    slug: 'color-namer',
    title: 'Color Namer',
    shortTitle: 'Color Namer',
    description: 'Paste any HEX, RGB or HSL value and find its closest named color using CIE Lab ΔE matching.',
    category: 'typography',
    tags: ['color name', 'hex name', 'css color', 'delta e', 'color lookup', 'Lab color'],
    icon: 'CLR',
  },
  {
    slug: 'color-extractor',
    title: 'Image Dominant Color Extractor',
    shortTitle: 'Color Extractor',
    description: 'Extract dominant colors from any image as HEX, RGB, or HSL. Export as CSS variables, JSON, or Tailwind config.',
    category: 'typography',
    tags: ['dominant color', 'image palette', 'color picker', 'median cut', 'CSS variables', 'design tokens'],
    icon: 'CLR',
  },
  // ── Code & Web ────────────────────────────────────────────────────────────
  {
    slug: 'code-formatter',
    title: 'Code Formatter',
    shortTitle: 'Code Tools',
    description: 'Beautify or minify JavaScript, CSS and HTML with configurable indent and print-width options.',
    category: 'code',
    tags: ['format', 'beautify', 'JS', 'CSS', 'HTML', 'prettier'],
    icon: '{ }',
  },
  {
    slug: 'code-minifier',
    title: 'Code Minifier',
    shortTitle: 'Code Tools',
    description: 'Minify JS, CSS and HTML to reduce bundle size. Shows original vs minified byte counts.',
    category: 'code',
    tags: ['minify', 'compress', 'JS', 'CSS', 'bundle size'],
    icon: '{ }',
  },
  {
    slug: 'scss-compiler',
    title: 'SCSS Compiler',
    shortTitle: 'Code Tools',
    description: 'Compile SCSS to plain CSS in-browser. Supports variables, nesting, mixins and functions.',
    category: 'code',
    tags: ['SCSS', 'Sass', 'CSS', 'compile', 'variables', 'nesting'],
    icon: '{ }',
  },
  {
    slug: 'semantic-html',
    title: 'Semantic HTML Converter',
    shortTitle: 'Code Tools',
    description: 'Replace div-soup with semantic HTML5 elements. Paste markup, get accessible structure back.',
    category: 'code',
    tags: ['semantic', 'HTML5', 'accessibility', 'div-soup', 'section', 'article'],
    icon: '{ }',
  },
  {
    slug: 'brand-assets',
    title: 'Brand Assets Extractor',
    shortTitle: 'Brand Assets',
    description: 'Enter any URL — extract its colour palette, typography, logos and metadata from the page CSS.',
    category: 'code',
    tags: ['brand', 'colours', 'fonts', 'logos', 'CSS', 'extract'],
    icon: 'BRD',
  },
  {
    slug: 'xd-to-figma',
    title: 'XD → Figma Packager',
    shortTitle: 'XD → Figma',
    description: 'Drop XD artboard SVG exports, drag to set screen order, download a numbered ZIP for Figma import.',
    category: 'code',
    tags: ['XD', 'Figma', 'SVG', 'reorder', 'export', 'migration'],
    icon: 'XD',
  },
];

export const toolsByCategory = (cat: Category) => tools.filter((t) => t.category === cat);
export const toolBySlug = (slug: string) => tools.find((t) => t.slug === slug);
