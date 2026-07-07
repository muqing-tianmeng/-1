import random
import math
import time
import re
import threading
import csv
import io
from collections import deque, OrderedDict
from datetime import datetime, date, timedelta
from flask import Flask, jsonify, request, send_from_directory, Response
from flask_cors import CORS

app = Flask(__name__, static_folder="static", static_url_path="/static")
CORS(app)

# ==================== Storage ====================
MAX_RECORDS = 1000
records = deque(maxlen=MAX_RECORDS)
records_lock = threading.Lock()
record_id_counter = 0

goods_list = []
goods_lock = threading.Lock()
goods_id_counter = 0

suppliers_list = []
suppliers_lock = threading.Lock()
suppliers_id_counter = 0

customers_list = []
customers_lock = threading.Lock()
customers_id_counter = 0

settings_data = {"company_name": "XX地磅站", "station_id": "DB-2024-001"}
settings_lock = threading.Lock()

tare_weight = 0.0
tare_lock = threading.Lock()
weighing_mode = "once"  # "once" or "twice"

# ==================== Weight Simulation ====================
BASE_WEIGHT = 25000.0
AMPLITUDE = 333.0

PLATE_RE = re.compile(
    r"^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁]"
    r"[A-HJ-NP-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]$"
)


def simulate_weight():
    t = time.time()
    drift = math.sin(t * 0.3) * AMPLITUDE * 0.6
    noise = random.uniform(-80, 80)
    weight = BASE_WEIGHT + drift + noise
    return round(max(0.0, min(50000.0, weight)), 1)


# ==================== Routes ====================
@app.route("/")
def index():
    return send_from_directory("static", "v2.html")


@app.route("/v2")
def v2():
    return send_from_directory("static", "v2.html")


# ---- Weight ----
@app.route("/api/current_weight", methods=["GET"])
def current_weight():
    with tare_lock:
        gross = simulate_weight()
        tare = tare_weight
    net = round(max(0, gross - tare), 1)
    return jsonify({"gross": gross, "tare": tare, "net": net})


@app.route("/api/tare", methods=["POST"])
def set_tare():
    global tare_weight
    data = request.get_json(silent=True) or {}
    w = data.get("weight")
    if w is None:
        with tare_lock:
            gross = simulate_weight()
            tare_weight = gross
        return jsonify({"success": True, "tare": tare_weight})
    w = float(w)
    if w < 0 or w > 50000:
        return jsonify({"success": False, "error": "皮重超出范围"}), 400
    with tare_lock:
        tare_weight = w
    return jsonify({"success": True, "tare": tare_weight})


@app.route("/api/tare/clear", methods=["POST"])
def clear_tare():
    global tare_weight
    with tare_lock:
        tare_weight = 0.0
    return jsonify({"success": True, "tare": 0})


@app.route("/api/mode", methods=["GET", "POST"])
def weighing_mode_api():
    global weighing_mode
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        mode = data.get("mode", "once")
        if mode not in ("once", "twice"):
            return jsonify({"success": False, "error": "模式无效"}), 400
        weighing_mode = mode
    return jsonify({"success": True, "mode": weighing_mode})


# ---- Records ----
@app.route("/api/record", methods=["POST"])
def add_record():
    global record_id_counter
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"success": False, "error": "请求体必须为 JSON 格式"}), 415

    plate = (data.get("plate") or "").strip().upper()
    if not plate:
        return jsonify({"success": False, "error": "车牌号不能为空"}), 400
    if not PLATE_RE.match(plate):
        return jsonify({"success": False, "error": "车牌号格式不正确"}), 400

    gross = data.get("gross")
    tare_val = data.get("tare", 0)
    net = data.get("net")
    if gross is None and net is None:
        return jsonify({"success": False, "error": "缺少重量数据"}), 400
    gross = round(float(gross), 1) if gross is not None else 0
    net = round(float(net), 1) if net is not None else round(max(0, gross - float(tare_val)), 1)
    tare_val = round(float(tare_val), 1)

    with records_lock:
        record_id_counter += 1
        record = OrderedDict([
            ("id", record_id_counter),
            ("plate", plate),
            ("driver", (data.get("driver") or "").strip()),
            ("goods", (data.get("goods") or "").strip()),
            ("spec", (data.get("spec") or "").strip()),
            ("customer", (data.get("customer") or "").strip()),
            ("supplier", (data.get("supplier") or "").strip()),
            ("gross", gross),
            ("tare", tare_val),
            ("net", net),
            ("mode", data.get("mode", weighing_mode)),
            ("time", datetime.now().isoformat()),
        ])
        records.appendleft(dict(record))

    return jsonify({"success": True, **record})


@app.route("/api/record/<int:rid>", methods=["DELETE"])
def delete_record(rid):
    with records_lock:
        for i, r in enumerate(records):
            if r["id"] == rid:
                del records[i]
                return jsonify({"success": True})
    return jsonify({"success": False, "error": "记录不存在"}), 404


@app.route("/api/records", methods=["GET"])
def get_records():
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 50, type=int)
    plate_q = (request.args.get("plate") or "").strip().upper()
    date_q = (request.args.get("date") or "").strip()
    keyword = (request.args.get("keyword") or "").strip()

    with records_lock:
        items = list(records)

    if plate_q:
        items = [r for r in items if plate_q in r["plate"]]
    if date_q:
        items = [r for r in items if r["time"][:10] == date_q]
    if keyword:
        kw = keyword.lower()
        items = [r for r in items if
                 kw in r["plate"].lower() or
                 kw in r["driver"].lower() or
                 kw in r["goods"].lower() or
                 kw in r["supplier"].lower() or
                 kw in r.get("customer","").lower() or
                 kw in r.get("spec","").lower()]

    total = len(items)
    start = (page - 1) * per_page
    end = start + per_page
    page_items = items[start:end] if start < total else []

    return jsonify({
        "records": page_items,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": max(1, (total + per_page - 1) // per_page),
    })


@app.route("/api/records/all", methods=["GET"])
def get_all_records():
    plate_q = (request.args.get("plate") or "").strip().upper()
    date_q = (request.args.get("date") or "").strip()
    with records_lock:
        items = list(records)
    if plate_q:
        items = [r for r in items if plate_q in r["plate"]]
    if date_q:
        items = [r for r in items if r["time"][:10] == date_q]
    return jsonify({"records": items})


@app.route("/api/export_csv", methods=["GET"])
def export_csv():
    plate_q = (request.args.get("plate") or "").strip().upper()
    date_q = (request.args.get("date") or "").strip()
    with records_lock:
        items = list(records)
    if plate_q:
        items = [r for r in items if plate_q in r["plate"]]
    if date_q:
        items = [r for r in items if r["time"][:10] == date_q]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["编号", "车牌号", "司机", "货物", "供应商", "毛重(kg)", "皮重(kg)", "净重(kg)", "模式", "时间"])
    for r in reversed(items):
        writer.writerow([
            r["id"], r["plate"], r["driver"], r["goods"], r["supplier"],
            r["gross"], r["tare"], r["net"], r["mode"],
            r["time"][:19],
        ])

    return Response(
        output.getvalue().encode("utf-8-sig"),
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=weighbridge_records.csv"},
    )


@app.route("/api/clear_all", methods=["POST"])
def clear_all():
    global records, record_id_counter
    with records_lock:
        records.clear()
        record_id_counter = 0
    return jsonify({"success": True})


# ---- Stats ----
@app.route("/api/stats", methods=["GET"])
def get_stats():
    with records_lock:
        items = list(records)

    today = date.today().isoformat()
    today_records = [r for r in items if r["time"][:10] == today]
    today_count = len(today_records)
    today_total_net = sum(r["net"] for r in today_records)
    today_avg_net = round(today_total_net / today_count, 1) if today_count else 0
    today_max_net = max((r["net"] for r in today_records), default=0)

    # 7-day stats
    seven_days = []
    for i in range(6, -1, -1):
        d = (date.today() - timedelta(days=i)).isoformat()
        day_records = [r for r in items if r["time"][:10] == d]
        seven_days.append({
            "date": d,
            "count": len(day_records),
            "total_net": round(sum(r["net"] for r in day_records), 1),
        })

    # Top plates
    plate_count = {}
    for r in items:
        plate_count[r["plate"]] = plate_count.get(r["plate"], 0) + 1
    top_plates = sorted(plate_count.items(), key=lambda x: -x[1])[:10]
    top_plates_list = [{"plate": p, "count": c} for p, c in top_plates]

    return jsonify({
        "today": {
            "count": today_count,
            "total_net": round(today_total_net, 1),
            "avg_net": today_avg_net,
            "max_net": today_max_net,
        },
        "seven_days": seven_days,
        "top_plates": top_plates_list,
        "total_records": len(items),
    })


# ---- Goods ----
@app.route("/api/goods", methods=["GET"])
def get_goods():
    with goods_lock:
        return jsonify({"goods": list(goods_list)})


@app.route("/api/goods", methods=["POST"])
def add_goods():
    global goods_id_counter
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "货物名称不能为空"}), 400
    with goods_lock:
        goods_id_counter += 1
        spec = (data.get("spec") or "").strip()
        item = {"id": goods_id_counter, "name": name, "spec": spec}
        goods_list.append(item)
    return jsonify({"success": True, **item})


@app.route("/api/goods/<int:gid>", methods=["DELETE"])
def delete_goods(gid):
    with goods_lock:
        for i, g in enumerate(goods_list):
            if g["id"] == gid:
                del goods_list[i]
                return jsonify({"success": True})
    return jsonify({"success": False, "error": "货物不存在"}), 404


# ---- Suppliers ----
@app.route("/api/suppliers", methods=["GET"])
def get_suppliers():
    with suppliers_lock:
        return jsonify({"suppliers": list(suppliers_list)})


@app.route("/api/suppliers", methods=["POST"])
def add_supplier():
    global suppliers_id_counter
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "供应商名称不能为空"}), 400
    with suppliers_lock:
        suppliers_id_counter += 1
        item = {"id": suppliers_id_counter, "name": name}
        suppliers_list.append(item)
    return jsonify({"success": True, **item})


@app.route("/api/suppliers/<int:sid>", methods=["DELETE"])
def delete_supplier(sid):
    with suppliers_lock:
        for i, s in enumerate(suppliers_list):
            if s["id"] == sid:
                del suppliers_list[i]
                return jsonify({"success": True})
    return jsonify({"success": False, "error": "供应商不存在"}), 404


# ---- Customers ----
@app.route("/api/customers", methods=["GET"])
def get_customers():
    with customers_lock:
        return jsonify({"customers": list(customers_list)})


@app.route("/api/customers", methods=["POST"])
def add_customer():
    global customers_id_counter
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"success": False, "error": "??????????"}), 400
    with customers_lock:
        customers_id_counter += 1
        item = {"id": customers_id_counter, "name": name}
        customers_list.append(item)
    return jsonify({"success": True, **item})


@app.route("/api/customers/<int:cid>", methods=["DELETE"])
def delete_customer(cid):
    with customers_lock:
        for i, c in enumerate(customers_list):
            if c["id"] == cid:
                del customers_list[i]
                return jsonify({"success": True})
    return jsonify({"success": False, "error": "???????"}), 404


# ---- Settings ----
@app.route("/api/settings", methods=["GET", "POST"])
def settings_api():
    global settings_data
    if request.method == "POST":
        data = request.get_json(silent=True) or {}
        with settings_lock:
            if "company_name" in data:
                settings_data["company_name"] = str(data["company_name"]).strip()
            if "station_id" in data:
                settings_data["station_id"] = str(data["station_id"]).strip()
    with settings_lock:
        return jsonify({"success": True, **settings_data})


# ---- Request Logging ----
@app.before_request
def start_timer():
    from flask import g
    g.start_time = time.time()


@app.after_request
def log_request(response):
    from flask import g
    start = getattr(g, "start_time", None)
    duration_ms = (time.time() - start) * 1000 if start else 0
    app.logger.info(
        "%s %s -> %s (%.1fms)",
        request.method,
        request.path,
        response.status_code,
        duration_ms,
    )
    return response


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
