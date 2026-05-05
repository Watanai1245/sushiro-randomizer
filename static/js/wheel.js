// Single-reel slot machine — replaces the canvas spinning wheel.
// Public API is identical: new SpinningWheel(id, {onComplete}), setItems(items), spin(), isSpinning.

const SLOT_H      = 88;   // px — must match CSS .slot-item height
const SLOT_REPEAT = 20;   // times to repeat item list in the DOM reel

class SpinningWheel {
    constructor(containerId, options = {}) {
        this.el         = document.getElementById(containerId);
        this.onComplete = options.onComplete || null;
        this.items      = [];
        this.isSpinning = false;
        this._ci        = 0; // logical center-index inside the long reel

        this.el.innerHTML = `
            <div class="slot-machine">
                <div class="slot-window">
                    <div class="slot-reel"></div>
                    <div class="slot-fade-top"></div>
                    <div class="slot-fade-bottom"></div>
                    <div class="slot-selector"></div>
                </div>
            </div>`;
        this.reel = this.el.querySelector('.slot-reel');
        this._showEmpty();
    }

    setItems(items) {
        this.items = items;
        if (this.isSpinning) return;
        items.length === 0 ? this._showEmpty() : this._build();
    }

    _showEmpty() {
        this.reel.style.transition = 'none';
        this.reel.style.transform  = 'translateY(0)';
        this.reel.innerHTML = `
            <div class="slot-item slot-empty">
                <span class="slot-empty-icon">🍣</span>
                <span class="slot-empty-text">เลือกเมนูที่ต้องการ</span>
            </div>`;
    }

    _build() {
        const n = this.items.length;
        const rows = [];
        for (let i = 0; i < SLOT_REPEAT; i++) rows.push(...this.items);

        this.reel.innerHTML = rows.map(item => {
            const brd = item.color === '#F0F0F0' ? 'border:1.5px solid #BDBDBD' : '';
            return `<div class="slot-item">
                <div class="slot-img-box">
                    <span class="slot-img-fallback">🍣</span>
                    <img src="${item.value.image_url || ''}" class="slot-img"
                         loading="lazy" alt="" onerror="this.style.opacity='0'">
                </div>
                <div class="slot-info">
                    <div class="slot-name">${item.label}</div>
                    <div class="slot-meta">
                        <span class="plate-dot-sm" style="background:${item.color};${brd}"></span>
                        <span class="slot-price">฿${item.value.price}</span>
                    </div>
                </div>
            </div>`;
        }).join('');

        // Center at the midpoint of the repeated list so spins have room both ways
        this._ci = Math.floor(SLOT_REPEAT / 2) * n;
        this._moveTo(this._ci, false);
    }

    // Translate the reel so item at index ci appears in the center slot
    _moveTo(ci, animate, duration = 3000) {
        const top = Math.max(0, (ci - 1) * SLOT_H);
        this.reel.style.transition = animate
            ? `transform ${duration}ms cubic-bezier(0.05, 0.9, 0.1, 1.0)`
            : 'none';
        if (!animate) void this.reel.offsetHeight; // force reflow so 'none' takes effect
        this.reel.style.transform = `translateY(-${top}px)`;
    }

    spin() {
        if (this.isSpinning || this.items.length === 0) return;
        this.isSpinning = true;

        const n        = this.items.length;
        const winner   = Math.floor(Math.random() * n);
        const phase    = this._ci % n;
        const cycles   = 4 + Math.floor(Math.random() * 3); // 4-6 full rotations
        const shift    = ((winner - phase) + n) % n;
        const target   = this._ci + cycles * n + shift;
        const duration = 2800 + Math.random() * 700;

        this._moveTo(target, true, duration);

        setTimeout(() => {
            // Reset to mid-reel showing same item — visually invisible (top/center/bottom match)
            this._ci = Math.floor(SLOT_REPEAT / 2) * n + winner;
            this._moveTo(this._ci, false);
            this.isSpinning = false;
            if (this.onComplete) this.onComplete({ item: this.items[winner], index: winner });
        }, duration);
    }
}
