class SpinningWheel {
    constructor(canvasId, options = {}) {
        this.canvas      = document.getElementById(canvasId);
        this.ctx         = this.canvas.getContext('2d');
        this.items       = [];
        this.currentRotation = 0;
        this.isSpinning  = false;
        this.onComplete  = options.onComplete || null;
        this._raf        = null;
        this._resize();
        window.addEventListener('resize', () => this._resize());
    }

    _resize() {
        const parent = this.canvas.parentElement;
        const size   = Math.min(parent.clientWidth - 10, 420);
        this.canvas.width  = size;
        this.canvas.height = size;
        this.draw();
    }

    setItems(items) {
        this.items = items;
        this.currentRotation = 0;
        this.draw();
    }

    // ── Font sizing based on segment count ───────────────────────────────────
    _fontSize(n) {
        if (n === 0)  return 14;
        if (n <= 6)   return 16;
        if (n <= 12)  return 14;
        if (n <= 20)  return 12;
        if (n <= 35)  return 10;
        if (n <= 60)  return 9;
        return 8;
    }

    // ── Pixel-accurate truncation using canvas measureText ────────────────────
    // maxPx: available width in pixels along the radial direction
    _fit(str, maxPx, ctx) {
        if (ctx.measureText(str).width <= maxPx) return str;
        let lo = 1, hi = str.length - 1;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            if (ctx.measureText(str.slice(0, mid) + '…').width <= maxPx) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return str.slice(0, lo) + '…';
    }

    draw() {
        const { ctx, canvas } = this;
        const n  = this.items.length;
        const cx = canvas.width  / 2;
        const cy = canvas.height / 2;
        const r  = Math.min(cx, cy) - 18;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (n === 0) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(cx, cy, r, 0, 2 * Math.PI);
            ctx.fillStyle = '#F5F5F5';
            ctx.fill();
            ctx.strokeStyle = '#E0E0E0';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.fillStyle = '#BDBDBD';
            ctx.font = '16px Sarabun, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('เลือกเมนูที่ต้องการ', cx, cy);
            ctx.restore();
            this._drawPointer(cx, cy, r);
            return;
        }

        const fontSize = this._fontSize(n);
        // Available radial space: from just outside center hub (r=22) to near rim (r-12), minus tiny padding
        const availPx  = r - 12 - 24;   // ≈ 156 px when r=190

        // Outer glow ring
        ctx.save();
        ctx.shadowBlur  = 18;
        ctx.shadowColor = 'rgba(229,57,53,0.25)';
        ctx.beginPath();
        ctx.arc(cx, cy, r + 6, 0, 2 * Math.PI);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.restore();

        const seg = (2 * Math.PI) / n;
        // Thinner divider lines for many items so colours stay visible
        const dividerWidth = n > 30 ? 0.5 : n > 15 ? 1 : 2;

        // Set font once before the loop so measureText is accurate
        ctx.font = `bold ${fontSize}px Sarabun, sans-serif`;

        this.items.forEach((item, i) => {
            const start = -Math.PI / 2 + i * seg + this.currentRotation;
            const end   = start + seg;

            // Segment
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, start, end);
            ctx.closePath();
            ctx.fillStyle   = item.color || this._defaultColor(i);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth   = dividerWidth;
            ctx.stroke();
            ctx.restore();

            // Label — only draw if segment is wide enough for the text to be legible
            const arcH = 2 * (r * 0.55) * Math.sin(seg / 2); // arc height at 55% radius
            if (arcH < fontSize * 0.6) return; // skip text if truly unreadable

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(start + seg / 2);
            ctx.font          = `bold ${fontSize}px Sarabun, sans-serif`;
            ctx.textAlign     = 'right';
            ctx.textBaseline  = 'middle';
            ctx.shadowColor   = 'rgba(0,0,0,0.35)';
            ctx.shadowBlur    = 2;
            ctx.fillStyle     = item.textColor || '#fff';
            const label = this._fit(item.label, availPx, ctx);
            ctx.fillText(label, r - 12, 0);
            ctx.restore();
        });

        // Center hub
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, 2 * Math.PI);
        const g = ctx.createRadialGradient(cx - 4, cy - 4, 0, cx, cy, 22);
        g.addColorStop(0, '#FFFFFF');
        g.addColorStop(1, '#E0E0E0');
        ctx.fillStyle   = g;
        ctx.shadowColor = 'rgba(0,0,0,0.2)';
        ctx.shadowBlur  = 6;
        ctx.fill();
        ctx.strokeStyle = '#BDBDBD';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        ctx.restore();

        this._drawPointer(cx, cy, r);
    }

    _drawPointer(cx, cy, r) {
        const ctx = this.ctx;
        ctx.save();
        ctx.shadowColor   = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur    = 6;
        ctx.shadowOffsetY = 2;
        const tip = cy - r + 2;
        ctx.beginPath();
        ctx.moveTo(cx, tip);
        ctx.lineTo(cx - 12, tip - 22);
        ctx.lineTo(cx + 12, tip - 22);
        ctx.closePath();
        ctx.fillStyle   = '#E53935';
        ctx.fill();
        ctx.strokeStyle = '#B71C1C';
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        ctx.restore();
    }

    _defaultColor(i) {
        const palette = [
            '#E53935','#FB8C00','#FDD835','#43A047',
            '#00ACC1','#1E88E5','#8E24AA','#EC407A',
            '#FF7043','#66BB6A','#29B6F6','#AB47BC',
        ];
        return palette[i % palette.length];
    }

    spin() {
        if (this.isSpinning || this.items.length === 0) return;
        this.isSpinning = true;

        const spins    = Math.floor(Math.random() * 5) + 8;
        const extra    = Math.random() * 2 * Math.PI;
        const total    = spins * 2 * Math.PI + extra;
        const duration = 4500 + Math.random() * 1500;
        const startAngle = this.currentRotation;
        const startTime  = performance.now();

        const tick = (now) => {
            const t = Math.min((now - startTime) / duration, 1);
            this.currentRotation = startAngle + total * this._ease(t);
            this.draw();
            if (t < 1) {
                this._raf = requestAnimationFrame(tick);
            } else {
                this.isSpinning = false;
                if (this.onComplete) this.onComplete(this._winner());
            }
        };
        this._raf = requestAnimationFrame(tick);
    }

    _ease(t) { return 1 - Math.pow(1 - t, 4); }

    _winner() {
        const n   = this.items.length;
        const seg = (2 * Math.PI) / n;
        const rel = ((-this.currentRotation) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        return { item: this.items[Math.floor(rel / seg) % n], index: Math.floor(rel / seg) % n };
    }
}
