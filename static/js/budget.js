const DEFAULT_AMOUNTS = [100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 1000];
const WHEEL_COLORS = [
    '#E53935','#FB8C00','#FDD835','#43A047',
    '#00ACC1','#1E88E5','#8E24AA','#EC407A',
    '#FF7043','#66BB6A','#AB47BC','#29B6F6',
];

let allAmounts = [...DEFAULT_AMOUNTS];
let wheel = null;
let selectedBudget = null;

function init() {
    wheel = new SpinningWheel('budgetCanvas', {
        fontSize: 17,
        maxChars: 7,
        onComplete: onSpinDone,
    });
    renderChips();
    randomize();
}

function randomize() {
    const shuffled = [...allAmounts].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, 10);  // keep random order so positions change each time
    const items = picked.map((v, i) => ({
        label: `฿${v.toLocaleString()}`,
        value: v,
        color: WHEEL_COLORS[i % WHEEL_COLORS.length],
        textColor: v === 150 || v === 250 ? '#333' : '#fff', // yellow-ish contrast
    }));
    wheel.setItems(items);
    document.getElementById('resultArea').style.display = 'none';
    selectedBudget = null;
    updateConfirmBtn();
}

function addAmount() {
    const input = document.getElementById('customInput');
    const val = parseInt(input.value.replace(/,/g, ''));
    if (!val || val < 50 || val > 20000) {
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 400);
        return;
    }
    if (!allAmounts.includes(val)) {
        allAmounts.push(val);
        allAmounts.sort((a, b) => a - b);
        renderChips();
    }
    input.value = '';
    randomize();
}

function removeAmount(v) {
    allAmounts = allAmounts.filter(a => a !== v);
    renderChips();
    randomize();
}

function renderChips() {
    const el = document.getElementById('chipList');
    el.innerHTML = allAmounts.map(v => `
        <span class="chip">
            ฿${v.toLocaleString()}
            <button onclick="removeAmount(${v})" title="ลบ">×</button>
        </span>
    `).join('');
}

function spin() {
    if (!wheel || wheel.isSpinning) return;
    document.getElementById('resultArea').style.display = 'none';
    document.getElementById('spinBtn').disabled = true;
    document.getElementById('spinBtn').innerHTML = '<span class="spin-icon">⏳</span> กำลังหมุน…';
    selectedBudget = null;
    updateConfirmBtn();
    wheel.spin();
}

function onSpinDone(winner) {
    selectedBudget = winner.item.value;
    const area = document.getElementById('resultArea');
    document.getElementById('resultAmount').textContent = `฿${selectedBudget.toLocaleString()}`;
    area.style.display = 'block';
    area.classList.remove('pop');
    void area.offsetWidth;
    area.classList.add('pop');

    document.getElementById('spinBtn').disabled = false;
    document.getElementById('spinBtn').innerHTML = '🎯 หมุนอีกครั้ง';
    updateConfirmBtn();
}

function updateConfirmBtn() {
    const btn = document.getElementById('confirmBtn');
    btn.disabled = !selectedBudget;
    btn.textContent = selectedBudget
        ? `ยืนยัน ฿${selectedBudget.toLocaleString()} →`
        : 'ยืนยันงบประมาณ →';
}

async function confirmBudget() {
    if (!selectedBudget) return;
    const res = await fetch('/api/set-budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ budget: selectedBudget }),
    });
    if ((await res.json()).success) {
        window.location.href = '/menu';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    init();
    document.getElementById('customInput').addEventListener('keydown', e => {
        if (e.key === 'Enter') addAmount();
    });
});
