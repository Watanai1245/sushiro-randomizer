from flask import Flask, render_template, request, jsonify, session, redirect, url_for, send_from_directory
from werkzeug.utils import secure_filename
import csv
import os
import json
from datetime import datetime, timedelta, timezone
from functools import wraps

_TZ_THAI = timezone(timedelta(hours=7))

DATABASE_URL = os.environ.get('DATABASE_URL', '')
_USE_SQLITE  = not DATABASE_URL

if _USE_SQLITE:
    import sqlite3
else:
    import psycopg2
    import psycopg2.extras

def to_thai_time(ts):
    if not ts:
        return None
    try:
        dt = ts if isinstance(ts, datetime) else datetime.fromisoformat(str(ts).split('.')[0])
        return dt.replace(tzinfo=timezone.utc).astimezone(_TZ_THAI).strftime('%Y-%m-%d %H:%M')
    except Exception:
        return str(ts)

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'sushiro-th-secret-2024')

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
MENU_CSV    = os.path.join(BASE_DIR, 'Menu', 'sushiro_menu.csv')
IMAGES_DIR  = os.path.join(BASE_DIR, 'Menu', 'images')
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

ALLOWED_IMAGE_EXTS = {'jpg', 'jpeg', 'png', 'webp'}
CSV_FIELDNAMES = ['ชื่อเมนู (TH)', 'ชื่อเมนู (EN)', 'ราคา (บาท)', 'รูปภาพ (Path)', 'หมวดหมู่']


# ── Database ──────────────────────────────────────────────────────────────────

_SQLITE_PATH = os.path.join(BASE_DIR, 'sushiro.db')


class _SqliteDict:
    """Wrap sqlite3.Row list so callers can use dict() on each row."""
    def __init__(self, cur):
        self._cur = cur

    def execute(self, sql, params=()):
        sql = sql.replace('%s', '?')
        # SQLite uses AUTOINCREMENT differently; strip RETURNING and fetch lastrowid
        has_returning = 'RETURNING' in sql.upper()
        if has_returning:
            sql = sql[:sql.upper().rfind('RETURNING')].rstrip(' ,')
        self._cur.execute(sql, params)
        if has_returning:
            self._lastrowid = self._cur.lastrowid
        return self

    def fetchone(self):
        # Check lastrowid first — INSERT stripped of RETURNING yields no rows
        if hasattr(self, '_lastrowid'):
            rid = self._lastrowid
            del self._lastrowid
            self._cur.fetchone()  # drain the cursor
            return (rid,)
        row = self._cur.fetchone()
        return row

    def fetchall(self):
        rows = self._cur.fetchall()
        return [dict(r) for r in rows]

    def close(self):
        self._cur.close()


class _SqliteConn:
    def __init__(self, path):
        self._conn = sqlite3.connect(path)
        self._conn.row_factory = sqlite3.Row

    def cursor(self, cursor_factory=None):
        return _SqliteDict(self._conn.cursor())

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()


def get_db():
    if _USE_SQLITE:
        return _SqliteConn(_SQLITE_PATH)
    return psycopg2.connect(DATABASE_URL)


def _dict_cursor(conn):
    if _USE_SQLITE:
        return conn.cursor()
    return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)


def init_db():
    conn = get_db()
    cur  = conn.cursor()
    if _USE_SQLITE:
        cur.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_name   TEXT NOT NULL,
                budget      INTEGER DEFAULT 0,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                finished_at TIMESTAMP
            )
        ''')
        cur.execute('''
            CREATE TABLE IF NOT EXISTS meal_orders (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id   INTEGER NOT NULL REFERENCES sessions(id),
                item_name_th TEXT NOT NULL,
                item_name_en TEXT,
                price        INTEGER NOT NULL,
                category     TEXT,
                plate_color  TEXT,
                plate_name   TEXT,
                added_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
    else:
        cur.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                id          SERIAL PRIMARY KEY,
                user_name   TEXT NOT NULL,
                budget      INTEGER DEFAULT 0,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                finished_at TIMESTAMP
            )
        ''')
        cur.execute('''
            CREATE TABLE IF NOT EXISTS meal_orders (
                id           SERIAL PRIMARY KEY,
                session_id   INTEGER NOT NULL REFERENCES sessions(id),
                item_name_th TEXT NOT NULL,
                item_name_en TEXT,
                price        INTEGER NOT NULL,
                category     TEXT,
                plate_color  TEXT,
                plate_name   TEXT,
                added_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
    conn.commit()
    cur.close()
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


def _load_csv_raw():
    with open(MENU_CSV, 'r', encoding='utf-8-sig') as f:
        return [dict(row) for row in csv.DictReader(f)]


def _save_csv_raw(rows):
    global _menu_cache
    _menu_cache = None
    with open(MENU_CSV, 'w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)


def _save_uploaded_image(file, name_th):
    ext = file.filename.rsplit('.', 1)[-1].lower()
    if ext not in ALLOWED_IMAGE_EXTS:
        return None
    filename = name_th + '.' + ext
    file.save(os.path.join(IMAGES_DIR, filename))
    return f'images/{filename}'


# ── Auth helpers ──────────────────────────────────────────────────────────────

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
    cur  = conn.cursor()
    cur.execute('INSERT INTO sessions (user_name) VALUES (%s) RETURNING id', (name,))
    sid  = cur.fetchone()[0]
    conn.commit()
    cur.close()
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
    cur  = conn.cursor()
    cur.execute('UPDATE sessions SET budget = %s WHERE id = %s', (budget, sid))
    conn.commit()
    cur.close()
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
    cur  = conn.cursor()
    cur.execute(
        'INSERT INTO meal_orders (session_id,item_name_th,item_name_en,price,category,plate_color,plate_name) '
        'VALUES (%s,%s,%s,%s,%s,%s,%s)',
        (sid, data['name_th'], data.get('name_en', ''), data['price'],
         data.get('category', ''), data.get('plate_color', ''), data.get('plate_name', ''))
    )
    conn.commit()
    total, orders = _get_orders(conn, sid)
    cur.close()
    conn.close()
    return jsonify({'success': True, 'total': total, 'orders': orders})


@app.route('/api/remove-item/<int:item_id>', methods=['DELETE'])
def api_remove_item(item_id):
    sid = session.get('session_id')
    if not sid:
        return jsonify({'error': 'ไม่พบ session'}), 400

    conn = get_db()
    cur  = conn.cursor()
    cur.execute('DELETE FROM meal_orders WHERE id = %s AND session_id = %s', (item_id, sid))
    conn.commit()
    total, orders = _get_orders(conn, sid)
    cur.close()
    conn.close()
    return jsonify({'success': True, 'total': total, 'orders': orders})


@app.route('/api/summary')
def api_summary():
    sid = session.get('session_id')
    if not sid:
        return jsonify({'error': 'ไม่พบ session'}), 400

    conn = get_db()
    cur  = _dict_cursor(conn)
    cur.execute('SELECT * FROM sessions WHERE id = %s', (sid,))
    sess  = cur.fetchone()
    total, orders = _get_orders(conn, sid)
    cur.close()
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
    cur  = conn.cursor()
    cur.execute('UPDATE sessions SET finished_at = CURRENT_TIMESTAMP WHERE id = %s', (sid,))
    conn.commit()
    cur.close()
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
    sc   = conn.cursor()                                          # scalar cursor
    dc   = _dict_cursor(conn)

    sc.execute('SELECT COUNT(*) FROM sessions'); total_sessions = sc.fetchone()[0]
    sc.execute('SELECT COUNT(*) FROM sessions WHERE finished_at IS NULL'); active = sc.fetchone()[0]
    sc.execute('SELECT COUNT(*) FROM sessions WHERE finished_at IS NOT NULL'); finished = sc.fetchone()[0]
    sc.execute('SELECT COUNT(*) FROM meal_orders'); total_orders = sc.fetchone()[0]
    sc.execute('SELECT COALESCE(SUM(price),0) FROM meal_orders'); total_revenue = sc.fetchone()[0]
    sc.execute('SELECT AVG(s) FROM (SELECT SUM(price) s FROM meal_orders GROUP BY session_id) AS sub')
    avg = sc.fetchone()[0]

    stats = {
        'total_sessions':    total_sessions,
        'active_sessions':   active,
        'finished_sessions': finished,
        'total_orders':      total_orders,
        'total_revenue':     total_revenue,
        'avg_spend':         round(avg or 0),
    }

    dc.execute('''
        SELECT item_name_th, item_name_en, plate_color, plate_name,
               COUNT(*) cnt, SUM(price) revenue
        FROM meal_orders
        GROUP BY item_name_th, item_name_en, plate_color, plate_name
        ORDER BY cnt DESC LIMIT 15
    ''')
    top_items = [dict(r) for r in dc.fetchall()]

    dc.execute('''
        SELECT category, COUNT(*) cnt, SUM(price) revenue
        FROM meal_orders GROUP BY category ORDER BY cnt DESC
    ''')
    by_category = [dict(r) for r in dc.fetchall()]

    dc.execute('''
        SELECT plate_name, plate_color, COUNT(*) cnt, SUM(price) revenue
        FROM meal_orders GROUP BY plate_name, plate_color ORDER BY revenue DESC
    ''')
    by_plate = [dict(r) for r in dc.fetchall()]

    dc.execute('''
        SELECT s.id, s.user_name, s.budget, s.created_at, s.finished_at,
               COUNT(m.id) AS order_count,
               COALESCE(SUM(m.price), 0) AS total_spent
        FROM sessions s
        LEFT JOIN meal_orders m ON m.session_id = s.id
        GROUP BY s.id
        ORDER BY s.created_at DESC LIMIT 100
    ''')
    sessions = [dict(r) for r in dc.fetchall()]

    sc.close()
    dc.close()
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


@app.route('/admin/menu')
@require_admin
def admin_menu_management():
    return render_template('admin/menu_management.html')


@app.route('/admin/api/menu-list')
@require_admin
def admin_api_menu_list():
    rows = _load_csv_raw()
    result = []
    for i, row in enumerate(rows):
        img_path = row['รูปภาพ (Path)'].strip()
        filename = os.path.basename(img_path) if img_path else ''
        result.append({
            'id':        i,
            'name_th':   row['ชื่อเมนู (TH)'].strip(),
            'name_en':   row['ชื่อเมนู (EN)'].strip(),
            'price':     row['ราคา (บาท)'].strip(),
            'category':  row['หมวดหมู่'].strip(),
            'image_url': f'/menu-image/{filename}' if filename else '',
        })
    return jsonify(result)


@app.route('/admin/api/menu/add', methods=['POST'])
@require_admin
def admin_api_menu_add():
    name_th  = request.form.get('name_th', '').strip()
    name_en  = request.form.get('name_en', '').strip()
    category = request.form.get('category', '').strip()
    try:
        price = int(request.form.get('price', 0))
    except ValueError:
        return jsonify({'error': 'ราคาไม่ถูกต้อง'}), 400
    if not name_th:
        return jsonify({'error': 'กรุณาใส่ชื่อเมนู (TH)'}), 400

    img_path = ''
    file = request.files.get('image')
    if file and file.filename:
        saved = _save_uploaded_image(file, name_th)
        if saved is None:
            return jsonify({'error': 'ไฟล์รูปภาพต้องเป็น jpg, jpeg, png หรือ webp'}), 400
        img_path = saved

    rows = _load_csv_raw()
    rows.append({
        'ชื่อเมนู (TH)': name_th,
        'ชื่อเมนู (EN)': name_en,
        'ราคา (บาท)':    str(price),
        'รูปภาพ (Path)': img_path,
        'หมวดหมู่':      category,
    })
    _save_csv_raw(rows)
    return jsonify({'success': True})


@app.route('/admin/api/menu/edit/<int:item_id>', methods=['POST'])
@require_admin
def admin_api_menu_edit(item_id):
    name_th  = request.form.get('name_th', '').strip()
    name_en  = request.form.get('name_en', '').strip()
    category = request.form.get('category', '').strip()
    try:
        price = int(request.form.get('price', 0))
    except ValueError:
        return jsonify({'error': 'ราคาไม่ถูกต้อง'}), 400
    if not name_th:
        return jsonify({'error': 'กรุณาใส่ชื่อเมนู (TH)'}), 400

    rows = _load_csv_raw()
    if item_id < 0 or item_id >= len(rows):
        return jsonify({'error': 'ไม่พบเมนู'}), 404

    img_path = rows[item_id]['รูปภาพ (Path)'].strip()
    file = request.files.get('image')
    if file and file.filename:
        saved = _save_uploaded_image(file, name_th)
        if saved is None:
            return jsonify({'error': 'ไฟล์รูปภาพต้องเป็น jpg, jpeg, png หรือ webp'}), 400
        img_path = saved

    rows[item_id] = {
        'ชื่อเมนู (TH)': name_th,
        'ชื่อเมนู (EN)': name_en,
        'ราคา (บาท)':    str(price),
        'รูปภาพ (Path)': img_path,
        'หมวดหมู่':      category,
    }
    _save_csv_raw(rows)
    return jsonify({'success': True})


@app.route('/admin/api/menu/delete/<int:item_id>', methods=['POST'])
@require_admin
def admin_api_menu_delete(item_id):
    rows = _load_csv_raw()
    if item_id < 0 or item_id >= len(rows):
        return jsonify({'error': 'ไม่พบเมนู'}), 404
    rows.pop(item_id)
    _save_csv_raw(rows)
    return jsonify({'success': True})


@app.route('/admin/api/session/<int:sid>')
@require_admin
def admin_session_detail(sid):
    conn = get_db()
    dc   = _dict_cursor(conn)
    dc.execute('SELECT * FROM sessions WHERE id = %s', (sid,))
    sess = dc.fetchone()
    dc.execute('SELECT * FROM meal_orders WHERE session_id = %s ORDER BY added_at', (sid,))
    orders = dc.fetchall()
    dc.close()
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
    cur = _dict_cursor(conn)
    cur.execute('SELECT * FROM meal_orders WHERE session_id = %s ORDER BY added_at', (sid,))
    orders = [dict(r) for r in cur.fetchall()]
    cur.close()
    return sum(o['price'] for o in orders), orders


if __name__ == '__main__':
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    print(f'\n→ Open http://localhost:{port} in your browser')
    print(f'→ Admin panel: http://localhost:{port}/admin  (password: {ADMIN_PASSWORD})\n')
    app.run(debug=True, host='0.0.0.0', port=port)
