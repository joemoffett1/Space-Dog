#!/usr/bin/env python3
import argparse
import csv
import json
import os
import re
import sys
import shutil
import subprocess
import urllib.request
import urllib.error
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP

# ================== CONFIG ==================

HOME_DIR = "/home/holyholyman/MagicCollection"
DEFAULT_COLLECTION = os.path.join(HOME_DIR, "collection.csv")
DEFAULT_CK_JSON = os.path.join(HOME_DIR, "ck_pricelist.json")
DEFAULT_SCRY_CACHE = os.path.join(HOME_DIR, "scryfall_cache.json")

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


def pct(a: Decimal, b: Decimal) -> Decimal:
    if b <= 0:
        return Decimal("0.00")
    return (a / b * Decimal("100")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def print_section(title: str, first: bool = False):
    if not first:
        print()
    print(f"## {title}")


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
        }

        consider(name, payload)
        consider(front_face(name), payload)

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
      - sid_prices: scryfall_id -> {set_name,set,collector_number,tcg_low,tcg_market,name}
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

        if not legal:
            continue

        p = card.get("prices") or {}
        low = dmoney(p.get("usd_low"))
        mkt = dmoney(p.get("usd"))

        sid_prices[sid] = {
            "name": name,
            "set_name": clean(card.get("set_name")),
            "set": clean(card.get("set")),
            "collector_number": clean(card.get("collector_number")),
            "tcg_low": f"{low:.2f}" if low > 0 else "",
            "tcg_market": f"{mkt:.2f}" if mkt > 0 else "",
        }

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
                    "collector_number": collector_number,
                }
            )

    return owned_qty, owned_tags, owned_rows


# ================== MAIN ==================


def main():
    ap = argparse.ArgumentParser(
        prog="cardPuller",
        formatter_class=argparse.RawTextHelpFormatter,
        description=(
            "Compare a deck list against collection.csv.\n"
            "For missing cards, compare CK cheapest tournament-legal printing vs Scryfall TCG ref.\n\n"
            "Refresh caches (no deck required):\n"
            "  cardPuller --refresh\n"
        ),
    )

    ap.add_argument("deck_list", nargs="?", help="Deck list file (lines like: '1 Card Name')")
    ap.add_argument(
        "--refresh",
        action="store_true",
        help="Refresh CK pricelist + Scryfall cache (ONLY happens with this flag).",
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
    print_section("Owned (found in collection)", first=True)
    print("name|qty_owned|min_owned_tcg_market|min_owned_printing|tags")

    owned_count = 0
    owned_priced_count = 0
    total_owned_tcg_market = Decimal("0.00")

    for n in sorted(need.keys(), key=lambda x: x.lower()):
        if owned_qty.get(n, 0) <= 0:
            continue

        owned_count += 1

        # Choose the least valuable printing YOU OWN (by TCG market using scryfall_id)
        best_price = None
        best_desc = ""

        for rr in owned_rows.get(n, []):
            sid = rr.get("scryfall_id") or ""
            if not sid:
                continue
            sp = sid_prices.get(sid)
            if not sp:
                continue
            mkt = dmoney(sp.get("tcg_market", ""))
            if mkt <= 0:
                continue

            set_name = clean(sp.get("set_name")) or clean(rr.get("edition_name"))
            cn = clean(sp.get("collector_number")) or clean(rr.get("collector_number"))
            fin = clean(rr.get("finish"))

            desc = f"{set_name} #{cn}".strip() if (set_name or cn) else set_name
            if fin:
                desc = (desc + f" ({fin})").strip()

            if best_price is None or mkt < best_price:
                best_price = mkt
                best_desc = desc

        min_owned_market_s = ""
        if best_price is not None:
            min_owned_market_s = f"{best_price:.2f}"
            # Commander default: sum 1x per deck card
            total_owned_tcg_market += best_price
            owned_priced_count += 1

        tag_str = "; ".join(
            f"{t}({q})" for t, q in sorted(owned_tags[n].items(), key=lambda x: x[0].lower())
        )

        print("|".join([n, str(owned_qty[n]), min_owned_market_s, best_desc, tag_str]))

    print(f"# TOTAL_OWNED_TCG_MARKET|{total_owned_tcg_market:.2f}|cards={owned_count}|priced={owned_priced_count}")

    # ================== MISSING LIST ==================
    missing = [n for n in need.keys() if owned_qty.get(n, 0) <= 0]

    print_section("Missing (not in collection)")
    print("name")
    for n in sorted(missing, key=lambda x: x.lower()):
        print(n)

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
            # If we're excluding illegal, we just don't have a CK option for this name
            if not args.include_illegal:
                # still show the row if we have TCG (optional), but CK fields blank
                ck_price = Decimal("0.00")
                ck_edition = ""
                ck_url = ""
            else:
                ck_price = Decimal("0.00")
                ck_edition = ""
                ck_url = ""
        else:
            ck_price = ck["ck_price"]
            ck_edition = ck["ck_edition"]
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
                    }
                )

        rows.append(
            {
                "name": name,
                "ck_price": ck_price,
                "ck_edition": ck_edition,
                "ck_url": ck_url,
                "tcg_low": tcg_low,
                "tcg_mkt": tcg_mkt,
                "tcg_ref_kind": tcg_ref_kind,
                "tcg_ref": tcg_ref,
                "pct_ref": pct_ref,
                "recommend_tcg": recommend_tcg,
                "savings": savings,
            }
        )

    # sort rows
    if args.sort == "pct":
        rows.sort(
            key=lambda r: (
                r["pct_ref"] if r["pct_ref"] > 0 else Decimal("999999"),
                r["ck_price"] if r["ck_price"] > 0 else Decimal("999999"),
                r["name"].lower(),
            )
        )
    elif args.sort == "ck":
        rows.sort(
            key=lambda r: (
                r["ck_price"] if r["ck_price"] > 0 else Decimal("999999"),
                r["name"].lower(),
            )
        )
    else:  # tcg
        rows.sort(
            key=lambda r: (
                r["tcg_ref"] if r["tcg_ref"] > 0 else Decimal("999999"),
                r["name"].lower(),
            )
        )

    print_section("Missing pricing (CK cheapest tournament-legal vs Scryfall TCG ref)")
    print("name|ck_price|ck_edition|ck_url|tcg_low|tcg_market|tcg_ref|tcg_ref_price|pct_ck_of_tcg_ref|recommend_if_saves>=deal_min|savings")
    for r in rows:
        print(
            "|".join(
                [
                    r["name"],
                    f"{r['ck_price']:.2f}" if r["ck_price"] > 0 else "",
                    r["ck_edition"],
                    r["ck_url"],
                    f"{r['tcg_low']:.2f}" if r["tcg_low"] > 0 else "",
                    f"{r['tcg_mkt']:.2f}" if r["tcg_mkt"] > 0 else "",
                    r["tcg_ref_kind"],
                    f"{r['tcg_ref']:.2f}" if r["tcg_ref"] > 0 else "",
                    f"{r['pct_ref']:.2f}%" if r["pct_ref"] > 0 else "",
                    r["recommend_tcg"],
                    f"{r['savings']:.2f}" if r["recommend_tcg"] else "",
                ]
            )
        )

    # ================== GOOD DEALS SECTION ==================
    print_section(f"Good deals (recommend TCG only if it saves >= {deal_min:.2f})")
    print("name|ck_price|tcg_ref|tcg_ref_price|savings|ck_edition|ck_url")

    good_deals.sort(key=lambda r: (r["savings"] * Decimal("-1"), r["name"].lower()))
    for g in good_deals:
        print(
            "|".join(
                [
                    g["name"],
                    f"{g['ck_price']:.2f}",
                    g["tcg_ref_kind"],
                    f"{g['tcg_ref']:.2f}",
                    f"{g['savings']:.2f}",
                    g["ck_edition"],
                    g["ck_url"],
                ]
            )
        )

    print(f"# TOTAL_EST_BUY_FROM_CK|{total_ck:.2f}|cards={ck_count}")
    print(f"# TOTAL_EST_TCG_REF|{total_tcg_ref:.2f}|cards={tcg_count}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
