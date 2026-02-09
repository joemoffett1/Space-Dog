#!/usr/bin/env python3
"""Simple local GUI for cardBuy.py and cardPuller.py.

Runs a local web UI in WSL and can open as a standalone Windows app window.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import platform
import re
import shlex
import subprocess
import sys
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def _q(form: dict[str, list[str]], key: str, default: str = "") -> str:
    return (form.get(key, [default])[0] or "").strip()


def _checked(form: dict[str, list[str]], key: str) -> bool:
    return _q(form, key) == "1"


def _strip_ansi(text: str) -> str:
    return ANSI_RE.sub("", text or "")


def _safe_split(args_text: str) -> list[str]:
    if not args_text.strip():
        return []
    try:
        return shlex.split(args_text)
    except ValueError:
        return []


def _build_cardbuy_cmd(form: dict[str, list[str]]) -> list[str]:
    cmd = [sys.executable, str(ROOT / "cardBuy.py")]
    collection = _q(form, "collection_csv") or _q(form, "source_csv", "collection.csv")
    if collection:
        cmd.append(collection)

    text_args = [
        ("-t", "tag"),
        ("-m", "min_buy"),
        ("-x", "max_buy"),
        ("-p", "min_pct"),
        ("-tl", "min_tcg_low_pct"),
        ("-daf", "date_added_from"),
        ("-dat", "date_added_to"),
        ("-tcq", "min_tcg_nm_qty"),
        ("-lmp", "min_low_market_pct"),
        ("-mmp", "max_low_market_pct"),
        ("-ap", "min_arb_profit"),
        ("--sort", "sort"),
    ]
    for flag, key in text_args:
        value = _q(form, key)
        if value:
            cmd.extend([flag, value])

    bool_args = [
        ("-b", "exclude_binders"),
        ("--cash", "cash"),
        ("--tcglow", "tcglow"),
        ("--show-zero", "show_zero"),
        ("--price_check", "price_check"),
        ("--arb_check", "arb_check"),
        ("--asc", "asc"),
        ("--refresh-ck-only", "refresh_ck_only"),
        ("--refresh", "refresh_all"),
    ]
    for flag, key in bool_args:
        if _checked(form, key):
            cmd.append(flag)

    cmd.extend(_safe_split(_q(form, "extra_args")))
    return cmd


def _build_cardpuller_cmd(form: dict[str, list[str]]) -> tuple[list[str] | None, str | None]:
    input_csv = _q(form, "pull_csv") or _q(form, "source_csv")
    if not input_csv:
        return None, "cardPuller needs a CSV input (ex: michael.csv, terra.csv)."

    cmd = [sys.executable, str(ROOT / "cardPuller.py")]
    if _checked(form, "pull_binders"):
        cmd.append("-b")
    if _checked(form, "pull_refresh"):
        cmd.append("--refresh")
    cmd.extend(_safe_split(_q(form, "pull_extra_args") or _q(form, "extra_args")))
    cmd.append(input_csv)
    return cmd, None


def _run_command(cmd: list[str], timeout_sec: int = 900) -> dict[str, str | int | float]:
    started = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
        )
        return {
            "ok": "1" if proc.returncode == 0 else "0",
            "exit_code": proc.returncode,
            "elapsed_sec": round(time.time() - started, 2),
            "stdout": _strip_ansi(proc.stdout),
            "stderr": _strip_ansi(proc.stderr),
            "cmd": " ".join(shlex.quote(x) for x in cmd),
        }
    except subprocess.TimeoutExpired as ex:
        return {
            "ok": "0",
            "exit_code": 124,
            "elapsed_sec": round(time.time() - started, 2),
            "stdout": _strip_ansi((ex.stdout or "")),
            "stderr": f"Timed out after {timeout_sec}s.",
            "cmd": " ".join(shlex.quote(x) for x in cmd),
        }


def _norm_col(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").casefold())


def _to_money_num(raw: str) -> float | None:
    s = (raw or "").strip()
    if not s or s == "-":
        return None
    m = re.search(r"-?\d+(?:,\d{3})*(?:\.\d+)?", s)
    if not m:
        return None
    try:
        return float(m.group(0).replace(",", ""))
    except ValueError:
        return None


def _to_pct_num(raw: str) -> float | None:
    s = (raw or "").strip()
    if not s or s == "-":
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", s.replace("%", ""))
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def _fmt_money(num: float | None) -> str:
    if num is None:
        return "-"
    return f"${num:,.2f}"


def _extract_pipe_rows(text: str) -> tuple[list[str], list[list[str]]]:
    headers: list[str] = []
    rows: list[list[str]] = []
    for line in (text or "").splitlines():
        if "|" not in line:
            continue
        raw = line.strip()
        if not raw:
            continue
        if set(raw) <= {"-", "+", " "}:
            continue
        cols = [c.strip() for c in line.split("|")]
        if not cols:
            continue
        first = (cols[0] or "").strip()
        if not first:
            continue
        if not headers and first.lower() in {"card", "name"}:
            headers = cols
            continue
        if headers and first.lower() in {"card", "name"}:
            continue
        if headers:
            cmp_len = min(len(cols), len(headers))
            if cmp_len > 0:
                row_head = [c.strip().casefold() for c in cols[:cmp_len]]
                hdr_head = [h.strip().casefold() for h in headers[:cmp_len]]
                if row_head == hdr_head:
                    continue
        if (
            first.startswith("Totals")
            or first.startswith("Total ")
            or first.startswith("Missing Totals")
            or first.startswith("Arb -")
            or first.startswith("#")
        ):
            continue
        rows.append(cols)
    return headers, rows


def _render_rows_table(headers: list[str], rows: list[list[str]], limit: int = 200) -> str:
    if not rows:
        return "<p class='muted'>No table rows detected in output.</p>"
    visible = rows[:limit]
    max_cols = max(len(r) for r in visible)
    if headers:
        max_cols = max(max_cols, len(headers))
    if not headers:
        headers = [f"Col {i+1}" for i in range(max_cols)]
    elif len(headers) < max_cols:
        headers = headers + [f"Col {i+1}" for i in range(len(headers), max_cols)]

    out = ["<table>", "<thead><tr>"]
    for h in headers:
        out.append(f"<th>{html.escape(h)}</th>")
    out.append("</tr></thead><tbody>")
    for r in visible:
        out.append("<tr>")
        for i in range(max_cols):
            cell = r[i] if i < len(r) else ""
            out.append(f"<td>{html.escape(cell)}</td>")
        out.append("</tr>")
    out.append("</tbody></table>")
    if len(rows) > limit:
        out.append(f"<p class='muted'>Showing {limit} of {len(rows)} parsed rows.</p>")
    return "".join(out)


def _build_live_records(headers: list[str], rows: list[list[str]]) -> list[dict[str, str | float | int | None]]:
    col_map: dict[str, int] = {}
    for i, h in enumerate(headers or []):
        key = _norm_col(h)
        if key and key not in col_map:
            col_map[key] = i

    def _col_idx(*candidates: str) -> int | None:
        for c in candidates:
            idx = col_map.get(_norm_col(c))
            if idx is not None:
                return idx
        return None

    name_idx = _col_idx("Card", "Name")
    version_idx = _col_idx("Version")
    qty_idx = _col_idx("Qty", "Quantity", "total_owned")
    location_idx = _col_idx("Location", "Loc")
    ck_idx = _col_idx("CK Cash", "CK Credit", "CK")
    tcg_market_idx = _col_idx("TCG Market", "TCG MKT", "Market", "Mkt")
    tcg_low_idx = _col_idx("TCG Low", "TCGLow")
    pct_low_mkt_idx = _col_idx(
        "Pct Low/Mkt",
        "Pct Low Mkt",
        "Pct TCG Low to TCG Market",
    )

    def _cell(row: list[str], idx: int | None) -> str:
        if idx is None or idx < 0 or idx >= len(row):
            return ""
        return (row[idx] or "").strip()

    out: list[dict[str, str | float | int | None]] = []
    for row in rows:
        name = _cell(row, name_idx) or ((row[0].strip() if row else ""))
        if not name:
            continue
        version = _cell(row, version_idx) or "-"
        qty_raw = _cell(row, qty_idx) or "-"
        location = _cell(row, location_idx) or "-"
        ck_raw = _cell(row, ck_idx) or "-"
        tcg_low_raw = _cell(row, tcg_low_idx) or "-"
        pct_low_mkt_raw = _cell(row, pct_low_mkt_idx) or "-"
        tcg_market_raw = _cell(row, tcg_market_idx) or "-"

        ck_num = _to_money_num(ck_raw)
        tcg_low_num = _to_money_num(tcg_low_raw)
        pct_low_mkt_num = _to_pct_num(pct_low_mkt_raw)
        tcg_market_num = _to_money_num(tcg_market_raw)
        # cardBuy usually emits low + pct-low/mkt; derive market when direct market isn't present.
        if tcg_market_num is None and tcg_low_num is not None and pct_low_mkt_num and pct_low_mkt_num > 0:
            tcg_market_num = (tcg_low_num * 100.0) / pct_low_mkt_num
            tcg_market_raw = _fmt_money(tcg_market_num)

        qty_num = None
        m = re.search(r"-?\d+", qty_raw)
        if m:
            try:
                qty_num = int(m.group(0))
            except ValueError:
                qty_num = None

        out.append(
            {
                "name": name,
                "version": version,
                "qty_raw": qty_raw,
                "qty_num": qty_num,
                "location": location,
                "ck_raw": ck_raw,
                "ck_num": ck_num,
                "tcg_low_raw": tcg_low_raw,
                "tcg_low_num": tcg_low_num,
                "tcg_market_raw": tcg_market_raw,
                "tcg_market_num": tcg_market_num,
            }
        )
    return out


def _render_image_cards(records: list[dict[str, str | float | int | None]], limit: int = 80) -> str:
    if not records:
        return "<p class='muted'>No card rows found to render.</p>"

    out = ["<div class='cards'>"]
    for rec in records[:limit]:
        name = str(rec.get("name", "") or "")
        if not name:
            continue
        version = str(rec.get("version", "-") or "-")
        ck_price = str(rec.get("ck_raw", "-") or "-")
        tcg_market = str(rec.get("tcg_market_raw", "-") or "-")
        encoded = urllib.parse.quote(name)
        img = (
            f"https://api.scryfall.com/cards/named?fuzzy={encoded}"
            f"&format=image&version=small"
        )
        out.append(
            "<div class='card'>"
            f"<div class='card-name top'>{html.escape(name)}</div>"
            f"<div class='card-version'>{html.escape(version)}</div>"
            f"<img loading='lazy' src='{img}' alt='{html.escape(name)}'/>"
            "<div class='prices'>"
            f"<div class='price-row'><span class='badge ck'>CK</span><span class='price'>{html.escape(ck_price)}</span></div>"
            f"<div class='price-row'><span class='badge tcg'>TCG MKT</span><span class='price'>{html.escape(tcg_market)}</span></div>"
            "</div>"
            "</div>"
        )
    out.append("</div>")
    if len(records) > limit:
        out.append(f"<p class='muted'>Showing {limit} of {len(records)} rows.</p>")
    out.append("<p class='muted'>Image mode loads from Scryfall in your browser.</p>")
    return "".join(out)


def _render_interactive_view(headers: list[str], rows: list[list[str]], default_mode: str) -> str:
    records = _build_live_records(headers, rows)
    if not records:
        return "<p class='muted'>No rows parsed from output.</p>"

    default_view = "cards" if default_mode == "images" else "table"
    data_json = json.dumps(records, separators=(",", ":")).replace("</", "<\\/")

    return (
        "<div class='live-controls'>"
        "<div class='live-item'><label>Search</label><input data-live='q' type='text' placeholder='name, version, location'/></div>"
        "<div class='live-item'><label>Min CK</label><input data-live='min_ck' type='text' placeholder='0'/></div>"
        "<div class='live-item'><label>Min TCG MKT</label><input data-live='min_mkt' type='text' placeholder='0'/></div>"
        "<div class='live-item'><label>Min Qty</label><input data-live='min_qty' type='text' placeholder='0'/></div>"
        "<div class='live-item'><label>Sort</label>"
        "<select data-live='sort_key'>"
        "<option value='ck_num'>CK</option>"
        "<option value='tcg_market_num'>TCG MKT</option>"
        "<option value='tcg_low_num'>TCG Low</option>"
        "<option value='qty_num'>Qty</option>"
        "<option value='name'>Card</option>"
        "<option value='version'>Version</option>"
        "</select></div>"
        "<div class='live-item'><label>Order</label>"
        "<select data-live='order'><option value='desc'>Desc</option><option value='asc'>Asc</option></select></div>"
        f"<div class='live-item'><label>View</label><select data-live='view'><option value='table' {'selected' if default_view=='table' else ''}>Table</option><option value='cards' {'selected' if default_view=='cards' else ''}>Cards</option></select></div>"
        "<div class='live-item'><label>Limit</label><input data-live='limit' type='text' value='120'/></div>"
        "</div>"
        "<div id='live-summary' class='muted'></div>"
        "<div id='live-root'></div>"
        "<script>"
        "(function(){"
        f"const DATA={data_json};"
        "const root=document.getElementById('live-root');"
        "const summary=document.getElementById('live-summary');"
        "if(!root||!summary){return;}"
        "const controls={};document.querySelectorAll('[data-live]').forEach(el=>{controls[el.getAttribute('data-live')]=el;el.addEventListener('input',render);el.addEventListener('change',render);});"
        "const esc=(s)=>String(s??'').replace(/[&<>\\\"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','\\\"':'&quot;','\\'':'&#39;'}[c]));"
        "const num=(v)=>{const s=String(v??'').trim();if(!s)return null;const n=Number(s);return Number.isFinite(n)?n:null;};"
        "const imgUrl=(name)=>`https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}&format=image&version=small`;"
        "function normText(v){return String(v??'').toLowerCase();}"
        "function renderTable(rows){"
        "let h='<table><thead><tr><th>Card</th><th>Version</th><th>Qty</th><th>Location</th><th>CK</th><th>TCG MKT</th><th>TCG Low</th></tr></thead><tbody>';"
        "for(const r of rows){h+=`<tr><td>${esc(r.name)}</td><td>${esc(r.version)}</td><td>${esc(r.qty_raw)}</td><td>${esc(r.location)}</td><td>${esc(r.ck_raw)}</td><td>${esc(r.tcg_market_raw)}</td><td>${esc(r.tcg_low_raw)}</td></tr>`;}"
        "h+='</tbody></table>';return h;}"
        "function renderCards(rows){"
        "let h='<div class=\"cards\">';"
        "for(const r of rows){h+=`<div class=\"card\"><div class=\"card-name top\">${esc(r.name)}</div><div class=\"card-version\">${esc(r.version)}</div><img loading=\"lazy\" src=\"${imgUrl(r.name)}\" alt=\"${esc(r.name)}\"/><div class=\"prices\"><div class=\"price-row\"><span class=\"badge ck\">CK</span><span class=\"price\">${esc(r.ck_raw)}</span></div><div class=\"price-row\"><span class=\"badge tcg\">TCG MKT</span><span class=\"price\">${esc(r.tcg_market_raw)}</span></div></div></div>`;}"
        "h+='</div>';return h;}"
        "function render(){"
        "const q=normText(controls.q?.value||'');"
        "const minCk=num((controls.min_ck?.value||'').trim());"
        "const minMkt=num((controls.min_mkt?.value||'').trim());"
        "const minQty=num((controls.min_qty?.value||'').trim());"
        "const sortKey=controls.sort_key?.value||'ck_num';"
        "const order=controls.order?.value||'desc';"
        "const view=controls.view?.value||'table';"
        "let limit=parseInt((controls.limit?.value||'120').trim(),10);if(!Number.isFinite(limit)||limit<1){limit=120;}"
        "let rows=DATA.filter((r)=>{"
        "if(q){const blob=normText(`${r.name} ${r.version} ${r.location}`);if(!blob.includes(q))return false;}"
        "if(minCk!==null){if(r.ck_num===null||r.ck_num<minCk)return false;}"
        "if(minMkt!==null){if(r.tcg_market_num===null||r.tcg_market_num<minMkt)return false;}"
        "if(minQty!==null){if(r.qty_num===null||r.qty_num<minQty)return false;}"
        "return true;});"
        "rows.sort((a,b)=>{"
        "if(sortKey==='name'||sortKey==='version'){const av=String(a[sortKey]??'');const bv=String(b[sortKey]??'');const cmp=av.localeCompare(bv);return order==='asc'?cmp:-cmp;}"
        "const av=Number.isFinite(a[sortKey])?a[sortKey]:-Infinity;const bv=Number.isFinite(b[sortKey])?b[sortKey]:-Infinity;"
        "return order==='asc'?(av-bv):(bv-av);});"
        "const shown=rows.slice(0,limit);"
        "summary.textContent=`Loaded ${DATA.length} rows, showing ${shown.length}`;"
        "root.innerHTML=(view==='cards')?renderCards(shown):renderTable(shown);"
        "}"
        "render();"
        "})();"
        "</script>"
    )


def _style() -> str:
    return """
<style>
:root{
  --bg:#0b0e13; --panel:#111722; --line:#2d3748; --text:#e6edf3;
  --muted:#9aa4b2; --cyan:#00d1ff; --yellow:#ffe082; --green:#39d353;
  --pink:#ff7ce5; --blue:#4aa3ff; --bad:#ff6b6b;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.35 ui-monospace,Consolas,Monaco,monospace}
.wrap{max-width:1560px;margin:18px auto;padding:0 14px}
h1{margin:0 0 8px;color:var(--yellow);font-size:24px}
.sub{color:var(--muted);margin-bottom:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px}
.panel h2{margin:0 0 10px;color:var(--cyan);font-size:18px}
.row{display:grid;grid-template-columns:220px 1fr;gap:8px;align-items:center;margin-bottom:8px}
.row label{color:var(--yellow)}
input[type=text], select{width:100%;padding:7px;border:1px solid var(--line);border-radius:7px;background:#0f141d;color:var(--text)}
.checks{display:flex;flex-wrap:wrap;gap:8px 12px;margin:8px 0}
.checks label{color:var(--text)}
.btn{padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:#182233;color:var(--text);cursor:pointer}
.btn:hover{border-color:var(--blue)}
a.btn{text-decoration:none;display:inline-block}
.toolopts{margin-top:8px;padding-top:2px}
.cmd{margin-top:10px;padding:10px;border:1px solid var(--line);border-radius:8px;background:#0f141d}
.cmd .k{color:var(--cyan)} .cmd .v{color:var(--text)}
.ok{color:var(--green)} .bad{color:var(--bad)}
pre{margin:0;padding:10px;background:#0f141d;border:1px solid var(--line);border-radius:8px;overflow:auto;white-space:pre}
table{width:100%;border-collapse:collapse}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
th{color:var(--cyan)}
.muted{color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:10px}
.card{border:1px solid var(--line);border-radius:8px;padding:8px;background:#0f141d}
.card img{width:100%;height:auto;border-radius:6px}
.card-name{color:var(--cyan);font-weight:700}
.card-name.top{margin-bottom:6px;min-height:2.6em}
.card-version{margin-bottom:6px;color:var(--pink);font-size:12px}
.prices{margin-top:8px;border-top:1px solid var(--line);padding-top:6px}
.price-row{display:flex;justify-content:space-between;align-items:center;margin-top:4px}
.badge{display:inline-block;padding:1px 6px;border-radius:999px;font-size:12px;font-weight:700}
.badge.ck{background:#3f3420;color:#ffe082;border:1px solid #6a582e}
.badge.tcg{background:#1d3350;color:#8fd1ff;border:1px solid #2d4d78}
.price{color:var(--green);font-weight:700}
.live-controls{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px 10px;margin-bottom:10px}
.live-item label{display:block;color:var(--yellow);margin-bottom:4px}
@media (max-width:1200px){.grid{grid-template-columns:1fr}}
</style>
"""


def _render_page(
    form: dict[str, list[str]] | None = None,
    tool: str = "cardbuy",
    mode: str = "text",
    result: dict[str, str | int | float] | None = None,
    error: str = "",
) -> str:
    form = form or {}
    cardbuy_rows = ""
    cardpuller_rows = ""
    if result:
        _headers, rows = _extract_pipe_rows(str(result.get("stdout", "")))
        if mode in {"list", "images"}:
            cardbuy_rows = _render_interactive_view(_headers, rows, mode)
        else:
            cardbuy_rows = f"<pre>{html.escape(str(result.get('stdout', '')).rstrip())}</pre>"
        cardpuller_rows = cardbuy_rows

    status_html = ""
    if result:
        ok = str(result.get("ok", "0")) == "1"
        status_class = "ok" if ok else "bad"
        status_html = (
            "<div class='cmd'>"
            f"<div><span class='k'>Command:</span> <span class='v'>{html.escape(str(result.get('cmd', '')))}</span></div>"
            f"<div><span class='k'>Exit:</span> <span class='{status_class}'>{result.get('exit_code')}</span>"
            f" <span class='k'>Time:</span> <span class='v'>{result.get('elapsed_sec')}s</span></div>"
            "</div>"
        )
        stderr = str(result.get("stderr", "")).strip()
        if stderr:
            status_html += f"<pre>{html.escape(stderr)}</pre>"
    elif error:
        status_html = f"<pre>{html.escape(error)}</pre>"
    selected_tool = _q(form, "tool", tool if tool in {"cardbuy", "cardpuller"} else "cardbuy")
    if selected_tool not in {"cardbuy", "cardpuller"}:
        selected_tool = "cardbuy"
    mode_value = mode if mode in {"text", "list", "images"} else "images"
    source_csv = _q(form, "source_csv")
    if not source_csv:
        source_csv = "collection.csv" if selected_tool == "cardbuy" else "michael.csv"
    show_loader = result is None or str(result.get("ok", "0")) != "1"
    tool_title = "cardBuy" if selected_tool == "cardbuy" else "cardPuller"
    body_html = (cardbuy_rows if tool == "cardbuy" else cardpuller_rows) if result else "<p class='muted'>Load a dataset to start.</p>"

    tcglow_default_checked = _checked(form, "tcglow") or ("tcglow" not in form)

    loader_html = f"""
  <div class='panel'>
    <h2>Load Dataset</h2>
    <form method='post' action='/run'>
      <div class='row'><label>Dataset Type</label>
        <select id='tool-select' name='tool'>
          <option value='cardbuy' {'selected' if selected_tool=='cardbuy' else ''}>cardBuy Data</option>
          <option value='cardpuller' {'selected' if selected_tool=='cardpuller' else ''}>cardPuller Data</option>
        </select>
      </div>
      <div class='row'><label>Source CSV</label><input id='source-csv' type='text' name='source_csv' value='{html.escape(source_csv)}' placeholder='collection.csv or michael.csv'/></div>
      <div class='row'><label>View</label>
        <select name='mode'>
          <option value='text' {'selected' if mode_value=='text' else ''}>Raw Text</option>
          <option value='list' {'selected' if mode_value=='list' else ''}>Interactive Table</option>
          <option value='images' {'selected' if mode_value=='images' else ''}>Interactive Cards</option>
        </select>
      </div>
      <div id='opts-cardbuy' class='toolopts'>
        <div class='checks'>
          <label><input type='checkbox' name='exclude_binders' value='1' {'checked' if _checked(form, 'exclude_binders') else ''}/> -b</label>
          <label><input type='checkbox' name='cash' value='1' {'checked' if _checked(form, 'cash') else ''}/> --cash</label>
          <label><input type='checkbox' name='tcglow' value='1' {'checked' if tcglow_default_checked else ''}/> --tcglow</label>
          <label><input type='checkbox' name='show_zero' value='1' {'checked' if _checked(form, 'show_zero') else ''}/> --show-zero</label>
          <label><input type='checkbox' name='price_check' value='1' {'checked' if _checked(form, 'price_check') else ''}/> --price_check</label>
          <label><input type='checkbox' name='arb_check' value='1' {'checked' if _checked(form, 'arb_check') else ''}/> --arb_check</label>
          <label><input type='checkbox' name='asc' value='1' {'checked' if _checked(form, 'asc') else ''}/> --asc</label>
        </div>
        <div class='row'><label>Sort</label><input type='text' name='sort' value='{html.escape(_q(form, "sort"))}' placeholder='pct, cash, buy, arbprofit, ...'/></div>
      </div>
      <div id='opts-cardpuller' class='toolopts'>
        <div class='checks'>
          <label><input type='checkbox' name='pull_binders' value='1' {'checked' if _checked(form, 'pull_binders') else ''}/> -b</label>
          <label><input type='checkbox' name='pull_refresh' value='1' {'checked' if _checked(form, 'pull_refresh') else ''}/> --refresh</label>
        </div>
      </div>
      <div class='row'><label>Extra Args</label><input type='text' name='extra_args' value='{html.escape(_q(form, "extra_args"))}' placeholder='Optional extra flags...'/></div>
      <button class='btn' type='submit'>Load</button>
    </form>
    <script>
      (function(){{
        const sel = document.getElementById('tool-select');
        const buy = document.getElementById('opts-cardbuy');
        const pull = document.getElementById('opts-cardpuller');
        const source = document.getElementById('source-csv');
        function sync(){{
          const isBuy = sel.value === 'cardbuy';
          buy.style.display = isBuy ? 'block' : 'none';
          pull.style.display = isBuy ? 'none' : 'block';
          if (!source.value.trim()) {{
            source.placeholder = isBuy ? 'collection.csv' : 'michael.csv';
          }}
        }}
        sel.addEventListener('change', sync);
        sync();
      }})();
    </script>
  </div>
"""

    active_html = f"""
  <div class='panel' style='margin-top:12px'>
    <h2>Loaded: {tool_title}</h2>
    <div class='muted'>Source: {html.escape(source_csv)}</div>
    <div style='margin-top:8px'><a class='btn' href='/'>Choose Different Source</a></div>
  </div>
"""

    return f"""<!doctype html>
<html><head><meta charset='utf-8'><title>MagicCollection GUI</title>{_style()}</head>
<body><div class='wrap'>
  <h1>MagicCollection GUI</h1>
  <div class='sub'>Load once, then filter/sort the loaded rows in-memory with no rerun.</div>
  {loader_html if show_loader else active_html}
  <div class='panel' style='margin-top:12px'>
    <h2>Result</h2>
    {status_html}
    {body_html}
  </div>
</div></body></html>"""


class AppHandler(BaseHTTPRequestHandler):
    server_version = "CardGUI/0.1"

    def do_GET(self) -> None:
        if self.path != "/":
            self.send_error(404)
            return
        body = _render_page().encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        if self.path != "/run":
            self.send_error(404)
            return

        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        payload = self.rfile.read(size).decode("utf-8", errors="replace")
        form = urllib.parse.parse_qs(payload, keep_blank_values=True)
        tool = _q(form, "tool", "cardbuy")
        mode = _q(form, "mode", "text")

        if tool == "cardpuller":
            cmd, err = _build_cardpuller_cmd(form)
            if err:
                result = None
                error = err
            else:
                result = _run_command(cmd or [])
                error = ""
        else:
            result = _run_command(_build_cardbuy_cmd(form))
            error = ""

        body = _render_page(form=form, tool=tool, mode=mode, result=result, error=error).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        # Keep terminal cleaner for this app.
        return


def _looks_like_wsl() -> bool:
    return bool(os.environ.get("WSL_DISTRO_NAME")) or ("microsoft" in platform.release().lower())


def _open_windows_window(url: str, mode: str) -> str:
    """Open URL from WSL.

    Returns one of: app, browser, disabled, skipped, failed.
    """
    if mode == "none":
        return "disabled"
    if not _looks_like_wsl():
        return "skipped"

    def _start_windows(args: list[str]) -> bool:
        try:
            subprocess.Popen(
                ["cmd.exe", "/C", "start", "", *args],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return True
        except Exception:
            return False

    if mode == "app":
        # Try common Windows browsers in app-window mode first.
        for browser in ("msedge", "chrome", "brave"):
            if _start_windows([browser, f"--app={url}"]):
                return "app"
        # Fall back to default browser if app-window mode is unavailable.
        if _start_windows([url]):
            return "browser"
        return "failed"

    if _start_windows([url]):
        return "browser"
    return "failed"


def main() -> int:
    ap = argparse.ArgumentParser(
        prog="cardUI",
        description="Local web GUI for cardBuy.py and cardPuller.py",
    )
    ap.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    ap.add_argument("--port", type=int, default=8765, help="Bind port (default: 8765)")
    ap.add_argument(
        "--open-mode",
        choices=("app", "browser", "none"),
        default="app",
        help="Auto-open mode in WSL: app window, browser tab/window, or none (default: app).",
    )
    ap.add_argument("--no-open", action="store_true", help="Alias for --open-mode none.")
    args = ap.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    url = f"http://{args.host}:{args.port}/"
    print(f"cardUI listening on {url}")

    open_mode = "none" if args.no_open else args.open_mode
    launch_state = _open_windows_window(url, open_mode)
    if launch_state == "app":
        print("Opened in Windows app window.")
    elif launch_state == "browser":
        print("Opened in Windows browser.")
    elif launch_state == "disabled":
        print("Auto-open disabled.")
    elif launch_state == "skipped":
        print("Auto-open skipped (not running in WSL).")
    else:
        print("Auto-open failed. Open URL manually.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
