import {
  fetchViaProxy, fetchCSSText, toAbsolute,
  extractAllColoursFromCSS, dedupeColours, isSkippable, hexNorm,
  extractColourPairs, extractFontsFromCSS, extractMeta, extractLogoUrl,
  buildAllIonicColors, contrastText, relativeLuminance, hexToRgb,
  BrandData, BrandColor,
} from '@/lib/brand-extract';

/* ── State ── */
let currentData: BrandData | null = null;

/* ── DOM helpers ── */
function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function showStatus(msg: string, type: 'ok' | 'err' | 'info') {
  const bar = el('statusBar');
  bar.textContent = msg;
  bar.className = 'status ' + type;
}

function hideStatus() {
  el('statusBar').className = 'status hidden';
}

/* ── Extraction pipeline ── */
async function fetchAndExtract(rawUrl: string): Promise<BrandData> {
  let url = rawUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  new URL(url); // throws if invalid

  const domain = new URL(url).hostname.replace(/^www\./, '');

  showStatus('Fetching page HTML…', 'info');
  const html = await fetchViaProxy(url);

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  showStatus('Parsing CSS and extracting assets…', 'info');

  const cssChunks: string[] = [];
  const googleFontLinks: string[] = [];
  doc.querySelectorAll('style').forEach(s => cssChunks.push(s.textContent || ''));
  doc.querySelectorAll('[style]').forEach(el => cssChunks.push(el.getAttribute('style') || ''));

  const sheetLinks = [...doc.querySelectorAll('link[rel="stylesheet"]')]
    .map(l => l.getAttribute('href')).filter(Boolean) as string[];

  for (const href of sheetLinks) {
    const absHref = toAbsolute(href, url);
    if (/fonts\.googleapis\.com/i.test(absHref)) { googleFontLinks.push(absHref); continue; }
    if (cssChunks.length < 8) {
      const text = await fetchCSSText(absHref, url).catch(() => '');
      if (text) cssChunks.push(text);
    }
  }

  const allCSS = cssChunks.join('\n');
  const rawColors = extractAllColoursFromCSS(allCSS);
  const meta = extractMeta(doc);

  if (meta.themeColor && /^#[0-9a-f]{3,6}$/i.test(meta.themeColor)) {
    const tc = hexNorm(meta.themeColor);
    if (!isSkippable(tc)) rawColors.unshift(tc);
  }

  const dedupedColours = dedupeColours(rawColors, 10);
  const colors: BrandColor[] = dedupedColours.map((hex, i) => ({
    hex: hex.toUpperCase(),
    name: ['Primary', 'Secondary', 'Accent', 'Neutral', 'Surface', 'Tint', 'Shade', 'Highlight', 'Muted', 'Dark'][i] || 'Colour ' + (i + 1),
    role: ['primary', 'secondary', 'accent', 'neutral', 'surface', 'tint', 'shade', 'highlight', 'muted', 'dark'][i] || 'accent',
  }));

  const pairs   = extractColourPairs(allCSS, dedupedColours);
  const fonts   = extractFontsFromCSS(allCSS, googleFontLinks);
  const logoUrl    = extractLogoUrl(doc, url, domain);
  const faviconUrl = meta.faviconUrl ? toAbsolute(meta.faviconUrl, url) : `https://${domain}/favicon.ico`;

  const standardIcons = [
    { url: toAbsolute('/apple-touch-icon.png', url), label: 'Apple Icon' },
    { url: toAbsolute('/favicon.svg', url),          label: 'Favicon SVG' },
    { url: toAbsolute('/favicon-32x32.png', url),    label: 'Favicon 32px' },
  ];
  if (meta.ogImage) standardIcons.push({ url: toAbsolute(meta.ogImage, url), label: 'OG Image' });

  const svgImages: Array<{ url: string; label: string }> = [];
  doc.querySelectorAll('svg').forEach((svg, i) => {
    if (svgImages.length >= 12) return;
    try {
      const vb = svg.getAttribute('viewBox') || '';
      const wA = parseInt(svg.getAttribute('width') || '0');
      const hA = parseInt(svg.getAttribute('height') || '0');
      const vbNums = vb.split(/\s+/).map(Number);
      const vbW = vbNums[2] || 0, vbH = vbNums[3] || 0;
      const effectiveW = wA || vbW, effectiveH = hA || vbH;
      if (effectiveW > 0 && effectiveW < 8 && effectiveH > 0 && effectiveH < 8) return;
      const svgStr = new XMLSerializer().serializeToString(svg);
      const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
      const label = svg.getAttribute('aria-label') || svg.querySelector('title')?.textContent || ('SVG ' + (i + 1));
      svgImages.push({ url: dataUrl, label });
    } catch { /* skip */ }
  });

  const imgElements: Array<{ url: string; label: string; priority?: number }> = [];
  doc.querySelectorAll('img[src]').forEach(img => {
    if (imgElements.length >= 16) return;
    const src = img.getAttribute('src') || '';
    if (!src || src.length < 3) return;
    const absUrl = /^data:/i.test(src) ? src : toAbsolute(src, url);
    const alt = img.getAttribute('alt') || '';
    const cls = (img.getAttribute('class') || '') + (img.getAttribute('id') || '');
    const isPriority = /logo|icon|brand|hero|symbol/i.test(alt + cls + src);
    imgElements.push({ url: absUrl, label: alt || 'Image', priority: isPriority ? 0 : 1 });
  });
  imgElements.sort((a, b) => (a.priority ?? 1) - (b.priority ?? 1));

  const bgDataImages: Array<{ url: string; label: string }> = [];
  const bgDataRe = /url\(['"]?(data:image\/(?:svg\+xml|png|jpeg|gif|webp|x-icon)[^'")\s]{1,200000})['"]?\)/g;
  let bgDm;
  while ((bgDm = bgDataRe.exec(allCSS)) !== null && bgDataImages.length < 4) {
    bgDataImages.push({ url: bgDm[1], label: 'CSS Image' });
  }

  const bgHttpImages: Array<{ url: string; label: string }> = [];
  const bgHttpRe = /background(?:-image)?\s*:[^;]*url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g;
  let bgHm;
  while ((bgHm = bgHttpRe.exec(allCSS)) !== null && bgHttpImages.length < 4) {
    bgHttpImages.push({ url: bgHm[1], label: 'BG Image' });
  }

  return {
    name: meta.name || domain,
    domain,
    tagline: meta.desc ? meta.desc.slice(0, 160) : '',
    colors,
    pairs,
    fonts,
    logoUrl,
    faviconUrl,
    standardIcons,
    svgImages,
    imgElements: imgElements.slice(0, 12),
    bgImages: [...bgDataImages, ...bgHttpImages].slice(0, 6),
    meta: {
      description: meta.desc,
      twitter: meta.twitterSite || null,
      themeColor: meta.themeColor || null,
      ogImage: meta.ogImage || null,
    },
  };
}

/* ── Mini preview rendering ── */
function renderPreview(data: BrandData) {
  // Brand header
  const favicon = el<HTMLImageElement>('brandFavicon');
  favicon.src = data.faviconUrl;
  favicon.style.display = '';
  el('brandName').textContent = data.name || data.domain;
  el('brandDomain').textContent = data.domain;

  // Color swatches
  const swatchContainer = el('colorSwatches');
  swatchContainer.innerHTML = '';
  data.colors.forEach(c => {
    const swatch = document.createElement('div');
    swatch.className = 'color-swatch';
    swatch.style.background = c.hex;
    swatch.title = c.hex + ' · ' + c.name;
    const tooltip = document.createElement('div');
    tooltip.className = 'color-swatch-tooltip';
    tooltip.textContent = c.hex;
    swatch.appendChild(tooltip);
    swatchContainer.appendChild(swatch);
  });

  // Font list
  const fontContainer = el('fontList');
  fontContainer.innerHTML = '';
  if (data.fonts.length === 0) {
    fontContainer.innerHTML = '<div style="font-size:11px;color:#94a3b8;font-style:italic;">No custom fonts detected</div>';
  } else {
    data.fonts.forEach(f => {
      const item = document.createElement('div');
      item.className = 'font-item';
      item.innerHTML = `<span class="font-name">${f.name}</span><span class="font-meta">${f.role} · ${f.source}</span>`;
      fontContainer.appendChild(item);
    });
  }

  // Show results panel
  el('resultsPanel').classList.add('visible');
  el('applyBtn').removeAttribute('disabled');
}

/* ── Wire up UI ── */
function init() {
  // Extract button
  el('extractBtn').addEventListener('click', async () => {
    const urlInput = el<HTMLInputElement>('urlInput');
    const rawUrl = urlInput.value.trim();
    if (!rawUrl) {
      showStatus('Enter a URL first.', 'err');
      return;
    }

    const extractBtn = el<HTMLButtonElement>('extractBtn');
    extractBtn.disabled = true;
    extractBtn.textContent = 'Extracting…';
    el('resultsPanel').classList.remove('visible');
    el<HTMLElement>('doneFeedback').className = 'done-feedback';
    currentData = null;

    try {
      const data = await fetchAndExtract(rawUrl);
      currentData = data;
      renderPreview(data);
      showStatus(`✓ Extracted ${data.colors.length} colours, ${data.fonts.length} fonts from ${data.domain}`, 'ok');
    } catch (err: any) {
      showStatus('✕ ' + (err.message || 'Extraction failed'), 'err');
    } finally {
      extractBtn.disabled = false;
      extractBtn.textContent = 'Extract';
    }
  });

  // URL input — Enter key
  el('urlInput').addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') el('extractBtn').click();
  });

  // Apply button
  el('applyBtn').addEventListener('click', () => {
    if (!currentData) return;

    const options = {
      styles:    (el<HTMLInputElement>('optStyles').checked),
      variables: (el<HTMLInputElement>('optVariables').checked),
      frame:     (el<HTMLInputElement>('optFrame').checked),
    };

    const ionicColors = buildAllIonicColors(currentData.colors);

    el<HTMLButtonElement>('applyBtn').disabled = true;
    el<HTMLButtonElement>('applyBtn').textContent = 'Applying…';

    parent.postMessage({
      pluginMessage: {
        type: 'apply',
        data: { ...currentData, ionicColors },
        options,
      }
    }, '*');
  });

  // Close button
  el('closeBtn').addEventListener('click', () => {
    parent.postMessage({ pluginMessage: { type: 'close' } }, '*');
  });

  // Messages from code.ts
  window.addEventListener('message', (event: MessageEvent) => {
    const msg = event.data?.pluginMessage;
    if (!msg) return;

    if (msg.type === 'done') {
      const feedback = el('doneFeedback');
      el<HTMLButtonElement>('applyBtn').disabled = false;
      el<HTMLButtonElement>('applyBtn').textContent = 'Apply to Figma';

      if (msg.success) {
        feedback.textContent = `✓ Applied ${msg.count} item${msg.count !== 1 ? 's' : ''} to Figma`;
        feedback.className = 'done-feedback visible ok';
      } else {
        feedback.textContent = '✕ ' + (msg.error || 'Apply failed');
        feedback.className = 'done-feedback visible err';
      }
    }
  });
}

init();
