// Single-reel slot machine using requestAnimationFrame + node recycling.
// Algorithm adapted from cc-crazy-monkey (github.com/alchimya/cc-crazy-monkey):
//   only N_NODES live DOM nodes exist; when a node scrolls off the top it is
//   recycled to the bottom and assigned the next item — identical to reel.js's
//   stop-recycling logic, re-expressed for CSS/DOM instead of Cocos2D.
//
// Public API (unchanged): new SpinningWheel(id, {onComplete}), setItems(items),
//   spin(), isSpinning

const SLOT_H   = 88;    // px per row — must match CSS .slot-item height
const N_NODES  = 5;     // 1 buffer above + 3 visible + 1 buffer below
const WIN_Y    = SLOT_H; // y of the centre (winning) slot = 88 px from reel top
const FALLBACK = '/static/images/sushiro-logo.svg';

class SpinningWheel {
    constructor(containerId, options = {}) {
        this.onComplete = options.onComplete || null;
        this.items      = [];
        this.isSpinning = false;
        this._raf       = null;
        this._nodes     = [];
        this._nextIdx   = 0;

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
        items.length === 0 ? this._showEmpty() : this._initNodes();
    }

    spin() {
        if (this.isSpinning || !this.items.length) return;
        this.isSpinning = true;

        const n      = this.items.length;
        const winner = Math.floor(Math.random() * n);
        const spins  = 5 + Math.floor(Math.random() * 3); // 5–7 full rotations

        // How many item-steps from current centre to winner
        const curIdx  = this._centerNode().itemIdx;
        const stepsToWinner = ((winner - curIdx) + n) % n;
        const totalPx = (spins * n + stepsToWinner) * SLOT_H;
        const duration = 3000 + Math.random() * 700; // 3.0–3.7 s

        let scrolled = 0;
        const startT = performance.now();

        const tick = (now) => {
            const t     = Math.min((now - startT) / duration, 1);
            const eased = this._ease(t);
            const step  = eased * totalPx - scrolled;
            if (step > 0) this._scroll(step);
            scrolled = eased * totalPx;

            if (t < 1) {
                this._raf = requestAnimationFrame(tick);
            } else {
                this._snapTo(winner);
                this.isSpinning = false;
                if (this.onComplete) this.onComplete({ item: this.items[winner], index: winner });
            }
        };

        this._raf = requestAnimationFrame(tick);
    }

    // ── Private: animation ────────────────────────────────────────────────────

    // Ease-in-out cubic: slow start → fast middle → slow stop (authentic slot feel)
    _ease(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // Shift all nodes upward by dy px; recycle any that leave the top
    _scroll(dy) {
        for (const nd of this._nodes) nd.y -= dy;

        // Recycle nodes that scrolled past the top buffer boundary
        let recycled = true;
        while (recycled) {
            recycled = false;
            const top = this._topNode();
            if (top.y < -SLOT_H) {
                const bot  = this._botNode();
                top.y      = bot.y + SLOT_H;
                top.itemIdx = this._nextIdx;
                this._fill(top.el, this.items[this._nextIdx]);
                this._nextIdx = (this._nextIdx + 1) % this.items.length;
                recycled = true;
            }
        }

        for (const nd of this._nodes) nd.el.style.top = Math.round(nd.y) + 'px';
    }

    // Nudge all nodes so the winner sits exactly at WIN_Y (payline)
    _snapTo(winnerIdx) {
        const candidates = this._nodes.filter(n => n.itemIdx === winnerIdx);
        if (!candidates.length) return;
        const winNode = candidates.reduce((best, nd) =>
            Math.abs(nd.y - WIN_Y) < Math.abs(best.y - WIN_Y) ? nd : best
        );
        const dy = winNode.y - WIN_Y;
        for (const nd of this._nodes) {
            nd.y -= dy;
            nd.el.style.top = Math.round(nd.y) + 'px';
        }
    }

    _centerNode() {
        return this._nodes.reduce((best, nd) =>
            Math.abs(nd.y - WIN_Y) < Math.abs(best.y - WIN_Y) ? nd : best
        );
    }
    _topNode() { return this._nodes.reduce((a, b) => a.y < b.y ? a : b); }
    _botNode() { return this._nodes.reduce((a, b) => a.y > b.y ? a : b); }

    // ── Private: DOM ──────────────────────────────────────────────────────────

    _showEmpty() {
        cancelAnimationFrame(this._raf);
        this._reel.innerHTML = `
            <div class="slot-empty">
                <span class="slot-empty-icon">🎰</span>
                <span class="slot-empty-text">เลือกเมนูที่ต้องการ</span>
            </div>`;
        this._nodes = [];
    }

    _initNodes() {
        cancelAnimationFrame(this._raf);
        this._reel.innerHTML = '';
        this._nodes = [];

        const n = this.items.length;
        for (let i = 0; i < N_NODES; i++) {
            const itemIdx = i % n;
            const y       = (i - 1) * SLOT_H; // node 0 → y=-88, node 2 → y=88 (centre)
            const el      = document.createElement('div');
            el.className  = 'slot-item';
            el.style.top  = y + 'px';
            this._fill(el, this.items[itemIdx]);
            this._reel.appendChild(el);
            this._nodes.push({ el, itemIdx, y });
        }
        this._nextIdx = N_NODES % n;
    }

    // Write item content into a .slot-item element
    _fill(el, item) {
        const isObj = item.value !== null && typeof item.value === 'object';
        const src   = (isObj && item.value.image_url) || FALLBACK;
        const brd   = item.color === '#F0F0F0' ? 'border:1.5px solid #BDBDBD;' : '';
        const meta  = isObj && item.value.price != null
            ? `<div class="slot-meta">
                   <span class="plate-dot-sm" style="background:${item.color};${brd}"></span>
                   <span class="slot-price">฿${item.value.price}</span>
               </div>` : '';
        el.innerHTML = `
            <div class="slot-img-box">
                <img src="${src}" class="slot-img" loading="lazy" alt=""
                     onerror="this.onerror=null;this.src='${FALLBACK}'">
            </div>
            <div class="slot-info">
                <div class="slot-name">${item.label}</div>
                ${meta}
            </div>`;
    }
}
