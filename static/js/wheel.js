// Single-reel slot machine — translateY strip approach.
// Builds REPEATS copies of all items into the DOM once; animates by sliding
// the whole strip with transform:translateY. No per-frame DOM changes.
// After each spin the reel teleports (invisibly) back to repeat-1 so the
// same strip can be used for the next spin indefinitely.

const SLOT_H   = 88;    // px — must match CSS .slot-item height
const REPEATS  = 8;     // strips built upfront; 8 × n items total
const WIN_Y    = SLOT_H; // top of the centre (winning) slot = 88 px from window top
const FALLBACK = '/static/images/sushiro-logo.svg';

class SpinningWheel {
    constructor(containerId, options = {}) {
        this.onComplete = options.onComplete || null;
        this.items      = [];
        this.isSpinning = false;
        this._raf       = null;
        this._offset    = 0;   // current scroll amount (reel moves up by this many px)

        const el = document.getElementById(containerId);
        el.innerHTML = `
            <div class="slot-machine">
                <div class="slot-window">
                    <div class="slot-reel"></div>
                    <div class="slot-fade-top"></div>
                    <div class="slot-fade-bottom"></div>
                    <div class="slot-selector"></div>
                </div>
            </div>`;
        this._reel = el.querySelector('.slot-reel');
        this._showEmpty();
    }

    // ── Public ────────────────────────────────────────────────────────────────

    setItems(items) {
        this.items = items;
        if (this.isSpinning) return;
        items.length === 0 ? this._showEmpty() : this._build();
    }

    spin() {
        if (this.isSpinning || !this.items.length) return;
        this.isSpinning = true;
        cancelAnimationFrame(this._raf);

        const n           = this.items.length;
        const winner      = Math.floor(Math.random() * n);
        const extraLoops  = 3 + Math.floor(Math.random() * 3); // 3–5 full rotations

        // Target offset so winner item lands at WIN_Y in repeat (extraLoops+1)
        // Formula: offset = (repeat * n + winnerIdx) * SLOT_H - WIN_Y
        const targetOffset = (extraLoops + 1) * n * SLOT_H + winner * SLOT_H - WIN_Y;
        const startOffset  = this._offset;

        const duration = 3000 + Math.random() * 700; // 3.0–3.7 s
        const startT   = performance.now();

        const tick = (now) => {
            const t      = Math.min((now - startT) / duration, 1);
            const eased  = this._ease(t);
            const offset = startOffset + eased * (targetOffset - startOffset);
            this._reel.style.transform = `translateY(${-offset}px)`;

            if (t < 1) {
                this._raf = requestAnimationFrame(tick);
            } else {
                // Teleport to repeat-1 equivalent (same visual, resets counter for next spin)
                const resetOffset = n * SLOT_H + winner * SLOT_H - WIN_Y;
                this._offset = resetOffset;
                this._reel.style.transform = `translateY(${-resetOffset}px)`;

                this.isSpinning = false;
                if (this.onComplete) this.onComplete({ item: this.items[winner], index: winner });
            }
        };

        this._raf = requestAnimationFrame(tick);
    }

    // ── Private: animation ────────────────────────────────────────────────────

    // Ease-in-out cubic: slow start → fast middle → slow stop
    _ease(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // ── Private: DOM ──────────────────────────────────────────────────────────

    _showEmpty() {
        cancelAnimationFrame(this._raf);
        this._reel.style.transform = '';
        this._offset = 0;
        this._reel.innerHTML = `
            <div class="slot-empty">
                <span class="slot-empty-icon">🎰</span>
                <span class="slot-empty-text">เลือกเมนูที่ต้องการ</span>
            </div>`;
    }

    _build() {
        cancelAnimationFrame(this._raf);
        const n    = this.items.length;
        const html = [];
        for (let rep = 0; rep < REPEATS; rep++) {
            for (const item of this.items) html.push(this._itemHtml(item));
        }
        this._reel.innerHTML = html.join('');

        // Start position: item 0 of repeat 1 at WIN_Y (so repeat 0 fills the slot above)
        this._offset = n * SLOT_H - WIN_Y;
        this._reel.style.transform = `translateY(${-this._offset}px)`;
    }

    _itemHtml(item) {
        const isObj = item.value !== null && typeof item.value === 'object';

        // Simple (budget) items: no image — show coloured tile with large amount text
        if (!isObj) {
            const tc = item.textColor || '#fff';
            return `<div class="slot-item slot-item-simple" style="background:${item.color}">
                <div class="slot-name slot-name-simple" style="color:${tc}">${item.label}</div>
            </div>`;
        }

        // Menu items: thumbnail + name + price
        const src = item.value.image_url || FALLBACK;
        const brd = item.color === '#F0F0F0' ? 'border:1.5px solid #BDBDBD;' : '';
        const meta = item.value.price != null
            ? `<div class="slot-meta">
                   <span class="plate-dot-sm" style="background:${item.color};${brd}"></span>
                   <span class="slot-price">฿${item.value.price}</span>
               </div>` : '';
        return `<div class="slot-item">
            <div class="slot-img-box">
                <img src="${src}" class="slot-img" loading="eager" alt=""
                     onerror="this.onerror=null;this.src='${FALLBACK}'">
            </div>
            <div class="slot-info">
                <div class="slot-name">${item.label}</div>
                ${meta}
            </div>
        </div>`;
    }
}
