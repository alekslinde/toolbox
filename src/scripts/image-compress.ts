import type { Alpine } from 'alpinejs';
import { fmtBytes, baseName, extOf, replaceUntilStable } from '@/lib/utils';
import { wireDropZone } from '@/lib/file-dropzone';

export function imageCompressor() {
  return {
    // state
    helpful:       0,
    fileLoaded:    false,
    processing:    false,
    format:        'jpeg',
    quality:       82,
    pngReduce:     false,
    pngColors:     256,
    pngWarning:    '',
    maxDim:        '',
    origSize:      '',
    outSize:       '',
    origDims:      '',
    outDims:       '',
    progress:      0,
    status:        '',
    statusType:    'info' as 'ok' | 'err' | 'info',
    previewSrc:    '',
    savingBadge:   '',
    savingPositive: true,

    // internal
    _file:    null as File | null,
    _img:     null as HTMLImageElement | null,
    _isSvg:   false,
    _svgText: '',
    _srcSize: 0,

    init() {
      wireDropZone('ic-drop', {
        onFile: (file) => { this._loadFile(file); },
        onClear: () => { this._clear(); },
        typeLabel: (file) =>
          file.type === 'image/svg+xml' || extOf(file.name) === 'svg'
            ? 'SVG vector'
            : `${extOf(file.name).toUpperCase()} image`,
      });
    },

    _clear() {
      this._file = null;
      this._img = null;
      this._isSvg = false;
      this._svgText = '';
      this._srcSize = 0;
      this.fileLoaded = false;
      this.pngWarning = '';
      this.previewSrc = '';
      this.status = '';
      this.savingBadge = '';
    },

    onFormatChange() {
      // no-op — reactivity handles UI show/hide
    },

    _loadFile(file: File) {
      const isSvg = file.type === 'image/svg+xml' || extOf(file.name) === 'svg';
      this._file  = file;
      this._srcSize = file.size;
      this._isSvg = isSvg;
      this.pngWarning = '';

      if (isSvg) {
        const reader = new FileReader();
        reader.onload = (e) => {
          this._svgText = e.target!.result as string;
          this._img = null;
          this.format   = 'svg';
          this.origSize = fmtBytes(file.size);
          this.origDims = 'SVG (vector)';
          this.fileLoaded = true;
          this.previewSrc = URL.createObjectURL(file);
          this._setStatus('SVG loaded — click to minify.', 'info');
        };
        reader.readAsText(file);
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            this._img = img;
            const ext = extOf(file.name);
            this.format   = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg';
            this.origSize = fmtBytes(file.size);
            this.origDims = `${img.naturalWidth}×${img.naturalHeight}`;
            this.fileLoaded = true;
            this.previewSrc = e.target!.result as string;
            this._setStatus('Loaded — adjust settings and click Preview & Download.', 'info');
            if (ext === 'png') this._inspectPng(file);
          };
          img.src = e.target!.result as string;
        };
        reader.readAsDataURL(file);
      }
    },

    // Inspect a loaded PNG's header to warn up front when a lossless
    // (truecolor) re-encode would enlarge it — e.g. it's already indexed.
    async _inspectPng(file: File) {
      try {
        const { parsePngInfo, wouldLosslessReencodeGrow } = await import('@/lib/png-info');
        const bytes = new Uint8Array(await file.arrayBuffer());
        const info = parsePngInfo(bytes);
        if (!info) return;
        if (wouldLosslessReencodeGrow(info)) {
          const kind = info.isPalette
            ? `already a ${info.paletteColors ?? '≤256'}-colour palette PNG`
            : info.bitDepth < 8 ? `already a ${info.bitDepth}-bit PNG`
            : 'a grayscale PNG';
          this.pngWarning = `This is ${kind}. A lossless PNG re-encode will likely be larger — enable “Reduce colors”, convert to WebP, or keep the original.`;
        }
      } catch { /* inspection is best-effort — never block the tool */ }
    },

    async compress() {
      if (!this._file) return;
      this.processing = true;
      this.progress   = 20;

      try {
        if (this.format === 'svg' || this._isSvg) {
          const svg  = this._svgText;
          const orig = new TextEncoder().encode(svg).length;
          const min  = replaceUntilStable(svg, /<!--[\s\S]*?-->/g, '')
            .replace(/<\?xml[^>]*\?>/g, '')
            .replace(/<metadata[\s\S]*?<\/metadata>/g, '')
            .replace(/<title>[^<]*<\/title>/g, '')
            .replace(/<desc>[^<]*<\/desc>/g, '')
            .replace(/\s*\n\s*/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .replace(/>\s+</g, '><')
            .replace(/\s*=\s*/g, '=')
            .replace(/"\s+/g, '" ')
            .replace(/\s+"/g, ' "')
            .replace(/\s*\/>/g, '/>')
            .trim();

          this.progress = 80;
          const outBytes = new TextEncoder().encode(min).length;
          this.outSize  = fmtBytes(outBytes);
          this.outDims  = 'SVG (vector)';
          this._setSaving(orig, outBytes);

          const blob = new Blob([min], { type: 'image/svg+xml' });
          this.previewSrc = URL.createObjectURL(blob);
          this._download(blob, baseName(this._file.name) + '_min.svg');
          this.progress = 100;
          this._setStatus(`✓ SVG minified — saved ${fmtBytes(orig - outBytes)}`, 'ok');

        } else {
          if (!this._img) throw new Error('No image loaded.');
          const q      = parseInt(String(this.quality)) / 100;
          const maxDim = this.maxDim ? parseInt(String(this.maxDim)) : null;
          const sw = this._img.naturalWidth, sh = this._img.naturalHeight;
          let ow = sw, oh = sh;
          if (maxDim && (sw > maxDim || sh > maxDim)) {
            const ratio = Math.min(maxDim / sw, maxDim / sh);
            ow = Math.round(sw * ratio);
            oh = Math.round(sh * ratio);
          }

          const canvas = document.createElement('canvas');
          canvas.width = ow; canvas.height = oh;
          const ctx = canvas.getContext('2d')!;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(this._img, 0, 0, ow, oh);
          this.progress = 60;

          let blob: Blob | null;
          if (this.format === 'png' && this.pngReduce) {
            // Lossy palette PNG via UPNG (reduces to N colors).
            const { default: UPNG } = await import('upng-js');
            const rgba = ctx.getImageData(0, 0, ow, oh).data;
            const colors = Math.min(256, Math.max(2, parseInt(String(this.pngColors)) || 256));
            const png = UPNG.encode([rgba.buffer], ow, oh, colors);
            blob = new Blob([png], { type: 'image/png' });
          } else {
            const mime = this.format === 'jpeg' ? 'image/jpeg'
                       : this.format === 'webp' ? 'image/webp'
                       : 'image/png';
            blob = await new Promise<Blob | null>((res) =>
              canvas.toBlob(res, mime, this.format === 'png' ? undefined : q)
            );
          }
          if (!blob) throw new Error('Encoding failed.');

          this.progress = 85;

          // Keep-smaller guard: re-encoding can enlarge an already-optimised
          // file (esp. lossless PNG→PNG). If the output isn't smaller AND we
          // stayed in the same format at full resolution, hand back the
          // untouched original rather than a bigger "compressed" file.
          const sameFormat = extOf(this._file.name) === (this.format === 'jpeg' ? 'jpg' : this.format)
                          || (this.format === 'jpeg' && extOf(this._file.name) === 'jpeg');
          const resized = ow !== sw || oh !== sh;
          let ext2 = this.format === 'jpeg' ? 'jpg' : this.format;
          let downloadName = baseName(this._file.name) + `_opt.${ext2}`;

          if (blob.size >= this._srcSize && sameFormat && !resized) {
            blob = this._file;
            ext2 = extOf(this._file.name);
            downloadName = this._file.name;
            this.outSize = fmtBytes(blob.size);
            this.outDims = `${ow}×${oh}`;
            this._setSaving(this._srcSize, blob.size);
            this.previewSrc = URL.createObjectURL(blob);
            this._download(blob, downloadName);
            this.progress = 100;
            this._setStatus('✓ Original was already optimal — kept as-is.', 'ok');
          } else {
            this.outSize  = fmtBytes(blob.size);
            this.outDims  = `${ow}×${oh}`;
            this._setSaving(this._srcSize, blob.size);
            this.previewSrc = URL.createObjectURL(blob);
            this._download(blob, downloadName);
            this.progress = 100;
            this._setStatus(`✓ Downloaded (${fmtBytes(blob.size)})`, 'ok');
          }
        }
      } catch (e: any) {
        this._setStatus(`✕ ${e.message}`, 'err');
      }

      setTimeout(() => { this.progress = 0; }, 1500);
      this.processing = false;
    },

    _setSaving(orig: number, out: number) {
      const saving = orig - out;
      const pct    = ((saving / orig) * 100).toFixed(1);
      this.savingPositive = saving > 0;
      this.savingBadge = saving > 0
        ? `↓ ${pct}% smaller`
        : `↑ ${Math.abs(parseFloat(pct))}% larger`;
    },

    _setStatus(msg: string, type: 'ok' | 'err' | 'info') {
      this.status     = msg;
      this.statusType = type;
    },

    _download(blob: Blob, name: string) {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    },
  };
}

export function registerImageCompress(Alpine: Alpine) {
  Alpine.data('imageCompressor', imageCompressor);
}
