// Single-reel slot machine built with React (no JSX, no build tools).
// SpinningWheel public API is unchanged: new SpinningWheel(id, {onComplete}),
// setItems(items), spin(), isSpinning.

const SLOT_H      = 88;   // px — must match CSS .slot-item height
const SLOT_REPEAT = 20;   // times to repeat the item list in the virtual reel
const FALLBACK    = '/static/images/sushiro-logo.svg';

// ── React slot-machine component ──────────────────────────────────────────────

class SlotMachineComponent extends React.Component {
    constructor(props) {
        super(props);
        this.state   = { items: [], rows: [] };
        this.reelRef = React.createRef();
        this._ci       = 0;
        this._spinning = false;
    }

    /* Called externally via ref ------------------------------------------- */
    setItems(items) {
        if (items.length === 0) {
            this.setState({ items: [], rows: [] });
            return;
        }
        const rows = [];
        for (let i = 0; i < SLOT_REPEAT; i++) rows.push(...items);
        this.setState({ items, rows }, () => {
            this._ci = Math.floor(SLOT_REPEAT / 2) * items.length;
            this._moveTo(this._ci, false);
        });
    }

    spin() {
        const { items } = this.state;
        if (this._spinning || items.length === 0) return;
        this._spinning = true;

        const n        = items.length;
        const winner   = Math.floor(Math.random() * n);
        const phase    = this._ci % n;
        const cycles   = 4 + Math.floor(Math.random() * 3);
        const shift    = ((winner - phase) + n) % n;
        const target   = this._ci + cycles * n + shift;
        const duration = 2800 + Math.random() * 700;

        this._moveTo(target, true, duration);

        setTimeout(() => {
            this._ci = Math.floor(SLOT_REPEAT / 2) * n + winner;
            this._moveTo(this._ci, false);
            this._spinning = false;
            if (this.props.onComplete) {
                this.props.onComplete({ item: items[winner], index: winner });
            }
        }, duration);
    }

    /* Private ---------------------------------------------------------------- */
    _moveTo(ci, animate, duration = 3000) {
        const reel = this.reelRef.current;
        if (!reel) return;
        const top = Math.max(0, (ci - 1) * SLOT_H);
        reel.style.transition = animate
            ? `transform ${duration}ms cubic-bezier(0.05, 0.9, 0.1, 1.0)`
            : 'none';
        if (!animate) void reel.offsetHeight; // force reflow
        reel.style.transform = `translateY(-${top}px)`;
    }

    _itemRow(item, idx) {
        const h       = React.createElement;
        const imgUrl  = (item.value && item.value.image_url) || FALLBACK;
        const brdStyle = item.color === '#F0F0F0'
            ? { border: '1.5px solid #BDBDBD' } : {};

        return h('div', { key: idx, className: 'slot-item' },
            h('div', { className: 'slot-img-box' },
                h('span', { className: 'slot-img-fallback' }, '🍣'),
                h('img', {
                    src: imgUrl,
                    className: 'slot-img',
                    loading: 'lazy',
                    alt: '',
                    onError: function(e) {
                        if (e.target.src !== window.location.origin + FALLBACK) {
                            e.target.src = FALLBACK;
                        }
                    }
                })
            ),
            h('div', { className: 'slot-info' },
                h('div', { className: 'slot-name' }, item.label),
                h('div', { className: 'slot-meta' },
                    h('span', {
                        className: 'plate-dot-sm',
                        style: Object.assign({ background: item.color }, brdStyle)
                    }),
                    h('span', { className: 'slot-price' },
                        '฿' + (item.value ? item.value.price : ''))
                )
            )
        );
    }

    render() {
        const h = React.createElement;
        const { items, rows } = this.state;

        const reelContent = items.length === 0
            ? h('div', { className: 'slot-item slot-empty' },
                h('span', { className: 'slot-empty-icon' }, '🎰'),
                h('span', { className: 'slot-empty-text' }, 'เลือกเมนูที่ต้องการ')
              )
            : rows.map((item, idx) => this._itemRow(item, idx));

        return h('div', { className: 'slot-machine' },
            h('div', { className: 'slot-window' },
                h('div', { className: 'slot-reel', ref: this.reelRef },
                    reelContent
                ),
                h('div', { className: 'slot-fade-top' }),
                h('div', { className: 'slot-fade-bottom' }),
                h('div', { className: 'slot-selector' })
            )
        );
    }
}

// ── SpinningWheel — public wrapper (API unchanged) ────────────────────────────

class SpinningWheel {
    constructor(containerId, options = {}) {
        this.isSpinning  = false;
        this._compRef    = React.createRef();
        this._onComplete = options.onComplete || null;

        const container = document.getElementById(containerId);
        const root      = ReactDOM.createRoot(container);
        root.render(
            React.createElement(SlotMachineComponent, {
                ref:        this._compRef,
                onComplete: (winner) => {
                    this.isSpinning = false;
                    if (this._onComplete) this._onComplete(winner);
                }
            })
        );
    }

    setItems(items) {
        const c = this._compRef.current;
        if (c) c.setItems(items);
    }

    spin() {
        if (this.isSpinning) return;
        const c = this._compRef.current;
        if (!c) return;
        this.isSpinning = true;
        c.spin();
    }
}
