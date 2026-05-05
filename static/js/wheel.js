// Single-reel slot machine — pure vanilla JS, no frameworks required.
// Public API: new SpinningWheel(containerId, {onComplete}), setItems(items), spin(), isSpinning

const SLOT_H      = 88;   // px — must match CSS .slot-item height
const SLOT_REPEAT = 20;   // how many times to tile the item list in the virtual reel
const FALLBACK    = '/static/images/sushiro-logo.svg';

class SpinningWheel {
    constructor(containerId, options = {}) {
        this.onComplete = options.onComplete || null;
        this.items      = [];
        this.isSpinning = false;
        this._ci        = 0;  // logical center-index in the long repeated reel

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
        if (this.isSpinning || this.items.length === 0) return;
        this.isSpinning = true;

        const n        = this.items.length;
        const winner   = Math.floor(Math.random() * n);
        const phase    = this._ci % n;
        const cycles   = 5 + Math.floor(Math.random() * 3);  // 5–7 full rotations
        const shift    = ((winner - phase) + n) % n;
        const target   = this._ci + cycles * n + shift;
        const duration = 3000 + Math.random() * 800;         // 3.0–3.8 s

        this._moveTo(target, true, duration);

        setTimeout(() => {
            // Silently snap to the mid-reel position for the same item —
            // all 3 visible rows share the same (index % n), so no visual jump.
            this._ci = Math.floor(SLOT_REPEAT / 2) * n + winner;
            this._moveTo(this._ci, false);
            this.isSpinning = false;
            if (this.onComplete) this.onComplete({ item: this.items[winner], index: winner });
        }, duration);
    }

    // ── Private ───────────────────────────────────────────────────────────────

    _showEmpty() {
        this._reel.style.transition = 'none';
        this._reel.style.transform  = 'translateY(0)';
        this._reel.innerHTML = `
            <div class="slot-item slot-empty">
                <span class="slot-empty-icon">🎰</span>
                <span class="slot-empty-text">เลือกเมนูที่ต้องการ</span>
            </div>`;
    }

    _build() {
        // Tile the item list SLOT_REPEAT times to give the reel room to scroll
        const rows = [];
        for (let i = 0; i < SLOT_REPEAT; i++) rows.push(...this.items);

        this._reel.innerHTML = rows.map(item => this._rowHTML(item)).join('');

        // Start at the middle of the tiled list so spins can go either direction
        this._ci = Math.floor(SLOT_REPEAT / 2) * this.items.length;
        this._moveTo(this._ci, false);
    }

    _rowHTML(item) {
        const isObj    = item.value !== null && typeof item.value === 'object';
        const imgSrc   = (isObj && item.value.image_url) || FALLBACK;
        const brd      = item.color === '#F0F0F0' ? 'border:1.5px solid #BDBDBD;' : '';
        const pricePart = isObj && item.value.price != null
            ? `<div class="slot-meta">
                   <span class="plate-dot-sm" style="background:${item.color};${brd}"></span>
                   <span class="slot-price">฿${item.value.price}</span>
               </div>`
            : '';

        return `
            <div class="slot-item">
                <div class="slot-img-box">
                    <img src="${imgSrc}" class="slot-img" loading="lazy" alt=""
                         onerror="this.onerror=null;this.src='${FALLBACK}'">
                </div>
                <div class="slot-info">
                    <div class="slot-name">${item.label}</div>
                    ${pricePart}
                </div>
            </div>`;
    }

    // Translate the reel so the item at logical index ci sits in the center row.
    // Center row starts at px offset 88 from the top of the 264 px window.
    _moveTo(ci, animate, duration = 3000) {
        const offset = Math.max(0, (ci - 1) * SLOT_H);
        this._reel.style.transition = animate
            ? `transform ${duration}ms cubic-bezier(0.05, 0.9, 0.1, 1.0)`
            : 'none';
        if (!animate) void this._reel.offsetHeight;  // flush layout so 'none' sticks
        this._reel.style.transform = `translateY(-${offset}px)`;
    }
}
