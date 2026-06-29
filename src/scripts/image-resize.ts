import type { Alpine } from 'alpinejs';

function fmtBytes(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(2) + ' MB';
}
function baseName(name: string): string { return name.replace(/\.[^.]+$/, ''); }

export function imageResizer() {
  return {
    helpful: 0,
    dragOver: false,
    fileLoaded: false,
    processing: false,
    fileInfo: '',
    w: 800,
    h: 600,
    lockAspect: true,
    fit: 'contain',
    format: 'jpeg',
    padColor: '#ffffff',
    padColorHex: '#ffffff',
    origDims: '',
    progress: 0,
    status: '',
    statusType: 'info' as 'ok' | 'err' | 'info',
    previewSrc: '',
    _file: null as File | null,
    _img: null as HTMLImageElement | null,

    // Crop state
    thumbSrc: '',
    thumbScale: 1,
    cropX: 0, cropY: 0, cropW: 0, cropH: 0,
    aspectPreset: null as number | null,
    _drawing: false,
    _dragMode: 'draw' as string,
    _drawAnchor: { x: 0, y: 0 },
    _cropAtDragStart: { x: 0, y: 0, w: 0, h: 0 },
    presets: [
      { label: 'Free',  ratio: null },
      { label: '1∶1',  ratio: 1 },
      { label: '4∶3',  ratio: 4 / 3 },
      { label: '16∶9', ratio: 16 / 9 },
      { label: '3∶2',  ratio: 3 / 2 },
      { label: '9∶16', ratio: 9 / 16 },
      { label: '2∶3',  ratio: 2 / 3 },
    ],

    handleDrop(e: DragEvent) {
      this.dragOver = false;
      const file = e.dataTransfer?.files[0];
      if (file) this._load(file);
    },
    handleFileInput(e: Event) {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this._load(file);
    },

    _load(file: File) {
      this._file = file;
      this.fileInfo = `${file.name} · ${fmtBytes(file.size)}`;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          this._img = img;
          this.w = img.naturalWidth;
          this.h = img.naturalHeight;
          this.origDims = `${img.naturalWidth} × ${img.naturalHeight} px`;
          this.thumbSrc = ev.target!.result as string;
          this.cropW = 0;
          const ext = file.name.split('.').pop()?.toLowerCase() || '';
          this.format = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg';
          this.fileLoaded = true;
          this._setStatus('Loaded — drag thumbnail to crop, then Resize & Download.', 'info');
          (this as any).$nextTick(() => requestAnimationFrame(() => this.onThumbLoad()));
        };
        img.src = ev.target!.result as string;
      };
      reader.readAsDataURL(file);
    },

    onThumbLoad() {
      const img = (this as any).$refs.thumbImg as HTMLImageElement;
      const canvas = (this as any).$refs.cropCanvas as HTMLCanvasElement;
      if (!img || !canvas || !this._img) return;
      let dw = img.clientWidth, dh = img.clientHeight;
      if (dw === 0) {
        const maxH = 288, maxW = img.parentElement?.clientWidth ?? this._img.naturalWidth;
        const s = Math.min(maxW / this._img.naturalWidth, maxH / this._img.naturalHeight, 1);
        dw = Math.round(this._img.naturalWidth * s);
        dh = Math.round(this._img.naturalHeight * s);
      }
      canvas.width = dw; canvas.height = dh;
      canvas.style.width = dw + 'px'; canvas.style.height = dh + 'px';
      this.thumbScale = this._img.naturalWidth / dw;
      this.drawOverlay();
    },

    drawOverlay() {
      const canvas = (this as any).$refs.cropCanvas as HTMLCanvasElement;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (this.cropW < 2 || this.cropH < 2) return;

      const s = this.thumbScale;
      const rx = this.cropX / s, ry = this.cropY / s;
      const rw = this.cropW / s, rh = this.cropH / s;

      // Dark mask; clearRect punches through to the img beneath
      ctx.fillStyle = 'rgba(0,0,0,0.48)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.clearRect(rx, ry, rw, rh);

      // Border + rule-of-thirds
      ctx.strokeStyle = 'rgba(168,85,247,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
      ctx.strokeStyle = 'rgba(168,85,247,0.3)';
      ctx.lineWidth = 0.5;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(rx + rw * i / 3, ry); ctx.lineTo(rx + rw * i / 3, ry + rh); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rx, ry + rh * i / 3); ctx.lineTo(rx + rw, ry + rh * i / 3); ctx.stroke();
      }

      // Corner handles (10 px squares with white outline for contrast)
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#a855f7';
      for (const [hx, hy] of [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]] as [number, number][]) {
        ctx.fillRect(hx - 5, hy - 5, 10, 10);
        ctx.strokeRect(hx - 5, hy - 5, 10, 10);
      }
    },

    // Returns the interaction zone under a thumb-coord point
    _hitTest(x: number, y: number): string {
      if (this.cropW < 2 || this.cropH < 2) return 'draw';
      const s = this.thumbScale;
      const rx = this.cropX / s, ry = this.cropY / s;
      const rw = this.cropW / s, rh = this.cropH / s;
      const R = 10;
      const corners: [string, number, number][] = [
        ['nw', rx,      ry      ],
        ['ne', rx + rw, ry      ],
        ['sw', rx,      ry + rh ],
        ['se', rx + rw, ry + rh ],
      ];
      for (const [name, cx, cy] of corners) {
        if (Math.abs(x - cx) <= R && Math.abs(y - cy) <= R) return name;
      }
      if (x > rx && x < rx + rw && y > ry && y < ry + rh) return 'move';
      return 'draw';
    },

    _getCursor(mode: string): string {
      return ({ draw: 'crosshair', move: 'move', nw: 'nw-resize', ne: 'ne-resize', sw: 'sw-resize', se: 'se-resize' } as Record<string,string>)[mode] ?? 'crosshair';
    },

    startDraw(e: PointerEvent) {
      const canvas = (this as any).$refs.cropCanvas as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      this._dragMode = this._hitTest(x, y);
      this._drawAnchor = { x, y };
      this._cropAtDragStart = { x: this.cropX, y: this.cropY, w: this.cropW, h: this.cropH };
      this._drawing = true;
      canvas.setPointerCapture(e.pointerId);
    },

    onMove(e: PointerEvent) {
      const canvas = (this as any).$refs.cropCanvas as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(canvas.width,  e.clientX - rect.left));
      const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));

      if (!this._drawing) {
        canvas.style.cursor = this._getCursor(this._hitTest(x, y));
        return;
      }

      const s = this.thumbScale;
      const mode = this._dragMode;

      if (mode === 'draw') {
        let rx = Math.min(x, this._drawAnchor.x);
        let ry = Math.min(y, this._drawAnchor.y);
        let rw = Math.abs(x - this._drawAnchor.x);
        let rh = Math.abs(y - this._drawAnchor.y);
        if (this.aspectPreset !== null && rw > 0) {
          rh = rw / this.aspectPreset;
          if (ry + rh > canvas.height) { rh = canvas.height - ry; rw = rh * this.aspectPreset; }
        }
        this.cropX = Math.round(rx * s); this.cropY = Math.round(ry * s);
        this.cropW = Math.round(rw * s); this.cropH = Math.round(rh * s);

      } else if (mode === 'move') {
        const { x: ox, y: oy, w: ow, h: oh } = this._cropAtDragStart;
        const imgW = this._img!.naturalWidth, imgH = this._img!.naturalHeight;
        const dx = (x - this._drawAnchor.x) * s;
        const dy = (y - this._drawAnchor.y) * s;
        this.cropX = Math.round(Math.max(0, Math.min(imgW - ow, ox + dx)));
        this.cropY = Math.round(Math.max(0, Math.min(imgH - oh, oy + dy)));

      } else {
        // Corner resize — anchor is the opposite corner
        const { x: ox, y: oy, w: ow, h: oh } = this._cropAtDragStart;
        const anchorX = (mode === 'nw' || mode === 'sw' ? ox + ow : ox) / s;
        const anchorY = (mode === 'nw' || mode === 'ne' ? oy + oh : oy) / s;
        const fixedLeft = mode === 'nw' || mode === 'sw'; // anchor is on the right
        const fixedTop  = mode === 'nw' || mode === 'ne'; // anchor is at the bottom

        let rw = Math.abs(x - anchorX);
        let rh = this.aspectPreset !== null ? rw / this.aspectPreset : Math.abs(y - anchorY);

        // Clamp so the moving corner stays in-canvas
        const maxW = fixedLeft ? anchorX : canvas.width  - anchorX;
        const maxH = fixedTop  ? anchorY : canvas.height - anchorY;
        rw = Math.min(rw, maxW);
        rh = this.aspectPreset !== null ? rw / this.aspectPreset : Math.min(rh, maxH);
        if (this.aspectPreset !== null && rh > maxH) { rh = maxH; rw = rh * this.aspectPreset; }

        this.cropX = Math.round((fixedLeft ? anchorX - rw : anchorX) * s);
        this.cropY = Math.round((fixedTop  ? anchorY - rh : anchorY) * s);
        this.cropW = Math.round(rw * s);
        this.cropH = Math.round(rh * s);
      }

      if (this.aspectPreset !== null) this.h = Math.round(parseInt(String(this.w)) / this.aspectPreset) || 1;
      this.drawOverlay();
    },

    endDraw(_e: PointerEvent) {
      this._drawing = false;
      if (this.cropW < 4 || this.cropH < 4) { this.cropW = 0; this.cropH = 0; this.drawOverlay(); }
    },

    applyPreset(ratio: number | null) {
      this.aspectPreset = ratio;
      if (ratio === null || !this._img) return;
      const sw = this._img.naturalWidth, sh = this._img.naturalHeight;
      const newH = sw / ratio;
      if (newH <= sh) {
        this.cropX = 0; this.cropY = Math.round((sh - newH) / 2);
        this.cropW = sw; this.cropH = Math.round(newH);
      } else {
        const newW = sh * ratio;
        this.cropX = Math.round((sw - newW) / 2); this.cropY = 0;
        this.cropW = Math.round(newW); this.cropH = sh;
      }
      this.h = Math.round(parseInt(String(this.w)) / ratio) || 1;
      (this as any).$nextTick(() => this.drawOverlay());
    },

    clearCrop() {
      this.cropW = 0; this.cropH = 0; this.aspectPreset = null;
      this.drawOverlay();
    },

    onWChange() {
      if (!this.lockAspect || !this._img) return;
      const v = parseInt(String(this.w));
      if (!v) return;
      this.h = Math.round(v / (this._img.naturalWidth / this._img.naturalHeight)) || 1;
    },
    onHChange() {
      if (!this.lockAspect || !this._img) return;
      const v = parseInt(String(this.h));
      if (!v) return;
      this.w = Math.round(v * (this._img.naturalWidth / this._img.naturalHeight)) || 1;
    },
    syncPadHex(e: Event) {
      const val = (e.target as HTMLInputElement).value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(val)) this.padColor = val;
    },

    async resize() {
      if (!this._img || !this._file) return;
      const tw = parseInt(String(this.w)), th = parseInt(String(this.h));
      if (!tw || !th || tw < 1 || th < 1) { this._setStatus('✕ Enter valid width and height.', 'err'); return; }
      this.processing = true;
      this.progress = 20;
      try {
        let src: CanvasImageSource = this._img;
        let sw = this._img.naturalWidth, sh = this._img.naturalHeight;

        if (this.cropW > 4 && this.cropH > 4) {
          const cc = document.createElement('canvas');
          cc.width = this.cropW; cc.height = this.cropH;
          cc.getContext('2d')!.drawImage(this._img, this.cropX, this.cropY, this.cropW, this.cropH, 0, 0, this.cropW, this.cropH);
          src = cc; sw = this.cropW; sh = this.cropH;
        }

        const canvas = document.createElement('canvas');
        canvas.width = tw; canvas.height = th;
        const ctx = canvas.getContext('2d')!;

        if (this.fit === 'stretch') {
          ctx.drawImage(src, 0, 0, tw, th);
        } else if (this.fit === 'contain') {
          const scale = Math.min(tw / sw, th / sh);
          const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
          ctx.drawImage(src, Math.round((tw - dw) / 2), Math.round((th - dh) / 2), dw, dh);
        } else if (this.fit === 'cover') {
          const scale = Math.max(tw / sw, th / sh);
          const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
          ctx.drawImage(src, Math.round((tw - dw) / 2), Math.round((th - dh) / 2), dw, dh);
        } else if (this.fit === 'pad') {
          ctx.fillStyle = this.padColor;
          ctx.fillRect(0, 0, tw, th);
          const scale = Math.min(tw / sw, th / sh);
          const dw = Math.round(sw * scale), dh = Math.round(sh * scale);
          ctx.drawImage(src, Math.round((tw - dw) / 2), Math.round((th - dh) / 2), dw, dh);
        }

        this.progress = 70;
        const mime = this.format === 'jpeg' ? 'image/jpeg' : this.format === 'webp' ? 'image/webp' : 'image/png';
        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob(res, mime, this.format === 'png' ? undefined : 0.92)
        );
        if (!blob) throw new Error('Encoding failed.');

        const ext2 = this.format === 'jpeg' ? 'jpg' : this.format;
        this.previewSrc = URL.createObjectURL(blob);
        this._dl(blob, `${baseName(this._file.name)}_${tw}x${th}.${ext2}`);
        this.progress = 100;
        this._setStatus(`✓ Resized to ${tw}×${th} (${fmtBytes(blob.size)})`, 'ok');
      } catch (e: any) {
        this._setStatus('✕ ' + e.message, 'err');
      }
      setTimeout(() => { this.progress = 0; }, 1500);
      this.processing = false;
    },

    _setStatus(msg: string, type: 'ok' | 'err' | 'info') { this.status = msg; this.statusType = type; },
    _dl(blob: Blob, name: string) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}

export function registerImageResize(Alpine: Alpine) {
  Alpine.data('imageResizer', imageResizer);
}
