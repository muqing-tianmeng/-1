# build_v2.py — Assembles static/v2.html from CSS + skeleton HTML + JS
import os

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")

CSS = r"""
*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#080b12;--sidebar-bg:#05070d;--card-bg:#0f121c;--card-bg-hover:#141826;
  --border:#1a1e2c;--border-light:#222738;--text:#d0d5e0;--text-dim:#6b7190;
  --text-muted:#444860;--accent:#f0b840;--accent-glow:rgba(240,184,64,0.12);
  --green:#4ade80;--red:#f87171;--blue:#60a5fa;--orange:#f59e0b;
  --input-bg:#0a0d16;--input-border:#1e2232;--input-focus:#2a3050;
  --shadow-card:0 1px 3px rgba(0,0,0,0.4);
}
body{
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background:var(--bg);color:var(--text);min-height:100vh;
  display:grid;grid-template-columns:230px 1fr;-webkit-font-smoothing:antialiased;
}

/* ===== SIDEBAR ===== */
.sidebar{
  background:var(--sidebar-bg);display:flex;flex-direction:column;
  border-right:1px solid var(--border);padding:20px 0 16px 0;position:sticky;top:0;height:100vh;
}
.sidebar-logo{padding:0 20px 24px 20px;border-bottom:1px solid var(--border);margin-bottom:12px;}
.sidebar-logo .logo-icon{font-size:26px;display:block;margin-bottom:4px;}
.sidebar-logo h2{font-size:17px;font-weight:700;color:var(--text);letter-spacing:1px;margin:4px 0 2px 0;}
.sidebar-logo .ver{font-size:11px;color:var(--text-muted);}
.sidebar-nav{flex:1;padding:4px 10px;}
.nav-item{
  display:flex;align-items:center;gap:10px;padding:11px 14px;margin:2px 0;
  border-radius:8px;cursor:pointer;transition:all 0.15s;font-size:14px;color:var(--text-dim);
  user-select:none;
}
.nav-item:hover{background:var(--card-bg);color:var(--text);}
.nav-item.active{background:var(--accent-glow);color:var(--accent);font-weight:600;}
.nav-item .nav-icon{font-size:16px;width:20px;text-align:center;}
.sidebar-footer{padding:12px 20px;font-size:11px;color:var(--text-muted);border-top:1px solid var(--border);}

/* ===== MAIN HEADER ===== */
.main{display:flex;flex-direction:column;overflow-x:hidden;}
.main-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:12px 24px;background:var(--sidebar-bg);border-bottom:1px solid var(--border);
  position:sticky;top:0;z-index:10;
}
.header-company{font-size:15px;font-weight:600;color:var(--text);}
.header-right{display:flex;align-items:center;gap:18px;}
.header-status{display:flex;align-items:center;gap:7px;font-size:12px;color:var(--green);}
.header-status.offline{color:var(--red);}
.header-status-dot{width:7px;height:7px;border-radius:50%;background:currentColor;animation:pulse-dot 2s infinite;}
.header-status.offline .header-status-dot{animation:none;}
@keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:0.4}}
.header-time{font-size:13px;color:var(--text-dim);font-variant-numeric:tabular-nums;}
.main-content{flex:1;padding:20px 24px;overflow-y:auto;}

/* ===== PAGES ===== */
.page{display:none;}
.page.active{display:block;}

/* ===== WEIGH PAGE ===== */
.weigh-grid{display:grid;grid-template-columns:1fr 1fr;grid-template-rows:auto auto auto;gap:16px;}
.weigh-weight-panel{grid-column:1;grid-row:1;}
.weigh-stats-row{grid-column:1;grid-row:2;display:flex;gap:12px;}
.weigh-form-panel{grid-column:1;grid-row:3;}
.weigh-side-panel{grid-column:2;grid-row:1/4;display:flex;flex-direction:column;gap:16px;}

.weight-panel{
  background:var(--card-bg);border:1px solid var(--border);
  border-radius:12px;padding:20px 24px;transition:border-color 0.3s,box-shadow 0.3s;
}
.weight-panel.overload{border-color:var(--red);box-shadow:0 0 24px rgba(248,113,113,0.25);animation:overload-flash 0.6s infinite alternate;}
@keyframes overload-flash{from{box-shadow:0 0 16px rgba(248,113,113,0.2)}to{box-shadow:0 0 32px rgba(248,113,113,0.45)}}

.card-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;}
.card-label{font-size:13px;font-weight:600;color:var(--text-dim);letter-spacing:0.5px;text-transform:uppercase;}
.overload-alert{display:none;font-size:12px;color:var(--red);font-weight:700;animation:blink 0.5s infinite alternate;}
.overload-alert.show{display:inline;}
@keyframes blink{from{opacity:1}to{opacity:0.3}}

/* Digit Display */
.weight-display{
  display:flex;align-items:flex-end;justify-content:center;gap:4px;
  padding:18px 0 10px 0;font-family:"SF Mono","Consolas","Monaco",monospace;
}
.digit-column{
  width:56px;height:92px;overflow:hidden;border-radius:6px;
  background:#05070d;border:1px solid var(--border);position:relative;
}
.digit-strip{transition:transform 0.35s cubic-bezier(0.25,0.1,0.25,1);}
.digit-cell{
  width:56px;height:92px;display:flex;align-items:center;justify-content:center;
  font-size:64px;font-weight:800;color:var(--accent);line-height:1;
}
.decimal-dot{
  width:20px;text-align:center;font-size:56px;font-weight:800;color:var(--accent);
  padding-bottom:6px;line-height:1;
}

/* Stability */
.stability-row{display:flex;align-items:center;justify-content:space-between;margin:8px 0 12px 0;}
.stability-badge{
  display:flex;align-items:center;gap:6px;font-size:12px;font-weight:500;
  padding:4px 10px;border-radius:20px;border:1px solid var(--border);transition:all 0.3s;
}
.stability-badge.stable{color:var(--green);border-color:rgba(74,222,128,0.25);background:rgba(74,222,128,0.06);}
.stability-badge.unstable{color:var(--orange);border-color:rgba(245,158,11,0.25);background:rgba(245,158,11,0.06);}
.stability-dot{width:6px;height:6px;border-radius:50%;background:currentColor;}
.sparkline-canvas{border-radius:4px;}

/* Weight Summary */
.weight-summary{display:flex;gap:12px;margin-top:8px;}
.weight-item{
  flex:1;background:rgba(255,255,255,0.02);border:1px solid var(--border);
  border-radius:8px;padding:10px 14px;text-align:center;
}
.weight-item .label{font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;}
.weight-item .value{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;}
.weight-item .value.gross{color:var(--blue);}
.weight-item .value.tare{color:var(--red);}
.weight-item .value.net{color:var(--green);}

/* Mini Stats */
.mini-stat{
  flex:1;background:var(--card-bg);border:1px solid var(--border);
  border-radius:10px;padding:14px 16px;text-align:center;
}
.mini-stat.accent{border-color:rgba(240,184,64,0.2);background:var(--accent-glow);}
.ms-val{font-size:26px;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums;}
.ms-lbl{font-size:11px;color:var(--text-dim);margin-top:4px;}

/* Cards & Forms */
.card{background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:20px 24px;}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;margin-bottom:16px;}
.form-group{display:flex;flex-direction:column;gap:4px;}
.form-group label{font-size:12px;font-weight:500;color:var(--text-dim);}
.form-group input,.form-group select{
  background:var(--input-bg);border:1px solid var(--input-border);border-radius:6px;
  padding:9px 12px;color:var(--text);font-size:14px;outline:none;transition:border-color 0.2s;
  font-family:inherit;
}
.form-group input:focus,.form-group select:focus{border-color:var(--input-focus);}
.form-group input::placeholder{color:var(--text-muted);}
.form-group select option{background:var(--card-bg);color:var(--text);}

/* Buttons */
.btn-row{display:flex;gap:8px;flex-wrap:wrap;}
.btn{
  padding:9px 18px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;
  border:1px solid transparent;transition:all 0.15s;font-family:inherit;
  display:inline-flex;align-items:center;gap:5px;
}
.btn:active{transform:scale(0.97);}
.btn-primary{background:var(--accent);color:#1a1a0a;border-color:var(--accent);}
.btn-primary:hover{background:#f5c85a;box-shadow:0 0 16px var(--accent-glow);}
.btn-outline{background:transparent;color:var(--text-dim);border-color:var(--border);}
.btn-outline:hover{background:var(--card-bg-hover);color:var(--text);border-color:var(--border-light);}
.btn-outline:disabled{opacity:0.4;cursor:not-allowed;}
.btn-danger{background:rgba(248,113,113,0.15);color:var(--red);border-color:rgba(248,113,113,0.25);}
.btn-danger:hover{background:rgba(248,113,113,0.25);}
.btn-sm{padding:6px 14px;font-size:12px;}

.mode-indicator{font-size:12px;font-weight:500;padding:4px 12px;border-radius:20px;border:1px solid;}

/* Camera */
.camera-card .card-label{margin-bottom:10px;}
.camera-view{
  position:relative;width:100%;aspect-ratio:16/10;background:#000;
  border-radius:8px;overflow:hidden;border:1px solid var(--border);
}
.camera-placeholder{
  position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
  justify-content:center;color:var(--text-muted);gap:8px;
}
.camera-placeholder .icon{font-size:32px;}
.camera-placeholder{font-size:13px;}
.camera-view video{width:100%;height:100%;object-fit:cover;}
.camera-crosshair{
  position:absolute;inset:15%;border:1px dashed rgba(255,255,255,0.2);
  pointer-events:none;
}
.camera-crosshair::before,.camera-crosshair::after{
  content:'';position:absolute;background:rgba(255,255,255,0.15);
}
.camera-crosshair::before{top:50%;left:0;right:0;height:1px;}
.camera-crosshair::after{left:50%;top:0;bottom:0;width:1px;}
.camera-label{
  position:absolute;bottom:6px;right:10px;font-size:11px;color:rgba(255,255,255,0.5);
  font-family:monospace;background:rgba(0,0,0,0.5);padding:2px 6px;border-radius:3px;
}

/* Mini Table */
.mini-table{width:100%;border-collapse:collapse;font-size:12px;}
.mini-table thead th{
  position:sticky;top:0;background:var(--card-bg);color:var(--text-muted);
  font-weight:500;text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);
  font-size:11px;
}
.mini-table tbody td{padding:7px 10px;border-bottom:1px solid rgba(255,255,255,0.03);}

/* Records Page */
.records-header{display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap;}
.records-search,.records-date{
  background:var(--input-bg);border:1px solid var(--input-border);border-radius:6px;
  padding:8px 12px;color:var(--text);font-size:13px;outline:none;font-family:inherit;
}
.records-search:focus,.records-date:focus{border-color:var(--input-focus);}
.records-search{width:240px;}
.records-search::placeholder{color:var(--text-muted);}
.records-count{font-size:12px;color:var(--text-dim);white-space:nowrap;}

.records-table{width:100%;border-collapse:collapse;font-size:13px;}
.records-table thead th{
  position:sticky;top:0;background:var(--card-bg);color:var(--text-muted);
  font-weight:500;text-align:left;padding:9px 10px;border-bottom:1px solid var(--border);
  white-space:nowrap;font-size:11px;
}
.records-table tbody td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.03);}
.records-table tbody tr:hover{background:var(--card-bg-hover);}

.pagination{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:16px;}
.page-btn{
  background:var(--card-bg);border:1px solid var(--border);border-radius:6px;
  padding:7px 16px;color:var(--text-dim);font-size:12px;cursor:pointer;font-family:inherit;
  transition:all 0.15s;
}
.page-btn:hover:not(:disabled){background:var(--card-bg-hover);color:var(--text);}
.page-btn:disabled{opacity:0.3;cursor:not-allowed;}
.page-info{font-size:12px;color:var(--text-dim);}

/* Stats Page */
.kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px;}
.kpi-card{
  background:var(--card-bg);border:1px solid var(--border);border-radius:10px;
  padding:16px 18px;text-align:center;
}
.kpi-card.accent{border-color:rgba(240,184,64,0.2);background:var(--accent-glow);}
.kpi-label{font-size:11px;color:var(--text-dim);margin-bottom:6px;letter-spacing:0.5px;}
.kpi-value{font-size:28px;font-weight:800;color:var(--accent);font-variant-numeric:tabular-nums;}
.kpi-unit{font-size:13px;font-weight:400;color:var(--text-dim);margin-left:4px;}

.chart-card{background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:20px 24px;margin-bottom:16px;}
.chart-title{font-size:13px;font-weight:600;color:var(--text-dim);margin-bottom:16px;}
.bar-chart{display:flex;align-items:flex-end;gap:16px;height:200px;padding:0 4px;}
.bar-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;}
.bar-fill{
  width:100%;max-width:36px;background:linear-gradient(180deg,var(--accent),rgba(240,184,64,0.3));
  border-radius:4px 4px 0 0;min-height:2px;transition:height 0.4s;
}
.bar-value{font-size:11px;color:var(--text-dim);margin-bottom:4px;font-weight:600;}
.bar-label{font-size:10px;color:var(--text-muted);margin-top:6px;}

.top-plates-card{background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:20px 24px;}
.rank-num{
  display:inline-flex;align-items:center;justify-content:center;
  width:24px;height:24px;border-radius:50%;font-size:12px;font-weight:700;
  background:rgba(255,255,255,0.05);color:var(--text-dim);
}
.rank-num.r1{background:rgba(240,184,64,0.2);color:var(--accent)}
.rank-num.r2{background:rgba(192,192,208,0.15);color:#c0c0d0}
.rank-num.r3{background:rgba(180,140,100,0.15);color:#b48c64}

.empty-state{display:flex;flex-direction:column;align-items:center;gap:8px;padding:32px 0;color:var(--text-muted);}
.empty-icon{font-size:36px;opacity:0.5;}
.empty-text{font-size:13px;}

/* Settings */
.settings-section{
  background:var(--card-bg);border:1px solid var(--border);
  border-radius:12px;padding:20px 24px;margin-bottom:16px;
}
.settings-section h3{font-size:14px;font-weight:600;color:var(--text);margin-bottom:14px;}
.settings-row{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;}
.tag-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;}
.tag{
  display:inline-flex;align-items:center;gap:4px;font-size:12px;
  background:rgba(255,255,255,0.04);border:1px solid var(--border);border-radius:6px;
  padding:4px 8px;color:var(--text-dim);
}
.tag-spec{color:var(--text-muted);font-size:10px;}
.tag-remove{cursor:pointer;color:var(--text-muted);font-size:14px;margin-left:2px;line-height:1;}
.tag-remove:hover{color:var(--red);}

/* Modal */
.modal-overlay{
  display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);
  z-index:100;align-items:center;justify-content:center;
}
.modal-overlay.show{display:flex;}
.modal{
  background:#fff;color:#1a1a1a;border-radius:12px;padding:32px;max-width:500px;width:90%;
  max-height:85vh;overflow-y:auto;position:relative;
}
.modal h2{text-align:center;font-size:18px;letter-spacing:6px;margin-bottom:20px;color:#222;}
.modal table{width:100%;border-collapse:collapse;}
.modal table td{padding:6px 8px;border-bottom:1px solid #e5e5e5;font-size:13px;}
.modal table td:first-child{color:#666;width:90px;font-size:12px;}
.modal-divider{border-top:2px solid #222;margin:8px 0;}
.modal-seal{display:flex;justify-content:flex-end;margin-top:16px;}
.modal-seal-circle{
  border:2px solid var(--red);border-radius:50%;width:80px;height:80px;
  display:flex;align-items:center;justify-content:center;color:var(--red);
  font-size:11px;text-align:center;transform:rotate(-15deg);opacity:0.7;padding:4px;
}
.modal-footer{text-align:center;font-size:11px;color:#999;margin-top:12px;}
.modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;}

/* Toast */
.toast{
  position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);
  padding:10px 24px;border-radius:8px;font-size:14px;font-weight:500;z-index:200;
  transition:transform 0.3s;pointer-events:none;
}
.toast.success{background:#0d2818;color:var(--green);border:1px solid rgba(74,222,128,0.3);}
.toast.error{background:#2d1010;color:var(--red);border:1px solid rgba(248,113,113,0.3);}
.toast.show{transform:translateX(-50%) translateY(0);}

/* Shortcuts */
.shortcuts-overlay{
  display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);
  z-index:150;align-items:center;justify-content:center;
}
.shortcuts-overlay.show{display:flex;}
.shortcuts-panel{
  background:var(--card-bg);border:1px solid var(--border);border-radius:14px;
  padding:24px 28px;min-width:320px;
}
.shortcuts-panel h3{font-size:15px;font-weight:600;margin-bottom:16px;color:var(--accent);}
.shortcut-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px;}
.kbd{
  background:rgba(255,255,255,0.08);border:1px solid var(--border);border-radius:4px;
  padding:2px 8px;font-size:12px;font-family:monospace;color:var(--accent);
}
.shortcut-hint{margin-top:14px;font-size:11px;color:var(--text-muted);text-align:center;}

/* Scrollbar */
::-webkit-scrollbar{width:5px;height:5px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--border-light);border-radius:3px;}

/* Print */
@media print{
  body{background:#fff;color:#000;display:block;}
  .sidebar,.main-header,.toast,.shortcuts-overlay{display:none!important;}
  .modal-overlay{position:static;display:block!important;background:none;}
  .modal{max-width:100%;box-shadow:none;border:none;}
}
"""

def main():
    # Read JS
    js_path = os.path.join(STATIC, "v2.js")
    with open(js_path, "r", encoding="utf-8") as f:
        js = f.read()

    # Read skeleton and patch
    skel_path = os.path.join(STATIC, "v2_skeleton.html")
    with open(skel_path, "r", encoding="utf-8") as f:
        html = f.read()

    # Replace external CSS link with inline style
    html = html.replace(
        '<link rel="stylesheet" href="/static/v2_styles.css">',
        f"<style>{CSS}</style>"
    )

    # Insert JS before </body>
    html = html.replace(
        "</body>",
        f'<script src="/static/v2.js"></script>\n</body>'
    )

    out_path = os.path.join(STATIC, "v2.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"Written {len(html)} bytes to {out_path}")

if __name__ == "__main__":
    main()
