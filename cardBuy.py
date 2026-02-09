#!/usr/bin/env python3
import argparse
import csv
import json
import os
import sys
import urllib.request
import urllib.error
import shutil
import subprocess
import re
import textwrap
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from datetime import datetime, date

CK_URL = "https://api.cardkingdom.com/api/v2/pricelist"
DEFAULT_SCRY_CACHE = "scryfall_cache.json"
DEFAULT_COLLECTION_CSV = "collection.csv"
DEFAULT_TCG_REF = "tcglow_reference.txt"
SORT_CHOICES = [
    "pct", "creditpct", "buy",
    "card", "version", "qty", "location",
    "cash", "credit",
    "pctcash", "pctcredit",
    "tcglow", "pcttcglow", "lowmktpct",
    "arbprofit", "arbroi", "sourcecost",
    "ckbuyqty",
]


# ---------- helpers ----------

def dmoney(x) -> Decimal:
    try:
        return Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError):
        return Decimal("0.00")


def as_bool_str(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    s = str(v).strip().lower()
    return "true" if s in ("true", "1", "yes", "y") else "false"


def pct_of_retail(buy: Decimal, retail: Decimal) -> Decimal:
    if retail <= 0:
        return Decimal("0.00")
    return (buy / retail * Decimal("100")).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP
    )


ANSI_RESET = "\033[0m"
ANSI_BOLD = "\033[1m"
ANSI_WHITE = "\033[97m"
ANSI_BLUE = "\033[38;5;39m"
ANSI_CYAN = "\033[36m"
ANSI_YELLOW = "\033[33m"
ANSI_LIGHT_PINK = "\033[38;5;213m"
ANSI_GOLD = "\033[38;5;220m"
ANSI_GREEN = "\033[32m"
ANSI_RED = "\033[31m"
ANSI_GRAY = "\033[90m"


def should_color_output() -> bool:
    if os.environ.get("FORCE_COLOR"):
        return True
    if os.environ.get("NO_COLOR"):
        return False
    return sys.stdout.isatty()


def colorize(s: str, code: str, enabled: bool) -> str:
    return f"{code}{s}{ANSI_RESET}" if enabled else s


def colorize_pct_gradient(
    text: str,
    value: Decimal,
    red_floor: Decimal,
    green_ceiling: Decimal,
    enabled: bool,
    switch: Decimal | None = None,
) -> str:
    if not enabled:
        return text

    v = float(value)
    lo = float(red_floor)
    hi = float(green_ceiling)
    mid = float((red_floor + green_ceiling) / Decimal("2")) if switch is None else float(switch)

    if hi <= lo:
        code = ANSI_BOLD + "\033[38;2;255;255;255m"
        return colorize(text, code, enabled)

    if v <= lo:
        r, g, b = 255, 0, 0
    elif v >= hi:
        r, g, b = 0, 255, 0
    elif v <= mid:
        span = max(mid - lo, 1e-9)
        t = (v - lo) / span
        r, g, b = 255, int(round(255 * t)), 0
    else:
        span = max(hi - mid, 1e-9)
        t = (v - mid) / span
        r, g, b = int(round(255 * (1 - t))), 255, 0

    code = ANSI_BOLD + f"\033[38;2;{r};{g};{b}m"
    return colorize(text, code, enabled)


class ColorHelpFormatter(argparse.RawTextHelpFormatter):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._use_color = should_color_output()

    def start_section(self, heading):
        if self._use_color:
            heading = colorize(heading, ANSI_BOLD + ANSI_YELLOW, True)
        super().start_section(heading)

    def _format_action_invocation(self, action):
        text = super()._format_action_invocation(action)
        if self._use_color:
            return colorize(text, ANSI_BOLD + ANSI_CYAN, True)
        return text


class ColorArgumentParser(argparse.ArgumentParser):
    @staticmethod
    def _colorize_field(field: str, enabled: bool) -> str:
        if not enabled:
            return field
        if field.startswith("-"):
            return colorize(field, ANSI_BOLD + ANSI_YELLOW, True)
        return colorize(field, ANSI_BOLD + ANSI_BLUE, True)

    @staticmethod
    def _colorize_meta(meta: str, enabled: bool) -> str:
        if not enabled or not meta:
            return meta
        if meta.startswith("default: "):
            _, value = meta.split(": ", 1)
            return f"{colorize('default:', ANSI_WHITE, True)} {colorize(value, ANSI_CYAN, True)}"
        return colorize(meta, ANSI_CYAN, True)

    @staticmethod
    def _colorize_desc(desc: str, enabled: bool) -> str:
        if not enabled:
            return desc
        return desc.replace("COLLECTION_CSV", colorize("COLLECTION_CSV", ANSI_BLUE, True))

    @staticmethod
    def _render_table(title: str, rows: list[tuple[str, ...]], use_color: bool) -> str:
        norm_rows: list[tuple[str, str, str]] = []
        has_meta = False
        for row in rows:
            if len(row) == 3:
                field, meta, desc = row
                has_meta = True
            elif len(row) == 2:
                field, desc = row
                meta = ""
            else:
                raise ValueError("rows must contain 2 or 3 columns")
            norm_rows.append((field, meta, desc))

        col1_name = "Field"
        col2_name = "Meta"
        col3_name = "Description"

        c1 = max(8, *(len(field) for field, _, _ in norm_rows))
        c2 = max(0, *(len(meta) for _, meta, _ in norm_rows)) if has_meta else 0

        term_w = shutil.get_terminal_size((120, 20)).columns
        table_w = max(84, min(term_w - 2, 128))
        gaps = 2 + (2 if has_meta else 0)
        fixed = c1 + (c2 if has_meta else 0) + gaps
        c3 = max(28, table_w - fixed)

        out = []
        title_s = colorize(title, ANSI_BOLD + ANSI_CYAN, True) if use_color else title
        out.append(title_s)

        line_len = table_w
        sep = "⎯" * line_len
        out.append(colorize(sep, ANSI_GRAY, True) if use_color else sep)

        for idx, (field, meta, desc) in enumerate(norm_rows):
            wrapped = textwrap.wrap(desc, width=c3, break_long_words=False, break_on_hyphens=False) or [""]
            for i, part in enumerate(wrapped):
                field_raw = field if i == 0 else ""
                meta_raw = meta if i == 0 else ""
                field_col = field_raw.ljust(c1)
                meta_col = meta_raw.ljust(c2) if has_meta else ""
                desc_col = part

                if i == 0:
                    field_col = ColorArgumentParser._colorize_field(field_col, use_color)
                    if has_meta and meta_raw:
                        meta_col = ColorArgumentParser._colorize_meta(meta_col, use_color)
                desc_col = ColorArgumentParser._colorize_desc(desc_col, use_color)

                if has_meta:
                    out.append(f"{field_col}  {meta_col}  {desc_col}")
                else:
                    out.append(f"{field_col}  {desc_col}")

        out.append(colorize(sep, ANSI_GRAY, True) if use_color else sep)

        return "\n".join(out)

    def format_help(self):
        use_color = should_color_output()
        lines = []
        title = "cardBuy  Match your MTG collection against Card Kingdom's buylist."
        usage = f"USAGE  {self.prog} [OPTIONS] [COLLECTION_CSV]"

        if use_color:
            title = (
                f"{colorize('cardBuy', ANSI_BOLD + ANSI_BLUE, True)} "
                + colorize(" Match your MTG collection against Card Kingdom's buylist.", ANSI_BOLD + ANSI_CYAN, True)
            )
            usage = (
                f"{colorize('USAGE', ANSI_BOLD + ANSI_CYAN, True)}  "
                f"{colorize(self.prog, ANSI_BOLD + ANSI_BLUE, True)} "
                f"{colorize('[OPTIONS]', ANSI_BOLD + ANSI_YELLOW, True)} "
                f"{colorize('[COLLECTION_CSV]', ANSI_BOLD + ANSI_YELLOW, True)}"
            )

        lines.append(title)
        lines.append("")
        lines.append(usage)
        lines.append("")

        lines.append(self._render_table(
            "COLLECTION",
            [
                ("COLLECTION_CSV", f"default: {DEFAULT_COLLECTION_CSV}", "Collection CSV file (ignored with --price_check/--arb_check)."),
                ("Columns", "", "Collection mode columns: Quantity, Name, Finish, Tags, Edition Name, Scryfall ID (optional: Date Added)"),
            ],
            use_color,
        ))
        lines.append("")
        lines.append(self._render_table(
            "FILTERS",
            [
                ("-t", "Only include cards whose Tags field contains this text."),
                ("-b", "Exclude Binder/Binders rows except Gas Binder(s); keep non-binder locations (boxes, etc.)."),
                ("-m", "Minimum payout amount (always credit-basis; not changed by --cash)."),
                ("-x", "Maximum payout amount (always credit-basis; not changed by --cash)."),
                ("-p", "Minimum selected payout % of CK retail (credit by default, cash with --cash)."),
                ("-tl", "Minimum selected payout % of TCG Low."),
                ("-daf DATE", "Only include rows with Date Added on/after DATE."),
                ("-dat DATE", "Only include rows with Date Added on/before DATE."),
                ("-tcq", "Minimum TCG NM listing count for the matched version."),
                ("-lmp", "Minimum (TCG Low / TCG Market) %."),
                ("-mmp", "Maximum (TCG Low / TCG Market) %."),
                ("-ap", "Minimum arbitrage profit amount (requires --arb_check)."),
            ],
            use_color,
        ))
        lines.append("")
        lines.append(self._render_table(
            "SETTINGS",
            [
                ("--cash", "Show cash mode columns only (CK Cash + Pct Cash). Default shows credit columns."),
                ("--tcglow", "Add TCG Low, % of TCG Low, and % TCG Low to TCG Market columns."),
                ("--show-zero", "Include priced rows even when CK Buy Qty is 0, and use full owned qty in totals."),
                ("--price_check", "Overall market check using CK pricelist entries (ignores COLLECTION_CSV, tags, and owned qty)."),
                ("--arb_check", "Arbitrage mode (market-wide): compare CK payout to TCG Low source cost."),
            ],
            use_color,
        ))
        lines.append("")
        lines.append(self._render_table(
            "SORTING",
            [
                ("--sort", "Sort by any available field: " + ", ".join(SORT_CHOICES) + "."),
                ("--asc", "Sort ascending instead of descending."),
            ],
            use_color,
        ))
        lines.append("")
        lines.append(self._render_table(
            "ADMIN",
            [
                ("--refresh-ck-only", "", "Force re-download of Card Kingdom pricelist only and exit if COLLECTION_CSV is not provided."),
                ("--refresh", "", "Force re-download of Card Kingdom + Scryfall + TCG tracker reference data and exit if COLLECTION_CSV is not provided."),
                ("--ck-json PATH", "default: ck_pricelist.json", "Cached Card Kingdom pricelist JSON."),
                ("--scry-cache PATH", f"default: {DEFAULT_SCRY_CACHE}", "Cached Scryfall price JSON."),
                ("--tcg-ref PATH", f"default: {DEFAULT_TCG_REF}", "Version+foil TCG reference file from cardCheck --version-low-only output."),
                ("-h, --help", "", "Show this help message and exit."),
            ],
            use_color,
        ))
        lines.append("")
        lines.append(self._render_table(
            "EXAMPLES",
            [
                ("cardBuy --refresh-ck-only", "Refresh CK cache only, then exit."),
                ("cardBuy --refresh", "Refresh CK + Scryfall caches and rebuild TCG tracker reference, then exit."),
                ("cardBuy collection.csv -daf 20260201", "Filter by Date Added and show Date Added column."),
                ("cardBuy collection.csv --tag \"trade\" --min-pct 60", "Filter by tag and minimum selected payout %."),
                ("cardBuy collection.csv --cash --min-buy 5 --sort buy", "Cash mode with minimum buy and custom sort."),
                ("cardBuy --price_check --tcglow --sort pcttcglow --cash", "Market-wide price check from CK pricelist."),
                ("cardBuy --arb_check --cash --min-buy 2 --sort arbprofit", "Arbitrage scan sorted by spread profit."),
            ],
            use_color,
        ))

        return "\n".join(lines) + "\n"


def version_plain(version_base: str, finish: str) -> str:
    base = (version_base or "").strip() or "-"
    fin = (finish or "").strip()
    fin_lc = fin.lower()
    if fin_lc == "foil":
        return f"{base} - F" if base != "-" else "F"
    if fin_lc in ("", "normal", "nonfoil", "non-foil"):
        return base
    if base == "-":
        return fin or "-"
    return f"{base} ({fin})"


def format_version(version_base: str, finish: str, enabled: bool) -> str:
    base = (version_base or "").strip() or "-"
    fin_lc = (finish or "").strip().lower()
    if fin_lc == "foil":
        if base == "-":
            return colorize("F", ANSI_BOLD + ANSI_GOLD, enabled)
        return (
            f"{colorize(base, ANSI_LIGHT_PINK, enabled)} "
            f"{colorize('-', ANSI_WHITE, enabled)} "
            f"{colorize('F', ANSI_BOLD + ANSI_GOLD, enabled)}"
        )
    if fin_lc in ("", "normal", "nonfoil", "non-foil"):
        return colorize(base, ANSI_LIGHT_PINK, enabled)

    txt = f"{base} ({finish})" if base != "-" else (finish or "-")
    return colorize(txt, ANSI_LIGHT_PINK, enabled)


def version_base_from_row(set_code: str, collector_number: str, edition_name: str) -> str:
    sc = (set_code or "").strip().upper()
    cn = (collector_number or "").strip()
    if sc or cn:
        return f"{sc} #{cn}".strip() if (sc or cn) else ""
    return (edition_name or "").strip() or "-"


def format_money(v: Decimal, enabled: bool) -> str:
    s = f"${v:.2f}"
    code = ANSI_BOLD + ANSI_GREEN if v >= Decimal("5.00") else ANSI_GREEN
    return colorize(s, code, enabled)


def download_ck_json(path: str, url: str = CK_URL, timeout: int = 60) -> None:
    """
    Download CK pricelist to `path`.
    CK may return 403 to default Python user agents, so we:
      1) Try urllib with browser-like headers
      2) If 403/blocked, fallback to curl (if installed)
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json,text/plain,*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Connection": "close",
        "Referer": "https://www.cardkingdom.com/",
    }

    req = urllib.request.Request(url, headers=headers, method="GET")

    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
        if not data:
            raise RuntimeError("Downloaded 0 bytes from CK pricelist.")
        with open(path, "wb") as f:
            f.write(data)
        return

    except urllib.error.HTTPError as e:
        if e.code != 403:
            raise

        curl_path = shutil.which("curl")
        if not curl_path:
            raise RuntimeError(
                "CK returned HTTP 403 Forbidden when downloading the pricelist.\n"
                "Tried urllib with browser headers, but CK still blocked it.\n"
                "Install curl (recommended) or manually download the pricelist JSON and save it as:\n"
                f"  {path}\n"
            ) from e

        cmd = [
            curl_path,
            "-L",
            "-sS",
            "-H", f"User-Agent: {headers['User-Agent']}",
            "-H", f"Accept: {headers['Accept']}",
            "-H", f"Referer: {headers['Referer']}",
            url,
            "-o", path,
        ]
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if p.returncode != 0:
            raise RuntimeError(
                "CK returned HTTP 403 via urllib, and curl fallback also failed.\n"
                f"curl stderr:\n{p.stderr.strip()}\n"
                f"Try manually downloading the pricelist and saving it to: {path}"
            ) from e

        if not os.path.exists(path) or os.path.getsize(path) == 0:
            raise RuntimeError(
                "curl reported success but the downloaded file is empty.\n"
                f"Try manually downloading the pricelist and saving it to: {path}"
            ) from e


def _extract_records(ck):
    if isinstance(ck, list):
        return ck
    if isinstance(ck, dict):
        for key in ("data", "results", "items", "pricelist", "prices"):
            if key in ck and isinstance(ck[key], list):
                return ck[key]
        for v in ck.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
        raise ValueError(
            f"Unexpected CK JSON structure. Keys: {list(ck.keys())[:20]}"
        )
    raise ValueError(f"Unexpected CK JSON type: {type(ck).__name__}")


def load_ck_index(path: str):
    with open(path, "r", encoding="utf-8") as f:
        ck = json.load(f)

    records = _extract_records(ck)

    idx = {}
    for rec in records:
        if not isinstance(rec, dict):
            continue
        if not ck_record_is_english(rec):
            continue
        sid = (rec.get("scryfall_id") or "").strip()
        if not sid:
            continue
        foil = as_bool_str(rec.get("is_foil"))
        idx.setdefault((sid, foil), []).append(rec)
    return idx


def ck_record_is_english(rec: dict) -> bool:
    sku = str(rec.get("sku") or "").strip().upper()
    variation = str(rec.get("variation") or "").strip().upper()
    edition = str(rec.get("edition") or "").strip().upper()
    name = str(rec.get("name") or "").strip().upper()
    blob = " ".join([sku, variation, edition, name])

    # CK non-English SKU suffixes commonly end with these language codes.
    if re.search(r"-(JP|DE|FR|IT|ES|PT|KO|RU|CS|CT|SC)$", sku):
        return False

    # Catch non-English language markers in variation/edition labels.
    if re.search(
        r"\b(JPN|JAPANESE|GERMAN|FRENCH|ITALIAN|SPANISH|PORTUGUESE|KOREAN|RUSSIAN|CHINESE|SIMPLIFIED|TRADITIONAL)\b",
        blob,
    ):
        return False

    return True


def normalize_collector_number(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    m = re.match(r"^0+([0-9].*)$", s)
    if m:
        s = m.group(1)
    return s


def parse_ref_version(version: str):
    v = (version or "").strip()
    if not v or "#" not in v:
        return ("", "", False)
    is_foil = v.endswith(" - F")
    if is_foil:
        v = v[:-4].strip()
    left, right = v.split("#", 1)
    set_code = left.strip().upper()
    collector = normalize_collector_number(right.strip())
    return (set_code, collector, is_foil)


def load_tcg_reference(path: str) -> dict:
    ref = {}
    if not path or not os.path.exists(path):
        return ref
    ansi_re = re.compile(r"\x1b\[[0-9;]*m")
    by_version = {}
    by_name = {}
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            s = ansi_re.sub("", line).strip()
            if not s or "|" not in s:
                continue
            if s.startswith("Card Check") or s.startswith("Card ") or s.startswith("Rows ") or s.startswith("-"):
                continue
            parts = [p.strip() for p in s.split("|")]
            if len(parts) < 4:
                continue
            name, version, market_s, low_s = parts[:4]
            nm_qty_s = parts[4] if len(parts) >= 5 else ""
            set_code, collector, is_foil = parse_ref_version(version)
            if not set_code or not collector:
                continue
            market = dmoney(market_s.replace("$", "").strip())
            low = dmoney(low_s.replace("$", "").strip())
            try:
                nm_qty = int(str(nm_qty_s).strip())
            except (TypeError, ValueError):
                nm_qty = 0
            entry = {"low": low, "market": market, "nm_qty": nm_qty}
            key3 = (set_code, collector, is_foil)
            key4 = (set_code, collector, is_foil, canonical_name(name))
            by_name[key4] = entry
            by_version.setdefault(key3, []).append((canonical_name(name), entry))

    # Keep version-only lookup only when it is unique by card name.
    for key3, vals in by_version.items():
        uniq_names = {nm for nm, _ in vals}
        if len(uniq_names) == 1:
            ref[key3] = vals[0][1]
    # Always keep exact name lookups.
    ref.update(by_name)
    return ref


def lookup_tcg_reference(ref: dict, edition_code: str, collector_number: str, finish: str, card_name: str = ""):
    set_code = (edition_code or "").strip().upper()
    collector = normalize_collector_number(collector_number)
    fin = (finish or "").strip().lower()
    is_foil = fin == "foil"
    hit = None
    nm = canonical_name(card_name)
    if nm:
        hit = ref.get((set_code, collector, is_foil, nm))
    else:
        hit = ref.get((set_code, collector, is_foil))
    if not hit:
        return (False, Decimal("0.00"), Decimal("0.00"), 0)
    try:
        nm_qty = int(hit.get("nm_qty") or 0)
    except (TypeError, ValueError):
        nm_qty = 0
    return (True, dmoney(hit.get("low")), dmoney(hit.get("market")), nm_qty)


def ck_collector_number_from_record(rec: dict) -> str:
    # CK usually does not expose collector number as a dedicated field;
    # prefer explicit fields, then SKU, then variation/url heuristics.
    for k in ("collector_number", "number"):
        cn = normalize_collector_number(str(rec.get(k) or ""))
        if cn:
            return cn

    # SKU is usually safest for CK records, e.g. M3C-0032 or RFM3C-0032.
    sku = str(rec.get("sku") or "").strip()
    m = re.search(r"-([0-9]+[A-Za-z]?)$", sku)
    if m:
        return normalize_collector_number(m.group(1))

    variation = str(rec.get("variation") or "").strip()
    m = re.match(r"^([0-9]+[A-Za-z★]*)\b", variation)
    if m:
        return normalize_collector_number(m.group(1))

    url = str(rec.get("url") or "").strip()
    if url:
        slug = url.rsplit("/", 1)[-1]
        # Only use multi-digit tokens from slug to avoid set-name collisions
        # like "modern-horizons-3-...".
        tokens = re.findall(r"-([0-9]{2,}[A-Za-z]?)(?:-|$)", slug)
        if tokens:
            # Prefer the longest numeric token when multiple are present.
            best = max(tokens, key=len)
            return normalize_collector_number(best)

    return ""


def pick_ck_record(candidates, edition_name: str, edition_code: str, collector_number: str = ""):
    if not candidates:
        return None
    if isinstance(candidates, dict):
        return candidates

    def norm(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", (s or "").lower())

    pool = candidates
    target_cn = normalize_collector_number(collector_number)
    if target_cn:
        cn_matches = [rec for rec in candidates if normalize_collector_number(ck_collector_number_from_record(rec)) == target_cn]
        if cn_matches:
            pool = cn_matches

    targets = [norm(edition_name), norm(edition_code)]
    targets = [t for t in targets if t]
    if targets:
        for rec in pool:
            rec_fields = [
                rec.get("edition"),
                rec.get("edition_name"),
                rec.get("edition_code"),
                rec.get("set"),
                rec.get("set_name"),
                rec.get("expansion"),
            ]
            rec_norm = {norm(v) for v in rec_fields if v}
            if any(t in rec_norm for t in targets):
                return rec
    return pool[0]


def load_scry_sid_prices(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        obj = json.load(f)
    if isinstance(obj, dict):
        return obj.get("sid_prices", {}) or {}
    return {}


def tcg_low_for_finish(sp: dict, finish: str) -> Decimal:
    fin = (finish or "").strip().lower()
    low = dmoney((sp or {}).get("tcg_low", ""))
    low_foil = dmoney((sp or {}).get("tcg_low_foil", ""))
    low_etched = dmoney((sp or {}).get("tcg_low_etched", ""))
    # Only use true NM tcg_low values; do not fall back to market.
    if "etched" in fin:
        return low_etched if low_etched > 0 else Decimal("0.00")
    if fin == "foil":
        return low_foil if low_foil > 0 else Decimal("0.00")
    return low if low > 0 else Decimal("0.00")


def tcg_market_for_finish(sp: dict, finish: str) -> Decimal:
    fin = (finish or "").strip().lower()
    mkt = dmoney((sp or {}).get("tcg_market", ""))
    mkt_foil = dmoney((sp or {}).get("tcg_market_foil", ""))
    mkt_etched = dmoney((sp or {}).get("tcg_market_etched", ""))
    if "etched" in fin:
        return mkt_etched if mkt_etched > 0 else Decimal("0.00")
    if fin == "foil":
        return mkt_foil if mkt_foil > 0 else Decimal("0.00")
    return mkt if mkt > 0 else Decimal("0.00")


def should_exclude_binders(tags: str, exclude_binders: bool) -> bool:
    """
    If exclude_binders is True:
      - exclude rows whose Tags mention Binder/Binders
      - except rows that mention Gas Binder(s)
      - keep all non-binder locations (e.g., boxes)
    """
    if not exclude_binders:
        return False
    t = (tags or "").lower()
    has_binder = re.search(r"\bbinders?\b", t) is not None
    has_gas_binder = re.search(r"\bgas binders?\b", t) is not None
    return has_binder and not has_gas_binder


def first_nonempty(row: dict, *keys: str) -> str:
    for key in keys:
        val = row.get(key)
        if val is None:
            continue
        s = str(val).strip()
        if s:
            return s
    return ""


def canonical_name(s: str) -> str:
    return re.sub(r"\s+", "", (s or "").casefold())


def parse_flexible_date(raw: str) -> date | None:
    s = (raw or "").strip()
    if not s:
        return None
    # Try ISO forms first (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).date()
    except ValueError:
        pass
    # Common export formats
    fmts = (
        "%Y%m%d",
        "%Y-%m-%d",
        "%Y/%m/%d",
        "%m/%d/%Y",
        "%m/%d/%y",
        "%Y-%m-%d %H:%M:%S",
        "%m/%d/%Y %H:%M:%S",
    )
    for fmt in fmts:
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


# ---------- main ----------

def main():
    help_color = should_color_output()
    ap = ColorArgumentParser(
        prog="cardBuy",
        add_help=False,
        usage="cardBuy [OPTIONS] [COLLECTION_CSV]",
        formatter_class=ColorHelpFormatter,
        description="cardBuy  Match your MTG collection against Card Kingdom's buylist.",
        epilog=(
            f"{colorize('EXAMPLES', ANSI_BOLD + ANSI_YELLOW, help_color)}:\n"
            f"  {colorize('cardBuy --refresh', ANSI_CYAN, help_color)}\n"
            f"  {colorize('cardBuy collection.csv --tag \"trade\" --min-pct 60', ANSI_CYAN, help_color)}\n"
            f"  {colorize('cardBuy collection.csv --cash --min-buy 5 --sort buy', ANSI_CYAN, help_color)}\n"
            f"  {colorize('cardBuy', ANSI_CYAN, help_color)}\n"
            f"  {colorize('cardBuy --cash -m 5 -p 50', ANSI_CYAN, help_color)}\n"
            f"  {colorize('cardBuy collection.csv --tcglow', ANSI_CYAN, help_color)}"
        ),
    )

    collection_group = ap.add_argument_group("COLLECTION")
    filters_group = ap.add_argument_group("FILTERS")
    settings_group = ap.add_argument_group("SETTINGS")
    sorting_group = ap.add_argument_group("SORTING")
    admin_group = ap.add_argument_group("ADMIN")

    collection_group.add_argument(
        "collection_csv",
        nargs="?",
        metavar="COLLECTION_CSV",
        help=f"Collection CSV file (default: {DEFAULT_COLLECTION_CSV})\n"
             "Collection mode required columns:\n"
             "  Quantity, Name, Finish, Tags, Edition Name, Scryfall ID",
    )

    admin_group.add_argument(
        "-h", "--help",
        action="help",
        help="Show this help message and exit.",
    )
    admin_group.add_argument(
        "--refresh-ck-only",
        action="store_true",
        help="Force re-download of Card Kingdom pricing data only and exit if COLLECTION_CSV is not provided.",
    )
    admin_group.add_argument(
        "--refresh",
        action="store_true",
        help="Force re-download of Card Kingdom + Scryfall + TCG tracker reference data and exit if COLLECTION_CSV is not provided.",
    )
    filters_group.add_argument("-t", "--tag", help="Only include cards whose Tags field contains this text")
    filters_group.add_argument(
        "-b", "--exclude-binders",
        action="store_true",
        help="Exclude Binder/Binders rows except Gas Binder(s); keep non-binder locations (boxes, etc.).",
    )
    filters_group.add_argument(
        "-m", "--min-buy",
        type=Decimal,
        default=Decimal("0.01"),
        help="Minimum payout amount (always credit-basis; not changed by --cash).",
    )
    filters_group.add_argument(
        "-x", "--max-buy",
        type=Decimal,
        help="Maximum payout amount (always credit-basis; not changed by --cash).",
    )
    filters_group.add_argument(
        "-p", "--min-pct",
        type=Decimal,
        help="Minimum selected payout %% of CK retail (credit by default, cash with --cash).",
    )
    filters_group.add_argument(
        "-tl", "--min-tcg-low-pct",
        type=Decimal,
        help="Minimum selected payout %% of TCG Low.",
    )
    filters_group.add_argument(
        "-daf", "--date-added-from",
        metavar="DATE",
        help="Only include rows with Date Added on/after DATE (e.g. 20260201).",
    )
    filters_group.add_argument(
        "-dat", "--date-added-to",
        metavar="DATE",
        help="Only include rows with Date Added on/before DATE (e.g. 20260209).",
    )
    filters_group.add_argument(
        "-tcq", "--min-tcg-nm-qty",
        type=int,
        help="Minimum TCG NM listing count for the matched version.",
    )
    filters_group.add_argument(
        "-lmp", "--min-low-market-pct",
        type=Decimal,
        help="Minimum (TCG Low / TCG Market) %%.",
    )
    filters_group.add_argument(
        "-mmp", "--max-low-market-pct",
        type=Decimal,
        help="Maximum (TCG Low / TCG Market) %%.",
    )
    filters_group.add_argument(
        "-ap", "--min-arb-profit",
        type=Decimal,
        help="Minimum arbitrage profit amount per card (requires --arb_check).",
    )
    settings_group.add_argument(
        "--cash",
        action="store_true",
        help="Show cash mode columns only (CK Cash + Pct Cash). Default shows credit columns.",
    )
    settings_group.add_argument(
        "--tcglow",
        action="store_true",
        help="Add TCG Low, %% of TCG Low, and %% TCG Low to TCG Market columns.",
    )
    settings_group.add_argument(
        "--show-zero",
        dest="include_zero_buy_qty",
        action="store_true",
        help="Include priced rows even when CK Buy Qty is 0; totals use full owned qty (ignore CK buy cap).",
    )
    settings_group.add_argument(
        "--price_check",
        action="store_true",
        help="Overall market check using CK pricelist entries (ignores COLLECTION_CSV, tags, and owned qty).",
    )
    settings_group.add_argument(
        "--arb_check",
        action="store_true",
        help="Arbitrage mode (market-wide): compare CK payout to TCG Low source cost.",
    )

    sorting_group.add_argument(
        "--sort",
        choices=SORT_CHOICES,
        default=None,
        help=(
            "Sort by any available field:\n"
            f"  {', '.join(SORT_CHOICES)}\n"
            "Legacy aliases: pct=cash %%, creditpct=credit %%, buy=cash amount.\n"
            "Default sort: credit (or cash with --cash), and arbprofit with --arb_check."
        ),
    )
    sorting_group.add_argument("--asc", action="store_true", help="Sort ascending instead of descending")

    admin_group.add_argument(
        "--ck-json",
        default="ck_pricelist.json",
        help="Cached Card Kingdom pricelist JSON (default: ck_pricelist.json)",
    )
    admin_group.add_argument(
        "--scry-cache",
        default=DEFAULT_SCRY_CACHE,
        help=f"Cached Scryfall price JSON (default: {DEFAULT_SCRY_CACHE})",
    )
    admin_group.add_argument(
        "--tcg-ref",
        default=DEFAULT_TCG_REF,
        help=f"Version+foil TCG reference file from cardCheck --version-low-only output (default: {DEFAULT_TCG_REF})",
    )

    args = ap.parse_args()
    if args.refresh and args.refresh_ck_only:
        print("ERROR: choose only one of --refresh or --refresh-ck-only", file=sys.stderr)
        return 2
    date_from = None
    date_to = None
    if args.date_added_from:
        date_from = parse_flexible_date(args.date_added_from)
        if date_from is None:
            print(f"ERROR: invalid --date-added-from value: {args.date_added_from}", file=sys.stderr)
            return 2
    if args.date_added_to:
        date_to = parse_flexible_date(args.date_added_to)
        if date_to is None:
            print(f"ERROR: invalid --date-added-to value: {args.date_added_to}", file=sys.stderr)
            return 2
    if date_from and date_to and date_from > date_to:
        print("ERROR: --date-added-from must be <= --date-added-to", file=sys.stderr)
        return 2
    if args.arb_check:
        args.price_check = True
        args.tcglow = True
    if args.sort is None:
        if args.arb_check:
            args.sort = "arbprofit"
        else:
            args.sort = "cash" if args.cash else "credit"
    if args.price_check:
        # Hard guard: market-wide mode never uses collection-specific inputs/filters.
        args.collection_csv = None
        args.tag = None
        args.exclude_binders = False

    if args.refresh_ck_only:
        try:
            download_ck_json(args.ck_json)
        except Exception as e:
            print(f"ERROR refreshing CK pricelist: {e}", file=sys.stderr)
            return 3
        if not args.collection_csv:
            print(f"Refreshed CK pricelist cache -> {args.ck_json}")
            return 0

    # Refresh cache ONLY when explicitly requested
    if args.refresh:
        try:
            download_ck_json(args.ck_json)
        except Exception as e:
            print(f"ERROR refreshing CK pricelist: {e}", file=sys.stderr)
            return 3
        try:
            from cardPuller import refresh_scryfall_cache, refresh_tcg_reference
            refresh_scryfall_cache(args.scry_cache)
        except Exception as e:
            print(f"ERROR refreshing Scryfall cache: {e}", file=sys.stderr)
            return 3
        try:
            ref_dir = os.path.dirname(args.tcg_ref) or "."
            tracker_dat = os.path.join(ref_dir, "tcgtracker.dat")
            tracker_csv = os.path.join(ref_dir, "tcgtracking_tcg_low_en.csv")
            refresh_tcg_reference(args.tcg_ref, tracker_dat, tracker_csv)
        except Exception as e:
            print(f"ERROR refreshing TCG tracker reference: {e}", file=sys.stderr)
            return 3

        if not args.collection_csv:
            print(f"Refreshed CK pricelist cache -> {args.ck_json}")
            print(f"Refreshed Scryfall cache -> {args.scry_cache}")
            print(f"Refreshed TCG tracker dat -> {tracker_dat}")
            print(f"Refreshed TCG tracker csv -> {tracker_csv}")
            print(f"Refreshed TCG reference -> {args.tcg_ref}")
            return 0

    # Require cache to exist for normal runs (no implicit network)
    if not os.path.exists(args.ck_json):
        print(f"ERROR: missing CK cache: {args.ck_json}\nRun: cardBuy --refresh-ck-only (or --refresh)", file=sys.stderr)
        return 2

    if not args.price_check:
        if not args.collection_csv:
            args.collection_csv = DEFAULT_COLLECTION_CSV
        if not os.path.exists(args.collection_csv):
            print(f"ERROR: missing collection CSV: {args.collection_csv}", file=sys.stderr)
            return 2

    ck_idx = load_ck_index(args.ck_json)
    tcg_ref = load_tcg_reference(args.tcg_ref)
    sid_prices = {}
    need_tcg_low = (
        args.tcglow
        or args.sort in ("tcglow", "pcttcglow", "lowmktpct", "arbprofit", "arbroi", "sourcecost")
        or args.min_tcg_low_pct is not None
        or args.min_tcg_nm_qty is not None
        or args.min_low_market_pct is not None
        or args.max_low_market_pct is not None
    )
    if need_tcg_low:
        if os.path.exists(args.scry_cache):
            sid_prices = load_scry_sid_prices(args.scry_cache)
        elif not tcg_ref:
            print(
                f"ERROR: missing both Scryfall cache ({args.scry_cache}) and TCG reference ({args.tcg_ref}).\n"
                "Run: cardPuller --refresh and rebuild reference via cardCheck --version-low-only.",
                file=sys.stderr,
            )
            return 2
    elif args.price_check and os.path.exists(args.scry_cache):
        sid_prices = load_scry_sid_prices(args.scry_cache)
    rows = []
    rows_by_key = {}
    total_cash = Decimal("0.00")
    if args.price_check:
        seen_ck_ids = set()
        for rec_list in ck_idx.values():
            if isinstance(rec_list, dict):
                rec_iter = [rec_list]
            else:
                rec_iter = rec_list or []

            for rec in rec_iter:
                if not isinstance(rec, dict):
                    continue

                rec_id = rec.get("id")
                if rec_id is not None:
                    if rec_id in seen_ck_ids:
                        continue
                    seen_ck_ids.add(rec_id)

                scryfall_id = (rec.get("scryfall_id") or "").strip()
                name = (rec.get("name") or "").strip() or scryfall_id or "-"
                finish = "Foil" if as_bool_str(rec.get("is_foil")) == "true" else "Normal"
                tags = "-"
                sp = sid_prices.get(scryfall_id, {}) if scryfall_id else {}
                edition_name = first_nonempty(sp, "set_name", "edition", "edition_name", "set_name", "expansion")
                edition_code = first_nonempty(sp, "set", "edition_code", "set")
                ck_collector_number = ck_collector_number_from_record(rec)
                collector_number = ck_collector_number or first_nonempty(sp, "collector_number", "number")

                ck_buy_cash = dmoney(rec.get("price_buy"))
                ck_retail = dmoney(rec.get("price_retail"))
                ck_qty_buying = int(rec.get("qty_buying") or 0)
                ck_buy_credit = dmoney(ck_buy_cash * Decimal("1.30"))
                pct_cash = pct_of_retail(ck_buy_cash, ck_retail)
                pct_credit = pct_of_retail(ck_buy_credit, ck_retail)
                selected_buy = ck_buy_cash if args.cash else ck_buy_credit
                selected_pct = pct_cash if args.cash else pct_credit
                filter_buy = ck_buy_credit
                ver_base = version_base_from_row(edition_code, collector_number, edition_name)
                ver_plain = version_plain(ver_base, finish)
                tcg_low = Decimal("0.00")
                tcg_market = Decimal("0.00")
                pct_tcg_low = Decimal("0.00")
                pct_low_market = Decimal("0.00")
                source_market = "-"
                source_cost = Decimal("0.00")
                source_cost_effective = Decimal("0.00")
                arb_profit = Decimal("0.00")
                arb_roi = Decimal("0.00")
                filter_pct_tcg_low = Decimal("0.00")
                filter_pct_low_market = Decimal("0.00")
                tcg_nm_qty = 0
                if need_tcg_low and scryfall_id:
                    sp = sid_prices.get(scryfall_id, {})
                    ref_found, ref_low, ref_market, ref_nm_qty = lookup_tcg_reference(
                        tcg_ref, edition_code, collector_number, finish, name
                    )
                    if ref_found:
                        tcg_low = ref_low
                        tcg_nm_qty = ref_nm_qty
                    else:
                        tcg_low = tcg_low_for_finish(sp, finish)
                    if ref_market > 0:
                        tcg_market = ref_market
                    else:
                        tcg_market = tcg_market_for_finish(sp, finish)
                    pct_tcg_low = pct_of_retail(selected_buy, tcg_low) if tcg_low > 0 else Decimal("0.00")
                    filter_pct_tcg_low = pct_of_retail(ck_buy_credit, tcg_low) if tcg_low > 0 else Decimal("0.00")
                    pct_low_market = pct_of_retail(tcg_low, tcg_market) if (tcg_low > 0 and tcg_market > 0) else Decimal("0.00")
                    filter_pct_low_market = pct_low_market
                if args.arb_check:
                    if tcg_low > 0:
                        source_market, source_cost, source_cost_effective = ("TCG Low", tcg_low, tcg_low)
                        arb_profit = dmoney(selected_buy - source_cost_effective)
                        arb_roi = pct_of_retail(selected_buy, source_cost_effective) if source_cost_effective > 0 else Decimal("0.00")

                if ck_buy_cash <= 0:
                    continue
                if need_tcg_low and tcg_low <= 0:
                    continue
                if ck_qty_buying <= 0 and not args.include_zero_buy_qty:
                    continue
                if filter_buy < args.min_buy:
                    continue
                if args.max_buy is not None and filter_buy > args.max_buy:
                    continue
                if args.min_pct is not None and selected_pct < args.min_pct:
                    continue
                if args.min_tcg_low_pct is not None and filter_pct_tcg_low < args.min_tcg_low_pct:
                    continue
                if args.min_tcg_nm_qty is not None and tcg_nm_qty < args.min_tcg_nm_qty:
                    continue
                if args.min_low_market_pct is not None and filter_pct_low_market < args.min_low_market_pct:
                    continue
                if args.max_low_market_pct is not None and filter_pct_low_market > args.max_low_market_pct:
                    continue
                if args.arb_check and arb_profit <= 0:
                    continue
                if args.arb_check and args.min_arb_profit is not None and arb_profit < args.min_arb_profit:
                    continue

                row_key = (
                    name.casefold(),
                    ver_plain.casefold(),
                    "-",
                )
                if row_key in rows_by_key:
                    continue

                rows_by_key[row_key] = {
                    "pct_cash": pct_cash,
                    "pct_credit": pct_credit,
                    "buy_cash": ck_buy_cash,
                    "buy_credit": ck_buy_credit,
                    "retail": ck_retail,
                    "your_qty": 1,
                    "sell_qty": 0,
                    "ck_qty_buying": ck_qty_buying,
                    "payout": Decimal("0.00"),
                    "name": name,
                    "edition": edition_name,
                    "edition_code": edition_code,
                    "collector_number": collector_number,
                    "scryfall_id": scryfall_id,
                    "finish": finish,
                    "tags": tags,
                    "version_plain": ver_plain,
                    "tcg_low": tcg_low,
                    "tcg_market": tcg_market,
                    "tcg_nm_qty": tcg_nm_qty,
                    "pct_tcg_low": pct_tcg_low,
                    "pct_low_market": pct_low_market,
                    "source_market": source_market,
                    "source_cost": source_cost,
                    "source_cost_effective": source_cost_effective,
                    "arb_profit": arb_profit,
                    "arb_roi": arb_roi,
                }
    else:
        tag_filter = args.tag.lower() if args.tag else None
        required_cols = ["Quantity", "Name", "Finish", "Tags", "Edition Name", "Scryfall ID"]

        with open(args.collection_csv, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)

            fieldnames = reader.fieldnames or []
            for col in required_cols:
                if col not in fieldnames:
                    print(f"Missing column: {col}", file=sys.stderr)
                    print(f"Found columns: {reader.fieldnames}", file=sys.stderr)
                    return 2
            needs_date_added = (
                date_from is not None
                or date_to is not None
            )
            if needs_date_added and "Date Added" not in fieldnames:
                print("Missing column: Date Added", file=sys.stderr)
                print(f"Found columns: {reader.fieldnames}", file=sys.stderr)
                return 2

            for row in reader:
                try:
                    your_qty = int(str(row.get("Quantity", "")).strip())
                except (ValueError, TypeError):
                    continue

                name = (row.get("Name") or "").strip()
                finish = (row.get("Finish") or "").strip()
                tags = (row.get("Tags") or "").strip()
                date_added = (row.get("Date Added") or "").strip()
                edition_name = (row.get("Edition Name") or "").strip()
                edition_code = (row.get("Edition Code") or "").strip()
                collector_number = (row.get("Collector Number") or "").strip()
                scryfall_id = (row.get("Scryfall ID") or "").strip()

                if not scryfall_id:
                    continue

                # -b: exclude non-Gas binders
                if should_exclude_binders(tags, args.exclude_binders):
                    continue

                # -t: tag filter
                if tag_filter and tag_filter not in tags.lower():
                    continue
                if date_from is not None or date_to is not None:
                    row_date = parse_flexible_date(date_added)
                    if row_date is None:
                        continue
                    if date_from is not None and row_date < date_from:
                        continue
                    if date_to is not None and row_date > date_to:
                        continue

                foil = "true" if finish.lower() == "foil" else "false"
                rec = pick_ck_record(ck_idx.get((scryfall_id, foil)), edition_name, edition_code, collector_number)
                if not rec:
                    continue
                if not name:
                    name = (rec.get("name") or "").strip() or scryfall_id

                ck_buy_cash = dmoney(rec.get("price_buy"))
                ck_retail = dmoney(rec.get("price_retail"))
                ck_qty_buying = int(rec.get("qty_buying") or 0)
                ck_buy_credit = dmoney(ck_buy_cash * Decimal("1.30"))
                pct_cash = pct_of_retail(ck_buy_cash, ck_retail)
                pct_credit = pct_of_retail(ck_buy_credit, ck_retail)
                selected_buy = ck_buy_cash if args.cash else ck_buy_credit
                selected_pct = pct_cash if args.cash else pct_credit
                filter_buy = ck_buy_credit
                ver_base = version_base_from_row(edition_code, collector_number, edition_name)
                ver_plain = version_plain(ver_base, finish)
                tcg_low = Decimal("0.00")
                tcg_market = Decimal("0.00")
                pct_tcg_low = Decimal("0.00")
                pct_low_market = Decimal("0.00")
                filter_pct_tcg_low = Decimal("0.00")
                filter_pct_low_market = Decimal("0.00")
                tcg_nm_qty = 0
                if need_tcg_low:
                    sp = sid_prices.get(scryfall_id, {})
                    ref_found, ref_low, ref_market, ref_nm_qty = lookup_tcg_reference(
                        tcg_ref, edition_code, collector_number, finish, name
                    )
                    if ref_found:
                        tcg_low = ref_low
                        tcg_nm_qty = ref_nm_qty
                    else:
                        tcg_low = tcg_low_for_finish(sp, finish)
                    if ref_market > 0:
                        tcg_market = ref_market
                    else:
                        tcg_market = tcg_market_for_finish(sp, finish)
                    pct_tcg_low = pct_of_retail(selected_buy, tcg_low) if tcg_low > 0 else Decimal("0.00")
                    filter_pct_tcg_low = pct_of_retail(ck_buy_credit, tcg_low) if tcg_low > 0 else Decimal("0.00")
                    pct_low_market = pct_of_retail(tcg_low, tcg_market) if (tcg_low > 0 and tcg_market > 0) else Decimal("0.00")
                    filter_pct_low_market = pct_low_market

                if ck_buy_cash <= 0:
                    continue
                if need_tcg_low and tcg_low <= 0:
                    continue
                if ck_qty_buying <= 0 and not args.include_zero_buy_qty:
                    continue
                if filter_buy < args.min_buy:
                    continue
                if args.max_buy is not None and filter_buy > args.max_buy:
                    continue
                if args.min_pct is not None and selected_pct < args.min_pct:
                    continue
                if args.min_tcg_low_pct is not None and filter_pct_tcg_low < args.min_tcg_low_pct:
                    continue
                if args.min_tcg_nm_qty is not None and tcg_nm_qty < args.min_tcg_nm_qty:
                    continue
                if args.min_low_market_pct is not None and filter_pct_low_market < args.min_low_market_pct:
                    continue
                if args.max_low_market_pct is not None and filter_pct_low_market > args.max_low_market_pct:
                    continue

                row_key = (
                    name.casefold(),
                    ver_plain.casefold(),
                    (tags or "-").strip().casefold(),
                    (date_added or "-").strip().casefold() if needs_date_added else "",
                )
                existing = rows_by_key.get(row_key)
                if existing:
                    existing["your_qty"] += your_qty
                    continue

                rows_by_key[row_key] = {
                    "pct_cash": pct_cash,
                    "pct_credit": pct_credit,
                    "buy_cash": ck_buy_cash,
                    "buy_credit": ck_buy_credit,
                    "retail": ck_retail,
                    "your_qty": your_qty,
                    "sell_qty": 0,
                    "ck_qty_buying": ck_qty_buying,
                    "payout": Decimal("0.00"),
                    "name": name,
                    "edition": edition_name,
                    "edition_code": edition_code,
                    "collector_number": collector_number,
                    "scryfall_id": scryfall_id,
                    "finish": finish,
                    "tags": tags,
                    "date_added": date_added,
                    "version_plain": ver_plain,
                    "tcg_low": tcg_low,
                    "tcg_market": tcg_market,
                    "tcg_nm_qty": tcg_nm_qty,
                    "pct_tcg_low": pct_tcg_low,
                    "pct_low_market": pct_low_market,
                    "source_market": "-",
                    "source_cost": Decimal("0.00"),
                    "source_cost_effective": Decimal("0.00"),
                    "arb_profit": Decimal("0.00"),
                    "arb_roi": Decimal("0.00"),
                }

    rows = list(rows_by_key.values())
    total_cash = Decimal("0.00")
    for r in rows:
        if args.include_zero_buy_qty:
            r["sell_qty"] = r["your_qty"]
        else:
            r["sell_qty"] = min(r["your_qty"], r["ck_qty_buying"])
        r["payout"] = dmoney(r["buy_cash"] * r["sell_qty"])
        total_cash += r["payout"]

    sort_key = {
        "pct": lambda r: (r["pct_cash"], r["buy_cash"], r["name"]),
        "creditpct": lambda r: (r["pct_credit"], r["buy_cash"], r["name"]),
        "buy": lambda r: (r["buy_cash"], r["pct_cash"], r["name"]),
        "card": lambda r: (r["name"], r["version_plain"]),
        "version": lambda r: (r["version_plain"], r["name"]),
        "qty": lambda r: (r["your_qty"], r["name"]),
        "location": lambda r: (r["tags"], r["name"]),
        "cash": lambda r: (r["buy_cash"], r["name"]),
        "credit": lambda r: (r["buy_credit"], r["name"]),
        "pctcash": lambda r: (r["pct_cash"], r["name"]),
        "pctcredit": lambda r: (r["pct_credit"], r["name"]),
        "tcglow": lambda r: (r["tcg_low"], r["name"]),
        "pcttcglow": lambda r: (r["pct_tcg_low"], r["name"]),
        "lowmktpct": lambda r: (r["pct_low_market"], r["name"]),
        "arbprofit": lambda r: (r["arb_profit"], r["name"]),
        "arbroi": lambda r: (r["arb_roi"], r["name"]),
        "sourcecost": lambda r: (r["source_cost_effective"], r["name"]),
        "ckbuyqty": lambda r: (r["ck_qty_buying"], r["name"]),
    }[args.sort]

    rows.sort(key=sort_key, reverse=not args.asc)

    # Output
    use_color = should_color_output()
    show_cash_only = args.cash
    show_location = not args.price_check
    show_date_added = (not args.price_check) and (date_from is not None or date_to is not None)
    show_ck_pct = not args.price_check
    show_arb = args.arb_check
    tcg_low_pct_factor = (Decimal("1.00") / Decimal("1.30")) if show_cash_only else Decimal("1.00")
    tcg_low_red = Decimal("70") * tcg_low_pct_factor
    tcg_low_switch = Decimal("100") * tcg_low_pct_factor
    tcg_low_green = Decimal("150") * tcg_low_pct_factor
    price_label = "CK Cash" if show_cash_only else "CK Credit"
    pct_label = "Pct Cash" if show_cash_only else "Pct Credit"

    fmt_rows = []
    w_card = len("Card")
    w_ver = len("Version")
    w_qty = len("Qty")
    w_date = len("Date Added")
    w_loc = len("Location")
    w_cash = len("CK Cash")
    w_credit = len("CK Credit")
    w_pct_cash = len("Pct Cash")
    w_pct_credit = len("Pct Credit")
    w_tcg_low = len("TCG Low")
    w_pct_tcg_low = len("Pct TCG Low")
    w_pct_low_market = len("Pct Low/Mkt")
    w_source = len("Source")
    w_source_cost = len("Source Cost")
    w_arb_profit = len("Arb Profit")
    w_arb_roi = len("Arb ROI")
    w_ck_buy_qty = len("CK Buy Qty")

    for r in rows:
        ver_base = version_base_from_row(
            r.get("edition_code", ""),
            r.get("collector_number", ""),
            r["edition"],
        )
        ver_plain = r.get("version_plain") or version_plain(ver_base, r["finish"])
        rp = {
            "card": r["name"],
            "ver_base": ver_base,
            "ver_plain": ver_plain,
            "finish": r["finish"],
            "qty": str(r["your_qty"]),
            "date_added": r.get("date_added", "-") or "-",
            "loc": r["tags"] or "-",
            "cash": f"${r['buy_cash']:.2f}",
            "credit": f"${r['buy_credit']:.2f}",
            "pct_cash": f"{r['pct_cash']:.2f}%",
            "pct_credit": f"{r['pct_credit']:.2f}%",
            "ck_buy_qty": str(r["ck_qty_buying"]),
            "tcg_low_v": Decimal("0.00"),
            "tcg_low": "-",
            "pct_tcg_low": "-",
            "pct_tcg_low_v": Decimal("0.00"),
            "pct_low_market": "-",
            "pct_low_market_v": Decimal("0.00"),
            "source_market": r.get("source_market", "-"),
            "source_cost": "-",
            "source_cost_v": Decimal("0.00"),
            "arb_profit": "-",
            "arb_profit_v": Decimal("0.00"),
            "arb_roi": "-",
            "arb_roi_v": Decimal("0.00"),
        }
        if args.tcglow:
            tcg_low = r.get("tcg_low", Decimal("0.00"))
            pct_tcg_low = r.get("pct_tcg_low", Decimal("0.00"))
            pct_low_market = r.get("pct_low_market", Decimal("0.00"))
            rp["tcg_low_v"] = tcg_low
            rp["tcg_low"] = f"${tcg_low:.2f}" if tcg_low > 0 else "-"
            rp["pct_tcg_low"] = f"{pct_tcg_low:.2f}%" if tcg_low > 0 else "-"
            rp["pct_tcg_low_v"] = pct_tcg_low if tcg_low > 0 else Decimal("0.00")
            rp["pct_low_market"] = f"{pct_low_market:.2f}%" if pct_low_market > 0 else "-"
            rp["pct_low_market_v"] = pct_low_market if pct_low_market > 0 else Decimal("0.00")
        if show_arb:
            src_cost = r.get("source_cost", Decimal("0.00"))
            arb_profit = r.get("arb_profit", Decimal("0.00"))
            arb_roi = r.get("arb_roi", Decimal("0.00"))
            rp["source_cost_v"] = src_cost
            rp["source_cost"] = f"${src_cost:.2f}" if src_cost > 0 else "-"
            rp["arb_profit_v"] = arb_profit
            rp["arb_profit"] = f"${arb_profit:.2f}" if arb_profit != 0 else "-"
            rp["arb_roi_v"] = arb_roi
            rp["arb_roi"] = f"{arb_roi:.2f}%" if arb_roi > 0 else "-"

        fmt_rows.append(rp)
        w_card = max(w_card, len(rp["card"]))
        w_ver = max(w_ver, len(rp["ver_plain"]))
        w_qty = max(w_qty, len(rp["qty"]))
        w_date = max(w_date, len(rp["date_added"]))
        w_loc = max(w_loc, len(rp["loc"]))
        w_cash = max(w_cash, len(rp["cash"]))
        w_credit = max(w_credit, len(rp["credit"]))
        w_pct_cash = max(w_pct_cash, len(rp["pct_cash"]))
        w_pct_credit = max(w_pct_credit, len(rp["pct_credit"]))
        if args.tcglow:
            w_tcg_low = max(w_tcg_low, len(rp["tcg_low"]))
            w_pct_tcg_low = max(w_pct_tcg_low, len(rp["pct_tcg_low"]))
            w_pct_low_market = max(w_pct_low_market, len(rp["pct_low_market"]))
        if show_arb:
            w_source = max(w_source, len(rp["source_market"]))
            w_source_cost = max(w_source_cost, len(rp["source_cost"]))
            w_arb_profit = max(w_arb_profit, len(rp["arb_profit"]))
            w_arb_roi = max(w_arb_roi, len(rp["arb_roi"]))
        w_ck_buy_qty = max(w_ck_buy_qty, len(rp["ck_buy_qty"]))

    w_price = w_cash if show_cash_only else w_credit
    w_pct = w_pct_cash if show_cash_only else w_pct_credit
    col_widths = [w_card, w_ver, w_qty]
    if show_date_added:
        col_widths.append(w_date)
    if show_location:
        col_widths.append(w_loc)
    col_widths.append(w_price)
    if show_ck_pct:
        col_widths.append(w_pct)
    if args.tcglow:
        col_widths.extend([w_pct_tcg_low, w_tcg_low, w_pct_low_market])
    if show_arb:
        col_widths.extend([w_source, w_source_cost, w_arb_profit, w_arb_roi])
    col_widths.append(w_ck_buy_qty)
    table_w = sum(col_widths) + (3 * (len(col_widths) - 1))
    print(colorize("Buylist Matches".center(table_w), ANSI_BOLD + ANSI_YELLOW, use_color))

    h_card = colorize("Card", ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_card - len("Card")))
    h_ver = colorize("Version", ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_ver - len("Version")))
    h_qty = colorize("Qty", ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_qty - len("Qty")))
    h_date = colorize("Date Added", ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_date - len("Date Added")))
    h_loc = colorize("Location", ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_loc - len("Location")))
    h_price = colorize(price_label, ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_price - len(price_label)))
    h_pct = colorize(pct_label, ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_pct - len(pct_label)))
    h_tcg_low = colorize("TCG Low", ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_tcg_low - len("TCG Low")))
    h_pct_tcg_low = colorize("Pct TCG Low", ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_pct_tcg_low - len("Pct TCG Low")))
    h_pct_low_market = colorize("Pct Low/Mkt", ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_pct_low_market - len("Pct Low/Mkt")))
    h_source = colorize("Source", ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_source - len("Source")))
    h_source_cost = colorize("Source Cost", ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_source_cost - len("Source Cost")))
    h_arb_profit = colorize("Arb Profit", ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_arb_profit - len("Arb Profit")))
    h_arb_roi = colorize("Arb ROI", ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_arb_roi - len("Arb ROI")))
    h_ck_buy_qty = colorize("CK Buy Qty", ANSI_BOLD + ANSI_BLUE, use_color) + (" " * max(0, w_ck_buy_qty - len("CK Buy Qty")))

    header_parts = [h_card, h_ver, h_qty]
    if show_date_added:
        header_parts.append(h_date)
    if show_location:
        header_parts.append(h_loc)
    header_parts.append(h_price)
    if show_ck_pct:
        header_parts.append(h_pct)
    if args.tcglow:
        header_parts.extend([h_pct_tcg_low, h_tcg_low, h_pct_low_market])
    if show_arb:
        header_parts.extend([h_source, h_source_cost, h_arb_profit, h_arb_roi])
    header_parts.append(h_ck_buy_qty)
    print(" | ".join(header_parts))

    sep_parts = ["-" * w_card, "-" * w_ver, "-" * w_qty]
    if show_date_added:
        sep_parts.append("-" * w_date)
    if show_location:
        sep_parts.append("-" * w_loc)
    sep_parts.append("-" * w_price)
    if show_ck_pct:
        sep_parts.append("-" * w_pct)
    if args.tcglow:
        sep_parts.extend(["-" * w_pct_tcg_low, "-" * w_tcg_low, "-" * w_pct_low_market])
    if show_arb:
        sep_parts.extend(["-" * w_source, "-" * w_source_cost, "-" * w_arb_profit, "-" * w_arb_roi])
    sep_parts.append("-" * w_ck_buy_qty)
    print(colorize("-+-".join(sep_parts), ANSI_WHITE, use_color))

    for rp, r in zip(fmt_rows, rows):
        card_s = colorize(rp["card"], ANSI_BOLD + ANSI_CYAN, use_color) + (" " * max(0, w_card - len(rp["card"])))
        ver_s = format_version(rp["ver_base"], rp["finish"], use_color) + (" " * max(0, w_ver - len(rp["ver_plain"])))
        qty_color = ANSI_BOLD + (ANSI_RED if r["your_qty"] > r["ck_qty_buying"] else ANSI_YELLOW)
        qty_s = colorize(rp["qty"], qty_color, use_color) + (" " * max(0, w_qty - len(rp["qty"])))
        date_s = colorize(rp["date_added"], ANSI_WHITE, use_color) + (" " * max(0, w_date - len(rp["date_added"])))
        loc_s = colorize(rp["loc"], ANSI_BLUE, use_color) + (" " * max(0, w_loc - len(rp["loc"])))

        price_plain = rp["cash"] if show_cash_only else rp["credit"]
        pct_plain = rp["pct_cash"] if show_cash_only else rp["pct_credit"]
        price_val = r["buy_cash"] if show_cash_only else r["buy_credit"]
        price_s = format_money(price_val, use_color) + (" " * max(0, w_price - len(price_plain)))
        if show_cash_only:
            pct_colored = colorize_pct_gradient(
                pct_plain,
                r["pct_cash"],
                Decimal("34"),
                Decimal("64"),
                use_color,
            )
        else:
            pct_colored = colorize_pct_gradient(
                pct_plain,
                r["pct_credit"],
                Decimal("45"),
                Decimal("80"),
                use_color,
            )
        pct_s = pct_colored + (" " * max(0, w_pct - len(pct_plain)))

        tcg_low_s = None
        pct_tcg_low_s = None
        pct_low_market_s = None
        source_s = None
        source_cost_s = None
        arb_profit_s = None
        arb_roi_s = None
        if args.tcglow:
            if rp["tcg_low"] == "-":
                tcg_low_s = colorize("-", ANSI_WHITE, use_color) + (" " * max(0, w_tcg_low - 1))
            else:
                tcg_low_s = format_money(rp["tcg_low_v"], use_color) + (" " * max(0, w_tcg_low - len(rp["tcg_low"])))
            if rp["pct_tcg_low"] == "-":
                pct_tcg_low_s = colorize("-", ANSI_WHITE, use_color) + (" " * max(0, w_pct_tcg_low - 1))
            else:
                pct_tcg_low_s = colorize_pct_gradient(
                    rp["pct_tcg_low"],
                    rp["pct_tcg_low_v"],
                    tcg_low_red,
                    tcg_low_green,
                    use_color,
                    switch=tcg_low_switch,
                ) + (
                    " " * max(0, w_pct_tcg_low - len(rp["pct_tcg_low"]))
                )
            if rp["pct_low_market"] == "-":
                pct_low_market_s = colorize("-", ANSI_WHITE, use_color) + (" " * max(0, w_pct_low_market - 1))
            else:
                pct_low_market_s = colorize_pct_gradient(
                    rp["pct_low_market"],
                    rp["pct_low_market_v"],
                    Decimal("70"),
                    Decimal("100"),
                    use_color,
                    switch=Decimal("85"),
                ) + (" " * max(0, w_pct_low_market - len(rp["pct_low_market"])))
        if show_arb:
            source_s = colorize(rp["source_market"], ANSI_CYAN, use_color) + (" " * max(0, w_source - len(rp["source_market"])))
            if rp["source_cost"] == "-":
                source_cost_s = colorize("-", ANSI_WHITE, use_color) + (" " * max(0, w_source_cost - 1))
            else:
                source_cost_s = format_money(rp["source_cost_v"], use_color) + (" " * max(0, w_source_cost - len(rp["source_cost"])))
            if rp["arb_profit"] == "-":
                arb_profit_s = colorize("-", ANSI_WHITE, use_color) + (" " * max(0, w_arb_profit - 1))
            else:
                profit_color = ANSI_BOLD + ANSI_GREEN if rp["arb_profit_v"] >= Decimal("0.00") else ANSI_BOLD + ANSI_RED
                arb_profit_s = colorize(rp["arb_profit"], profit_color, use_color) + (" " * max(0, w_arb_profit - len(rp["arb_profit"])))
            if rp["arb_roi"] == "-":
                arb_roi_s = colorize("-", ANSI_WHITE, use_color) + (" " * max(0, w_arb_roi - 1))
            else:
                arb_roi_s = colorize_pct_gradient(
                    rp["arb_roi"],
                    rp["arb_roi_v"],
                    Decimal("70"),
                    Decimal("150"),
                    use_color,
                    switch=Decimal("100"),
                ) + (" " * max(0, w_arb_roi - len(rp["arb_roi"])))

        ck_buy_qty_s = colorize(rp["ck_buy_qty"], ANSI_BOLD + ANSI_WHITE, use_color) + (" " * max(0, w_ck_buy_qty - len(rp["ck_buy_qty"])))

        row_parts = [card_s, ver_s, qty_s]
        if show_date_added:
            row_parts.append(date_s)
        if show_location:
            row_parts.append(loc_s)
        row_parts.append(price_s)
        if show_ck_pct:
            row_parts.append(pct_s)
        if args.tcglow:
            row_parts.extend([pct_tcg_low_s, tcg_low_s, pct_low_market_s])
        if show_arb:
            row_parts.extend([source_s, source_cost_s, arb_profit_s, arb_roi_s])
        row_parts.append(ck_buy_qty_s)
        print(" | ".join(row_parts))

    total_credit = dmoney(total_cash * Decimal("1.30"))
    total_cards = sum(int(r.get("sell_qty", 0)) for r in rows)
    total_arb_profit = dmoney(sum((r.get("arb_profit", Decimal("0.00")) * Decimal(str(r.get("sell_qty", 0)))) for r in rows))
    print()
    if show_cash_only:
        print(
            f"{colorize('Totals', ANSI_BOLD + ANSI_CYAN, use_color)} "
            f"{colorize('-', ANSI_WHITE, use_color)} "
            f"{colorize('CK Cash', ANSI_CYAN, use_color)} {format_money(total_cash, use_color)} "
            f"{colorize('(', ANSI_WHITE, use_color)}"
            f"{colorize('rows', ANSI_CYAN, use_color)} {colorize(str(len(rows)), ANSI_BOLD + ANSI_WHITE, use_color)}"
            f"{colorize(',', ANSI_WHITE, use_color)} "
            f"{colorize('cards', ANSI_CYAN, use_color)} {colorize(str(total_cards), ANSI_BOLD + ANSI_WHITE, use_color)}"
            f"{colorize(')', ANSI_WHITE, use_color)}"
        )
    else:
        print(
            f"{colorize('Totals', ANSI_BOLD + ANSI_CYAN, use_color)} "
            f"{colorize('-', ANSI_WHITE, use_color)} "
            f"{colorize('CK Credit', ANSI_CYAN, use_color)} {format_money(total_credit, use_color)} "
            f"{colorize('(', ANSI_WHITE, use_color)}"
            f"{colorize('rows', ANSI_CYAN, use_color)} {colorize(str(len(rows)), ANSI_BOLD + ANSI_WHITE, use_color)}"
            f"{colorize(',', ANSI_WHITE, use_color)} "
            f"{colorize('cards', ANSI_CYAN, use_color)} {colorize(str(total_cards), ANSI_BOLD + ANSI_WHITE, use_color)}"
            f"{colorize(')', ANSI_WHITE, use_color)}"
        )
    if show_arb:
        print(
            f"{colorize('Arb', ANSI_BOLD + ANSI_CYAN, use_color)} "
            f"{colorize('-', ANSI_WHITE, use_color)} "
            f"{colorize('Profit', ANSI_CYAN, use_color)} {format_money(total_arb_profit, use_color)}"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
