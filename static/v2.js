// ============================================================
// 地磅称重系统 v2.2 — 前端 JavaScript
// ============================================================

const $ = (id) => document.getElementById(id);
const CELL_HEIGHT = 92;
const PLATE_RE = /^[\u4eac\u6d25\u6caa\u6e1d\u5180\u8c6b\u4e91\u8fbd\u9ed1\u6e58\u7696\u9c81\u65b0\u82cf\u6d59\u8d63\u9102\u6842\u7518\u664b\u8499\u9655\u5409\u95fd\u8d35\u7ca4\u5ddd\u9752\u85cf\u743c\u5b81][A-HJ-NP-Z][A-HJ-NP-Z0-9]{4,5}[A-HJ-NP-Z0-9\u6302\u5b66\u8b66\u6e2f\u6fb3]$/;

let currentWeightValue = 0;
let recordsCache = [];
let currentPage = "weigh";
let isConnected = true;
let fetchErrorCount = 0;

let weightHistory = [];
let isStable = false;
const STABILITY_WINDOW = 10;
const STABILITY_THRESHOLD = 50;
let overloadThreshold = 49000;
let isOverload = false;
let sparklineData = new Array(30).fill(25000);

let weighState = { gross: null, tare: null, mode: "single" };
let goodsCache = [];
let suppliersCache = [];
let customersCache = [];
let settingsData = { company_name: "XX\u5730\u78c5\u7ad9", station_id: "DB-2024-001" };
let pollTimeout = null;
let recordsPage = 1;
const PER_PAGE = 20;

// ============================================================
// INITIALIZATION
// ============================================================
async function init() {
  createDigitColumns();
  await Promise.all([
    fetchSettings(), fetchGoods(), fetchSuppliers(),
    fetchCustomers(), fetchStatsMini(), fetchRecordsAll()
  ]);
  updateClock();
  setInterval(updateClock, 10000);
  startPolling();
  initCamera();
  document.querySelectorAll(".nav-item").forEach(el => {
    el.addEventListener("click", () => switchPage(el.dataset.page));
  });
  document.addEventListener("keydown", handleKeyboard);
}

function createDigitColumns() {
  const display = $("weightDisplay");
  display.innerHTML = "";
  ["ten_k","k","hundred","ten","one","dot","tenth"].forEach(id => {
    if (id === "dot") {
      const dot = document.createElement("div");
      dot.className = "decimal-dot";
      dot.textContent = ".";
      display.appendChild(dot);
      return;
    }
    const col = document.createElement("div");
    col.className = "digit-column";
    col.id = "col-" + id;
    const strip = document.createElement("div");
    strip.className = "digit-strip";
    for (let i = 0; i <= 11; i++) {
      const cell = document.createElement("div");
      cell.className = "digit-cell";
      cell.textContent = i % 10;
      strip.appendChild(cell);
    }
    col.appendChild(strip);
    display.appendChild(col);
  });
}

// ============================================================
// CLOCK
// ============================================================
function updateClock() {
  const now = new Date();
  $("headerTime").textContent = now.toLocaleString("zh-CN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    year: "numeric", month: "2-digit", day: "2-digit"
  });
}

// ============================================================
// PAGE SWITCHING
// ============================================================
function switchPage(page) {
  currentPage = page;
  document.querySelectorAll(".nav-item").forEach(el =>
    el.classList.toggle("active", el.dataset.page === page));
  document.querySelectorAll(".page").forEach(el =>
    el.classList.toggle("active", el.id === "page" + page.charAt(0).toUpperCase() + page.slice(1)));
  if (page === "records") renderRecordsPage();
  if (page === "stats") loadStats();
  if (page === "settings") renderSettingsPage();
}

// ============================================================
// WEIGHT POLLING
// ============================================================
function startPolling() { pollTimeout = setTimeout(fetchWeight, 1000); }

async function fetchWeight() {
  try {
    const res = await fetch("/api/current_weight");
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    currentWeightValue = data.gross || 0;
    updateDigitDisplay(currentWeightValue);
    updateSummaryDisplay(data.gross, data.tare, data.net);
    updateCameraTimestamp();
    checkStability(currentWeightValue);
    checkOverload(currentWeightValue);
    sparklineData.push(currentWeightValue);
    if (sparklineData.length > 30) sparklineData.shift();
    drawSparkline();
    setConnectionStatus(true);
  } catch(e) {
    setConnectionStatus(false);
  }
  pollTimeout = setTimeout(fetchWeight, 1000);
}

// ============================================================
// DIGIT DISPLAY (翻牌动画)
// ============================================================
function updateDigitDisplay(weight) {
  const w = Math.min(50000, Math.max(0, weight));
  const intPart = Math.floor(w).toString().padStart(5, " ");
  const decPart = Math.round((w - Math.floor(w)) * 10);
  const posMap = { 0: "ten_k", 1: "k", 2: "hundred", 3: "ten", 4: "one" };
  for (let i = 0; i < 5; i++) {
    const col = document.getElementById("col-" + posMap[i]);
    if (!col) continue;
    const strip = col.querySelector(".digit-strip");
    const d = intPart[i] === " " ? 0 : parseInt(intPart[i]);
    strip.style.transform = "translateY(-" + (d * CELL_HEIGHT) + "px)";
  }
  const tenthCol = document.getElementById("col-tenth");
  if (tenthCol) {
    const strip = tenthCol.querySelector(".digit-strip");
    strip.style.transform = "translateY(-" + (decPart * CELL_HEIGHT) + "px)";
  }
}

function updateSummaryDisplay(gross, tare, net) {
  $("grossDisplay").textContent = gross != null ? gross.toFixed(1) + " kg" : "--";
  $("tareDisplay").textContent = tare != null ? tare.toFixed(1) + " kg" : "--";
  $("netDisplay").textContent = net != null ? net.toFixed(1) + " kg" : "--";
}

// ============================================================
// STABILITY CHECK (稳定性检测)
// ============================================================
function checkStability(weight) {
  weightHistory.push(weight);
  if (weightHistory.length > STABILITY_WINDOW) weightHistory.shift();
  const badge = $("stabilityBadge");
  if (!badge) return;
  if (weightHistory.length < 5) {
    isStable = false;
    badge.className = "stability-badge unstable";
    badge.innerHTML = '<span class="stability-dot"></span> \u7edf\u8ba1\u4e2d...';
    return false;
  }
  const mean = weightHistory.reduce((a,b) => a+b, 0) / weightHistory.length;
  const variance = weightHistory.reduce((a,b) => a+(b-mean)*(b-mean), 0) / weightHistory.length;
  const stddev = Math.sqrt(variance);
  isStable = stddev < STABILITY_THRESHOLD;
  if (isStable) {
    badge.className = "stability-badge stable";
    badge.innerHTML = '<span class="stability-dot"></span> \u7a33\u5b9a \u00b7 \u03c3=' + stddev.toFixed(0);
  } else {
    badge.className = "stability-badge unstable";
    badge.innerHTML = '<span class="stability-dot"></span> \u6ce2\u52a8\u4e2d \u00b7 \u03c3=' + stddev.toFixed(0);
  }
  return isStable;
}

// ============================================================
// SPARKLINE (重量趋势迷你图)
// ============================================================
function drawSparkline() {
  const canvas = $("sparklineCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (sparklineData.length < 2) return;
  const min = Math.min(...sparklineData), max = Math.max(...sparklineData);
  const range = Math.max(max - min, 10);
  ctx.strokeStyle = "#f0b840";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  sparklineData.forEach((v, i) => {
    const x = (i / (sparklineData.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 8) - 4;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  ctx.fillStyle = "rgba(240,184,64,0.08)";
  ctx.fill();
}

// ============================================================
// OVERLOAD CHECK (超载检测)
// ============================================================
function checkOverload(weight) {
  if (weight > overloadThreshold) {
    if (!isOverload) {
      isOverload = true;
      $("overloadAlert").classList.add("show");
      $("weightPanel").classList.add("overload");
      speak("\u8b66\u544a\uff0c\u91cd\u91cf\u8d85\u8f7d");
    }
  } else {
    if (isOverload) {
      isOverload = false;
      $("overloadAlert").classList.remove("show");
      $("weightPanel").classList.remove("overload");
    }
  }
}

// ============================================================
// SPEECH (语音播报)
// ============================================================
function speak(text) {
  if (!("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN"; u.rate = 1.0;
    speechSynthesis.speak(u);
  } catch(e) {}
}

function speakWeight(plate, net) {
  if (!plate) return;
  speak("\u8f66\u724c " + plate.replace(/(.)/g, "$1 ") +
       " \u51c0\u91cd " + Math.round(net) + " \u5343\u514b");
}

// ============================================================
// CONNECTION STATUS
// ============================================================
function setConnectionStatus(connected) {
  const status = $("headerStatus");
  const text = $("headerStatusText");
  if (!status || !text) return;
  if (connected) {
    fetchErrorCount = 0;
    isConnected = true;
    status.className = "header-status";
    text.textContent = "\u4f20\u611f\u5668\u5728\u7ebf";
  } else {
    fetchErrorCount++;
    if (fetchErrorCount >= 3) {
      isConnected = false;
      status.className = "header-status offline";
      text.textContent = "\u8fde\u63a5\u4e2d\u65ad";
    }
  }
}

// ============================================================
// CAMERA
// ============================================================
function initCamera() {
  updateCameraTimestamp();
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
      .then(stream => {
        const video = $("cameraVideo");
        const placeholder = $("cameraPlaceholder");
        if (video && placeholder) {
          video.srcObject = stream;
          video.style.display = "block";
          placeholder.style.display = "none";
        }
      }).catch(() => {});
  }
}

function updateCameraTimestamp() {
  const el = $("cameraTimestamp");
  if (el) el.textContent = new Date().toLocaleTimeString("zh-CN");
}

// ============================================================
// WEIGH STATE MACHINE
// ============================================================
function captureGross() {
  if (!isStable && weightHistory.length >= 5) {
    showToast("\u91cd\u91cf\u4e0d\u7a33\u5b9a\uff0c\u8bf7\u7b49\u5f85\u7a33\u5b9a\u540e\u518d\u9501\u5b9a", "error");
    return;
  }
  weighState.gross = currentWeightValue;
  weighState.mode = "double";
  updateModeUI();
  showToast("\u6bdb\u91cd\u5df2\u9501\u5b9a: " + currentWeightValue.toFixed(1) + " kg", "success");
}

function captureTare() {
  if (weighState.gross === null) {
    showToast("\u8bf7\u5148\u9501\u5b9a\u6bdb\u91cd", "error");
    return;
  }
  if (!isStable && weightHistory.length >= 5) {
    showToast("\u91cd\u91cf\u4e0d\u7a33\u5b9a\uff0c\u8bf7\u7b49\u5f85\u7a33\u5b9a\u540e\u518d\u9501\u5b9a", "error");
    return;
  }
  weighState.tare = currentWeightValue;
  updateModeUI();
  showToast("\u76ae\u91cd\u5df2\u9501\u5b9a: " + currentWeightValue.toFixed(1) + " kg", "success");
}

function manualTare() {
  const val = parseFloat(prompt("\u8bf7\u8f93\u5165\u76ae\u91cd\u503c (kg):", "5000"));
  if (isNaN(val) || val < 0 || val > 50000) {
    showToast("\u76ae\u91cd\u65e0\u6548", "error");
    return;
  }
  weighState.tare = val;
  weighState.mode = "double";
  if (weighState.gross === null) weighState.gross = currentWeightValue;
  updateModeUI();
  showToast("\u76ae\u91cd\u5df2\u8bbe\u7f6e: " + val.toFixed(1) + " kg", "success");
}

function clearWeighState() {
  weighState = { gross: null, tare: null, mode: "single" };
  weightHistory = [];
  isStable = false;
  drawSparkline();
  const badge = $("stabilityBadge");
  if (badge) {
    badge.className = "stability-badge unstable";
    badge.innerHTML = '<span class="stability-dot"></span> \u7edf\u8ba1\u4e2d...';
  }
  updateModeUI();
  ["plateInput","driverInput","customerInput","specInput"].forEach(id => {
    const el = $(id); if (el) el.value = "";
  });
  const cs = $("cargoSelect"); if (cs) cs.value = "";
  const ss = $("supplierSelect"); if (ss) ss.value = "";
  showToast("\u5df2\u91cd\u7f6e", "success");
}

function updateModeUI() {
  const badge = $("modeBadge");
  const btnGross = $("btnGross");
  const btnTare = $("btnTare");

  if (weighState.mode === "double") {
    if (badge) {
      badge.innerHTML = "\u2696 \u4e8c\u6b21\u79f0\u91cd\u6a21\u5f0f";
      badge.style.color = "#f0b840";
      badge.style.borderColor = "rgba(240,184,64,0.3)";
    }
    if (btnGross) {
      btnGross.disabled = true;
      btnGross.textContent = "\u2713 \u6bdb\u91cd: " +
        (weighState.gross != null ? weighState.gross.toFixed(0) + "kg" : "--");
    }
    if (btnTare) {
      if (weighState.tare !== null) {
        btnTare.disabled = true;
        btnTare.textContent = "\u2713 \u76ae\u91cd: " + weighState.tare.toFixed(0) + "kg";
      } else {
        btnTare.disabled = false;
        btnTare.textContent = "\u2696 \u76ae\u91cd";
      }
    }
  } else {
    if (badge) {
      badge.innerHTML = "\u{1F4D7} \u4e00\u6b21\u79f0\u91cd\u6a21\u5f0f";
      badge.style.color = "#60a5fa";
      badge.style.borderColor = "#1a2a4a";
    }
    if (btnGross) { btnGross.disabled = false; btnGross.textContent = "\u2696 \u6bdb\u91cd"; }
    if (btnTare) { btnTare.disabled = true; btnTare.textContent = "\u2696 \u76ae\u91cd"; }
  }

  if (weighState.mode === "double") {
    const gross = weighState.gross != null ? weighState.gross : 0;
    const tare = weighState.tare != null ? weighState.tare : 0;
    updateSummaryDisplay(gross, tare, Math.max(0, gross - tare));
  }
}

// ============================================================
// HANDLE RECORD
// ============================================================
async function handleRecord() {
  const plate = ($("plateInput").value || "").trim().toUpperCase();
  if (!plate) {
    showToast("\u8bf7\u8f93\u5165\u8f66\u724c\u53f7", "error");
    $("plateInput").focus();
    return;
  }
  if (!PLATE_RE.test(plate)) {
    showToast("\u8f66\u724c\u53f7\u683c\u5f0f\u4e0d\u6b63\u786e", "error");
    $("plateInput").focus();
    return;
  }
  if (!isStable && weightHistory.length >= 5) {
    showToast("\u91cd\u91cf\u4e0d\u7a33\u5b9a\uff0c\u5efa\u8bae\u7b49\u5f85\u7a33\u5b9a\u540e\u8bb0\u5f55", "error");
  }

  const driverVal = ($("driverInput").value || "").trim();
  const cargoVal = ($("cargoSelect").value || "").trim();
  const supplierVal = ($("supplierSelect").value || "").trim();
  const customerVal = ($("customerInput").value || "").trim();
  const specVal = ($("specInput").value || "").trim();

  let gross, tare, net, mode;
  if (weighState.mode === "double") {
    if (weighState.gross === null) {
      showToast("\u8bf7\u5148\u9501\u5b9a\u6bdb\u91cd", "error"); return;
    }
    if (weighState.tare === null) {
      showToast("\u8bf7\u5148\u9501\u5b9a\u76ae\u91cd", "error"); return;
    }
    gross = weighState.gross;
    tare = weighState.tare;
    net = Math.max(0, gross - tare);
    mode = "double";
  } else {
    gross = currentWeightValue;
    tare = 0;
    net = currentWeightValue;
    mode = "single";
  }

  const btn = $("btnRecord");
  btn.disabled = true;
  btn.textContent = "\u63d0\u4ea4\u4e2d...";

  try {
    const payload = {
      plate, driver: driverVal, goods: cargoVal, supplier: supplierVal,
      customer: customerVal, spec: specVal, gross, tare, net, mode
    };
    const res = await fetch("/api/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast("\u8bb0\u5f55\u6210\u529f\uff01\u51c0\u91cd: " + net.toFixed(1) + " kg", "success");
      speakWeight(plate, net);
      clearWeighState();
      await Promise.all([fetchRecordsAll(), fetchStatsMini()]);
      if (currentPage === "records") renderRecordsPage();
    } else {
      showToast(data.error || "\u8bb0\u5f55\u5931\u8d25", "error");
    }
  } catch(e) {
    showToast("\u7f51\u7edc\u9519\u8bef\uff0c\u8bf7\u91cd\u8bd5", "error");
  }
  btn.disabled = false;
  btn.textContent = "\u{1F4DD} \u8bb0\u5f55\u79f0\u91cd";
}

// ============================================================
// RECORDS FETCHING
// ============================================================
async function fetchRecordsAll() {
  try {
    const res = await fetch("/api/records/all");
    const data = await res.json();
    recordsCache = data.records || [];
    renderMiniRecords();
    const el = $("totalRecords");
    if (el) el.textContent = recordsCache.length;
  } catch(e) {}
}

function renderMiniRecords() {
  const tbody = $("miniRecordsBody");
  if (!tbody) return;
  const recent = recordsCache.slice(0, 10);
  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="color:var(--text-dim);text-align:center;padding:20px;">\u6682\u65e0\u8bb0\u5f55</td></tr>';
    return;
  }
  tbody.innerHTML = recent.map(r => {
    const t = (r.time || "").replace("T", " ").substring(0, 16);
    return '<tr><td style="color:var(--text-dim);">' + escapeHtml(t) +
      '</td><td style="font-weight:500;">' + escapeHtml(r.plate) +
      '</td><td style="color:#4ade80;">' + (r.net || 0).toFixed(0) + '</td></tr>';
  }).join("");
}

// ============================================================
// RECORDS PAGE
// ============================================================
function renderRecordsPage() {
  recordsPage = 1;
  renderRecordsTable();
}

function renderRecordsTable() {
  let records = [...recordsCache].reverse();
  const search = ($("recordsSearch").value || "").toLowerCase();
  const dateFilter = ($("recordsDate").value || "").trim();

  if (dateFilter) {
    records = records.filter(r => (r.time || "").startsWith(dateFilter));
  }
  if (search) {
    records = records.filter(r =>
      (r.plate||"").toLowerCase().includes(search) ||
      (r.driver||"").toLowerCase().includes(search) ||
      (r.goods||"").toLowerCase().includes(search) ||
      (r.supplier||"").toLowerCase().includes(search) ||
      (r.customer||"").toLowerCase().includes(search) ||
      (r.spec||"").toLowerCase().includes(search)
    );
  }

  const countEl = $("recordsCount");
  if (countEl) countEl.textContent = "\u5171 " + records.length + " \u6761\u8bb0\u5f55";

  const totalPages = Math.max(1, Math.ceil(records.length / PER_PAGE));
  if (recordsPage > totalPages) recordsPage = totalPages;
  const start = (recordsPage - 1) * PER_PAGE;
  const pageItems = records.slice(start, start + PER_PAGE);

  const tbody = $("recordsPageBody");
  if (pageItems.length === 0) {
    tbody.innerHTML = '<tr><td colspan="14"><div class="empty-state"><span class="empty-icon">\u{1F4EE}</span><span class="empty-text">\u6682\u65e0\u5339\u914d\u8bb0\u5f55</span></div></td></tr>';
  } else {
    tbody.innerHTML = pageItems.map(r => {
      const t = (r.time || "").replace("T", " ").substring(0, 19);
      const modeLabel = r.mode === "double" ? "\u4e8c\u6b21" : "\u4e00\u6b21";
      return '<tr>' +
        '<td>' + r.id + '</td>' +
        '<td style="font-weight:500;">' + escapeHtml(r.plate) + '</td>' +
        '<td>' + escapeHtml(r.driver||"") + '</td>' +
        '<td>' + escapeHtml(r.customer||"") + '</td>' +
        '<td>' + escapeHtml(r.goods||"") + '</td>' +
        '<td>' + escapeHtml(r.spec||"") + '</td>' +
        '<td>' + escapeHtml(r.supplier||"") + '</td>' +
        '<td style="color:#60a5fa;">' + (r.gross||0).toFixed(0) + '</td>' +
        '<td style="color:#f87171;">' + (r.tare||0).toFixed(0) + '</td>' +
        '<td style="color:#4ade80;font-weight:600;">' + (r.net||0).toFixed(0) + '</td>' +
        '<td><span style="font-size:11px;padding:2px 7px;border-radius:8px;background:' +
          (r.mode==="double"?"#1a1a10":"#0a1a20") + ';color:' +
          (r.mode==="double"?"#f0b840":"#60a5fa") + ';">' + modeLabel + '</span></td>' +
        '<td style="font-size:12px;color:var(--text-dim)">' + t + '</td>' +
        '<td>' +
          '<span style="cursor:pointer;color:var(--red);font-size:18px;line-height:1;" ' +
            'onclick="deleteRecord(' + r.id + ')" title="\u5220\u9664">&times;</span> ' +
          '<span style="cursor:pointer;color:var(--accent);font-size:13px;margin-left:6px;" ' +
            'onclick="viewSlip(' + r.id + ')" title="\u67e5\u770b\u78c5\u5355">\u{1F4C4}</span>' +
        '</td></tr>';
    }).join("");
  }

  const pagEl = $("pagination");
  if (totalPages <= 1) {
    pagEl.innerHTML = "";
  } else {
    pagEl.innerHTML =
      '<button class="page-btn" ' + (recordsPage <= 1 ? "disabled" : "") +
        ' onclick="goPage(' + (recordsPage-1) + ')">\u2190 \u4e0a\u4e00\u9875</button>' +
      '<span class="page-info">\u7b2c ' + recordsPage + ' / ' + totalPages + ' \u9875</span>' +
      '<button class="page-btn" ' + (recordsPage >= totalPages ? "disabled" : "") +
        ' onclick="goPage(' + (recordsPage+1) + ')">\u4e0b\u4e00\u9875 \u2192</button>';
  }
}

function goPage(p) { recordsPage = p; renderRecordsTable(); }

async function deleteRecord(id) {
  if (!confirm("\u786e\u8ba4\u5220\u9664\u8bb0\u5f55 #" + id + "\uff1f")) return;
  try {
    const res = await fetch("/api/record/" + id, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      showToast("\u8bb0\u5f55\u5df2\u5220\u9664", "success");
      await fetchRecordsAll();
      if (currentPage === "records") renderRecordsTable();
    } else {
      showToast("\u5220\u9664\u5931\u8d25", "error");
    }
  } catch(e) { showToast("\u7f51\u7edc\u9519\u8bef", "error"); }
}

async function exportCSV() {
  const search = ($("recordsSearch").value || "").trim();
  const date = ($("recordsDate").value || "").trim();
  let url = "/api/export_csv?";
  if (search) url += "plate=" + encodeURIComponent(search) + "&";
  if (date) url += "date=" + encodeURIComponent(date);
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "weighbridge_records.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("CSV \u5bfc\u51fa\u6210\u529f", "success");
  } catch(e) { showToast("\u5bfc\u51fa\u5931\u8d25", "error"); }
}

// ============================================================
// STATS PAGE
// ============================================================
async function fetchStatsMini() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();
    const tc = $("todayCount"); if (tc) tc.textContent = data.today ? data.today.count : 0;
    const tn = $("todayNet"); if (tn) tn.textContent = data.today ? (data.today.total_net || 0).toFixed(0) : 0;
  } catch(e) {}
}

async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();
    renderKPI(data);
    renderBarChart(data.seven_days || []);
    renderTopPlates(data.top_plates || []);
  } catch(e) {
    const kg = $("kpiGrid");
    if (kg) kg.innerHTML = '<div style="color:var(--text-dim);text-align:center;grid-column:1/-1;padding:20px;">\u7edf\u8ba1\u52a0\u8f7d\u5931\u8d25</div>';
  }
}

function renderKPI(data) {
  const t = data.today || {};
  const kg = $("kpiGrid");
  if (!kg) return;
  kg.innerHTML =
    '<div class="kpi-card accent"><div class="kpi-label">\u4eca\u65e5\u8f66\u6b21</div><div class="kpi-value">' + (t.count||0) + '<span class="kpi-unit">\u8f86</span></div></div>' +
    '<div class="kpi-card"><div class="kpi-label">\u4eca\u65e5\u51c0\u91cd\u603b\u91cf</div><div class="kpi-value" style="color:#4ade80;">' + (t.total_net||0).toFixed(0) + '<span class="kpi-unit">kg</span></div></div>' +
    '<div class="kpi-card"><div class="kpi-label">\u4eca\u65e5\u5e73\u5747\u51c0\u91cd</div><div class="kpi-value" style="color:#60a5fa;">' + (t.avg_net||0).toFixed(0) + '<span class="kpi-unit">kg</span></div></div>' +
    '<div class="kpi-card accent"><div class="kpi-label">\u4eca\u65e5\u6700\u9ad8\u5355\u6b21\u51c0\u91cd</div><div class="kpi-value">' + (t.max_net||0).toFixed(0) + '<span class="kpi-unit">kg</span></div></div>' +
    '<div class="kpi-card"><div class="kpi-label">\u5386\u53f2\u603b\u8bb0\u5f55</div><div class="kpi-value">' + (data.total_records||0) + '<span class="kpi-unit">\u6761</span></div></div>';
}

function renderBarChart(sevenDays) {
  const el = $("barChart");
  if (!el) return;
  const maxVal = Math.max(...sevenDays.map(d => d.count), 1);
  if (maxVal === 0) {
    el.innerHTML = '<div class="empty-state"><span class="empty-icon">\u{1F4CA}</span><span class="empty-text">\u8fd17\u5929\u65e0\u6570\u636e</span></div>';
    return;
  }
  el.innerHTML = sevenDays.map(d => {
    const h = Math.max(2, (d.count / maxVal) * 170);
    const label = d.date.substring(5);
    return '<div class="bar-col"><div class="bar-value">' + d.count +
      '</div><div class="bar-fill" style="height:' + h + 'px;"></div>' +
      '<div class="bar-label">' + label + '</div></div>';
  }).join("");
}

function renderTopPlates(plates) {
  const tb = $("topPlatesBody");
  if (!tb) return;
  if (!plates || plates.length === 0) {
    tb.innerHTML = '<tr><td colspan="4"><div class="empty-state"><span class="empty-icon">\u{1F4EE}</span><span class="empty-text">\u6682\u65e0\u6570\u636e</span></div></td></tr>';
    return;
  }
  tb.innerHTML = plates.slice(0, 5).map((p, i) => {
    const rc = i === 0 ? "r1" : i === 1 ? "r2" : i === 2 ? "r3" : "rn";
    return '<tr><td><span class="rank-num ' + rc + '">' + (i+1) + '</span></td>' +
      '<td style="font-weight:500;">' + escapeHtml(p.plate) + '</td>' +
      '<td>' + p.count + '</td>' +
      '<td style="font-variant-numeric:tabular-nums;">' + (p.total_net||0).toFixed(0) + '</td></tr>';
  }).join("");
}

// ============================================================
// SETTINGS PAGE
// ============================================================
async function fetchSettings() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    settingsData = data;
    const hc = $("headerCompany");
    if (hc) hc.textContent = data.company_name || "XX\u5730\u78c5\u7ad9";
  } catch(e) {}
}

async function saveCompanySettings() {
  const name = $("settingsCompanyName").value.trim();
  const sid = $("settingsScaleId").value.trim();
  if (!name) { showToast("\u8bf7\u8f93\u5165\u516c\u53f8\u540d\u79f0", "error"); return; }
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company_name: name, station_id: sid })
    });
    const data = await res.json();
    if (data.success) {
      settingsData = data;
      const hc = $("headerCompany"); if (hc) hc.textContent = name;
      showToast("\u8bbe\u7f6e\u5df2\u4fdd\u5b58", "success");
    }
  } catch(e) { showToast("\u4fdd\u5b58\u5931\u8d25", "error"); }
}

async function saveOverloadThreshold() {
  const val = parseInt($("settingsOverloadThreshold").value);
  if (isNaN(val) || val < 1000 || val > 50000) {
    showToast("\u9608\u503c\u987b\u5728 1000~50000 \u4e4b\u95f4", "error");
    return;
  }
  overloadThreshold = val;
  isOverload = false;
  const oa = $("overloadAlert"); if (oa) oa.classList.remove("show");
  showToast("\u8d85\u8f7d\u9608\u503c\u5df2\u8bbe\u4e3a " + val + " kg", "success");
}

function renderSettingsPage() {
  $("settingsCompanyName").value = settingsData.company_name || "XX\u5730\u78c5\u7ad9";
  $("settingsScaleId").value = settingsData.station_id || "DB-2024-001";
  $("settingsOverloadThreshold").value = overloadThreshold;
  renderCargoTags();
  renderSupplierTags();
  renderCustomerTags();
}

async function fetchGoods() {
  try { const r = await fetch("/api/goods"); const d = await r.json(); goodsCache = d.goods || []; renderCargoSelect(); } catch(e) {}
}
async function fetchSuppliers() {
  try { const r = await fetch("/api/suppliers"); const d = await r.json(); suppliersCache = d.suppliers || []; renderSupplierSelect(); } catch(e) {}
}
async function fetchCustomers() {
  try { const r = await fetch("/api/customers"); const d = await r.json(); customersCache = d.customers || []; } catch(e) {}
}

function renderCargoSelect() {
  const sel = $("cargoSelect");
  if (!sel) return;
  sel.innerHTML = '<option value="">-- \u9009\u62e9\u8d27\u7269 --</option>' +
    goodsCache.map(g => '<option value="' + escapeHtml(g.name) + '">' +
      escapeHtml(g.name) + (g.spec ? " (" + escapeHtml(g.spec) + ")" : "") + '</option>').join("");
}

function renderSupplierSelect() {
  const sel = $("supplierSelect");
  if (!sel) return;
  sel.innerHTML = '<option value="">-- \u9009\u62e9\u4f9b\u5e94\u5546 --</option>' +
    suppliersCache.map(s => '<option value="' + escapeHtml(s.name) + '">' + escapeHtml(s.name) + '</option>').join("");
}

async function addCargo() {
  const name = $("newCargoName").value.trim();
  const spec = $("newCargoSpec").value.trim();
  if (!name) { showToast("\u8bf7\u8f93\u5165\u8d27\u7269\u540d\u79f0", "error"); return; }
  try {
    await fetch("/api/goods", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, spec })
    });
    $("newCargoName").value = "";
    $("newCargoSpec").value = "";
    await fetchGoods();
    renderCargoTags();
    showToast("\u8d27\u7269\u5df2\u6dfb\u52a0", "success");
  } catch(e) { showToast("\u6dfb\u52a0\u5931\u8d25", "error"); }
}

async function removeCargo(id) {
  try { await fetch("/api/goods/" + id, { method: "DELETE" }); await fetchGoods(); renderCargoTags(); } catch(e) {}
}

function renderCargoTags() {
  const el = $("cargoTags");
  if (!el) return;
  if (goodsCache.length === 0) {
    el.innerHTML = '<span style="color:var(--text-dim);font-size:12px;">\u6682\u65e0\u8d27\u7269</span>';
    return;
  }
  el.innerHTML = goodsCache.map(g =>
    '<span class="tag">' + escapeHtml(g.name) +
    (g.spec ? ' <span class="tag-spec">' + escapeHtml(g.spec) + '</span>' : '') +
    '<span class="tag-remove" onclick="removeCargo(' + g.id + ')">&times;</span></span>'
  ).join("");
}

async function addSupplier() {
  const name = $("newSupplierInput").value.trim();
  if (!name) { showToast("\u8bf7\u8f93\u5165\u4f9b\u5e94\u5546\u540d\u79f0", "error"); return; }
  try {
    await fetch("/api/suppliers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    $("newSupplierInput").value = "";
    await fetchSuppliers();
    renderSupplierTags();
    showToast("\u4f9b\u5e94\u5546\u5df2\u6dfb\u52a0", "success");
  } catch(e) { showToast("\u6dfb\u52a0\u5931\u8d25", "error"); }
}

async function removeSupplier(id) {
  try { await fetch("/api/suppliers/" + id, { method: "DELETE" }); await fetchSuppliers(); renderSupplierTags(); } catch(e) {}
}

function renderSupplierTags() {
  const el = $("supplierTags");
  if (!el) return;
  if (suppliersCache.length === 0) {
    el.innerHTML = '<span style="color:var(--text-dim);font-size:12px;">\u6682\u65e0\u4f9b\u5e94\u5546</span>';
    return;
  }
  el.innerHTML = suppliersCache.map(s =>
    '<span class="tag">' + escapeHtml(s.name) +
    '<span class="tag-remove" onclick="removeSupplier(' + s.id + ')">&times;</span></span>'
  ).join("");
}

async function addCustomer() {
  const name = $("newCustomerInput").value.trim();
  if (!name) { showToast("\u8bf7\u8f93\u5165\u6536\u8d27\u5355\u4f4d\u540d\u79f0", "error"); return; }
  try {
    await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    $("newCustomerInput").value = "";
    await fetchCustomers();
    renderCustomerTags();
    showToast("\u6536\u8d27\u5355\u4f4d\u5df2\u6dfb\u52a0", "success");
  } catch(e) { showToast("\u6dfb\u52a0\u5931\u8d25", "error"); }
}

async function removeCustomer(id) {
  try { await fetch("/api/customers/" + id, { method: "DELETE" }); await fetchCustomers(); renderCustomerTags(); } catch(e) {}
}

function renderCustomerTags() {
  const el = $("customerTags");
  if (!el) return;
  if (customersCache.length === 0) {
    el.innerHTML = '<span style="color:var(--text-dim);font-size:12px;">\u6682\u65e0\u6536\u8d27\u5355\u4f4d</span>';
    return;
  }
  el.innerHTML = customersCache.map(c =>
    '<span class="tag">' + escapeHtml(c.name) +
    '<span class="tag-remove" onclick="removeCustomer(' + c.id + ')">&times;</span></span>'
  ).join("");
}

async function clearAllData() {
  if (!confirm("\u786e\u8ba4\u6e05\u7a7a\u6240\u6709\u6570\u636e\uff1f\u6b64\u64cd\u4f5c\u4e0d\u53ef\u6062\u590d\uff01")) return;
  try {
    await fetch("/api/clear_all", { method: "POST" });
    recordsCache = [];
    $("totalRecords").textContent = "0";
    $("todayCount").textContent = "0";
    $("todayNet").textContent = "0";
    renderMiniRecords();
    showToast("\u6240\u6709\u6570\u636e\u5df2\u6e05\u7a7a", "success");
  } catch(e) { showToast("\u64cd\u4f5c\u5931\u8d25", "error"); }
}

// ============================================================
// SLIP / MODAL
// ============================================================
function viewSlip(id) {
  const r = recordsCache.find(x => x.id === id);
  if (!r) return;
  const t = (r.time || "").replace("T", " ").substring(0, 19);
  $("modalContent").innerHTML =
    '<h2>\u8fc7 \u78c5 \u5355</h2>' +
    '<table>' +
    '<tr><td>\u5730\u78c5\u7f16\u53f7</td><td>' + escapeHtml(settingsData.station_id || "") + '</td></tr>' +
    '<tr><td>\u65e5\u671f\u65f6\u95f4</td><td>' + escapeHtml(t) + '</td></tr>' +
    '<tr><td>\u8f66\u724c\u53f7\u7801</td><td style="font-size:16px;font-weight:700;">' + escapeHtml(r.plate) + '</td></tr>' +
    '<tr><td>\u53f8\u673a</td><td>' + escapeHtml(r.driver||"") + '</td></tr>' +
    '<tr><td>\u6536\u8d27\u5355\u4f4d</td><td>' + escapeHtml(r.customer||"") + '</td></tr>' +
    '<tr><td>\u8d27\u7269\u54c1\u540d</td><td>' + escapeHtml(r.goods||"") + '</td></tr>' +
    '<tr><td>\u89c4\u683c\u578b\u53f7</td><td>' + escapeHtml(r.spec||"") + '</td></tr>' +
    '<tr><td>\u4f9b\u5e94\u5546</td><td>' + escapeHtml(r.supplier||"") + '</td></tr>' +
    '<tr><td colspan="2"><div class="modal-divider"></div></td></tr>' +
    '<tr><td>\u6bdb\u91cd</td><td style="font-size:16px;">' + (r.gross||0).toFixed(1) + ' kg</td></tr>' +
    '<tr><td>\u76ae\u91cd</td><td>' + (r.tare||0).toFixed(1) + ' kg</td></tr>' +
    '<tr><td style="font-weight:700;">\u51c0\u91cd</td><td style="font-size:20px;font-weight:700;color:#1a1a1a;">' + (r.net||0).toFixed(1) + ' kg</td></tr>' +
    '</table>' +
    '<div class="modal-seal"><div class="modal-seal-circle">' +
      escapeHtml(settingsData.company_name||"XX\u5730\u78c5\u7ad9") + '</div></div>' +
    '<div class="modal-footer">\u672c\u78c5\u5355\u4e3a\u7535\u5b50\u8bb0\u5f55\uff0c\u4ec5\u4f9b\u5185\u90e8\u4f7f\u7528</div>' +
    '<div class="modal-actions">' +
      '<button class="btn btn-outline btn-sm" onclick="closeModal()">\u5173\u95ed</button>' +
      '<button class="btn btn-primary btn-sm" onclick="window.print()">\u{1F5A8} \u6253\u5370</button>' +
    '</div>';
  $("modalOverlay").classList.add("show");
}

function closeModal(e) {
  if (e && e.target !== $("modalOverlay")) return;
  $("modalOverlay").classList.remove("show");
}

// ============================================================
// TOAST
// ============================================================
let toastTimer = null;
function showToast(msg, type) {
  const el = $("toast");
  el.textContent = msg;
  el.className = "toast " + (type || "success") + " show";
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove("show"); }, 2500);
}

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
function handleKeyboard(e) {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.target.tagName === "TEXTAREA") return;
  switch(e.key.toLowerCase()) {
    case "g": captureGross(); break;
    case "t": captureTare(); break;
    case "r": handleRecord(); break;
    case "c": clearWeighState(); break;
    case "?": toggleShortcuts(); break;
    case "escape":
      $("shortcutsOverlay").classList.remove("show");
      $("modalOverlay").classList.remove("show");
      break;
  }
}

function toggleShortcuts() {
  $("shortcutsOverlay").classList.toggle("show");
}

// ============================================================
// UTILITY
// ============================================================
const _escapeDiv = document.createElement("div");
function escapeHtml(text) {
  if (!text) return "";
  _escapeDiv.textContent = text;
  return _escapeDiv.innerHTML;
}

// ============================================================
// VISIBILITY CHANGE
// ============================================================
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (pollTimeout) { clearTimeout(pollTimeout); pollTimeout = null; }
  } else {
    if (!pollTimeout) startPolling();
  }
});

// ============================================================
// STARTUP
// ============================================================
window.addEventListener("DOMContentLoaded", init);
