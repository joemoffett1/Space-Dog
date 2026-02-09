#!/usr/bin/env python3
import argparse
import csv
import json
import os
import re
import sys
import shutil
import subprocess
import textwrap
import urllib.request
import urllib.error
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP

# ================== CONFIG ==================

HOME_DIR = "/home/holyholyman/MagicCollection"
DEFAULT_COLLECTION = os.path.join(HOME_DIR, "collection.csv")
DEFAULT_CK_JSON = os.path.join(HOME_DIR, "ck_pricelist.json")
DEFAULT_SCRY_CACHE = os.path.join(HOME_DIR, "scryfall_cache.json")
DEFAULT_TCG_REF = os.path.join(HOME_DIR, "tcglow_reference.txt")
DEFAULT_TCGTRACKER_DAT = os.path.join(HOME_DIR, "tcgtracker.dat")
DEFAULT_TCGTRACKER_CSV = os.path.join(HOME_DIR, "tcgtracking_tcg_low_en.csv")

CK_URL = "https://api.cardkingdom.com/api/v2/pricelist"
SCRYFALL_BULK_INDEX = "https://api.scryfall.com/bulk-data"

# ================== UTIL ==================


def clean(x) -> str:
    if x is None:
        return ""
    if not isinstance(x, str):
        x = str(x)
    return re.sub(r"\s+", " ", x.strip())


def front_face(name: str) -> str:
    n = clean(name)
    if " // " in n:
        return n.split(" // ", 1)[0].strip()
    return n


def canonical_name(name: str) -> str:
    # For deck names: use front face so MDFC works consistently
    return front_face(name)


def dmoney(x) -> Decimal:
    try:
        s = str(x).strip()
        if not s:
            return Decimal("0.00")
        return Decimal(s).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception:
        return Decimal("0.00")


def normalize_collector_number(raw: str) -> str:
    s = clean(raw)
    if not s:
        return ""
    m = re.match(r"^0+([0-9].*)$", s)
    if m:
        s = m.group(1)
    return s


def parse_ref_version(version: str):
    v = clean(version)
    if not v or "#" not in v:
        return ("", "", False)
    is_foil = v.endswith(" - F")
    if is_foil:
        v = v[:-4].strip()
    left, right = v.split("#", 1)
    return (left.strip().upper(), normalize_collector_number(right), is_foil)


def load_tcg_reference(path: str):
    ref = {}
    if not path or not os.path.exists(path):
        return ref
    ansi_re = re.compile(r"\x1b\[[0-9;]*m")
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
            _, version, market_s, low_s = parts[:4]
            set_code, collector, is_foil = parse_ref_version(version)
            if not set_code or not collector:
                continue
            ref[(set_code, collector, is_foil)] = {
                "low": dmoney(low_s.replace("$", "")),
                "market": dmoney(market_s.replace("$", "")),
            }
    return ref


def lookup_tcg_reference(ref: dict, set_code: str, collector_number: str, finish: str):
    code = clean(set_code).upper()
    cn = normalize_collector_number(collector_number)
    fin = clean(finish).lower()
    is_foil = fin == "foil"
    hit = ref.get((code, cn, is_foil))
    if not hit:
        return (Decimal("0.00"), Decimal("0.00"))
    return (dmoney(hit.get("low", "")), dmoney(hit.get("market", "")))


def pct(a: Decimal, b: Decimal) -> Decimal:
    if b <= 0:
        return Decimal("0.00")
    return (a / b * Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def print_section(title: str, first: bool = False):
    if not first:
        print()
    width = min(shutil.get_terminal_size((100, 20)).columns, 120)
    heading = f" {title} ".center(max(width, len(title) + 4), "=")
    print(colorize(heading, ANSI_BOLD + ANSI_YELLOW, should_color_output()))
    print()


def print_boxed_title(title: str, content_width: int, enabled: bool):
    inner_w = max(content_width, len(title))
    print(colorize(title.center(inner_w), ANSI_BOLD + ANSI_YELLOW, enabled))


ANSI_RESET = "\033[0m"
ANSI_BOLD = "\033[1m"
ANSI_WHITE = "\033[97m"
ANSI_BLUE = "\033[38;5;39m"
ANSI_CYAN = "\033[36m"
ANSI_YELLOW = "\033[33m"
ANSI_LIGHT_PINK = "\033[38;5;213m"
ANSI_GOLD = "\033[38;5;220m"
ANSI_GREEN = "\033[32m"
ANSI_GRAY = "\033[90m"


def should_color_output() -> bool:
    if os.environ.get("FORCE_COLOR"):
        return True
    if os.environ.get("NO_COLOR"):
        return False
    return sys.stdout.isatty()


def colorize(s: str, code: str, enabled: bool) -> str:
    return f"{code}{s}{ANSI_RESET}" if enabled else s


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
        return desc.replace("DECK_LIST", colorize("DECK_LIST", ANSI_BLUE, True))

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

        sep = "⎯" * table_w
        out.append(colorize(sep, ANSI_GRAY, True) if use_color else sep)

        for field, meta, desc in norm_rows:
            wrapped = textwrap.wrap(desc, width=c3, break_long_words=False, break_on_hyphens=False) or [""]
            for i, part in enumerate(wrapped):
                field_raw = field if i == 0 else ""
                meta_raw = meta if i == 0 else ""
                field_col = field_raw.ljust(c1)
                meta_col = meta_raw.ljust(c2) if has_meta else ""
                desc_col = ColorArgumentParser._colorize_desc(part, use_color)

                if i == 0:
                    field_col = ColorArgumentParser._colorize_field(field_col, use_color)
                    if has_meta and meta_raw:
                        meta_col = ColorArgumentParser._colorize_meta(meta_col, use_color)

                if has_meta:
                    out.append(f"{field_col}  {meta_col}  {desc_col}")
                else:
                    out.append(f"{field_col}  {desc_col}")

        out.append(colorize(sep, ANSI_GRAY, True) if use_color else sep)
        return "\n".join(out)

    def format_help(self):
        use_color = should_color_output()
        lines = []
        title = "cardPuller  Compare a deck list against collection.csv."
        usage = f"USAGE  {self.prog} [OPTIONS] [DECK_LIST]"

        if use_color:
            title = (
                f"{colorize('cardPuller', ANSI_BOLD + ANSI_BLUE, True)} "
                + colorize(" Compare a deck list against collection.csv.", ANSI_BOLD + ANSI_CYAN, True)
            )
            usage = (
                f"{colorize('USAGE', ANSI_BOLD + ANSI_CYAN, True)}  "
                f"{colorize(self.prog, ANSI_BOLD + ANSI_BLUE, True)} "
                f"{colorize('[OPTIONS]', ANSI_BOLD + ANSI_YELLOW, True)} "
                f"{colorize('[DECK_LIST]', ANSI_BOLD + ANSI_YELLOW, True)}"
            )

        lines.append(title)
        lines.append("")
        lines.append(usage)
        lines.append("")

        lines.append(self._render_table(
            "INPUT",
            [
                ("DECK_LIST", "", "Deck list file (lines like: '1 Card Name'). Required unless --refresh is used."),
            ],
            use_color,
        ))
        lines.append("")

        lines.append(self._render_table(
            "FILTERS",
            [
                ("-t", "Only consider collection rows whose Tags contains this text."),
                ("-b", "Exclude all 'Binders' rows except 'Gas Binders'."),
            ],
            use_color,
        ))
        lines.append("")

        lines.append(self._render_table(
            "SETTINGS",
            [
                ("--foil", "Use foil CK pricing when comparing (default: non-foil)."),
                ("--include-illegal", "Include non-tournament-legal printings (NOT recommended). Default excludes them."),
                ("--deal-min", "Only recommend a TCG alternative when TCG ref is at least this many dollars cheaper than CK."),
            ],
            use_color,
        ))
        lines.append("")

        lines.append(self._render_table(
            "SORTING",
            [
                ("--sort", "Sort missing pricing table by: pct, ck, tcg."),
            ],
            use_color,
        ))
        lines.append("")

        lines.append(self._render_table(
            "ADMIN",
            [
                ("--refresh", "", "Refresh CK pricelist + Scryfall cache + TCG tracker reference (ONLY happens with this flag)."),
                ("--collection", f"default: {DEFAULT_COLLECTION}", "Path to collection.csv."),
                ("--ck-json", f"default: {DEFAULT_CK_JSON}", "Path to CK pricelist JSON."),
                ("--scry-cache", f"default: {DEFAULT_SCRY_CACHE}", "Path to Scryfall cache."),
                ("--tcg-ref", f"default: {DEFAULT_TCG_REF}", "Path to cardCheck version-low reference file."),
                ("-h, --help", "", "Show this help message and exit."),
            ],
            use_color,
        ))
        lines.append("")

        lines.append(self._render_table(
            "EXAMPLES",
            [
                ("cardPuller --refresh", "Refresh CK + Scryfall caches and rebuild TCG tracker reference, then exit."),
                ("cardPuller michael.csv -b", "Compare a deck while excluding non-Gas binders."),
                ("cardPuller terra.csv --foil --sort ck", "Use foil comparison and sort missing by CK."),
            ],
            use_color,
        ))

        return "\n".join(lines) + "\n"


def owned_print_desc_plain(desc: str, is_foil: bool) -> str:
    if is_foil:
        return f"{desc} - F" if "#" in desc else f"{desc} (F)"
    return desc


def format_owned_print_desc(desc: str, is_foil: bool, enabled: bool) -> str:
    plain = owned_print_desc_plain(desc, is_foil)
    if is_foil:
        if not enabled:
            return plain
        if "#" in desc:
            return f"{colorize(desc, ANSI_LIGHT_PINK, enabled)} {colorize('-', ANSI_WHITE, enabled)} {colorize('F', ANSI_BOLD + ANSI_GOLD, enabled)}"
        return f"{colorize(desc, ANSI_LIGHT_PINK, enabled)} {colorize('(F)', ANSI_BOLD + ANSI_GOLD, enabled)}"
    return colorize(desc, ANSI_LIGHT_PINK, enabled) if enabled else plain


def format_owned_loc(loc: str, enabled: bool) -> str:
    if not enabled or not loc:
        return loc

    out = []
    for part in loc.split("; "):
        m = re.match(r"^(.*)\((\d+)\)$", part)
        if not m:
            out.append(colorize(part, ANSI_BLUE, enabled))
            continue
        label, qty = m.group(1), m.group(2)
        out.append(f"{colorize(label, ANSI_BLUE, enabled)}({colorize(qty, ANSI_BOLD + ANSI_WHITE, enabled)})")
    return "; ".join(out)


def format_owned_price(price_s: str, enabled: bool) -> str:
    if not price_s:
        return ""
    code = ANSI_BOLD + ANSI_GREEN if dmoney(price_s) >= Decimal("5.00") else ANSI_GREEN
    return colorize(f"${price_s}", code, enabled) if enabled else f"${price_s}"


def ck_version_base_from_sid(sid_prices: dict, sid: str, fallback_edition: str) -> str:
    sp = sid_prices.get(sid, {}) if sid else {}
    set_code = clean((sp or {}).get("set")).upper()
    cn = clean((sp or {}).get("collector_number"))

    if set_code or cn:
        return f"{set_code} #{cn}".strip() if (set_code or cn) else ""

    return fallback_edition or "-"


# ================== CK ==================


def download_ck_json(path: str):
    """
    Download CK pricelist to path.
    CK sometimes blocks default python user agents; we try browser-ish headers,
    and fall back to curl if needed.
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
    req = urllib.request.Request(CK_URL, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        if not data:
            raise RuntimeError("Downloaded 0 bytes from CK pricelist.")
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        print(f"# Refreshed CK pricelist → {path}", file=sys.stderr)
        return
    except urllib.error.HTTPError as e:
        if e.code != 403:
            raise

    curl = shutil.which("curl")
    if not curl:
        raise RuntimeError(
            "CK returned HTTP 403 Forbidden and curl is not installed.\n"
            f"Install curl or manually download the pricelist and save it to: {path}"
        )

    p = subprocess.run(
        [curl, "-L", "-sS", "-H", f"User-Agent: {headers['User-Agent']}", CK_URL, "-o", path],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if p.returncode != 0:
        raise RuntimeError(
            "curl failed while downloading CK pricelist.\n"
            f"curl stderr:\n{p.stderr.strip()}\n"
            f"Try manually downloading the pricelist and saving it to: {path}"
        )
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        raise RuntimeError(f"curl reported success but {path} is empty.")
    print(f"# Refreshed CK pricelist (curl) → {path}", file=sys.stderr)


def _extract_ck_records(ck_obj):
    if isinstance(ck_obj, list):
        return ck_obj
    if isinstance(ck_obj, dict):
        for key in ("data", "results", "items", "pricelist", "prices"):
            v = ck_obj.get(key)
            if isinstance(v, list):
                return v
        for v in ck_obj.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                return v
    raise ValueError("Unexpected CK JSON structure")


TOURNAMENT_FORMATS = ("standard", "pioneer", "modern", "legacy", "vintage")


def load_ck_cheapest_by_name(
    ck_json_path: str,
    want_foil: bool,
    sid_legal: dict[str, bool],
    require_legal: bool = True,
):
    """
    Build: name -> cheapest CK retail record across all printings,
    filtered by foil/non-foil, and optionally tournament-legal only.

    MDFC support:
      - index under full CK name
      - ALSO under front-face name
    """
    with open(ck_json_path, "r", encoding="utf-8") as f:
        ck = json.load(f)

    recs = _extract_ck_records(ck)
    foil_str = "true" if want_foil else "false"
    best = {}  # key_name -> payload

    def consider(key_name: str, payload: dict):
        cur = best.get(key_name)
        if cur is None or payload["ck_price"] < cur["ck_price"]:
            best[key_name] = payload

    for r in recs:
        if not isinstance(r, dict):
            continue

        name = clean(r.get("name"))
        if not name:
            continue

        is_foil = r.get("is_foil")
        if isinstance(is_foil, bool):
            is_foil = "true" if is_foil else "false"
        else:
            is_foil = clean(is_foil).lower()
            if is_foil not in ("true", "false"):
                is_foil = "false"

        if is_foil != foil_str:
            continue

        price_retail = dmoney(r.get("price_retail"))
        if price_retail <= 0:
            continue

        sid = clean(r.get("scryfall_id"))
        legal = bool(sid and sid_legal.get(sid, False))
        if require_legal and not legal:
            continue

        payload = {
            "ck_price": price_retail,
            "ck_edition": clean(r.get("edition")),
            "ck_url": clean(r.get("url")),
            "ck_legal": "true" if legal else "false",
            "scryfall_id": sid,
            "ck_is_foil": (is_foil == "true"),
        }

        consider(name, payload)
        consider(front_face(name), payload)

    return best


def load_ck_price_by_sid_finish(ck_json_path: str):
    """
    Build: (scryfall_id, is_foil_str) -> cheapest CK retail price for that exact finish.
    is_foil_str is "true" or "false".
    """
    with open(ck_json_path, "r", encoding="utf-8") as f:
        ck = json.load(f)

    recs = _extract_ck_records(ck)
    best = {}

    for r in recs:
        if not isinstance(r, dict):
            continue

        sid = clean(r.get("scryfall_id"))
        if not sid:
            continue

        is_foil = r.get("is_foil")
        if isinstance(is_foil, bool):
            is_foil = "true" if is_foil else "false"
        else:
            is_foil = clean(is_foil).lower()
            if is_foil not in ("true", "false"):
                is_foil = "false"

        price_retail = dmoney(r.get("price_retail"))
        if price_retail <= 0:
            continue

        key = (sid, is_foil)
        cur = best.get(key)
        if cur is None or price_retail < cur:
            best[key] = price_retail

    return best


# ================== SCRYFALL CACHE ==================


def is_tournament_legal_from_legalities(legalities: dict) -> bool:
    if not isinstance(legalities, dict):
        return False
    for fmt in TOURNAMENT_FORMATS:
        v = (legalities.get(fmt) or "").lower()
        if v in ("legal", "restricted"):
            return True
    return False


def refresh_scryfall_cache(cache_path: str):
    """
    Builds one cache file with:
      - sid_tournament_legal: scryfall_id -> bool
      - sid_prices: scryfall_id -> {set_name,set,collector_number,tcg_low,tcg_market,tcg_market_foil,tcg_market_etched,eur,eur_foil,name}  (ALL cards)
      - by_name: name -> {tcg_low_min, tcg_market_min} (tournament-legal only)

    MDFC support:
      - by_name includes full name AND front face key.
    """
    headers = {"User-Agent": "cardPuller/1.0 (local script)"}

    req = urllib.request.Request(SCRYFALL_BULK_INDEX, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        bulk = json.load(r)

    default = None
    for item in bulk.get("data", []):
        if item.get("type") == "default_cards":
            default = item
            break
    if not default or not default.get("download_uri"):
        raise RuntimeError("Could not locate Scryfall default_cards download_uri")

    dl_url = default["download_uri"]
    print("# Downloading Scryfall bulk (default_cards)…", file=sys.stderr)

    req2 = urllib.request.Request(dl_url, headers=headers)
    with urllib.request.urlopen(req2, timeout=300) as r:
        raw = r.read()

    data = json.loads(raw.decode("utf-8"))

    sid_legal: dict[str, bool] = {}
    sid_prices: dict[str, dict] = {}
    by_name: dict[str, dict] = {}

    def upd_min(cur_s: str, new_d: Decimal) -> str:
        if new_d <= 0:
            return cur_s
        if not cur_s:
            return f"{new_d:.2f}"
        cur_d = dmoney(cur_s)
        if new_d < cur_d:
            return f"{new_d:.2f}"
        return cur_s

    def update_name_key(k: str, low: Decimal, mkt: Decimal):
        if not k:
            return
        cur = by_name.get(k)
        if cur is None:
            by_name[k] = {
                "tcg_low_min": f"{low:.2f}" if low > 0 else "",
                "tcg_market_min": f"{mkt:.2f}" if mkt > 0 else "",
            }
        else:
            cur["tcg_low_min"] = upd_min(cur.get("tcg_low_min", ""), low)
            cur["tcg_market_min"] = upd_min(cur.get("tcg_market_min", ""), mkt)

    for card in data:
        if not isinstance(card, dict):
            continue

        sid = clean(card.get("id"))
        name = clean(card.get("name"))
        if not sid or not name:
            continue

        legal = is_tournament_legal_from_legalities(card.get("legalities") or {})
        sid_legal[sid] = legal

        p = card.get("prices") or {}
        low = dmoney(p.get("usd_low"))
        mkt = dmoney(p.get("usd"))
        mkt_foil = dmoney(p.get("usd_foil"))
        mkt_etched = dmoney(p.get("usd_etched"))
        eur = dmoney(p.get("eur"))
        eur_foil = dmoney(p.get("eur_foil"))

        # Store per-printing prices for ALL cards so Owned valuation works
        sid_prices[sid] = {
            "name": name,
            "set_name": clean(card.get("set_name")),
            "set": clean(card.get("set")),
            "collector_number": clean(card.get("collector_number")),
            "tcg_low": f"{low:.2f}" if low > 0 else "",
            "tcg_market": f"{mkt:.2f}" if mkt > 0 else "",
            "tcg_market_foil": f"{mkt_foil:.2f}" if mkt_foil > 0 else "",
            "tcg_market_etched": f"{mkt_etched:.2f}" if mkt_etched > 0 else "",
            "eur": f"{eur:.2f}" if eur > 0 else "",
            "eur_foil": f"{eur_foil:.2f}" if eur_foil > 0 else "",
        }

        # Only by-name mins for tournament-legal cards (avoid World Champs / etc)
        if legal:
            update_name_key(name, low, mkt)
            update_name_key(front_face(name), low, mkt)

    out = {"sid_tournament_legal": sid_legal, "sid_prices": sid_prices, "by_name": by_name}

    os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(out, f)

    print(
        f"# Refreshed Scryfall cache → {cache_path} (names={len(by_name)}, sids={len(sid_legal)}, priced={len(sid_prices)})",
        file=sys.stderr,
    )


def refresh_tcg_reference(
    ref_path: str,
    tracker_dat_path: str = DEFAULT_TCGTRACKER_DAT,
    tracker_csv_path: str = DEFAULT_TCGTRACKER_CSV,
):
    build_script = os.path.join(HOME_DIR, "build_tcgtracking_tcg_low_cache.py")
    check_script = os.path.join(HOME_DIR, "cardCheck")
    if not os.path.exists(build_script):
        raise RuntimeError(f"Missing script: {build_script}")
    if not os.path.exists(check_script):
        raise RuntimeError(f"Missing script: {check_script}")

    os.makedirs(os.path.dirname(ref_path) or ".", exist_ok=True)
    os.makedirs(os.path.dirname(tracker_dat_path) or ".", exist_ok=True)
    os.makedirs(os.path.dirname(tracker_csv_path) or ".", exist_ok=True)

    subprocess.run(
        [
            sys.executable,
            build_script,
            "--output-json",
            tracker_dat_path,
            "--output-csv",
            tracker_csv_path,
            "--no-preview",
        ],
        check=True,
    )
    with open(ref_path, "w", encoding="utf-8") as out:
        subprocess.run(
            [
                sys.executable,
                check_script,
                "--data",
                tracker_dat_path,
                "--version-low-only",
                "--limit",
                "0",
            ],
            stdout=out,
            check=True,
        )
    return tracker_dat_path, tracker_csv_path, ref_path


def load_scry_cache(cache_path: str):
    """
    Loads cache and repairs MDFC keys in case older cache versions exist.
    Ensures keys: sid_tournament_legal, sid_prices, by_name.
    """
    with open(cache_path, "r", encoding="utf-8") as f:
        obj = json.load(f)

    # Back-compat: older cache might be just a by_name dict
    if "by_name" not in obj:
        obj = {"sid_tournament_legal": {}, "sid_prices": {}, "by_name": obj}

    if "sid_prices" not in obj or not isinstance(obj.get("sid_prices"), dict):
        obj["sid_prices"] = {}

    by_name = obj.get("by_name", {}) or {}

    def merge_min(existing: str, incoming: str) -> str:
        if not incoming:
            return existing
        if not existing:
            return incoming
        try:
            if dmoney(incoming) < dmoney(existing):
                return incoming
        except Exception:
            pass
        return existing

    # derive front-face entries from MDFC "A // B" keys if missing
    derived = {}
    for k, v in by_name.items():
        if not isinstance(k, str) or " // " not in k:
            continue
        a = front_face(k)
        if not a:
            continue
        if a not in derived:
            derived[a] = {"tcg_low_min": "", "tcg_market_min": ""}
        derived[a]["tcg_low_min"] = merge_min(derived[a]["tcg_low_min"], (v or {}).get("tcg_low_min", ""))
        derived[a]["tcg_market_min"] = merge_min(derived[a]["tcg_market_min"], (v or {}).get("tcg_market_min", ""))

    for a, v in derived.items():
        if a not in by_name:
            by_name[a] = v
        else:
            by_name[a]["tcg_low_min"] = merge_min(by_name[a].get("tcg_low_min", ""), v.get("tcg_low_min", ""))
            by_name[a]["tcg_market_min"] = merge_min(by_name[a].get("tcg_market_min", ""), v.get("tcg_market_min", ""))

    obj["by_name"] = by_name
    return obj


# ================== COLLECTION ==================


def load_collection_owned(collection_csv: str, tag_filter: str | None, binders_exclude: bool):
    """
    Returns:
      - owned_qty[name] -> total quantity across qualifying rows
      - owned_tags[name][tag] -> qty per tag (to show where it lives)
      - owned_rows[name] -> list of per-printing rows (with scryfall_id, finish, etc)
    """
    owned_qty = defaultdict(int)
    owned_tags = defaultdict(lambda: defaultdict(int))
    owned_rows = defaultdict(list)

    tag_filter_lc = tag_filter.lower() if tag_filter else None

    with open(collection_csv, "r", encoding="utf-8", newline="") as f:
        rdr = csv.DictReader(f)
        for row in rdr:
            name = canonical_name(row.get("Name", ""))
            if not name:
                continue

            tags = clean(row.get("Tags", ""))
            tgl = tags.lower()

            if binders_exclude and ("binders" in tgl) and ("gas binders" not in tgl):
                continue
            if tag_filter_lc and tag_filter_lc not in tgl:
                continue

            try:
                q = int(clean(row.get("Quantity", "0")) or "0")
            except Exception:
                q = 0
            if q <= 0:
                continue

            sid = clean(row.get("Scryfall ID", ""))
            finish = clean(row.get("Finish", ""))
            edition_name = clean(row.get("Edition Name", ""))
            edition_code = clean(row.get("Edition Code", ""))
            collector_number = clean(row.get("Collector Number", ""))

            owned_qty[name] += q
            if tags:
                owned_tags[name][tags] += q

            owned_rows[name].append(
                {
                    "qty": q,
                    "tags": tags,
                    "scryfall_id": sid,
                    "finish": finish,
                    "edition_name": edition_name,
                    "edition_code": edition_code,
                    "collector_number": collector_number,
                }
            )

    return owned_qty, owned_tags, owned_rows


# ================== MAIN ==================


def main():
    ap = ColorArgumentParser(prog="cardPuller")

    ap.add_argument("deck_list", nargs="?", help="Deck list file (lines like: '1 Card Name')")
    ap.add_argument(
        "--refresh",
        action="store_true",
        help="Refresh CK pricelist + Scryfall cache + TCG tracker reference (ONLY happens with this flag).",
    )

    ap.add_argument(
        "--collection",
        "-C",
        default=DEFAULT_COLLECTION,
        help=f"Path to collection.csv (default: {DEFAULT_COLLECTION})",
    )
    ap.add_argument(
        "--ck-json",
        default=DEFAULT_CK_JSON,
        help=f"Path to CK pricelist JSON (default: {DEFAULT_CK_JSON})",
    )
    ap.add_argument(
        "--scry-cache",
        default=DEFAULT_SCRY_CACHE,
        help=f"Path to Scryfall cache (default: {DEFAULT_SCRY_CACHE})",
    )
    ap.add_argument(
        "--tcg-ref",
        default=DEFAULT_TCG_REF,
        help=f"Path to cardCheck version-low reference file (default: {DEFAULT_TCG_REF})",
    )

    ap.add_argument("-t", "--tag", help="Only consider collection rows whose Tags contains this text")
    ap.add_argument(
        "-b",
        action="store_true",
        help="Exclude all 'Binders' rows except 'Gas Binders'",
    )
    ap.add_argument("--foil", action="store_true", help="Use foil CK pricing when comparing (default: non-foil)")
    ap.add_argument("--sort", choices=["pct", "ck", "tcg"], default="pct", help="Sort missing pricing table by: pct, ck, tcg")
    ap.add_argument(
        "--include-illegal",
        action="store_true",
        help="Include non-tournament-legal printings (NOT recommended). Default excludes them.",
    )

    ap.add_argument(
        "--deal-min",
        type=Decimal,
        default=Decimal("5.00"),
        help="Only recommend a TCG alternative when TCG ref is at least this many dollars cheaper than CK (default: 5.00)",
    )

    args = ap.parse_args()

    # Refresh caches ONLY when explicitly requested
    if args.refresh:
        download_ck_json(args.ck_json)
        refresh_scryfall_cache(args.scry_cache)
        refresh_tcg_reference(args.tcg_ref)
        if not args.deck_list:
            return 0

    # Require caches to exist for normal runs (no implicit network)
    if not os.path.exists(args.ck_json):
        print(f"ERROR: missing CK cache: {args.ck_json}\nRun: cardPuller --refresh", file=sys.stderr)
        return 2
    if not os.path.exists(args.scry_cache):
        print(f"ERROR: missing Scryfall cache: {args.scry_cache}\nRun: cardPuller --refresh", file=sys.stderr)
        return 2

    if not args.deck_list:
        ap.error("deck_list is required unless you use --refresh")

    scry_cache = load_scry_cache(args.scry_cache)
    sid_legal = scry_cache.get("sid_tournament_legal", {}) or {}
    sid_prices = scry_cache.get("sid_prices", {}) or {}
    by_name = scry_cache.get("by_name", {}) or {}
    tcg_ref = load_tcg_reference(args.tcg_ref)
    ck_prices_by_sid_finish = load_ck_price_by_sid_finish(args.ck_json)

    # Parse deck list (Commander default: qty needed=1)
    need = {}
    with open(args.deck_list, "r", encoding="utf-8") as f:
        for line in f:
            m = re.match(r"\s*\d+\s+(.*)", line.strip())
            if not m:
                continue
            nm = canonical_name(m.group(1))
            if nm:
                need[nm] = 1

    # Load collection owned (honors -t and -b)
    owned_qty, owned_tags, owned_rows = load_collection_owned(args.collection, args.tag, args.b)

    # ================== OWNED OUTPUT ==================
    owned_count = 0
    owned_priced_count = 0
    owned_ck_priced_count = 0
    total_owned_tcg_market = Decimal("0.00")
    total_owned_ck_market = Decimal("0.00")
    owned_details = []
    owned_use_color = should_color_output()

    for n in sorted(need.keys(), key=lambda x: x.lower()):
        if owned_qty.get(n, 0) <= 0:
            continue

        owned_count += 1

        per_print = {}
        for rr in owned_rows.get(n, []):
            sid = rr.get("scryfall_id") or ""
            sp = sid_prices.get(sid) if sid else None

            set_code = (clean((sp or {}).get("set")) or clean(rr.get("edition_code"))).upper()
            set_name = clean((sp or {}).get("set_name")) or clean(rr.get("edition_name"))
            set_label = set_code or set_name
            cn = clean((sp or {}).get("collector_number")) or clean(rr.get("collector_number"))
            fin = clean(rr.get("finish"))

            desc = f"{set_label} #{cn}".strip() if (set_label or cn) else set_label
            fin_lc = fin.lower()
            if fin_lc in ("", "normal", "nonfoil", "non-foil"):
                pass
            elif fin_lc not in ("foil",):
                desc = (desc + f" ({fin})").strip()
            is_foil = fin_lc == "foil"

            key = (sid or "", set_label or "", cn or "", fin or "")
            rec = per_print.get(key)
            if rec is None:
                rec = {"qty": 0, "tags": defaultdict(int), "desc": desc, "price": None, "ck_price": None, "foil": is_foil}
                per_print[key] = rec

            rec["qty"] += rr.get("qty", 0)
            tags = clean(rr.get("tags", ""))
            if tags:
                rec["tags"][tags] += rr.get("qty", 0)

            ref_low, ref_market = lookup_tcg_reference(tcg_ref, set_code, cn, fin_lc)
            if ref_low > 0 or ref_market > 0:
                ref_price = ref_market if ref_market > 0 else ref_low
                rec["price"] = ref_price
            elif sp:
                mkt_foil = dmoney(sp.get("tcg_market_foil", ""))
                mkt_etched = dmoney(sp.get("tcg_market_etched", ""))
                mkt = dmoney(sp.get("tcg_market", ""))
                low = dmoney(sp.get("tcg_low", ""))

                if "etched" in fin_lc:
                    price = mkt_etched if mkt_etched > 0 else (mkt_foil if mkt_foil > 0 else (mkt if mkt > 0 else low))
                elif fin_lc == "foil":
                    price = mkt_foil if mkt_foil > 0 else (mkt if mkt > 0 else low)
                else:
                    price = mkt if mkt > 0 else low
                if price > 0:
                    rec["price"] = price

            if sid:
                if "etched" in fin_lc:
                    ck_price = ck_prices_by_sid_finish.get((sid, "true")) or ck_prices_by_sid_finish.get((sid, "false"))
                elif fin_lc == "foil":
                    ck_price = ck_prices_by_sid_finish.get((sid, "true"))
                else:
                    ck_price = ck_prices_by_sid_finish.get((sid, "false"))

                if ck_price is not None and ck_price > 0:
                    rec["ck_price"] = ck_price

        printings = []
        for rec in per_print.values():
            loc = "; ".join(
                f"{t}({q})" for t, q in sorted(rec["tags"].items(), key=lambda x: x[0].lower())
            )
            price = rec["price"]
            printings.append(
                {
                    "desc": rec["desc"],
                    "foil": rec.get("foil", False),
                    "ck_price": rec.get("ck_price"),
                    "ck_price_s": f"{rec['ck_price']:.2f}" if rec.get("ck_price") is not None else "",
                    "loc": loc,
                    "price": price,
                    "price_s": f"{price:.2f}" if price is not None else "",
                }
            )

        printings.sort(
            key=lambda x: (
                x["price"] is None,
                x["price"] if x["price"] is not None else Decimal("0.00"),
                x["desc"].lower(),
            )
        )

        # Choose least valuable printing you own (or by-name fallback if missing)
        best_price = next((p["price"] for p in printings if p["price"] is not None), None)

        if best_price is None:
            # Fallback when cache lacks sid_prices: use by-name mins
            by = by_name.get(n, {}) or {}
            mkt = dmoney(by.get("tcg_market_min", ""))
            low = dmoney(by.get("tcg_low_min", ""))
            fallback = mkt if mkt > 0 else low
            if fallback > 0:
                best_price = fallback
        if best_price is not None:
            # Commander default: sum 1x per deck card (least valuable you own)
            total_owned_tcg_market += best_price
            owned_priced_count += 1

        best_ck_price = min((p["ck_price"] for p in printings if p.get("ck_price") is not None), default=None)
        if best_ck_price is not None:
            total_owned_ck_market += best_ck_price
            owned_ck_priced_count += 1

        owned_details.append(
            {
                "name": n,
                "total": owned_qty[n],
                "printings": printings,
                "best_price": best_price,
            }
        )

    owned_details.sort(
        key=lambda x: (
            x["best_price"] is None,
            -(x["best_price"] if x["best_price"] is not None else Decimal("0.00")),
            x["name"].lower(),
        )
    )

    owned_table_rows = []
    ow_name_w = len("Card")
    ow_qty_w = len("Qty")
    ow_ver_w = len("Version")
    ow_loc_w = len("Location")
    ow_tcg_w = len("TCG")
    ow_ck_w = len("CK")

    for od in owned_details:
        print_rows = od["printings"] if od["printings"] else [{"desc": "-", "foil": False, "loc": "", "price_s": "", "ck_price_s": ""}]
        for i, p in enumerate(print_rows):
            name_plain = od["name"] if i == 0 else ""
            qty_plain = f"x{od['total']}" if i == 0 else ""
            ver_plain = owned_print_desc_plain(p["desc"], p.get("foil", False)) if p.get("desc") else "-"
            loc_plain = p.get("loc") or "-"
            tcg_num = p.get("price_s", "")
            ck_num = p.get("ck_price_s", "")
            tcg_plain = f"${tcg_num}" if tcg_num else "-"
            ck_plain = f"${ck_num}" if ck_num else "-"

            owned_table_rows.append(
                {
                    "name": name_plain,
                    "qty": qty_plain,
                    "desc": p.get("desc", "-"),
                    "foil": bool(p.get("foil", False)),
                    "ver_plain": ver_plain,
                    "loc": p.get("loc", ""),
                    "loc_plain": loc_plain,
                    "tcg_num": tcg_num,
                    "tcg_plain": tcg_plain,
                    "ck_num": ck_num,
                    "ck_plain": ck_plain,
                }
            )

            ow_name_w = max(ow_name_w, len(name_plain))
            ow_qty_w = max(ow_qty_w, len(qty_plain))
            ow_ver_w = max(ow_ver_w, len(ver_plain))
            ow_loc_w = max(ow_loc_w, len(loc_plain))
            ow_tcg_w = max(ow_tcg_w, len(tcg_plain))
            ow_ck_w = max(ow_ck_w, len(ck_plain))

    ow_plain_header = (
        f"{'Card'.ljust(ow_name_w)} | "
        f"{'Qty'.ljust(ow_qty_w)} | "
        f"{'Version'.ljust(ow_ver_w)} | "
        f"{'Location'.ljust(ow_loc_w)} | "
        f"{'TCG'.ljust(ow_tcg_w)} | "
        f"{'CK'.ljust(ow_ck_w)}"
    )
    print_boxed_title("Owned", len(ow_plain_header), owned_use_color)

    ow_hdr_name = colorize("Card", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, ow_name_w - len("Card")))
    ow_hdr_qty = colorize("Qty", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, ow_qty_w - len("Qty")))
    ow_hdr_ver = colorize("Version", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, ow_ver_w - len("Version")))
    ow_hdr_loc = colorize("Location", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, ow_loc_w - len("Location")))
    ow_hdr_tcg = colorize("TCG", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, ow_tcg_w - len("TCG")))
    ow_hdr_ck = colorize("CK", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, ow_ck_w - len("CK")))
    print(f"{ow_hdr_name} | {ow_hdr_qty} | {ow_hdr_ver} | {ow_hdr_loc} | {ow_hdr_tcg} | {ow_hdr_ck}")
    print(
        colorize(
            f"{'-' * ow_name_w}-+-{'-' * ow_qty_w}-+-{'-' * ow_ver_w}-+-{'-' * ow_loc_w}-+-{'-' * ow_tcg_w}-+-{'-' * ow_ck_w}",
            ANSI_WHITE,
            owned_use_color,
        )
    )

    for r in owned_table_rows:
        name_col = colorize(r["name"], ANSI_BOLD + ANSI_CYAN, owned_use_color) if r["name"] else ""
        qty_col = colorize(r["qty"], ANSI_BOLD + ANSI_YELLOW, owned_use_color) if r["qty"] else ""
        if r["ver_plain"] == "-":
            ver_col = colorize("-", ANSI_WHITE, owned_use_color)
        else:
            ver_col = format_owned_print_desc(r["desc"], r["foil"], owned_use_color)
        if r["loc_plain"] == "-":
            loc_col = colorize("-", ANSI_WHITE, owned_use_color)
        else:
            loc_col = format_owned_loc(r["loc"], owned_use_color)
        tcg_col = format_owned_price(r["tcg_num"], owned_use_color) if r["tcg_num"] else colorize("-", ANSI_WHITE, owned_use_color)
        ck_col = format_owned_price(r["ck_num"], owned_use_color) if r["ck_num"] else colorize("-", ANSI_WHITE, owned_use_color)

        name_s = name_col + (" " * max(0, ow_name_w - len(r["name"])))
        qty_s = qty_col + (" " * max(0, ow_qty_w - len(r["qty"])))
        ver_s = ver_col + (" " * max(0, ow_ver_w - len(r["ver_plain"])))
        loc_s = loc_col + (" " * max(0, ow_loc_w - len(r["loc_plain"])))
        tcg_s = tcg_col + (" " * max(0, ow_tcg_w - len(r["tcg_plain"])))
        ck_s = ck_col + (" " * max(0, ow_ck_w - len(r["ck_plain"])))
        print(f"{name_s} | {qty_s} | {ver_s} | {loc_s} | {tcg_s} | {ck_s}")

    print(
        f"{colorize('Total Owned Market', ANSI_BOLD + ANSI_CYAN, owned_use_color)} "
        f"{colorize('-', ANSI_WHITE, owned_use_color)} "
        f"{colorize('TCG', ANSI_CYAN, owned_use_color)} {format_owned_price(f'{total_owned_tcg_market:.2f}', owned_use_color)} "
        f"{colorize('|', ANSI_WHITE, owned_use_color)} "
        f"{colorize('CK', ANSI_CYAN, owned_use_color)} {format_owned_price(f'{total_owned_ck_market:.2f}', owned_use_color)} "
        f"{colorize('(', ANSI_WHITE, owned_use_color)}"
        f"{colorize('cards', ANSI_CYAN, owned_use_color)} {colorize(str(owned_count), ANSI_BOLD + ANSI_WHITE, owned_use_color)}, "
        f"{colorize('TCG priced', ANSI_CYAN, owned_use_color)} {colorize(str(owned_priced_count), ANSI_BOLD + ANSI_WHITE, owned_use_color)}, "
        f"{colorize('CK priced', ANSI_CYAN, owned_use_color)} {colorize(str(owned_ck_priced_count), ANSI_BOLD + ANSI_WHITE, owned_use_color)}"
        f"{colorize(')', ANSI_WHITE, owned_use_color)}"
    )

    # ================== MISSING LIST ==================
    missing = [n for n in need.keys() if owned_qty.get(n, 0) <= 0]

    print()
    missing_title_w = max([len("Missing")] + [len(n) for n in missing])
    print_boxed_title("Missing", missing_title_w, owned_use_color)
    for n in sorted(missing, key=lambda x: x.lower()):
        print(colorize(n, ANSI_BOLD + ANSI_CYAN, owned_use_color))

    # ================== MISSING PRICING (CK vs SCRY) ==================
    ck_best = load_ck_cheapest_by_name(
        args.ck_json,
        want_foil=args.foil,
        sid_legal=sid_legal,
        require_legal=(not args.include_illegal),
    )

    rows = []
    total_ck = Decimal("0.00")
    total_tcg_ref = Decimal("0.00")
    ck_count = 0
    tcg_count = 0

    good_deals = []
    deal_min = dmoney(args.deal_min)

    for name in missing:
        s = by_name.get(name, {})
        tcg_low = dmoney(s.get("tcg_low_min", ""))
        tcg_mkt = dmoney(s.get("tcg_market_min", ""))

        # Choose reference: prefer low, else market
        if tcg_low > 0:
            tcg_ref_kind = "low"
            tcg_ref = tcg_low
        elif tcg_mkt > 0:
            tcg_ref_kind = "market"
            tcg_ref = tcg_mkt
        else:
            tcg_ref_kind = ""
            tcg_ref = Decimal("0.00")

        ck = ck_best.get(name)
        if not ck:
            ck_price = Decimal("0.00")
            ck_edition = ""
            ck_sid = ""
            ck_is_foil = False
            ck_url = ""
        else:
            ck_price = ck["ck_price"]
            ck_edition = ck["ck_edition"]
            ck_sid = ck.get("scryfall_id", "")
            ck_is_foil = bool(ck.get("ck_is_foil", False))
            ck_url = ck["ck_url"]

        # If both sides empty, skip
        if ck_price <= 0 and tcg_ref <= 0:
            continue

        pct_ref = pct(ck_price, tcg_ref) if (ck_price > 0 and tcg_ref > 0) else Decimal("0.00")

        if ck_price > 0:
            total_ck += ck_price
            ck_count += 1
        if tcg_ref > 0:
            total_tcg_ref += tcg_ref
            tcg_count += 1

        recommend_tcg = ""
        savings = Decimal("0.00")
        if ck_price > 0 and tcg_ref > 0:
            savings = (ck_price - tcg_ref).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            if savings >= deal_min:
                recommend_tcg = f"tcg_{tcg_ref_kind}"
                good_deals.append(
                    {
                        "name": name,
                        "ck_price": ck_price,
                        "ck_edition": ck_edition,
                        "ck_url": ck_url,
                        "tcg_ref_kind": tcg_ref_kind,
                        "tcg_ref": tcg_ref,
                        "savings": savings,
                        "ck_sid": ck_sid,
                        "ck_is_foil": ck_is_foil,
                    }
                )

        rows.append(
            {
                "name": name,
                "ck_price": ck_price,
                "ck_edition": ck_edition,
                "ck_url": ck_url,
                "ck_sid": ck_sid,
                "ck_is_foil": ck_is_foil,
                "tcg_low": tcg_low,
                "tcg_mkt": tcg_mkt,
                "tcg_ref_kind": tcg_ref_kind,
                "tcg_ref": tcg_ref,
                "pct_ref": pct_ref,
                "recommend_tcg": recommend_tcg,
                "savings": savings,
            }
        )

    # Sort by CK price descending (highest upcharge candidates first)
    rows.sort(
        key=lambda r: (
            -(r["ck_price"] if r["ck_price"] > 0 else Decimal("0.00")),
            r["name"].lower(),
        )
    )

    missing_fmt = []
    mp_name_w = len("Card")
    mp_ck_w = len("CK")
    mp_ver_w = len("Version")
    mp_tcg_w = len("TCG")
    mp_up_w = len("Upcharge")
    for r in rows:
        version_base = ck_version_base_from_sid(sid_prices, r.get("ck_sid", ""), r["ck_edition"])
        ver_plain = owned_print_desc_plain(version_base, bool(r.get("ck_is_foil", False))) if version_base != "-" else "-"
        ck_plain = f"${r['ck_price']:.2f}" if r["ck_price"] > 0 else "-"
        tcg_plain = f"${r['tcg_ref']:.2f}" if r["tcg_ref"] > 0 else "-"
        if r.get("tcg_ref_kind") == "low":
            tcg_plain += " (low fallback)"
        up_plain = "-"
        if r["pct_ref"] > 0:
            up_plain = f"{(r['pct_ref'] - Decimal('100.00')).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP):+.2f}%"
        missing_fmt.append({"row": r, "version_base": version_base, "ver_plain": ver_plain, "ck_plain": ck_plain, "tcg_plain": tcg_plain, "up_plain": up_plain})
        mp_name_w = max(mp_name_w, len(r["name"]))
        mp_ck_w = max(mp_ck_w, len(ck_plain))
        mp_ver_w = max(mp_ver_w, len(ver_plain))
        mp_tcg_w = max(mp_tcg_w, len(tcg_plain))
        mp_up_w = max(mp_up_w, len(up_plain))

    mp_plain_header = (
        f"{'Card'.ljust(mp_name_w)} | "
        f"{'CK'.ljust(mp_ck_w)} | "
        f"{'Version'.ljust(mp_ver_w)} | "
        f"{'TCG'.ljust(mp_tcg_w)} | "
        f"{'Upcharge'.ljust(mp_up_w)}"
    )
    print()
    print_boxed_title("Missing Pricing", len(mp_plain_header), owned_use_color)

    mp_hdr_name = colorize("Card", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, mp_name_w - len("Card")))
    mp_hdr_ck = colorize("CK", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, mp_ck_w - len("CK")))
    mp_hdr_ver = colorize("Version", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, mp_ver_w - len("Version")))
    mp_hdr_tcg = colorize("TCG", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, mp_tcg_w - len("TCG")))
    mp_hdr_up = colorize("Upcharge", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, mp_up_w - len("Upcharge")))
    print(f"{mp_hdr_name} | {mp_hdr_ck} | {mp_hdr_ver} | {mp_hdr_tcg} | {mp_hdr_up}")
    print(
        colorize(
            f"{'-' * mp_name_w}-+-{'-' * mp_ck_w}-+-{'-' * mp_ver_w}-+-{'-' * mp_tcg_w}-+-{'-' * mp_up_w}",
            ANSI_WHITE,
            owned_use_color,
        )
    )

    for m in missing_fmt:
        r = m["row"]
        ck_price_s = format_owned_price(f"{r['ck_price']:.2f}", owned_use_color) if r["ck_price"] > 0 else colorize("-", ANSI_WHITE, owned_use_color)
        tcg_price_s = format_owned_price(f"{r['tcg_ref']:.2f}", owned_use_color) if r["tcg_ref"] > 0 else colorize("-", ANSI_WHITE, owned_use_color)
        version_base = m["version_base"]
        if version_base == "-":
            edition_s = colorize("-", ANSI_WHITE, owned_use_color)
        else:
            edition_s = format_owned_print_desc(
                version_base,
                bool(r.get("ck_is_foil", False)),
                owned_use_color,
            )

        if r["pct_ref"] > 0:
            premium = (r["pct_ref"] - Decimal("100.00")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            premium_s = colorize(f"{premium:+.2f}%", ANSI_BOLD + ANSI_YELLOW, owned_use_color)
        else:
            premium_s = colorize("-", ANSI_WHITE, owned_use_color)

        tcg_suffix = ""
        if r.get("tcg_ref_kind") == "low":
            tcg_suffix = " " + colorize("(low fallback)", ANSI_WHITE, owned_use_color)

        name_s = colorize(r["name"], ANSI_BOLD + ANSI_CYAN, owned_use_color) + (" " * max(0, mp_name_w - len(r["name"])))
        ck_s = ck_price_s + (" " * max(0, mp_ck_w - len(m["ck_plain"])))
        ver_s = edition_s + (" " * max(0, mp_ver_w - len(m["ver_plain"])))
        tcg_s = (tcg_price_s + tcg_suffix) + (" " * max(0, mp_tcg_w - len(m["tcg_plain"])))
        up_s = premium_s + (" " * max(0, mp_up_w - len(m["up_plain"])))

        print(f"{name_s} | {ck_s} | {ver_s} | {tcg_s} | {up_s}")

    print(
        f"{colorize('Missing Totals', ANSI_BOLD + ANSI_CYAN, owned_use_color)} "
        f"{colorize('-', ANSI_WHITE, owned_use_color)} "
        f"{colorize('CK', ANSI_CYAN, owned_use_color)} {format_owned_price(f'{total_ck:.2f}', owned_use_color)} "
        f"{colorize('|', ANSI_WHITE, owned_use_color)} "
        f"{colorize('TCG', ANSI_CYAN, owned_use_color)} {format_owned_price(f'{total_tcg_ref:.2f}', owned_use_color)} "
        f"{colorize('(', ANSI_WHITE, owned_use_color)}"
        f"{colorize('CK cards', ANSI_CYAN, owned_use_color)} {colorize(str(ck_count), ANSI_BOLD + ANSI_WHITE, owned_use_color)}, "
        f"{colorize('TCG cards', ANSI_CYAN, owned_use_color)} {colorize(str(tcg_count), ANSI_BOLD + ANSI_WHITE, owned_use_color)}"
        f"{colorize(')', ANSI_WHITE, owned_use_color)}"
    )

    # ================== GOOD DEALS SECTION ==================
    good_deals.sort(key=lambda r: (r["ck_price"] * Decimal("-1"), r["name"].lower()))
    gd_fmt = []
    gd_name_w = len("Card")
    gd_ck_w = len("CK")
    gd_tcg_w = len("TCG")
    gd_save_w = len("Save")
    gd_ver_w = len("Version")
    for g in good_deals:
        version_base = ck_version_base_from_sid(sid_prices, g.get("ck_sid", ""), g["ck_edition"])
        ver_plain = owned_print_desc_plain(version_base, bool(g.get("ck_is_foil", False))) if version_base != "-" else "-"
        ck_plain = f"${g['ck_price']:.2f}"
        tcg_plain = f"${g['tcg_ref']:.2f}" + (" (low fallback)" if g.get("tcg_ref_kind") == "low" else "")
        save_plain = f"${g['savings']:.2f}"
        gd_fmt.append({"row": g, "version_base": version_base, "ver_plain": ver_plain, "ck_plain": ck_plain, "tcg_plain": tcg_plain, "save_plain": save_plain})
        gd_name_w, gd_ck_w, gd_tcg_w, gd_save_w, gd_ver_w = max(gd_name_w, len(g["name"])), max(gd_ck_w, len(ck_plain)), max(gd_tcg_w, len(tcg_plain)), max(gd_save_w, len(save_plain)), max(gd_ver_w, len(ver_plain))

    gd_plain_header = (
        f"{'Card'.ljust(gd_name_w)} | "
        f"{'CK'.ljust(gd_ck_w)} | "
        f"{'TCG'.ljust(gd_tcg_w)} | "
        f"{'Save'.ljust(gd_save_w)} | "
        f"{'Version'.ljust(gd_ver_w)}"
    )
    print()
    print_boxed_title(f"Good Deals (save >= {deal_min:.2f})", len(gd_plain_header), owned_use_color)

    gd_hdr_name = colorize("Card", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, gd_name_w - len("Card")))
    gd_hdr_ck = colorize("CK", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, gd_ck_w - len("CK")))
    gd_hdr_tcg = colorize("TCG", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, gd_tcg_w - len("TCG")))
    gd_hdr_save = colorize("Save", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, gd_save_w - len("Save")))
    gd_hdr_ver = colorize("Version", ANSI_BOLD + ANSI_BLUE, owned_use_color) + (" " * max(0, gd_ver_w - len("Version")))
    print(f"{gd_hdr_name} | {gd_hdr_ck} | {gd_hdr_tcg} | {gd_hdr_save} | {gd_hdr_ver}")
    print(
        colorize(
            f"{'-' * gd_name_w}-+-{'-' * gd_ck_w}-+-{'-' * gd_tcg_w}-+-{'-' * gd_save_w}-+-{'-' * gd_ver_w}",
            ANSI_WHITE,
            owned_use_color,
        )
    )

    for d in gd_fmt:
        g = d["row"]
        ck_price_s = format_owned_price(f"{g['ck_price']:.2f}", owned_use_color)
        tcg_price_s = format_owned_price(f"{g['tcg_ref']:.2f}", owned_use_color)
        savings_s = format_owned_price(f"{g['savings']:.2f}", owned_use_color)
        version_base = d["version_base"]
        if version_base == "-":
            edition_s = colorize("-", ANSI_WHITE, owned_use_color)
        else:
            edition_s = format_owned_print_desc(
                version_base,
                bool(g.get("ck_is_foil", False)),
                owned_use_color,
            )

        tcg_suffix = ""
        if g.get("tcg_ref_kind") == "low":
            tcg_suffix = " " + colorize("(low fallback)", ANSI_WHITE, owned_use_color)

        name_s = colorize(g["name"], ANSI_BOLD + ANSI_CYAN, owned_use_color) + (" " * max(0, gd_name_w - len(g["name"])))
        ck_s = ck_price_s + (" " * max(0, gd_ck_w - len(d["ck_plain"])))
        tcg_s = (tcg_price_s + tcg_suffix) + (" " * max(0, gd_tcg_w - len(d["tcg_plain"])))
        save_s = savings_s + (" " * max(0, gd_save_w - len(d["save_plain"])))
        ver_s = edition_s + (" " * max(0, gd_ver_w - len(d["ver_plain"])))

        print(f"{name_s} | {ck_s} | {tcg_s} | {save_s} | {ver_s}")

    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
