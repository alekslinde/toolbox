import type { Alpine } from 'alpinejs';

function fmtBytes(b: number): string {
  if (b < 1024)       return b + ' B';
  if (b < 1048576)    return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

function extOf(name: string): string {
  return (name.split('.').pop() || '').toLowerCase();
}

export function imageCompressor() {
  return {
    // state
    helpful:       0,
    dragOver:      false,
    fileLoaded:    false,
    processing:    false,
    fileInfo:      '',
    format:        'jpeg',
    quality:       82,
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

    handleDrop(e: DragEvent) {
      this.dragOver = false;
      const file = e.dataTransfer?.files[0];
      if (file) this._loadFile(file);
    },

    handleFileInput(e: Event) {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this._loadFile(file);
    },

    onFormatChange() {
      // no-op — reactivity handles UI show/hide
    },

    _loadFile(file: File) {
      const isSvg = file.type === 'image/svg+xml' || extOf(file.name) === 'svg';
      this._file  = file;
      this._srcSize = file.size;
      this._isSvg = isSvg;
      this.fileInfo = `${file.name} · ${fmtBytes(file.size)}`;

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
          };
          img.src = e.target!.result as string;
        };
        reader.readAsDataURL(file);
      }
    },

    async compress() {
      if (!this._file) return;
      this.processing = true;
      this.progress   = 20;

      try {
        if (this.format === 'svg' || this._isSvg) {
          const svg  = this._svgText;
          const orig = new TextEncoder().encode(svg).length;
          const min  = svg
            .replace(/<!--[\s\S]*?-->/g, '')
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

          const mime = this.format === 'jpeg' ? 'image/jpeg'
                     : this.format === 'webp' ? 'image/webp'
                     : 'image/png';
          const blob = await new Promise<Blob | null>((res) =>
            canvas.toBlob(res, mime, this.format === 'png' ? undefined : q)
          );
          if (!blob) throw new Error('Encoding failed.');

          this.progress = 85;
          this.outSize  = fmtBytes(blob.size);
          this.outDims  = `${ow}×${oh}`;
          this._setSaving(this._srcSize, blob.size);

          const ext2 = this.format === 'jpeg' ? 'jpg' : this.format;
          this.previewSrc = URL.createObjectURL(blob);
          this._download(blob, baseName(this._file.name) + `_opt.${ext2}`);
          this.progress = 100;
          this._setStatus(`✓ Downloaded (${fmtBytes(blob.size)})`, 'ok');
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
