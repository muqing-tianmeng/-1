import random
import math
import time
import re
import threading
from collections import deque
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory, g
from flask_cors import CORS

app = Flask(__name__, static_folder="static", static_url_path="")
CORS(app)

# Serve the optimized static version
@app.route("/v2")
def index_v2():
    return send_from_directory("public", "index.html")


# In-memory storage for weighbridge records
MAX_RECORDS = 200
records = deque(maxlen=MAX_RECORDS)
records_lock = threading.Lock()
record_id_counter = 0

# Base weight and fluctuation parameters
BASE_WEIGHT = 25000.0
AMPLITUDE = 333.0  # ~±200 kg drift (333 * 0.6 ≈ 200)

# Chinese plate number regex: province + letter + 5-6 alphanumeric chars
PLATE_RE = re.compile(
    r"^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁]"
    r"[A-HJ-NP-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9挂学警港澳]$"
)


def simulate_weight():
    """Generate a realistic simulated weight reading with smooth drift and noise."""
    t = time.time()
    drift = math.sin(t * 0.3) * AMPLITUDE * 0.6
    noise = random.uniform(-80, 80)
    weight = BASE_WEIGHT + drift + noise
    return round(max(0.0, min(50000.0, weight)), 1)


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/current_weight", methods=["GET"])
def current_weight():
    return jsonify({"weight": simulate_weight()})


@app.route("/api/record", methods=["POST"])
def add_record():
    global record_id_counter
    data = request.get_json()
    if data is None:
        return jsonify({"success": False, "error": "请求体必须为 JSON 格式"}), 415

    plate = (data.get("plate") or "").strip().upper()
    weight = data.get("weight")

    if not plate:
        return jsonify({"success": False, "error": "车牌号不能为空"}), 400
    if not PLATE_RE.match(plate):
        return jsonify({"success": False, "error": "车牌号格式不正确"}), 400
    if weight is None or not isinstance(weight, (int, float)):
        return jsonify({"success": False, "error": "重量数据无效"}), 400
    if weight < 0 or weight > 50000:
        return jsonify({"success": False, "error": "重量超出范围 (0~50000 kg)"}), 400

    with records_lock:
        record_id_counter += 1
        record = {
            "id": record_id_counter,
            "plate": plate,
            "weight": round(float(weight), 1),
            "time": datetime.now().isoformat(),
        }
        records.appendleft(record)

    return jsonify({"success": True, **record})


@app.route("/api/records", methods=["GET"])
def get_records():
    with records_lock:
        snapshot = list(records)
    return jsonify({"records": snapshot})


@app.before_request
def start_timer():
    g.start_time = time.time()


@app.after_request
def log_request(response):
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
