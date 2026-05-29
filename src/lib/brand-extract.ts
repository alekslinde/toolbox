/* ── Brand Assets Extraction — shared utilities ── */

/* ── Types ── */

export interface BrandColor { hex: string; name: string; role: string; }
export interface ColourPair { fg: string; bg: string; count: number; }
export interface BrandFont { name: string; role: string; source: string; sample: string; }
export interface ImageItem { url: string; label: string; priority?: number; }
export interface IonicColor {
  name: string; base: string; shade: string; tint: string;
  rgb: string; contrast: string; contrastRgb: string; fromBrand: boolean;
}
export interface BrandData {
  name: string; domain: string; tagline: string;
  colors: BrandColor[]; pairs: ColourPair[]; fonts: BrandFont[];
  logoUrl: string; faviconUrl: string;
  standardIcons: ImageItem[]; svgImages: ImageItem[]; imgElements: ImageItem[]; bgImages: ImageItem[];
  meta: { description: string; twitter: string | null; themeColor: string | null; ogImage: string | null; };
}

/* ── Constants ── */

export const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

export const HEX_RE  = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
export const RGB_RE  = /rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/g;
export const RGBA_RE = /rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*[\d.]+\s*\)/g;
export const HSL_RE  = /hsl\(\s*(\d{1,3})\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/g;

export const IONIC_SEMANTIC_DEFAULTS: Record<string, string> = {
  success: '#2dd36f',
  warning: '#ffc409',
  danger:  '#eb445a',
  dark:    '#222428',
  medium:  '#92949c',
  light:   '#f4f5f8',
};

/* ── Fetch helpers ── */

export async function fetchViaProxy(url: string): Promise<string> {
  for (const makeProxy of CORS_PROXIES) {
    try {
      const res = await fetch(makeProxy(url), { signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const text = await res.text().catch(() => null);
      if (!text) continue;
      try { const json = JSON.parse(text); if (json?.contents) return json.contents; } catch {}
      if (text.length > 100) return text;
    } catch { /* try next */ }
  }
  throw new Error('Could not fetch the URL. The site may block external requests — try a different URL.');
}

export async function fetchCSSText(cssUrl: string, baseUrl: string): Promise<string> {
  const abs = toAbsolute(cssUrl, baseUrl);
  for (const makeProxy of CORS_PROXIES) {
    try {
      const res = await fetch(makeProxy(abs), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const text = await res.text().catch(() => null);
      if (!text) continue;
      try { const json = JSON.parse(text); if (json?.contents) return json.contents; } catch {}
      return text;
    } catch { /* try next */ }
  }
  return '';
}

export function toAbsolute(href: string, base: string): string {
  if (!href) return '';
  if (/^https?:\/\//i.test(href)) return href;
  try { return new URL(href, base).href; } catch { return href; }
}

/* ── Colour utils ── */

export function hexNorm(h: string): string {
  h = h.replace('#', '').toLowerCase();
  if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  return '#'+h;
}

export function rgbToHex(r: number|string, g: number|string, b: number|string): string {
  return '#'+[r,g,b].map(v=>parseInt(String(v)).toString(16).padStart(2,'0')).join('');
}

export function hslToHex(h: number, s: number, l: number): string {
  s/=100; l/=100; h/=360;
  const q = l<0.5?l*(1+s):l+s-l*s, p=2*l-q;
  const hue = (p: number,q: number,t: number) => {
    if(t<0)t++;if(t>1)t--;
    if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p;
  };
  return rgbToHex(Math.round(hue(p,q,h+1/3)*255),Math.round(hue(p,q,h)*255),Math.round(hue(p,q,h-1/3)*255));
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#','');
  return { r:parseInt(h.slice(0,2),16), g:parseInt(h.slice(2,4),16), b:parseInt(h.slice(4,6),16) };
}

export function colourDist(a: string, b: string): number {
  const A=hexToRgb(a), B=hexToRgb(b);
  return Math.abs(A.r-B.r)+Math.abs(A.g-B.g)+Math.abs(A.b-B.b);
}

export function relativeLuminance(hex: string): number {
  const {r,g,b} = hexToRgb(hex);
  const lin = (v: number) => { v/=255; return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4); };
  return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1=relativeLuminance(hex1), l2=relativeLuminance(hex2);
  return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
}

export function wcagLabel(ratio: number): { level: string; cls: string } {
  if (ratio >= 7)   return { level:'AAA', cls:'combo-aaa' };
  if (ratio >= 4.5) return { level:'AA',  cls:'combo-aa'  };
  if (ratio >= 3.0) return { level:'AA Large', cls:'combo-aa-lg' };
  return { level:'Fail', cls:'combo-fail' };
}

export function isSkippable(hex: string): boolean {
  if (!hex || hex.length !== 7) return true;
  const {r,g,b} = hexToRgb(hex);
  const lum = (r+g+b)/3;
  return lum > 245 || lum < 8;
}

export function contrastText(hex: string): string {
  return relativeLuminance(hex.toLowerCase()) > 0.35 ? '#1a1817' : '#ffffff';
}

export function extractAllColoursFromCSS(css: string): string[] {
  const freq: Record<string,number> = {};
  const add = (hex: string) => { if (!isSkippable(hex)) freq[hex] = (freq[hex]||0)+1; };
  css.replace(HEX_RE,  (_, h) => { add(hexNorm('#'+h)); return _; });
  css.replace(RGB_RE,  (_, r,g,b) => { add(rgbToHex(r,g,b)); return _; });
  css.replace(RGBA_RE, (_, r,g,b) => { add(rgbToHex(r,g,b)); return _; });
  css.replace(HSL_RE,  (_, h,s,l) => { add(hslToHex(+h,+s,+l)); return _; });
  css.replace(/--(color|clr|colour|brand|primary|secondary|accent|bg|background|text|foreground|surface)[^:]*:\s*([^;}\n]+)/gi, (_:string,_n:string,val:string) => {
    val.replace(HEX_RE,  (_:string,h:string)     => { add(hexNorm('#'+h)); return _; });
    val.replace(RGB_RE,  (_:string,r:string,g:string,b:string) => { add(rgbToHex(r,g,b)); return _; });
    return _;
  });
  return Object.entries(freq).sort((a,b)=>b[1]-a[1]).map(([hex])=>hex);
}

export function dedupeColours(colours: string[], max=10): string[] {
  const kept: string[] = [];
  for (const hex of colours) {
    if (kept.length >= max) break;
    if (!kept.some(k => colourDist(k,hex) < 28)) kept.push(hex);
  }
  return kept;
}

export function firstHex(val: string): string | null {
  const m = val.match(HEX_RE);
  if (m) return hexNorm(m[0]);
  const r = val.match(RGB_RE);
  if (r) { const parts=r[0].match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)||[]; return parts[1]?rgbToHex(parts[1],parts[2],parts[3]):null; }
  return null;
}

export function extractColourPairs(css: string, _knownColours: string[]): Array<{fg:string;bg:string;count:number}> {
  const pairs = new Map<string,number>();
  const blocks = css.split('}');
  for (const block of blocks) {
    const braceIdx = block.indexOf('{');
    if (braceIdx < 0) continue;
    const decls = block.slice(braceIdx+1);
    const found: string[] = [];
    decls.replace(HEX_RE,  (_:string, h:string) => { const c=hexNorm('#'+h); if (!isSkippable(c)) found.push(c); return _; });
    decls.replace(RGB_RE,  (_:string, r:string,g:string,b:string) => { const c=rgbToHex(r,g,b); if (!isSkippable(c)) found.push(c); return _; });
    decls.replace(RGBA_RE, (_:string, r:string,g:string,b:string) => { const c=rgbToHex(r,g,b); if (!isSkippable(c)) found.push(c); return _; });
    if (found.length < 2) continue;
    let fg: string|null=null, bg: string|null=null, border: string|null=null;
    decls.replace(/\bcolor\s*:\s*([^;]+)/gi,            (_:string, v:string) => { const c=firstHex(v); if(c) fg=c; return _; });
    decls.replace(/\bbackground(?:-color)?\s*:\s*([^;]+)/gi, (_:string,v:string) => { const c=firstHex(v); if(c) bg=c; return _; });
    decls.replace(/\bborder(?:-color)?\s*:\s*([^;]+)/gi, (_:string,v:string) => { const c=firstHex(v); if(c) border=c; return _; });
    if (fg && bg && fg!==bg) { const key=fg+'|'+bg; pairs.set(key,(pairs.get(key)||0)+1); }
    if (fg && border && fg!==border) { const key=fg+'|'+border; pairs.set(key,(pairs.get(key)||0)+1); }
  }
  return [...pairs.entries()]
    .sort((a,b)=>b[1]-a[1]).slice(0,8)
    .map(([key, count]) => { const [fg,bg]=key.split('|'); return { fg, bg, count }; })
    .filter(p => contrastRatio(p.fg,p.bg) > 1.2);
}

export function extractFontsFromCSS(css: string, googleFontLinks: string[]): Array<{name:string;role:string;source:string;sample:string}> {
  const found = new Map<string,{source:string;role:string}>();
  googleFontLinks.forEach(href => {
    const m = href.match(/family=([^&:;]+)/i);
    if (m) {
      const name = decodeURIComponent(m[1]).replace(/\+/g,' ').split(':')[0].trim();
      if (name && !found.has(name)) found.set(name, { source:'Google Fonts', role:'body' });
    }
  });
  css.replace(/font-family\s*:\s*([^;}{]+)/gi, (_:string,val:string) => {
    val.split(',').forEach(part => {
      let name = part.trim().replace(/^['"]|['"]$/g,'').trim();
      if (!name || /^(inherit|initial|unset|sans-serif|serif|monospace|cursive|fantasy|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|BlinkMacSystemFont|Arial|Helvetica|Georgia|Times|Verdana|Tahoma|Trebuchet|Impact)$/i.test(name)) return;
      if (!found.has(name)) found.set(name, { source:'Custom', role:'body' });
    });
    return _;
  });
  css.replace(/@import\s+url\(['"]?(https:\/\/fonts\.googleapis\.com[^'")\s]+)['"]?\)/gi, (_:string,href:string) => {
    const m = href.match(/family=([^&:;]+)/i);
    if (m) {
      const name = decodeURIComponent(m[1]).replace(/\+/g,' ').split(':')[0].trim();
      if (name && !found.has(name)) found.set(name, { source:'Google Fonts', role:'body' });
    }
    return _;
  });
  css.replace(/h[1-6][^{]*\{[^}]*font-family\s*:\s*['"]?([^'";,}]+)/gi, (_:string,name:string) => {
    name=name.trim().replace(/^['"]|['"]$/g,'').trim();
    if (found.has(name)) found.get(name)!.role='heading';
    return _;
  });
  css.replace(/(?:code|pre|kbd|samp)[^{]*\{[^}]*font-family\s*:\s*['"]?([^'";,}]+)/gi, (_:string,name:string) => {
    name=name.trim().replace(/^['"]|['"]$/g,'').trim();
    if (found.has(name)) found.get(name)!.role='mono';
    return _;
  });
  css.replace(/(?:body|p|main)[^{]*\{[^}]*font-family\s*:\s*['"]?([^'";,}]+)/gi, (_:string,name:string) => {
    name=name.trim().replace(/^['"]|['"]$/g,'').trim();
    if (found.has(name)) found.get(name)!.role='body';
    return _;
  });
  const arr = [...found.entries()];
  if (arr.length===1) arr[0][1].role='heading';
  if (arr.length>=2 && arr[0][1].role===arr[1][1].role) arr[1][1].role='body';
  return arr.slice(0,5).map(([name,info])=>({ name, role:info.role, source:info.source, sample:'Aa Bb Cc 123' }));
}

export function extractMeta(doc: Document): { name:string;desc:string;themeColor:string;faviconUrl:string;ogImage:string;twitterSite:string } {
  const get  = (sel: string) => doc.querySelector(sel)?.getAttribute('content') || '';
  const getH = (sel: string) => doc.querySelector(sel)?.getAttribute('href') || '';
  const name = get('meta[property="og:site_name"]') || get('meta[name="application-name"]') ||
               doc.querySelector('title')?.textContent?.split(/[|\-–—]/)[0]?.trim() || '';
  const desc = get('meta[property="og:description"]') || get('meta[name="description"]') || '';
  const themeColor = get('meta[name="theme-color"]') || get('meta[name="msapplication-TileColor"]') || '';
  let faviconUrl = '';
  for (const sel of ['link[rel="icon"][type="image/svg+xml"]','link[rel="shortcut icon"]','link[rel="icon"]','link[rel="apple-touch-icon"]']) {
    const h = getH(sel); if (h) { faviconUrl=h; break; }
  }
  return { name, desc, themeColor, faviconUrl,
           ogImage: get('meta[property="og:image"]') || '',
           twitterSite: get('meta[name="twitter:site"]') || '' };
}

export function extractLogoUrl(doc: Document, baseUrl: string, domain: string): string {
  const logoLink = doc.querySelector('link[rel~="logo"]')?.getAttribute('href');
  if (logoLink) return toAbsolute(logoLink, baseUrl);
  for (const el of [...doc.querySelectorAll('img, svg')]) {
    const src = el.getAttribute('src') || '';
    const combined = src + (el.getAttribute('alt')||'') + (el.getAttribute('class')||'') + (el.getAttribute('id')||'');
    if (/logo/i.test(combined) && src) return toAbsolute(src, baseUrl);
  }
  return 'https://'+domain+'/logo.svg';
}

/* ── Ionic palette ── */

export function darkenHex(hex: string, amount=0.12): string {
  const {r,g,b} = hexToRgb(hex);
  return rgbToHex(Math.round(r*(1-amount)), Math.round(g*(1-amount)), Math.round(b*(1-amount)));
}

export function lightenHex(hex: string, amount=0.10): string {
  const {r,g,b} = hexToRgb(hex);
  return rgbToHex(Math.min(255,Math.round(r+(255-r)*amount)), Math.min(255,Math.round(g+(255-g)*amount)), Math.min(255,Math.round(b+(255-b)*amount)));
}

export function buildIonicColor(name: string, hex: string): Omit<IonicColor, 'fromBrand'> {
  const base  = hex.toUpperCase();
  const shade = darkenHex(hex).toUpperCase();
  const tint  = lightenHex(hex).toUpperCase();
  const {r,g,b} = hexToRgb(hex);
  const contrast = contrastText(hex).toUpperCase();
  const cRgb = hexToRgb(contrast === '#FFFFFF' ? '#ffffff' : '#1a1817');
  return { name, base, shade, tint, rgb:`${r}, ${g}, ${b}`, contrast, contrastRgb:`${cRgb.r}, ${cRgb.g}, ${cRgb.b}` };
}

export function buildAllIonicColors(colors: BrandColor[]): IonicColor[] {
  const brandDefaults = ['#3880ff', '#3dc2ff', '#5260ff'];
  const allIonicColors: IonicColor[] = [];
  ['primary','secondary','tertiary'].forEach((role, i) => {
    const hex = colors[i] ? colors[i].hex.toLowerCase() : brandDefaults[i];
    allIonicColors.push({ ...buildIonicColor(role, hex), fromBrand: !!colors[i] });
  });
  Object.entries(IONIC_SEMANTIC_DEFAULTS).forEach(([name, defaultHex]) => {
    allIonicColors.push({ ...buildIonicColor(name, defaultHex), fromBrand: false });
  });
  return allIonicColors;
}
