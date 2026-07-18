// ============================================================
// 地磅称重系统 v2.3 — 前端 JavaScript
// ============================================================

const $ = (id) => document.getElementById(id);
const CELL_HEIGHT = 96;
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
let vehiclesCache = [];
let settingsData = { company_name: "XX地磅站", station_id: "DB-2024-001", unit_price: 0.0 };
let pollTimeout = null;
let recordsPage = 1;
const PER_PAGE = 20;
let plateDebounceTimer = null;

// ============================================================
// INITIALIZATION
// ============================================================
async function init() {
  createDigitColumns();
  await Promise.all([
    fetchSettings(), fetchGoods(), fetchSuppliers(),
    fetchCustomers(), fetchVehicles(), fetchStatsMini(), fetchRecordsAll()
  ]);
  updateClock();
  setInterval(updateClock, 10000);
  startPolling();
  initCamera();
  document.querySelectorAll(".nav-item").forEach(el => {
    el.addEventListener("click", () => switchPage(el.dataset.page));
  });
  document.addEventListener("keydown", handleKeyboard);

  const plateInput = $("plateInput");
  if (plateInput) {
    plateInput.addEventListener("input", onPlateInput);
    plateInput.addEventListener("blur", () => {
      setTimeout(() => { const vs = $("vehicleSuggestions"); if (vs) vs.classList.remove("show"); }, 200);
    });
    plateInput.addEventListener("focus", onPlateInput);
  }

  if (plateInput) {
    plateInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const vs = $("vehicleSuggestions");
        if (vs && vs.classList.contains("show")) {
          const first = vs.querySelector(".vs-item");
          if (first) first.click();
        }
      }
    });
  }

  document.addEventListener("click", (e) => {
    const vs = $("vehicleSuggestions");
    const pi = $("plateInput");
    if (vs && pi && !pi.contains(e.target) && !vs.contains(e.target)) {
      vs.classList.remove("show");
    }
  });
}

function createDigitColumns() {
  const display = $("weightDisplay");
  if (!display) return;
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
  const el = $("headerTime");
  if (!el) return;
  el.textContent = new Date().toLocaleString("zh-CN", {
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
  if (page === "records") renderRecordsTable();
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
    updateFeeEstimate();
    setConnectionStatus(true);
  } catch(e) {
    setConnectionStatus(false);
  }
  pollTimeout = setTimeout(fetchWeight, 1000);
}

// ============================================================
// DIGIT DISPLAY (rollover animation)
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
  const gd = $("grossDisplay"); if (gd) gd.textContent = gross != null ? gross.toFixed(1) + " kg" : "--";
  const td = $("tareDisplay"); if (td) td.textContent = tare != null ? tare.toFixed(1) + " kg" : "--";
  const nd = $("netDisplay"); if (nd) nd.textContent = net != null ? net.toFixed(1) + " kg" : "--";
}

// ============================================================
// FEE ESTIMATE
// ============================================================
function updateFeeEstimate() {
  const feeBar = $("feeBar");
  const feeAmount = $("feeAmount");
  const feeHint = $("feeHint");
  if (!feeBar || !feeAmount) return;

  const unitPrice = settingsData.unit_price || 0;
  if (unitPrice <= 0) {
    feeBar.style.display = "none";
    return;
  }
  feeBar.style.display = "flex";

  let netWeight;
  if (weighState.mode === "double" && weighState.gross != null && weighState.tare != null) {
    netWeight = Math.max(0, weighState.gross - weighState.tare);
  } else {
    netWeight = currentWeightValue;
  }
  const fee = (netWeight / 1000) * unitPrice;
  feeAmount.textContent = "\u00a5" + fee.toFixed(2);
  if (feeHint) feeHint.textContent = "\u5355\u4ef7 " + unitPrice.toFixed(1) + " \u5143/\u5428";
}

// ============================================================
// STABILITY CHECK
// ============================================================
function checkStability(weight) {
  weightHistory.push(weight);
  if (weightHistory.length > STABILITY_WINDOW) weightHistory.shift();
  const badge = $("stabilityBadge");
  if (!badge) return false;
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
// SPARKLINE (mini trend chart)
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
// OVERLOAD CHECK
// ============================================================
function checkOverload(weight) {
  if (weight > overloadThreshold) {
    if (!isOverload) {
      isOverload = true;
      const oa = $("overloadAlert"); if (oa) oa.classList.add("show");
      const wp = $("weightPanel"); if (wp) wp.classList.add("overload");
      speak("\u8b66\u544a\uff0c\u91cd\u91cf\u8d85\u8f7d");
    }
  } else {
    if (isOverload) {
      isOverload = false;
      const oa = $("overloadAlert"); if (oa) oa.classList.remove("show");
      const wp = $("weightPanel"); if (wp) wp.classList.remove("overload");
    }
  }
}

// ============================================================
// SPEECH (Web Speech API)
// ============================================================
function speak(text) {
  try {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN'; u.rate = 0.9; u.volume = 0.7;
      window.speechSynthesis.speak(u);
    }
  } catch(e) { /* silent */ }
}

function speakWeight(gross, net, mode) {
  let txt = '\u91cd\u91cf\u8bb0\u5f55\u6210\u529f';
  if (mode === 'double') {
    txt += '\uff0c\u6bdb\u91cd' + Math.round(gross) + '\u516c\u65a4\uff0c\u51c0\u91cd' + Math.round(net) + '\u516c\u65a4';
  } else {
    txt += '\uff0c\u51c0\u91cd' + Math.round(net) + '\u516c\u65a4';
  }
  speak(txt);
}

// ============================================================
// CONNECTION STATUS
// ============================================================
function setConnectionStatus(connected) {
  if (connected === isConnected) return;
  isConnected = connected;
  const status = $('headerStatus');
  const statusText = $('headerStatusText');
  if (!status || !statusText) return;
  if (connected) {
    status.className = 'header-status';
    statusText.textContent = '\u4f20\u611f\u5668\u5728\u7ebf';
    fetchErrorCount = 0;
  } else {
    fetchErrorCount++;
    if (fetchErrorCount >= 3) {
      status.className = 'header-status offline';
      statusText.textContent = '\u4f20\u611f\u5668\u79bb\u7ebf';
    }
  }
}

// ============================================================
// CAMERA
// ============================================================
function initCamera() {
  const video = $('cameraVideo');
  const placeholder = $('cameraPlaceholder');
  if (!video || !placeholder) return;
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({video: {width: 640, height: 480}})
      .then(stream => {
        video.srcObject = stream;
        video.style.display = 'block';
        placeholder.style.display = 'none';
      })
      .catch(() => { /* no camera, use placeholder */ });
  }
}

function updateCameraTimestamp() {
  const el = $('cameraTimestamp');
  if (el) el.textContent = new Date().toLocaleTimeString('zh-CN');
}

// ============================================================
// VEHICLE MATCHING
// ============================================================
function onPlateInput() {
  clearTimeout(plateDebounceTimer);
  const q = ($('plateInput')?.value || '').trim().toUpperCase();
  const vs = $('vehicleSuggestions');
  if (!vs) return;
  if (q.length < 1) { vs.classList.remove('show'); return; }
  plateDebounceTimer = setTimeout(() => {
    const matches = vehiclesCache.filter(v => v.plate.toUpperCase().includes(q));
    if (matches.length === 0) { vs.classList.remove('show'); return; }
    vs.innerHTML = matches.map(v =>
      '<div class="vs-item" onclick="selectVehicle(' + v.id + ')">'
      + '<span>' + v.plate + '</span>'
      + '<span class="vs-driver">' + (v.driver || '') + '</span>'
      + '</div>'
    ).join('');
    vs.classList.add('show');
  }, 250);
}

function selectVehicle(id) {
  const v = vehiclesCache.find(x => x.id === id);
  if (!v) return;
  if ($('plateInput')) $('plateInput').value = v.plate;
  if ($('driverInput')) $('driverInput').value = v.driver || '';
  if (v.default_cargo && $('cargoSelect')) {
    for (let o of $('cargoSelect').options) { if (o.text === v.default_cargo) { $('cargoSelect').value = o.value; break; } }
  }
  if (v.default_supplier && $('supplierSelect')) {
    for (let o of $('supplierSelect').options) { if (o.text === v.default_supplier) { $('supplierSelect').value = o.value; break; } }
  }
  if (v.default_customer && $('customerInput')) $('customerInput').value = v.default_customer;
  const vs = $('vehicleSuggestions'); if (vs) vs.classList.remove('show');
}

// ============================================================
// WEIGH STATE (DUAL MODE)
// ============================================================
function captureGross() {
  if (!isStable) { showToast('\u91cd\u91cf\u4e0d\u7a33\u5b9a\uff0c\u8bf7\u7a0d\u7b49', 'error'); return; }
  weighState.gross = currentWeightValue;
  weighState.mode = 'double';
  if (weighState.tare != null) weighState.tare = null;
  updateModeUI();
  updateFeeEstimate();
  speak('\u6bdb\u91cd' + Math.round(currentWeightValue));
  showToast('\u6bdb\u91cd\u5df2\u9501\u5b9a: ' + currentWeightValue.toFixed(1) + ' kg', 'success');
}

function captureTare() {
  if (weighState.gross == null) { showToast('\u8bf7\u5148\u9501\u5b9a\u6bdb\u91cd', 'error'); return; }
  if (!isStable) { showToast('\u91cd\u91cf\u4e0d\u7a33\u5b9a\uff0c\u8bf7\u7a0d\u7b49', 'error'); return; }
  weighState.tare = currentWeightValue;
  updateModeUI();
  updateFeeEstimate();
  const net = Math.max(0, weighState.gross - weighState.tare);
  speak('\u76ae\u91cd' + Math.round(weighState.tare) + '\uff0c\u51c0\u91cd' + Math.round(net));
  showToast('\u76ae\u91cd: ' + weighState.tare.toFixed(1) + ' kg  |  \u51c0\u91cd: ' + net.toFixed(1) + ' kg', 'success');
}

function manualTare() {
  const tareStr = prompt('\u8bf7\u8f93\u5165\u76ae\u91cd (kg)\uff1a', weighState.tare != null ? weighState.tare.toFixed(0) : '');
  if (tareStr === null) return;
  const tareVal = parseFloat(tareStr);
  if (isNaN(tareVal) || tareVal < 0) { showToast('\u76ae\u91cd\u6570\u503c\u65e0\u6548', 'error'); return; }
  if (tareVal === 0) { weighState.tare = null; } else { weighState.tare = tareVal; }
  weighState.mode = 'double';
  if (weighState.gross == null) weighState.gross = currentWeightValue;
  updateModeUI();
  updateFeeEstimate();
  showToast('\u76ae\u91cd\u5df2\u8bbe\u7f6e: ' + tareVal.toFixed(0) + ' kg', 'success');
}

function clearWeighState() {
  weighState = { gross: null, tare: null, mode: 'single' };
  updateModeUI();
  updateFeeEstimate();
  showToast('\u5df2\u6e05\u96f6', 'success');
}

function updateModeUI() {
  const badge = $('modeBadge');
  const btnGross = $('btnGross');
  const btnTare = $('btnTare');
  if (!badge) return;
  if (weighState.mode === 'single') {
    badge.innerHTML = '\u26cf \u4e00\u6b21\u79f0\u91cd\u6a21\u5f0f';
    badge.style.background = '#0a1a20'; badge.style.borderColor = '#1a2a4a'; badge.style.color = '#60a5fa';
    if (btnGross) { btnGross.textContent = '\u26cf \u6bdb\u91cd'; btnGross.disabled = false; }
    if (btnTare) { btnTare.textContent = '\u26cf \u76ae\u91cd'; btnTare.disabled = true; }
  } else {
    let label = '\u4e8c\u6b21\u79f0\u91cd';
    if (weighState.gross != null) label += '  \u6bdb= ' + weighState.gross.toFixed(0);
    if (weighState.tare != null) label += '  \u76ae= ' + weighState.tare.toFixed(0);
    badge.innerHTML = '\u26cf ' + label;
    badge.style.background = '#1a1408'; badge.style.borderColor = '#3a2a08'; badge.style.color = '#f59e0b';
    if (btnGross) { btnGross.textContent = weighState.gross != null ? '\u2705 \u6bdb\u91cd\u5df2\u9501' : '\u26cf \u6bdb\u91cd'; btnGross.disabled = (weighState.gross != null); }
    if (btnTare) { btnTare.textContent = weighState.tare != null ? '\u2705 \u76ae\u91cd\u5df2\u9501(' + weighState.tare.toFixed(0) + ')' : '\u26cf \u76ae\u91cd'; btnTare.disabled = (weighState.gross == null || weighState.tare != null); }
  }
}

// ============================================================
// HANDLE RECORD
// ============================================================
async function handleRecord() {
  const plate = ($('plateInput')?.value || '').trim().toUpperCase();
  if (!plate) { showToast('\u8bf7\u8f93\u5165\u8f66\u724c\u53f7', 'error'); return; }
  if (!PLATE_RE.test(plate)) { showToast('\u8f66\u724c\u53f7\u683c\u5f0f\u4e0d\u6b63\u786e', 'error'); return; }

  let gross, tare, net, mode;
  if (weighState.mode === 'double' && weighState.gross != null && weighState.tare != null) {
    gross = weighState.gross; tare = weighState.tare; net = Math.max(0, gross - tare); mode = 'double';
  } else if (weighState.mode === 'double' && weighState.gross != null) {
    gross = weighState.gross; tare = 0; net = gross; mode = 'single';
  } else {
    gross = currentWeightValue; tare = 0; net = gross; mode = 'single';
  }

  const driver = ($('driverInput')?.value || '').trim();
  const cargoSelect = $('cargoSelect');
  const goods = (cargoSelect && cargoSelect.options[cargoSelect.selectedIndex] ? cargoSelect.options[cargoSelect.selectedIndex].text : '');
  if (goods === '-- \u9009\u62e9\u8d27\u7269 --') $('cargoSelect').value = '';
  const goodsFinal = (cargoSelect && cargoSelect.options[cargoSelect.selectedIndex] ? cargoSelect.options[cargoSelect.selectedIndex].text : '');
  if (goodsFinal === '-- \u9009\u62e9\u8d27\u7269 --') { /* empty */ }
  const spec = ($('specInput')?.value || '').trim();
  const supplierSelect = $('supplierSelect');
  const supplier = (supplierSelect && supplierSelect.options[supplierSelect.selectedIndex] ? supplierSelect.options[supplierSelect.selectedIndex].text : '');
  if (supplier === '-- \u9009\u62e9\u4f9b\u5e94\u5546 --') $('supplierSelect').value = '';
  const supFinal = (supplierSelect && supplierSelect.options[supplierSelect.selectedIndex] ? supplierSelect.options[supplierSelect.selectedIndex].text : '');
  const customer = ($('customerInput')?.value || '').trim();

  const payload = {
    plate, driver,
    goods: (goodsFinal === '-- \u9009\u62e9\u8d27\u7269 --') ? '' : goodsFinal,
    spec,
    supplier: (supFinal === '-- \u9009\u62e9\u4f9b\u5e94\u5546 --') ? '' : supFinal,
    customer,
    gross: round1(gross), tare: round1(tare), net: round1(net), mode
  };

  const btn = $('btnRecord'); if (btn) { btn.disabled = true; btn.textContent = '\u63d0\u4ea4\u4e2d...'; }

  try {
    const res = await fetch('/api/record', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.success) { showToast(data.error || '\u8bb0\u5f55\u5931\u8d25', 'error'); return; }

    recordsCache.unshift(data);
    if (recordsCache.length > 1000) recordsCache.length = 1000;
    renderMiniRecords();
    fetchStatsMini();
    clearWeighState();
    speakWeight(gross, net, mode);
    showToast('\u2713 ' + plate + '  |  \u51c0\u91cd: ' + net.toFixed(1) + ' kg', 'success');

    // Clear driver, keep plate for next
    if ($('driverInput')) $('driverInput').value = '';
  } catch(e) {
    showToast('\u8bb0\u5f55\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '\u2713 \u8bb0\u5f55\u79f0\u91cd'; }
  }
}

function round1(v) { return Math.round(v * 10) / 10; }

// ============================================================
// RECORDS (Fetch, Render, CRUD, Export)
// ============================================================
async function fetchRecordsAll() {
  try {
    const res = await fetch('/api/records/all');
    const data = await res.json();
    recordsCache = data.records || [];
    renderMiniRecords();
  } catch(e) { /* silent */ }
}

function renderMiniRecords() {
  const tbody = $('miniRecordsBody'); if (!tbody) return;
  const items = recordsCache.slice(0, 10);
  if (items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-dim);text-align:center;padding:20px;">\u6682\u65e0\u8bb0\u5f55</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(r => '<tr>'
    + '<td>' + formatTime(r.time) + '</td>'
    + '<td>' + escapeHtml(r.plate) + '</td>'
    + '<td>' + escapeHtml(r.goods || '') + '</td>'
    + '<td style="color:var(--green);font-weight:600;">' + (r.net != null ? r.net.toFixed(0) : '--') + '</td>'
    + '</tr>').join('');
}

async function renderRecordsTable(page) {
  if (typeof page === 'number') recordsPage = page;
  const keyword = ($('recordsSearch')?.value || '').trim();
  const dateVal = ($('recordsDate')?.value || '');

  let url = '/api/records?page=' + recordsPage + '&per_page=' + PER_PAGE;
  if (keyword) url += '&keyword=' + encodeURIComponent(keyword);
  if (dateVal) url += '&date=' + dateVal;

  try {
    const res = await fetch(url); const data = await res.json();
    const items = data.records || []; const total = data.total || 0;
    const totalPages = data.total_pages || 1;

    const countEl = $('recordsCount'); if (countEl) countEl.textContent = '\u5171 ' + total + ' \u6761\u8bb0\u5f55';

    const tbody = $('recordsPageBody');
    if (tbody) {
      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="13"><div class="empty-state"><span class="empty-icon">&#x1F4CB;</span><span class="empty-text">\u6682\u65e0\u8bb0\u5f55</span></div></td></tr>';
      } else {
        tbody.innerHTML = items.map(r => '<tr>'
          + '<td>' + r.id + '</td>'
          + '<td>' + escapeHtml(r.plate) + '</td>'
          + '<td>' + escapeHtml(r.driver || '') + '</td>'
          + '<td>' + escapeHtml(r.customer || '') + '</td>'
          + '<td>' + escapeHtml(r.goods || '') + '</td>'
          + '<td>' + escapeHtml(r.spec || '') + '</td>'
          + '<td>' + escapeHtml(r.supplier || '') + '</td>'
          + '<td>' + (r.gross || 0).toFixed(1) + '</td>'
          + '<td>' + (r.tare || 0).toFixed(1) + '</td>'
          + '<td style="color:' + ((r.net || 0) > 0 ? 'var(--green)' : 'var(--text)') + ';font-weight:600;">' + (r.net || 0).toFixed(1) + '</td>'
          + '<td>' + (r.mode === 'double' ? '\u4e8c\u6b21' : '\u4e00\u6b21') + '</td>'
          + '<td>' + formatTime(r.time) + '</td>'
          + '<td><button class="btn btn-danger btn-sm" onclick="deleteRecord(' + r.id + ')">\u5220\u9664</button><button class="btn btn-outline btn-sm" style="margin-left:4px;" onclick="viewSlip(' + r.id + ')">\u7968</button></td>'
          + '</tr>').join('');
      }
    }

    const pag = $('pagination');
    if (pag) {
      pag.innerHTML = '<button class="page-btn" ' + (recordsPage <= 1 ? 'disabled' : '') + ' onclick="renderRecordsTable(' + (recordsPage - 1) + ')">\u2190 \u4e0a\u4e00\u9875</button>'
        + '<span class="page-info">' + recordsPage + ' / ' + totalPages + '</span>'
        + '<button class="page-btn" ' + (recordsPage >= totalPages ? 'disabled' : '') + ' onclick="renderRecordsTable(' + (recordsPage + 1) + ')">\u4e0b\u4e00\u9875 \u2192</button>';
    }
  } catch(e) { /* silent */ }
}

async function deleteRecord(id) {
  if (!confirm('\u786e\u8ba4\u5220\u9664\u8bb0\u5f55 ID:' + id + ' \uff1f')) return;
  try {
    const res = await fetch('/api/record/' + id, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      recordsCache = recordsCache.filter(r => r.id !== id);
      renderRecordsTable();
      renderMiniRecords();
      fetchStatsMini();
      showToast('\u8bb0\u5f55\u5df2\u5220\u9664', 'success');
    }
  } catch(e) { showToast('\u5220\u9664\u5931\u8d25', 'error'); }
}

function exportCSV() {
  const keyword = ($('recordsSearch')?.value || '').trim();
  const dateVal = ($('recordsDate')?.value || '');
  let url = '/api/export_csv';
  const params = [];
  if (keyword) params.push('plate=' + encodeURIComponent(keyword));
  if (dateVal) params.push('date=' + dateVal);
  if (params.length) url += '?' + params.join('&');
  const a = document.createElement('a');
  a.href = url; a.download = 'weighbridge_records.csv'; a.click();
}

// ============================================================
// STATS
// ============================================================
async function fetchStatsMini() {
  try {
    const res = await fetch('/api/stats'); const data = await res.json();
    const today = data.today || {};
    setKPIVals({
      wkTodayCount: (today.count || 0) + '<span class="kpi-unit">\u8f86</span>',
      wkTodayNet: ((today.total_net || 0) / 1000).toFixed(1) + '<span class="kpi-unit">t</span>',
      wkTodayAvg: (today.avg_net || 0).toFixed(0) + '<span class="kpi-unit">kg</span>',
      wkTodayMax: (today.max_net || 0).toFixed(0) + '<span class="kpi-unit">kg</span>',
      wkTotalRecords: (data.total_records || 0) + '<span class="kpi-unit">\u6761</span>'
    });
    setElText('hkTodayCount', today.count || 0);
    setElText('hkTodayNet', ((today.total_net || 0) / 1000).toFixed(1));
    const badge = $('navTodayBadge');
    if (badge) {
      const c = today.count || 0;
      if (c > 0) { badge.style.display = ''; badge.textContent = c; }
      else badge.style.display = 'none';
    }
  } catch(e) { /* silent */ }
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats'); const data = await res.json();
    renderKPI(data.today);
    renderBarChart(data.seven_days || []);
    renderTopPlates(data.top_plates || []);
  } catch(e) { /* silent */ }
}

function renderKPI(today) {
  const grid = $('kpiGrid'); if (!grid) return;
  const items = [
    {label:'\u4eca\u65e5\u8f66\u6b21', val:(today.count||0)+'\u8f86', color:'var(--accent)'},
    {label:'\u4eca\u65e5\u603b\u51c0\u91cd (t)', val:((today.total_net||0)/1000).toFixed(1), color:'var(--green)'},
    {label:'\u4eca\u65e5\u5e73\u5747\u51c0\u91cd (kg)', val:(today.avg_net||0).toFixed(0), color:'var(--blue)'},
    {label:'\u4eca\u65e5\u6700\u9ad8\u51c0\u91cd (kg)', val:(today.max_net||0).toFixed(0), color:'var(--orange)'},
    {label:'\u5386\u53f2\u603b\u8bb0\u5f55', val:'--', color:'var(--text-dim)'}
  ];
  grid.innerHTML = items.map(i => '<div class="kpi-card"><div class="kpi-label">'+i.label+'</div><div class="kpi-value" style="color:'+i.color+';">'+i.val+'</div></div>').join('');
}

function renderBarChart(sevenDays) {
  const chart = $('barChart'); if (!chart) return;
  if (sevenDays.length === 0) { chart.innerHTML = '<div class="empty-state"><span class="empty-icon">&#x1F4CA;</span><span class="empty-text">\u6682\u65e0\u6570\u636e</span></div>'; return; }
  const maxCount = Math.max(1, ...sevenDays.map(d => d.count));
  chart.innerHTML = sevenDays.map(d => {
    const pct = Math.round((d.count / maxCount) * 100);
    const dateLabel = d.date.slice(5);
    return '<div class="bar-col">'
      + '<span class="bar-value">' + d.count + '</span>'
      + '<div class="bar-fill" style="height:' + pct + '%"></div>'
      + '<span class="bar-label">' + dateLabel + '</span>'
      + '</div>';
  }).join('');
}

function renderTopPlates(plates) {
  const tbody = $('topPlatesBody'); if (!tbody) return;
  const top5 = plates.slice(0, 5);
  if (top5.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3"><div class="empty-state"><span class="empty-icon">&#x1F4CA;</span><span class="empty-text">\u6682\u65e0\u6570\u636e</span></div></td></tr>';
    return;
  }
  tbody.innerHTML = top5.map((p, i) => {
    let rankClass = '';
    if (i === 0) rankClass = ' r1'; else if (i === 1) rankClass = ' r2'; else if (i === 2) rankClass = ' r3';
    return '<tr>'
      + '<td><span class="rank-num' + rankClass + '">' + (i + 1) + '</span></td>'
      + '<td>' + escapeHtml(p.plate) + '</td>'
      + '<td>' + p.count + ' \u6b21</td>'
      + '</tr>';
  }).join('');
}

// ============================================================
// SETTINGS
// ============================================================
async function fetchSettings() {
  try {
    const res = await fetch('/api/settings');
    settingsData = await res.json();
    applySettings();
  } catch(e) { /* silent */ }
}

function applySettings() {
  setElText('headerCompany', settingsData.company_name || 'XX地磅站');
}

async function saveCompanySettings() {
  const company = ($('settingsCompanyName')?.value || '').trim();
  const sid = ($('settingsScaleId')?.value || '').trim();
  try {
    const res = await fetch('/api/settings', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({company_name: company, station_id: sid})
    });
    if (res.ok) { settingsData.company_name = company; settingsData.station_id = sid; applySettings(); showToast('\u8bbe\u7f6e\u5df2\u4fdd\u5b58', 'success'); }
  } catch(e) { showToast('\u4fdd\u5b58\u5931\u8d25', 'error'); }
}

async function saveUnitPrice() {
  const price = parseFloat($('settingsUnitPrice')?.value || '0');
  if (isNaN(price) || price < 0) { showToast('\u8bf7\u8f93\u5165\u6709\u6548\u4ef7\u683c', 'error'); return; }
  try {
    const res = await fetch('/api/settings', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({unit_price: price})
    });
    if (res.ok) { settingsData.unit_price = price; updateFeeEstimate(); showToast('\u5355\u4ef7\u5df2\u4fdd\u5b58: ' + price.toFixed(1) + ' \u5143/\u5428', 'success'); }
  } catch(e) { showToast('\u4fdd\u5b58\u5931\u8d25', 'error'); }
}

async function saveOverloadThreshold() {
  const val = parseInt($('settingsOverloadThreshold')?.value || '49000');
  if (isNaN(val) || val <= 0 || val > 50000) { showToast('\u8bf7\u8f93\u5165\u6709\u6548\u9608\u503c', 'error'); return; }
  overloadThreshold = val; showToast('\u8d85\u8f7d\u9608\u503c\u5df2\u4fdd\u5b58: ' + val + ' kg', 'success');
}

function renderSettingsPage() {
  if ($('settingsCompanyName')) $('settingsCompanyName').value = settingsData.company_name || '';
  if ($('settingsScaleId')) $('settingsScaleId').value = settingsData.station_id || '';
  if ($('settingsUnitPrice')) $('settingsUnitPrice').value = settingsData.unit_price || '';
  if ($('settingsOverloadThreshold')) $('settingsOverloadThreshold').value = overloadThreshold;
  renderCargoTags(); renderSupplierTags(); renderCustomerTags(); renderVehicleTags();
}

// --- Goods ---
async function fetchGoods() {
  try { const res = await fetch('/api/goods'); const data = await res.json(); goodsCache = data.goods || []; renderCargoSelect(); } catch(e) {}
}

function renderCargoSelect() {
  const sel = $('cargoSelect'); if (!sel) return;
  sel.innerHTML = '<option value="">-- 选择货物 --</option>' + goodsCache.map(g => '<option value="' + g.id + '">' + g.name + '</option>').join('');
}

function renderCargoTags() {
  const el = $('cargoTags'); if (!el) return;
  if (goodsCache.length === 0) { el.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">暂无货物</span>'; return; }
  el.innerHTML = goodsCache.map(g => '<span class="tag">' + g.name + (g.spec ? ' <span class="tag-spec">' + g.spec + '</span>' : '') + '<span class="tag-remove" onclick="removeCargo(' + g.id + ')"></span></span>').join('');
}

async function addCargo() {
  const name = ($('newCargoName')?.value || '').trim(); if (!name) { showToast('\u8bf7\u8f93\u5165\u8d27\u7269\u540d\u79f0', 'error'); return; }
  const spec = ($('newCargoSpec')?.value || '').trim();
  try {
    const res = await fetch('/api/goods', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, spec}) });
    const data = await res.json(); if (data.success) { goodsCache.push(data); renderCargoSelect(); renderCargoTags(); showToast('\u5df2\u6dfb\u52a0: ' + name, 'success'); if ($('newCargoName')) $('newCargoName').value = ''; if ($('newCargoSpec')) $('newCargoSpec').value = ''; }
  } catch(e) { showToast('\u6dfb\u52a0\u5931\u8d25', 'error'); }
}

async function removeCargo(id) {
  try {
    const res = await fetch('/api/goods/' + id, { method: 'DELETE' });
    if ((await res.json()).success) { goodsCache = goodsCache.filter(g => g.id !== id); renderCargoSelect(); renderCargoTags(); }
  } catch(e) {}
}

// --- Suppliers ---
async function fetchSuppliers() {
  try { const res = await fetch('/api/suppliers'); const data = await res.json(); suppliersCache = data.suppliers || []; renderSupplierSelect(); } catch(e) {}
}

function renderSupplierSelect() {
  const sel = $('supplierSelect'); if (!sel) return;
  sel.innerHTML = '<option value="">-- 选择供应商 --</option>' + suppliersCache.map(s => '<option value="' + s.id + '">' + s.name + '</option>').join('');
}

function renderSupplierTags() {
  const el = $('supplierTags'); if (!el) return;
  if (suppliersCache.length === 0) { el.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">暂无供应商</span>'; return; }
  el.innerHTML = suppliersCache.map(s => '<span class="tag">' + s.name + '<span class="tag-remove" onclick="removeSupplier(' + s.id + ')"></span></span>').join('');
}

async function addSupplier() {
  const name = ($('newSupplierInput')?.value || '').trim(); if (!name) { showToast('\u8bf7\u8f93\u5165\u4f9b\u5e94\u5546\u540d\u79f0', 'error'); return; }
  try {
    const res = await fetch('/api/suppliers', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name}) });
    const data = await res.json(); if (data.success) { suppliersCache.push(data); renderSupplierSelect(); renderSupplierTags(); showToast('\u5df2\u6dfb\u52a0: ' + name, 'success'); if ($('newSupplierInput')) $('newSupplierInput').value = ''; }
  } catch(e) { showToast('\u6dfb\u52a0\u5931\u8d25', 'error'); }
}

async function removeSupplier(id) {
  try {
    const res = await fetch('/api/suppliers/' + id, { method: 'DELETE' });
    if ((await res.json()).success) { suppliersCache = suppliersCache.filter(s => s.id !== id); renderSupplierSelect(); renderSupplierTags(); }
  } catch(e) {}
}

// --- Customers ---
async function fetchCustomers() {
  try { const res = await fetch('/api/customers'); const data = await res.json(); customersCache = data.customers || []; } catch(e) {}
}

function renderCustomerTags() {
  const el = $('customerTags'); if (!el) return;
  if (customersCache.length === 0) { el.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">暂无收货单位</span>'; return; }
  el.innerHTML = customersCache.map(c => '<span class="tag">' + c.name + '<span class="tag-remove" onclick="removeCustomer(' + c.id + ')"></span></span>').join('');
}

async function addCustomer() {
  const name = ($('newCustomerInput')?.value || '').trim(); if (!name) { showToast('\u8bf7\u8f93\u5165\u6536\u8d27\u5355\u4f4d\u540d\u79f0', 'error'); return; }
  try {
    const res = await fetch('/api/customers', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name}) });
    const data = await res.json(); if (data.success) { customersCache.push(data); renderCustomerTags(); showToast('\u5df2\u6dfb\u52a0: ' + name, 'success'); if ($('newCustomerInput')) $('newCustomerInput').value = ''; }
  } catch(e) { showToast('\u6dfb\u52a0\u5931\u8d25', 'error'); }
}

async function removeCustomer(id) {
  try {
    const res = await fetch('/api/customers/' + id, { method: 'DELETE' });
    if ((await res.json()).success) { customersCache = customersCache.filter(c => c.id !== id); renderCustomerTags(); }
  } catch(e) {}
}

// --- Vehicles ---
async function fetchVehicles() {
  try { const res = await fetch('/api/vehicles'); const data = await res.json(); vehiclesCache = data.vehicles || []; } catch(e) {}
}

function renderVehicleTags() {
  const el = $('vehicleTags'); if (!el) return;
  if (vehiclesCache.length === 0) { el.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">暂无车辆档案</span>'; return; }
  el.innerHTML = vehiclesCache.map(v => '<span class="tag">' + v.plate + (v.driver ? ' <span class="vehicle-tag-meta">' + v.driver + '</span>' : '') + (v.default_cargo ? ' <span class="vehicle-tag-meta">' + v.default_cargo + '</span>' : '') + '<span class="tag-remove" onclick="removeVehicle(' + v.id + ')"></span></span>').join('');
}

async function addVehicle() {
  const plate = ($('newVehiclePlate')?.value || '').trim().toUpperCase();
  if (!plate) { showToast('\u8bf7\u8f93\u5165\u8f66\u724c\u53f7', 'error'); return; }
  const driver = ($('newVehicleDriver')?.value || '').trim();
  const cargo = ($('newVehicleCargo')?.value || '').trim();
  const supplier = ($('newVehicleSupplier')?.value || '').trim();
  try {
    const res = await fetch('/api/vehicles', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({plate, driver, default_cargo: cargo, default_supplier: supplier})
    });
    const data = await res.json();
    if (data.success) { vehiclesCache.push(data); renderVehicleTags(); showToast('\u5df2\u6dfb\u52a0: ' + plate, 'success'); ['newVehiclePlate','newVehicleDriver','newVehicleCargo','newVehicleSupplier'].forEach(id => { const el = $(id); if (el) el.value = ''; }); }
  } catch(e) { showToast('\u6dfb\u52a0\u5931\u8d25', 'error'); }
}

async function removeVehicle(id) {
  try {
    const res = await fetch('/api/vehicles/' + id, { method: 'DELETE' });
    if ((await res.json()).success) { vehiclesCache = vehiclesCache.filter(v => v.id !== id); renderVehicleTags(); }
  } catch(e) {}
}

// ============================================================
// MODAL (Slip Preview)
// ============================================================
function viewSlip(recordId) {
  const r = recordsCache.find(x => x.id === recordId); if (!r) return;
  const overlay = $('modalOverlay'); const content = $('modalContent'); if (!overlay || !content) return;
  content.innerHTML = '<h2>' + (settingsData.company_name || 'XX地磅站') + '</h2>'
    + '<table>'
    + '<tr><td>地磅编号</td><td>' + (settingsData.station_id || '') + '</td></tr>'
    + '<tr><td>日期时间</td><td>' + formatTime(r.time) + '</td></tr>'
    + '<tr><td>车牌号码</td><td>' + escapeHtml(r.plate) + '</td></tr>'
    + '<tr><td>司机</td><td>' + escapeHtml(r.driver || '') + '</td></tr>'
    + '<tr><td>货物</td><td>' + escapeHtml(r.goods || '') + ' ' + escapeHtml(r.spec || '') + '</td></tr>'
    + '<tr><td>供应商</td><td>' + escapeHtml(r.supplier || '') + '</td></tr>'
    + '<tr><td>收货单位</td><td>' + escapeHtml(r.customer || '') + '</td></tr>'
    + '<tr class="modal-divider"><td colspan="2"></td></tr>'
    + '<tr><td>毛重 (kg)</td><td><b>' + (r.gross || 0).toFixed(1) + '</b></td></tr>'
    + '<tr><td>皮重 (kg)</td><td>' + (r.tare || 0).toFixed(1) + '</td></tr>'
    + '<tr><td>净重 (kg)</td><td><b style="font-size:16px;color:#d33;">' + (r.net || 0).toFixed(1) + '</b></td></tr>'
    + '</table>'
    + '<div class="modal-seal"><div class="modal-seal-circle">' + (settingsData.company_name || 'XX地磅站') + '</div></div>'
    + '<div class="modal-footer">操作员确认</div>'
    + '<div class="modal-actions">'
    + '<button class="btn btn-outline btn-sm" onclick="closeModal()">关闭</button>'
    + '<button class="btn btn-primary btn-sm" onclick="window.print()">&#x1F5A8; 打印</button>'
    + '</div>';
  overlay.classList.add('show');
}

function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  const overlay = $('modalOverlay'); if (overlay) overlay.classList.remove('show');
}

// ============================================================
// TOAST
// ============================================================
let toastTimer = null;
function showToast(msg, type) {
  const el = $('toast'); if (!el) return;
  el.textContent = msg; el.className = 'toast ' + type + ' show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); }, 2500);
}

// ============================================================
// SHORTCUTS
// ============================================================
function handleKeyboard(e) {
  if (currentPage !== 'weigh') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const key = e.key.toLowerCase();
  if (key === 'g') { e.preventDefault(); captureGross(); }
  else if (key === 't') { e.preventDefault(); captureTare(); }
  else if (key === 'r') { e.preventDefault(); handleRecord(); }
  else if (key === 'c') { e.preventDefault(); clearWeighState(); }
  else if (key === '?') { e.preventDefault(); toggleShortcuts(); }
}

function toggleShortcuts() {
  const el = $('shortcutsOverlay'); if (el) el.classList.toggle('show');
}

// ============================================================
// UTILITY
// ============================================================
const escapeDiv = document.createElement('div');
function escapeHtml(str) { escapeDiv.textContent = str || ''; return escapeDiv.innerHTML; }

function formatTime(isoStr) {
  if (!isoStr) return '';
  return isoStr.slice(0, 19).replace('T', ' ');
}

function setElText(id, val) {
  const el = $(id); if (el) el.textContent = val;
}

function setKPIVals(map) {
  for (let [id, val] of Object.entries(map)) { const el = $(id); if (el) el.innerHTML = val; }
}

async function clearAllData() {
  if (!confirm('危险操作确认！\n此操作将清空所有过磅记录，不可恢复。')) return;
  try {
    const res = await fetch('/api/clear_all', { method: 'POST' });
    if ((await res.json()).success) {
      recordsCache = []; renderMiniRecords(); renderRecordsTable(1); fetchStatsMini();
      showToast('所有数据已清空', 'success');
    }
  } catch(e) { showToast('清空失败', 'error'); }
}

// ============================================================
// VISIBILITY CHANGE (pause polling when tab hidden)
// ============================================================
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(pollTimeout); pollTimeout = null;
  } else {
    if (!pollTimeout) startPolling();
    updateClock();
  }
});

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', init);
