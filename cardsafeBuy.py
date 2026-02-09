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
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

CK_URL = "https://api.cardkingdom.com/api/v2/pricelist"


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


def download_ck_json(path: str, url: str = CK_URL, timeout: int = 60) -> None:
    """
    Download CK pricelist to `path`.
    CK may return 403 to default Python user agents, so we:
      1) Try urllib with browser-like headers
      2) If 403/blocked, fallback to curl (if installed)
    """
    headers = {
        # Browser-ish UA (CK tends to block Python-urllib)
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
        # If forbidden, try curl fallback
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

        # curl fallback
        cmd = [
            curl_path,
            "-L",                      # follow redirects
            "-sS",                     # silent but show errors
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

        # sanity check file size
        if not os.path.exists(path) or os.path.getsize(path) == 0:
            raise RuntimeError(
                "curl reported success but the downloaded file is empty.\n"
                f"Try manually downloading the pricelist and saving it to: {path}"
            ) from e


def _extract_records(ck):
    # CK JSON can be list or dict-wrapped list
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
        sid = (rec.get("scryfall_id") or "").strip()
        if not sid:
            continue
        foil = as_bool_str(rec.get("is_foil"))
        idx[(sid, foil)] = rec
    return idx


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser(
        prog="ck_buywant.py",
        formatter_class=argparse.RawTextHelpFormatter,
        description=(
            "Match your MTG collection against Card Kingdom's buylist.\n\n"
            "Refresh CK price cache (no collection file needed):\n"
            "  ck_buywant.py --refresh\n"
        ),
    )

    # Optional so --refresh can run standalone
    ap.add_argument(
        "collection_csv",
        nargs="?",
        help="Collection CSV file (optional if using --refresh only)\n"
             "Required columns when provided:\n"
             "  Quantity, Name, Finish, Tags, Edition Name, Scryfall ID",
    )

    ap.add_argument(
        "--ck-json",
        default="ck_pricelist.json",
        help="Cached Card Kingdom pricelist JSON (default: ck_pricelist.json)",
    )

    ap.add_argument(
        "--refresh",
        action="store_true",
        help="Force re-download of Card Kingdom pricing data\n"
             "If collection_csv is omitted, refresh happens and the script exits.",
    )

    # Filters
    ap.add_argument("-t", "--tag", help="Only include cards whose Tags field contains this text")
    ap.add_argument("-m", "--min-buy", type=Decimal, default=Decimal("0.01"),
                    help="Minimum CK cash buy price (e.g. -m 0.50)")
    ap.add_argument("-p", "--min-pct", type=Decimal,
                    help="Minimum CASH %% of retail (e.g. -p 50 = 50%%)")
    ap.add_argument("-c", "--min-credit-pct", type=Decimal,
                    help="Minimum STORE CREDIT %% of retail (e.g. -c 70)")
    ap.add_argument("-r", "--min-retail", type=Decimal,
                    help="Minimum CK retail price (filters bulk/junk)")

    # Sorting
    ap.add_argument(
        "--sort",
        choices=["pct", "creditpct", "buy"],
        default="pct",
        help=(
            "Sort results by:\n"
            "  pct        = cash %% of retail (default)\n"
            "  creditpct  = store credit %% of retail\n"
            "  buy        = cash buy price"
        ),
    )
    ap.add_argument("--asc", action="store_true", help="Sort ascending instead of descending")

    args = ap.parse_args()

    # Refresh / ensure cache exists
    if args.refresh or not os.path.exists(args.ck_json):
        try:
            download_ck_json(args.ck_json)
        except Exception as e:
            print(f"ERROR refreshing CK pricelist: {e}", file=sys.stderr)
            return 3

    # Refresh-only mode
    if not args.collection_csv:
        if args.refresh:
            print(f"Refreshed CK pricelist cache -> {args.ck_json}")
            return 0
        ap.error("collection_csv is required unless you use --refresh")

    ck_idx = load_ck_index(args.ck_json)
    tag_filter = args.tag.lower() if args.tag else None

    required_cols = ["Quantity", "Name", "Finish", "Tags", "Edition Name", "Scryfall ID"]

    rows = []
    total_cash = Decimal("0.00")

    with open(args.collection_csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)

        for col in required_cols:
            if col not in (reader.fieldnames or []):
                print(f"Missing column: {col}", file=sys.stderr)
                print(f"Found columns: {reader.fieldnames}", file=sys.stderr)
                return 2

        for row in reader:
            try:
                your_qty = int(row.get("Quantity", "").strip())
            except (ValueError, TypeError, AttributeError):
                continue

            name = (row.get("Name") or "").strip()
            finish = (row.get("Finish") or "").strip()
            tags = (row.get("Tags") or "").strip()
            edition_name = (row.get("Edition Name") or "").strip()
            scryfall_id = (row.get("Scryfall ID") or "").strip()

            if not scryfall_id:
                continue
            if tag_filter and tag_filter not in tags.lower():
                continue

            foil = "true" if finish.lower() == "foil" else "false"
            rec = ck_idx.get((scryfall_id, foil))
            if not rec:
                continue

            ck_buy_cash = dmoney(rec.get("price_buy"))
            ck_retail = dmoney(rec.get("price_retail"))
            ck_qty_buying = int(rec.get("qty_buying") or 0)

            if ck_qty_buying <= 0:
                continue
            if ck_buy_cash < args.min_buy:
                continue
            if args.min_retail is not None and ck_retail < args.min_retail:
                continue

            ck_buy_credit = dmoney(ck_buy_cash * Decimal("1.30"))

            pct_cash = pct_of_retail(ck_buy_cash, ck_retail)
            pct_credit = pct_of_retail(ck_buy_credit, ck_retail)

            if args.min_pct is not None and pct_cash < args.min_pct:
                continue
            if args.min_credit_pct is not None and pct_credit < args.min_credit_pct:
                continue

            sell_qty = min(your_qty, ck_qty_buying)
            payout_cash = dmoney(ck_buy_cash * sell_qty)
            total_cash += payout_cash

            rows.append({
                "pct_cash": pct_cash,
                "pct_credit": pct_credit,
                "buy_cash": ck_buy_cash,
                "buy_credit": ck_buy_credit,
                "retail": ck_retail,
                "your_qty": your_qty,
                "sell_qty": sell_qty,
                "ck_qty_buying": ck_qty_buying,
                "payout": payout_cash,
                "name": name,
                "edition": edition_name,
                "tags": tags,
            })

    sort_key = {
        "pct": lambda r: (r["pct_cash"], r["buy_cash"], r["name"]),
        "creditpct": lambda r: (r["pct_credit"], r["buy_cash"], r["name"]),
        "buy": lambda r: (r["buy_cash"], r["pct_cash"], r["name"]),
    }[args.sort]

    rows.sort(key=sort_key, reverse=not args.asc)

    # Output
    print("|".join([
        "pct_cash_of_retail",
        "pct_credit_of_retail",
        "ck_price_buy_cash",
        "ck_price_buy_credit",
        "ck_price_retail",
        "your_qty",
        "sell_qty",
        "ck_qty_buying",
        "est_payout_cash",
        "name",
        "edition_name",
        "tags",
    ]))

    for r in rows:
        print("|".join([
            f"{r['pct_cash']:.2f}%",
            f"{r['pct_credit']:.2f}%",
            f"{r['buy_cash']:.2f}",
            f"{r['buy_credit']:.2f}",
            f"{r['retail']:.2f}",
            str(r["your_qty"]),
            str(r["sell_qty"]),
            str(r["ck_qty_buying"]),
            f"{r['payout']:.2f}",
            r["name"],
            r["edition"],
            r["tags"],
        ]))

    total_credit = dmoney(total_cash * Decimal("1.30"))
    print(f"# TOTAL_EST_PAYOUT_CASH|{total_cash:.2f}")
    print(f"# TOTAL_EST_PAYOUT_STORE_CREDIT|{total_credit:.2f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
