#!/usr/bin/env python3
import json
import sys
import os
from collections import defaultdict
from datetime import datetime
from statistics import mean
import math
import plotly.graph_objs as go
import plotly.io as pio

# ============================================================
# 1. Data Processing & SLA Loading
# ============================================================

def load_k6_ndjson(path):
    records = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                records.append(json.loads(line))
    return records

def load_sla(path):
    if not path or not os.path.exists(path):
        return None
    with open(path, "r") as f:
        return json.load(f)

def parse_time(ts):
    return datetime.fromisoformat(ts.replace("Z", ""))

def percentile(values, p):
    if not values: return 0.0
    values = sorted(values)
    idx = math.ceil((p / 100) * len(values)) - 1
    return values[max(0, idx)]

def aggregate_data(records):
    series = defaultdict(lambda: defaultdict(lambda: {
        "reqs": 0, "errors": 0, "latencies": [], "status": defaultdict(int)
    }))
    for r in records:
        if r.get("type") != "Point": continue
        data = r["data"]
        tags = data.get("tags", {})
        # api = tags.get("group") or tags.get("url") or "unknown"
        api = tags.get("group") or tags.get("url") or "unknown"
        api = api.replace("::", "")
        second = parse_time(data["time"]).replace(microsecond=0)

        if r["metric"] == "http_reqs":
            series[api][second]["reqs"] += 1
            series[api][second]["status"][tags.get("status", "unknown")] += 1
            if tags.get("expected_response") == "false":
                series[api][second]["errors"] += 1
        elif r["metric"] == "http_req_duration":
            series[api][second]["latencies"].append(data["value"])
    return series

# ============================================================
# 2. Visualization Components
# ============================================================

# def get_donut_chart(status_summary):
#     fig = go.Figure(go.Pie(labels=list(status_summary.keys()), values=list(status_summary.values()), hole=0.6))
#     fig.update_layout(margin=dict(t=0, b=0, l=0, r=0), height=300, showlegend=True)
#     return pio.to_html(fig, include_plotlyjs=False, full_html=False)
def get_donut_chart(status_summary):
    fig = go.Figure(go.Pie(
        labels=list(status_summary.keys()), 
        values=list(status_summary.values()), 
        hole=0.6,
        textinfo='percent',
        # This formats the percentage to 2 decimal places
        texttemplate='%{percent:.2%}'
    ))
    fig.update_layout(margin=dict(t=0, b=0, l=0, r=0), height=300, showlegend=True)
    return pio.to_html(fig, include_plotlyjs=False, full_html=False)

def get_global_latency_chart(series):
    fig = go.Figure()
    for api, timeline in series.items():
        times = sorted(timeline.keys())
        avg = [mean(timeline[t]["latencies"]) if timeline[t]["latencies"] else 0 for t in times]
        p90 = [percentile(timeline[t]["latencies"], 90) for t in times]
        p95 = [percentile(timeline[t]["latencies"], 95) for t in times]
        mx = [max(timeline[t]["latencies"]) if timeline[t]["latencies"] else 0 for t in times]
        
        fig.add_scatter(x=times, y=avg, name=f"{api} Avg", visible=True)
        fig.add_scatter(x=times, y=p90, name=f"{api} P90", visible='legendonly')
        fig.add_scatter(x=times, y=p95, name=f"{api} P95", visible='legendonly')
        fig.add_scatter(x=times, y=mx, name=f"{api} Max", visible='legendonly')
    
    fig.update_layout(title="Global Latency Trends (Toggle legend for P90/P95/Max)", height=450, legend=dict(orientation="h", y=-0.2))
    return pio.to_html(fig, include_plotlyjs=False, full_html=False)

def get_drilldown_2x2(timeline):
    times = sorted(timeline.keys())
    
    # 1. Response Times (Multiple metrics)
    f1 = go.Figure()
    f1.add_scatter(x=times, y=[mean(timeline[t]["latencies"]) if timeline[t]["latencies"] else 0 for t in times], name="Avg")
    f1.add_scatter(x=times, y=[percentile(timeline[t]["latencies"], 90) for t in times], name="P90")
    f1.add_scatter(x=times, y=[percentile(timeline[t]["latencies"], 95) for t in times], name="P95")
    f1.add_scatter(x=times, y=[max(timeline[t]["latencies"]) if timeline[t]["latencies"] else 0 for t in times], name="Max")
    f1.update_layout(title="Response Times (ms)", height=300, showlegend=True)

    # 2. Transaction Rate
    f2 = go.Figure()
    f2.add_scatter(x=times, y=[timeline[t]["reqs"] for t in times], name="TPS", fill='tozeroy')
    f2.update_layout(title="Transaction Rate (TPS)", height=300, showlegend=True)

    # 3. HTTP Status Codes (With consistent legend text)
    f3 = go.Figure()
    all_codes = sorted(list(set(c for t in timeline.values() for c in t["status"].keys())))
    for code in all_codes:
        f3.add_scatter(x=times, y=[timeline[t]["status"].get(code, 0) for t in times], name=f"Status {code}")
    f3.update_layout(title="HTTP Status Codes Over Time", height=300, showlegend=True)

    # 4. Error Rate
    f4 = go.Figure()
    f4.add_scatter(x=times, y=[(timeline[t]["errors"]/timeline[t]["reqs"]*100) if timeline[t]["reqs"]>0 else 0 for t in times], name="Error %", line=dict(color='red'))
    f4.update_layout(title="Error Rate (%)", height=300, showlegend=True)

    return [pio.to_html(f, include_plotlyjs=False) for f in [f1, f2, f3, f4]]

# ============================================================
# 3. HTML Builder
# ============================================================

def build_dashboard(series, output_path, sla_data=None, app_name="N/A", run_name="N/A"):
    api_summary, global_status, all_times = [], defaultdict(int), []
    total_reqs, total_errs = 0, 0

    for api, timeline in series.items():
        lats, reqs, errs = [], 0, 0
        for t, data in timeline.items():
            lats.extend(data["latencies"]); reqs += data["reqs"]; errs += data["errors"]
            all_times.append(t)
            for code, count in data["status"].items(): global_status[code] += count
        
        total_reqs += reqs; total_errs += errs
        s_val = sla_data.get(api, {}) if sla_data else {}
        
        api_summary.append({
            "name": api, "count": reqs, "err": errs, "pass": reqs - errs,
            "min": round(min(lats), 2) if lats else 0, "max": round(max(lats), 2) if lats else 0,
            "avg": round(mean(lats), 2) if lats else 0, "p90": round(percentile(lats, 90), 2),
            "p95": round(percentile(lats, 95), 2), "sla": s_val.get("p90", "N/A"), "target": s_val.get("target_count", "N/A")
        })

    start_t, end_t = min(all_times), max(all_times)
    duration = (end_t - start_t).total_seconds()

    # Dynamic Table Header
    cols = ["Transaction"] + (["SLA (P90)"] if sla_data else []) + ["Min", "Max", "Avg", "P90", "P95"] + (["Target"] if sla_data else []) + ["Achieved", "Pass", "Fail"]
    header = "<tr>" + "".join(f"<th>{c}</th>" for c in cols) + "</tr>"
    
    table_rows = ""
    for s in api_summary:
        row = f"<td>{s['name']}</td>"
        if sla_data: row += f"<td>{s['sla']}ms</td>"
        row += f"<td>{s['min']}</td><td>{s['max']}</td><td>{s['avg']}</td><td>{s['p90']}</td><td>{s['p95']}</td>"
        if sla_data: row += f"<td>{s['target']}</td>"
        row += f"<td>{s['count']}</td><td>{s['pass']}</td><td class='text-danger'>{s['err']}</td>"
        table_rows += f"<tr>{row}</tr>"

    error_summary_rows = "".join([f"<tr><td>{s['name']}</td><td class='text-danger'>{s['err']}</td></tr>" for s in api_summary if s['err'] > 0])

    accordion_items = ""
    for i, s in enumerate(api_summary):
        charts = get_drilldown_2x2(series[s['name']])
        accordion_items += f"""
        <div class="accordion-item mb-2 border-0 shadow-sm">
            <h2 class="accordion-header"><button class="accordion-button collapsed bg-white" data-bs-toggle="collapse" data-bs-target="#coll{i}">
                <div class="d-flex justify-content-between w-100 me-3 mono">
                    <span>{s['name']}</span>
                    <span><span class="badge bg-light text-dark border">Success: {round(s['pass']/s['count']*100, 2)}%</span> <span class="badge bg-dark ms-2">Total: {s['count']}</span></span>
                </div>
            </button></h2>
            <div id="coll{i}" class="accordion-collapse collapse"><div class="accordion-body bg-light">
                <div class="row mb-3"><div class="col-md-6">{charts[0]}</div><div class="col-md-6">{charts[1]}</div></div>
                <div class="row"><div class="col-md-6">{charts[2]}</div><div class="col-md-6">{charts[3]}</div></div>
            </div></div>
        </div>"""
        # <div class="col"><div class="stat-card"><h6>Start Time</h6><div class="mono text-muted">{start_t.strftime('%H:%M:%S')}</div></div></div>
        # <div class="col"><div class="stat-card"><h6>End Time</h6><div class="mono text-muted">{end_t.strftime('%H:%M:%S')}</div></div></div>
            
    html = f"""
    <!DOCTYPE html><html><head><title>Performance Report</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>

    <link href="https://cdn.datatables.net/1.13.7/css/dataTables.bootstrap5.min.css" rel="stylesheet">
    <script src="https://code.jquery.com/jquery-3.7.0.js"></script>
    <script src="https://cdn.datatables.net/1.13.7/js/jquery.dataTables.min.js"></script>
    <script src="https://cdn.datatables.net/1.13.7/js/dataTables.bootstrap5.min.js"></script>
    
    <style>.mono {{ font-family: monospace; }} .stat-card {{ padding: 15px; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); text-align: center; }}</style>
    </head><body class="bg-light"><div class="container-fluid px-5 py-4">
        
        <div class="header-bar shadow-sm">
            <h2 class="mb-0">Load Summary Report</h2>
            <div class="d-flex gap-4 mt-2 opacity-75">
                <span><strong>Application:</strong> {app_name}</span>
                <span><strong>Run Name:</strong> {run_name}</span>
            </div>
        </div>

        <div class="row row-cols-1 row-cols-md-5 g-3 mb-4">
            <div class="col"><div class="stat-card"><h6>Start Time</h6><h3>{start_t.strftime('%H:%M:%S')}</h3></div></div>
            <div class="col"><div class="stat-card"><h6>End Time</h6><h3>{end_t.strftime('%H:%M:%S')}</h3></div></div>
            <div class="col"><div class="stat-card"><h6>Duration</h6><h3>{int(duration)}s</h3></div></div>
            <div class="col"><div class="stat-card"><h6>Total Req</h6><h3>{total_reqs:,}</h3></div></div>
            <div class="col"><div class="stat-card"><h6>Pass %</h6><h3 class="text-success">{round((total_reqs-total_errs)/total_reqs*100, 2)}%</h3></div></div>
        </div>

        <div class="card shadow-sm mb-4"><div class="card-body"><h5>Transaction Summary</h5>
            <table id="summaryTable" class="table table-hover table-sm mt-3"><thead>{header}</thead><tbody>{table_rows}</tbody></table>
        </div></div>

        <div class="row mb-4">
            <div class="col-md-6"><div class="card shadow-sm h-100"><div class="card-body"><h5>Error Summary</h5>
                <table class="table table-sm mt-2"><thead><tr><th>API</th><th>Failures</th></tr></thead><tbody>{error_summary_rows or "<tr><td>None</td><td>0</td></tr>"}</tbody></table>
            </div></div></div>
            <div class="col-md-6"><div class="card shadow-sm h-100"><div class="card-body"><h5>Global Status Code Distribution</h5>{get_donut_chart(global_status)}</div></div></div>
        </div>

        <div class="card shadow-sm mb-4"><div class="card-body"><h5>Global Trends</h5>{get_global_latency_chart(series)}</div></div>

        <h5 class="mb-3">Requests Breakdown by URL</h5>
        <div class="accordion" id="apiAccordion">{accordion_items}</div>
    </div><script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>

    <script>
        $(document).ready(function() {{
            $('#summaryTable').DataTable({{ 
                "pageLength": 10, 
                "order": [[ 0, "asc" ]] 
            }});
        }});
    </script>

    </body></html>"""
    
    with open(output_path, "w", encoding="utf-8") as f: f.write(html)

if __name__ == "__main__":
    if len(sys.argv) < 3: 
        print("Usage: python report.py <in.json> <out.html> [sla.json] [AppName] [RunName]")
    else:
        raw = load_k6_ndjson(sys.argv[1])
        sla = load_sla(sys.argv[3]) if len(sys.argv) > 3 else None
        # Get optional names or use defaults
        app_name = sys.argv[4] if len(sys.argv) > 4 else "N/A"
        run_name = sys.argv[5] if len(sys.argv) > 5 else "N/A"
        
        build_dashboard(aggregate_data(raw), sys.argv[2], sla, app_name, run_name)

# python dashboard_gen.py summary.json pro_dashboard.html sla.json App1 Run1

