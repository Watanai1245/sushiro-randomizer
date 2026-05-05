let menuWheel    = null;
let allMenuItems = [];
let selectedIds  = new Set();
let lastWinner   = null;
let budget       = 0;
let currentCat   = '';
let searchQuery  = '';

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
    budget = parseInt(document.getElementById('budgetData').dataset.budget) || 0;

    menuWheel = new SpinningWheel('menuCanvas', { onComplete: onSpinDone });

    const res    = await fetch('/api/menu-items');
    allMenuItems = await res.json();

    renderGrid();
    updateWheel();
    await refreshOrderList();

    document.getElementById('searchBox').addEventListener('input', e => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderGrid();
    });

    document.getElementById('catTabs').addEventListener('click', e => {
        const btn = e.target.closest('.cat-tab');
        if (!btn) return;
        document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentCat = btn.dataset.cat;
        renderGrid();
    });
}

// ── Grid rendering ────────────────────────────────────────────────────────────

function visibleItems() {
    return allMenuItems.filter(item => {
        const catOk    = !currentCat || item.category === currentCat;
        const searchOk = !searchQuery ||
            item.name_th.includes(searchQuery) ||
            item.name_en.toLowerCase().includes(searchQuery);
        return catOk && searchOk;
    });
}

function renderGrid() {
    const items = visibleItems();
    const grid  = document.getElementById('itemGrid');

    if (items.length === 0) {
        grid.innerHTML = '<p class="empty-note" style="padding:24px">ไม่พบเมนูที่ตรงกัน</p>';
        return;
    }

    grid.innerHTML = items.map(item => {
        const sel    = selectedIds.has(item.id);
        const border = item.plate_color === '#F0F0F0' ? 'border:1px solid #BDBDBD' : '';
        return `
        <div class="item-card${sel ? ' selected' : ''}" data-id="${item.id}" onclick="toggleItem(${item.id})">
          <div class="item-card-img-wrap">
            <img src="${item.image_url}" class="item-card-img" loading="lazy" alt=""
                 onerror="this.parentElement.innerHTML='<div class=\'img-placeholder\'>🍣</div>'">
          </div>
          <div class="item-card-body">
            <div class="item-card-name">${item.name_th}</div>
            <div class="item-card-meta">
              <span class="plate-dot-sm" style="background:${item.plate_color};${border}"></span>
              <span class="item-card-price">฿${item.price}</span>
            </div>
          </div>
          <div class="item-check${sel ? ' checked' : ''}">✓</div>
        </div>`;
    }).join('');
}

// ── Selection ─────────────────────────────────────────────────────────────────

function toggleItem(id) {
    if (selectedIds.has(id)) {
        selectedIds.delete(id);
    } else {
        selectedIds.add(id);
    }
    const card  = document.querySelector(`.item-card[data-id="${id}"]`);
    const check = card && card.querySelector('.item-check');
    if (card && check) {
        card.classList.toggle('selected', selectedIds.has(id));
        check.classList.toggle('checked', selectedIds.has(id));
    }
    updateWheel();
}

function selectVisible() {
    visibleItems().forEach(item => selectedIds.add(item.id));
    renderGrid();
    updateWheel();
}

function clearSelection() {
    selectedIds.clear();
    renderGrid();
    updateWheel();
}

function quickRandom(n = 10) {
    selectedIds.clear();
    [...allMenuItems]
        .sort(() => Math.random() - 0.5)
        .slice(0, n)
        .forEach(item => selectedIds.add(item.id));
    renderGrid();
    updateWheel();
}

// ── Wheel ─────────────────────────────────────────────────────────────────────

function updateWheel() {
    const items = allMenuItems.filter(item => selectedIds.has(item.id));
    menuWheel.setItems(items.map(item => ({
        label:     item.name_th,
        value:     item,
        color:     item.plate_color,
        textColor: item.text_color,
    })));
    hideResult();
    lastWinner = null;
    document.getElementById('addBtn').disabled = true;
    document.getElementById('spinBtn').disabled = items.length === 0;

    const n = selectedIds.size;
    document.getElementById('selectedCount').textContent =
        n === 0 ? 'ยังไม่ได้เลือก' : `เลือกแล้ว ${n} รายการ`;
}

// ── Spin ──────────────────────────────────────────────────────────────────────

function spin() {
    if (!menuWheel || menuWheel.isSpinning || selectedIds.size === 0) return;
    hideResult();
    lastWinner = null;
    document.getElementById('addBtn').disabled = true;

    const btn = document.getElementById('spinBtn');
    btn.disabled  = true;
    btn.innerHTML = '⏳ กำลังหมุน…';
    menuWheel.spin();
}

function onSpinDone(winner) {
    lastWinner = winner.item.value;
    showResult(lastWinner);
    document.getElementById('addBtn').disabled  = false;
    document.getElementById('spinBtn').disabled = false;
    document.getElementById('spinBtn').innerHTML = '🎯 หมุนอีกครั้ง';
}

// ── Result display ────────────────────────────────────────────────────────────

function showResult(item) {
    const area = document.getElementById('resultArea');
    const img  = document.getElementById('resultImg');

    if (item.image_url) {
        img.src           = item.image_url;
        img.style.display = 'block';
        img.onerror       = () => { img.style.display = 'none'; };
    } else {
        img.style.display = 'none';
    }

    document.getElementById('resultName').textContent   = item.name_th;
    document.getElementById('resultNameEn').textContent = item.name_en;
    document.getElementById('resultPrice').textContent  = `฿${item.price}`;
    document.getElementById('resultCat').textContent    = item.category;
    document.getElementById('plateDot').style.backgroundColor = item.plate_color;
    document.getElementById('plateName').textContent    = item.plate_name;

    area.style.display = 'flex';
    area.classList.remove('pop');
    void area.offsetWidth;
    area.classList.add('pop');
}

function hideResult() {
    document.getElementById('resultArea').style.display = 'none';
}

// ── Order list ────────────────────────────────────────────────────────────────

async function addItem() {
    if (!lastWinner) return;
    const btn = document.getElementById('addBtn');
    btn.disabled = true;

    const res = await fetch('/api/add-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name_th:     lastWinner.name_th,
            name_en:     lastWinner.name_en,
            price:       lastWinner.price,
            category:    lastWinner.category,
            plate_color: lastWinner.plate_color,
            plate_name:  lastWinner.plate_name,
        }),
    });

    const data = await res.json();
    if (data.success) {
        renderOrders(data.orders, data.total);
        btn.textContent = '✓ เพิ่มแล้ว!';
        setTimeout(() => { btn.textContent = '+ เพิ่มในรายการสั่ง'; }, 1400);
    }
}

async function removeItem(id) {
    const res  = await fetch(`/api/remove-item/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) renderOrders(data.orders, data.total);
}

async function refreshOrderList() {
    const res  = await fetch('/api/summary');
    const data = await res.json();
    if (!data.error) renderOrders(data.orders, data.total);
}

function renderOrders(orders, total) {
    const list    = document.getElementById('orderList');
    const totalEl = document.getElementById('totalCost');

    list.innerHTML = orders.length === 0
        ? '<p class="empty-note">ยังไม่มีรายการ…</p>'
        : orders.map(o => `
            <div class="order-row">
              <span class="order-dot" style="background:${o.plate_color};
                ${o.plate_color === '#F0F0F0' ? 'border:1.5px solid #BDBDBD' : ''}"></span>
              <span class="order-name" title="${o.item_name_en}">${o.item_name_th}</span>
              <span class="order-price">฿${o.price}</span>
              <button class="btn-del" onclick="removeItem(${o.id})" title="ลบ">✕</button>
            </div>`).join('');

    totalEl.textContent = `฿${total.toLocaleString()}`;
    updateBudgetBar(total);
}

function updateBudgetBar(total = 0) {
    const wrap = document.getElementById('budgetBarWrap');
    if (!budget) { wrap.style.display = 'none'; return; }

    wrap.style.display = 'block';
    const pct = Math.min((total / budget) * 100, 100);
    const bar = document.getElementById('budgetBar');
    bar.style.width           = `${pct}%`;
    bar.style.backgroundColor = pct >= 100 ? '#E53935' : pct >= 80 ? '#FB8C00' : '#43A047';

    const rem = budget - total;
    document.getElementById('budgetLabel').textContent = rem >= 0
        ? `งบ ฿${budget.toLocaleString()} · เหลือ ฿${rem.toLocaleString()}`
        : `งบ ฿${budget.toLocaleString()} · เกิน ฿${Math.abs(rem).toLocaleString()}`;
}

// ── Summary modal ─────────────────────────────────────────────────────────────

async function openSummary() {
    const res  = await fetch('/api/summary');
    const data = await res.json();
    if (data.error) return;

    document.getElementById('sumName').textContent   = data.user_name;
    document.getElementById('sumBudget').textContent = data.budget
        ? `฿${data.budget.toLocaleString()}` : 'ไม่ได้กำหนด';
    document.getElementById('sumTotal').textContent  = `฿${data.total.toLocaleString()}`;

    const diffEl = document.getElementById('sumDiff');
    if (data.budget) {
        const diff = data.budget - data.total;
        diffEl.textContent   = diff >= 0
            ? `ประหยัดได้ ฿${diff.toLocaleString()} 🎉`
            : `เกินงบ ฿${Math.abs(diff).toLocaleString()} ⚠️`;
        diffEl.className     = 'sum-diff ' + (diff >= 0 ? 'under' : 'over');
        diffEl.style.display = 'block';
    } else {
        diffEl.style.display = 'none';
    }

    document.getElementById('sumItems').innerHTML = data.orders.length === 0
        ? '<p class="empty-note">ไม่มีรายการ</p>'
        : data.orders.map((o, i) => `
            <div class="sum-row">
              <span class="sum-num">${i + 1}.</span>
              <span class="order-dot" style="background:${o.plate_color};
                ${o.plate_color === '#F0F0F0' ? 'border:1.5px solid #BDBDBD' : ''}"></span>
              <span class="sum-item-name">${o.item_name_th}</span>
              <span class="sum-item-price">฿${o.price}</span>
            </div>`).join('');

    document.getElementById('summaryModal').style.display = 'flex';
}

function closeSummary() {
    document.getElementById('summaryModal').style.display = 'none';
}

async function finishMeal() {
    await fetch('/api/finish', { method: 'POST' });
    window.location.href = '/';
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
