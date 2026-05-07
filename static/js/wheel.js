// Canvas spinning wheel.
// Draws N coloured pie segments, each labelled with the item name.
// Animates by rotating the canvas with ease-in-out; pointer is a fixed
// triangle at the top. After each spin the angle is normalised so the
// winner always rests under the pointer.
//
// Public API (unchanged): new SpinningWheel(id, {onComplete}), setItems(items),
//   spin(), isSpinning

const FALLBACK  = '/static/images/sushiro-logo.svg'; // kept for callers that reference it
const SEG_COLORS = [
    '#E53935','#FB8C00','#FDD835','#43A047',
    '#00ACC1','#1E88E5','#8E24AA','#EC407A',
    '#FF7043','#66BB6A','#AB47BC','#29B6F6',
];

// Canvas geometry (all values in px at 360×360 resolution)
const CX = 180, CY = 185, WHEEL_R = 154;

class SpinningWheel {
    constructor(containerId, options = {}) {
        this.onComplete = options.onComplete || null;
        this.items      = [];
        this.isSpinning = false;
        this._raf       = null;
        this._angle     = 0; // cumulative clockwise rotation (radians)

        const el = document.getElementById(containerId);
        el.innerHTML = `<div class="spin-wheel-wrap">
            <canvas class="spin-wheel-canvas" width="360" height="360"></canvas>
        </div>`;

        this._canvas = el.querySelector('.spin-wheel-canvas');
        this._ctx    = this._canvas.getContext('2d');
        this._draw();
    }

    // ── Public ────────────────────────────────────────────────────────────────

    setItems(items) {
        this.items = items;
        if (!this.isSpinning) this._draw();
    }

    spin() {
        if (this.isSpinning || !this.items.length) return;
        this.isSpinning = true;
        cancelAnimationFrame(this._raf);

        const n          = this.items.length;
        const winner     = Math.floor(Math.random() * n);
        const sliceAngle = (2 * Math.PI) / n;
        const extraSpins = 5 + Math.floor(Math.random() * 3); // 5–7 full rotations

        // Canonical rest angle: winner slice centred under pointer (screen top = −π/2).
        // Slice i centre in drawing frame: −π/2 + (i+0.5)·sliceAngle
        // After rotation r: screen_angle = centre + r = −π/2  ⟹  r = −(i+0.5)·sliceAngle (mod 2π)
        const raw            = -(winner + 0.5) * sliceAngle;
        const canonicalTarget = ((raw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

        const currentMod = ((this._angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        let correction   = canonicalTarget - currentMod;
        if (correction < 0) correction += 2 * Math.PI;

        const targetAngle = this._angle + extraSpins * 2 * Math.PI + correction;
        const startAngle  = this._angle;
        const duration    = 3000 + Math.random() * 700; // 3.0–3.7 s
        const startT      = performance.now();

        const tick = (now) => {
            const t     = Math.min((now - startT) / duration, 1);
            const eased = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
            this._angle = startAngle + eased * (targetAngle - startAngle);
            this._draw();

            if (t < 1) {
                this._raf = requestAnimationFrame(tick);
            } else {
                this._angle = canonicalTarget; // normalise to [0, 2π)
                this._draw();
                this.isSpinning = false;
                if (this.onComplete) this.onComplete({ item: this.items[winner], index: winner });
            }
        };

        this._raf = requestAnimationFrame(tick);
    }

    // ── Private ───────────────────────────────────────────────────────────────

    _draw() {
        const ctx = this._ctx;
        ctx.clearRect(0, 0, 360, 360);

        // Shadow behind wheel
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur  = 18;
        ctx.beginPath();
        ctx.arc(CX, CY, WHEEL_R, 0, 2 * Math.PI);
        ctx.fillStyle = '#1A1A2E';
        ctx.fill();
        ctx.restore();

        if (this.items.length > 0) {
            this._drawSegments();
        } else {
            this._drawEmptyLabel();
        }

        // Outer ring (fixed)
        ctx.beginPath();
        ctx.arc(CX, CY, WHEEL_R, 0, 2 * Math.PI);
        ctx.strokeStyle = '#E53935';
        ctx.lineWidth   = 5;
        ctx.stroke();

        // Centre cap (fixed, covers segment point)
        ctx.beginPath();
        ctx.arc(CX, CY, 17, 0, 2 * Math.PI);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#E53935';
        ctx.lineWidth   = 2.5;
        ctx.stroke();

        // Pointer triangle at top (fixed, on top of everything)
        const tipY  = CY - WHEEL_R + 3;
        const baseY = tipY - 22;
        ctx.beginPath();
        ctx.moveTo(CX - 13, baseY);
        ctx.lineTo(CX + 13, baseY);
        ctx.lineTo(CX, tipY);
        ctx.closePath();
        ctx.fillStyle   = '#E53935';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 2;
        ctx.fill();
        ctx.stroke();
    }

    _drawSegments() {
        const ctx        = this._ctx;
        const n          = this.items.length;
        const sliceAngle = (2 * Math.PI) / n;

        // All segments are drawn inside a single save/rotate block so the
        // whole wheel rotates together.
        ctx.save();
        ctx.translate(CX, CY);
        ctx.rotate(this._angle);

        for (let i = 0; i < n; i++) {
            const item   = this.items[i];
            const startA = -Math.PI / 2 + i * sliceAngle;
            const endA   = startA + sliceAngle;
            const midA   = startA + sliceAngle / 2;
            const color  = item.color || SEG_COLORS[i % SEG_COLORS.length];
            const tc     = item.textColor || '#fff';

            // Segment fill
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, WHEEL_R, startA, endA);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.fill();

            // Segment divider line
            ctx.strokeStyle = 'rgba(255,255,255,0.28)';
            ctx.lineWidth   = 1;
            ctx.stroke();

            // Label — hide when segments are too narrow to be useful
            if (n <= 40) {
                const fontSize = Math.max(9, Math.min(14, Math.round(560 / n)));
                ctx.save();
                ctx.rotate(midA);
                ctx.fillStyle    = tc;
                ctx.font         = `bold ${fontSize}px Sarabun, Arial, sans-serif`;
                ctx.textAlign    = 'right';
                ctx.textBaseline = 'middle';

                // Truncate label to fit within the arc width at 72 % radius
                const maxW = sliceAngle * WHEEL_R * 0.72;
                let label = item.label;
                while (label.length > 1 && ctx.measureText(label).width > maxW) {
                    label = label.slice(0, -1);
                }
                if (label.length < item.label.length) label = label.slice(0, -1) + '…';

                ctx.fillText(label, WHEEL_R - 10, 0);
                ctx.restore();
            }
        }

        ctx.restore();
    }

    _drawEmptyLabel() {
        const ctx = this._ctx;
        ctx.fillStyle    = 'rgba(255,255,255,0.38)';
        ctx.font         = 'bold 15px Sarabun, Arial, sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('เลือกเมนูที่ต้องการ', CX, CY);
    }
}
