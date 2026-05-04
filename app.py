from flask import Flask, render_template, request, jsonify, session, redirect, url_for, send_from_directory
import sqlite3
import csv
import os
import json
from datetime import datetime, timedelta, timezone

_TZ_THAI = timezone(timedelta(hours=7))

def to_thai_time(ts):
    if not ts:
        return None
    try:
        dt = datetime.strptime(str(ts), '%Y-%m-%d %H:%M:%S')
        return dt.replace(tzinfo=timezone.utc).astimezone(_TZ_THAI).strftime('%Y-%m-%d %H:%M')
    except Exception:
        return str(ts)

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'sushiro-th-secret-2024')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Vercel has a read-only filesystem; /tmp is the only writable location
DATABASE = os.path.join('/tmp' if os.environ.get('VERCEL') else BASE_DIR, 'sushiro.db')
MENU_CSV = os.path.join(BASE_DIR, 'Menu', 'sushiro_menu.csv')
IMAGES_DIR = os.path.join(BASE_DIR, 'Menu', 'images')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'sushiro-admin')

# ── Correct Sushiro Thailand plate colors ─────────────────────────────────────
# Source: official Sushiro Thailand pricing system
# ฿30=white, ฿40=red, ฿60=silver, ฿80=gold, ฿100=black; ฿70/120/140/160 mapped below
PLATE_COLORS = {
    30:  {'name': 'จานขาว',   'color': '#F0F0F0', 'text': '#424242'},
    40:  {'name': 'จานแดง',   'color': '#E53935', 'text': '#FFFFFF'},
    60:  {'name': 'จานเงิน',  'color': '#9E9E9E', 'text': '#FFFFFF'},
    70:  {'name': 'จานเงิน',  'color': '#9E9E9E', 'text': '#FFFFFF'},
    80:  {'name': 'จานทอง',   'color': '#FFB300', 'text': '#424242'},
    100: {'name': 'จานดำ',    'color': '#212121', 'text': '#FFFFFF'},
    120: {'name': 'พรีเมียม', 'color': '#5C6BC0', 'text': '#FFFFFF'},
    140: {'name': 'พรีเมียม', 'color': '#5C6BC0', 'text': '#FFFFFF'},
    160: {'name': 'พรีเมียม', 'color': '#5C6BC0', 'text': '#FFFFFF'},
}

# Plate tiers for checkbox filter UI (groups prices that share the same plate)
PLATE_TIERS = [
    {'id': 'white',   'name': 'จานขาว',   'prices': [30],           'color': '#F0F0F0', 'text': '#424242', 'label': '฿30'},
    {'id': 'red',     'name': 'จานแดง',   'prices': [40],           'color': '#E53935', 'text': '#FFFFFF', 'label': '฿40'},
    {'id': 'silver',  'name': 'จานเงิน',  'prices': [60, 70],       'color': '#9E9E9E', 'text': '#FFFFFF', 'label': '฿60–70'},
    {'id': 'gold',    'name': 'จานทอง',   'prices': [80],           'color': '#FFB300', 'text': '#424242', 'label': '฿80'},
    {'id': 'black',   'name': 'จานดำ',    'prices': [100],          'color': '#212121', 'text': '#FFFFFF', 'label': '฿100'},
    {'id': 'premium', 'name': 'พรีเมียม', 'prices': [120, 140, 160], 'color': '#5C6BC0', 'text': '#FFFFFF', 'label': '฿120+'},
]

_menu_cache = None


# ── Database ──────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_name TEXT NOT NULL,
            budget INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            finished_at TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS meal_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL REFERENCES sessions(id),
            item_name_th TEXT NOT NULL,
            item_name_en TEXT,
            price INTEGER NOT NULL,
            category TEXT,
            plate_color TEXT,
            plate_name TEXT,
            added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    ''')
    conn.commit()
    conn.close()


init_db()


# ── Menu loading ──────────────────────────────────────────────────────────────

def load_menu():
    menu = []
    with open(MENU_CSV, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            price    = int(row['ราคา (บาท)'].strip())
            category = row['หมวดหมู่'].strip()
            img_path = row['รูปภาพ (Path)'].strip()

            if category == 'Dessert':
                item_type = 'dessert'
            elif category == 'Drinks':
                item_type = 'drink'
            elif category == 'Side menu':
                item_type = 'side'
            else:
                item_type = 'sushi'

            plate    = PLATE_COLORS.get(price, {'name': 'พรีเมียม', 'color': '#5C6BC0', 'text': '#FFFFFF'})
            filename = os.path.basename(img_path) if img_path else ''

            menu.append({
                'id':          i,
                'name_th':     row['ชื่อเมนู (TH)'].strip(),
                'name_en':     row['ชื่อเมนู (EN)'].strip(),
                'price':       price,
                'image_url':   f'/menu-image/{filename}' if filename else '',
                'category':    category,
                'item_type':   item_type,
                'plate_color': plate['color'],
                'plate_name':  plate['name'],
                'text_color':  plate['text'],
            })
    return menu


def get_menu():
    global _menu_cache
    if _menu_cache is None:
        _menu_cache = load_menu()
    return _menu_cache


# ── Auth helpers ──────────────────────────────────────────────────────────────

from functools import wraps

def require_session(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if 'session_id' not in session:
            return redirect(url_for('index'))
        return fn(*args, **kwargs)
    return wrapper


def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get('admin_authenticated'):
            return redirect(url_for('admin_login'))
        return fn(*args, **kwargs)
    return wrapper


# ── User pages ────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/budget')
@require_session
def budget_page():
    return render_template('budget.html', user_name=session['user_name'])


@app.route('/menu')
@require_session
def menu_page():
    budget = session.get('budget', 0)
    return render_template('menu.html',
        user_name=session['user_name'],
        budget=budget,
        plate_tiers=PLATE_TIERS,
    )


# ── User API ──────────────────────────────────────────────────────────────────

@app.route('/api/start', methods=['POST'])
def api_start():
    data = request.get_json()
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'กรุณาใส่ชื่อ'}), 400

    conn = get_db()
    cur  = conn.execute('INSERT INTO sessions (user_name) VALUES (?)', (name,))
    sid  = cur.lastrowid
    conn.commit()
    conn.close()

    session['session_id'] = sid
    session['user_name']  = name
    session['budget']     = 0
    return jsonify({'success': True})


@app.route('/api/set-budget', methods=['POST'])
def api_set_budget():
    data   = request.get_json()
    budget = int(data.get('budget', 0))
    sid    = session.get('session_id')
    if not sid:
        return jsonify({'error': 'ไม่พบ session'}), 400

    conn = get_db()
    conn.execute('UPDATE sessions SET budget = ? WHERE id = ?', (budget, sid))
    conn.commit()
    conn.close()

    session['budget'] = budget
    return jsonify({'success': True, 'budget': budget})


@app.route('/api/menu-items')
def api_menu_items():
    return jsonify(get_menu())


@app.route('/api/add-item', methods=['POST'])
def api_add_item():
    data = request.get_json()
    sid  = session.get('session_id')
    if not sid:
        return jsonify({'error': 'ไม่พบ session'}), 400

    conn = get_db()
    conn.execute(
        'INSERT INTO meal_orders (session_id,item_name_th,item_name_en,price,category,plate_color,plate_name) '
        'VALUES (?,?,?,?,?,?,?)',
        (sid, data['name_th'], data.get('name_en', ''), data['price'],
         data.get('category', ''), data.get('plate_color', ''), data.get('plate_name', ''))
    )
    conn.commit()
    total, orders = _get_orders(conn, sid)
    conn.close()
    return jsonify({'success': True, 'total': total, 'orders': orders})


@app.route('/api/remove-item/<int:item_id>', methods=['DELETE'])
def api_remove_item(item_id):
    sid = session.get('session_id')
    if not sid:
        return jsonify({'error': 'ไม่พบ session'}), 400

    conn = get_db()
    conn.execute('DELETE FROM meal_orders WHERE id = ? AND session_id = ?', (item_id, sid))
    conn.commit()
    total, orders = _get_orders(conn, sid)
    conn.close()
    return jsonify({'success': True, 'total': total, 'orders': orders})


@app.route('/api/summary')
def api_summary():
    sid = session.get('session_id')
    if not sid:
        return jsonify({'error': 'ไม่พบ session'}), 400

    conn    = get_db()
    sess    = conn.execute('SELECT * FROM sessions WHERE id = ?', (sid,)).fetchone()
    total, orders = _get_orders(conn, sid)
    conn.close()

    budget = sess['budget'] or 0
    return jsonify({
        'user_name': sess['user_name'],
        'budget':    budget,
        'orders':    orders,
        'total':     total,
        'remaining': budget - total,
    })


@app.route('/api/finish', methods=['POST'])
def api_finish():
    sid = session.get('session_id')
    if not sid:
        return jsonify({'error': 'ไม่พบ session'}), 400

    conn = get_db()
    conn.execute('UPDATE sessions SET finished_at = CURRENT_TIMESTAMP WHERE id = ?', (sid,))
    conn.commit()
    conn.close()
    session.clear()
    return jsonify({'success': True})


@app.route('/menu-image/<path:filename>')
def menu_image(filename):
    return send_from_directory(IMAGES_DIR, filename)


# ── Admin pages ───────────────────────────────────────────────────────────────

@app.route('/admin')
def admin_index():
    if session.get('admin_authenticated'):
        return redirect(url_for('admin_dashboard'))
    return redirect(url_for('admin_login'))


@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    error = None
    if request.method == 'POST':
        pw = request.form.get('password', '')
        if pw == ADMIN_PASSWORD:
            session['admin_authenticated'] = True
            return redirect(url_for('admin_dashboard'))
        error = 'รหัสผ่านไม่ถูกต้อง'
    return render_template('admin/login.html', error=error)


@app.route('/admin/logout')
def admin_logout():
    session.pop('admin_authenticated', None)
    return redirect(url_for('admin_login'))


@app.route('/admin/dashboard')
@require_admin
def admin_dashboard():
    conn = get_db()

    stats = {
        'total_sessions':    conn.execute('SELECT COUNT(*) FROM sessions').fetchone()[0],
        'active_sessions':   conn.execute('SELECT COUNT(*) FROM sessions WHERE finished_at IS NULL').fetchone()[0],
        'finished_sessions': conn.execute('SELECT COUNT(*) FROM sessions WHERE finished_at IS NOT NULL').fetchone()[0],
        'total_orders':      conn.execute('SELECT COUNT(*) FROM meal_orders').fetchone()[0],
        'total_revenue':     conn.execute('SELECT COALESCE(SUM(price),0) FROM meal_orders').fetchone()[0],
    }
    avg = conn.execute(
        'SELECT AVG(s) FROM (SELECT SUM(price) s FROM meal_orders GROUP BY session_id)'
    ).fetchone()[0]
    stats['avg_spend'] = round(avg or 0)

    top_items = [dict(r) for r in conn.execute('''
        SELECT item_name_th, item_name_en, plate_color, plate_name,
               COUNT(*) cnt, SUM(price) revenue
        FROM meal_orders
        GROUP BY item_name_th
        ORDER BY cnt DESC LIMIT 15
    ''').fetchall()]

    by_category = [dict(r) for r in conn.execute('''
        SELECT category, COUNT(*) cnt, SUM(price) revenue
        FROM meal_orders GROUP BY category ORDER BY cnt DESC
    ''').fetchall()]

    by_plate = [dict(r) for r in conn.execute('''
        SELECT plate_name, plate_color, COUNT(*) cnt, SUM(price) revenue
        FROM meal_orders GROUP BY plate_name ORDER BY revenue DESC
    ''').fetchall()]

    sessions = [dict(r) for r in conn.execute('''
        SELECT s.id, s.user_name, s.budget, s.created_at, s.finished_at,
               COUNT(m.id) order_count,
               COALESCE(SUM(m.price),0) total_spent
        FROM sessions s
        LEFT JOIN meal_orders m ON m.session_id = s.id
        GROUP BY s.id ORDER BY s.created_at DESC LIMIT 100
    ''').fetchall()]

    conn.close()

    for s in sessions:
        s['created_at']  = to_thai_time(s['created_at'])
        s['finished_at'] = to_thai_time(s['finished_at'])

    return render_template('admin/dashboard.html',
        stats=stats,
        top_items_json=json.dumps(top_items, ensure_ascii=False),
        by_category_json=json.dumps(by_category, ensure_ascii=False),
        by_plate_json=json.dumps(by_plate, ensure_ascii=False),
        sessions=sessions,
    )


@app.route('/admin/api/session/<int:sid>')
@require_admin
def admin_session_detail(sid):
    conn   = get_db()
    sess   = conn.execute('SELECT * FROM sessions WHERE id = ?', (sid,)).fetchone()
    orders = conn.execute(
        'SELECT * FROM meal_orders WHERE session_id = ? ORDER BY added_at', (sid,)
    ).fetchall()
    conn.close()
    if not sess:
        return jsonify({'error': 'ไม่พบ session'}), 404
    sess_dict = dict(sess)
    sess_dict['created_at']  = to_thai_time(sess_dict['created_at'])
    sess_dict['finished_at'] = to_thai_time(sess_dict['finished_at'])
    return jsonify({
        'session': sess_dict,
        'orders':  [dict(o) for o in orders],
        'total':   sum(o['price'] for o in orders),
    })


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_orders(conn, sid):
    rows   = conn.execute(
        'SELECT * FROM meal_orders WHERE session_id = ? ORDER BY added_at', (sid,)
    ).fetchall()
    orders = [dict(r) for r in rows]
    return sum(o['price'] for o in orders), orders


if __name__ == '__main__':
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    print(f'\n→ Open http://localhost:{port} in your browser')
    print(f'→ Admin panel: http://localhost:{port}/admin  (password: {ADMIN_PASSWORD})\n')
    app.run(debug=True, host='0.0.0.0', port=port)
