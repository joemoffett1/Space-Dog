#!/usr/bin/env python3
import argparse
import csv
import json
import os
import subprocess
import sys
import time
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

BASE_URL = "https://tcgtracking.com"
DEFAULT_JSON_OUT = "tcgtracking_tcg_low_en.json"
DEFAULT_CSV_OUT = "tcgtracking_tcg_low_en.csv"


def q2(x) -> str:
    try:
        return str(Decimal(str(x)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    except (InvalidOperation, TypeError):
        return ""


def fetch_json(url: str) -> dict:
    cmd = [
        "curl",
        "-sS",
        "-A",
        "Mozilla/5.0",
        "--connect-timeout",
        "20",
        "--max-time",
        "180",
        url,
    ]
    p = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return json.loads(p.stdout)


def to_decimal(v) -> Decimal:
    try:
        return Decimal(str(v))
    except (InvalidOperation, TypeError):
        return Decimal("0")


def pick_nm_default(entry: dict, variant_code: str, low: Decimal, mkt: Decimal) -> None:
    if variant_code == "F":
        if low > 0:
            entry["tcg_low_foil"] = q2(low)
        if mkt > 0:
            entry["tcg_market_foil"] = q2(mkt)
    elif variant_code in ("E", "ETCHED"):
        if low > 0:
            entry["tcg_low_etched"] = q2(low)
        if mkt > 0:
            entry["tcg_market_etched"] = q2(mkt)
    else:
        if low > 0:
            entry["tcg_low"] = q2(low)
        if mkt > 0:
            entry["tcg_market"] = q2(mkt)


def apply_pricing_defaults(entry: dict, price_node: dict) -> None:
    tcg = (price_node or {}).get("tcg") or {}
    try:
        entry["tcg_nm_qty"] = int((price_node or {}).get("mp_qty") or 0)
    except (TypeError, ValueError):
        entry["tcg_nm_qty"] = 0
    if not isinstance(tcg, dict):
        return
    for label, vals in tcg.items():
        if not isinstance(vals, dict):
            continue
        low = to_decimal(vals.get("low"))
        mkt = to_decimal(vals.get("market"))
        lbl = str(label or "").strip().casefold()
        if "etch" in lbl:
            var = "E"
        elif "foil" in lbl:
            var = "F"
        else:
            var = "N"
        pick_nm_default(entry, var, low, mkt)


def apply_sku_nm_low_floor(entry: dict, variant_code: str, low: Decimal) -> None:
    if low <= 0:
        return
    if variant_code == "F":
        key = "tcg_low_foil"
    elif variant_code in ("E", "ETCHED"):
        key = "tcg_low_etched"
    else:
        key = "tcg_low"
    current = to_decimal(entry.get(key))
    if low > current:
        entry[key] = q2(low)


def build_cache(category_id: int, max_sets: int | None = None, sleep_ms: int = 0):
    sets_url = f"{BASE_URL}/tcgapi/v1/{category_id}/sets"
    sets_obj = fetch_json(sets_url)
    sets = sets_obj.get("sets", [])
    if max_sets is not None:
        sets = sets[:max_sets]

    sid_prices: dict[str, dict] = {}
    table_rows: list[dict] = []
    errors: list[dict] = []

    for i, s in enumerate(sets, start=1):
        set_id = s.get("id")
        set_code = (s.get("abbreviation") or "").upper()
        set_name = s.get("name") or ""
        api_url = s.get("api_url")
        skus_url = s.get("skus_url")
        pricing_url = s.get("pricing_url")
        if not api_url or not skus_url:
            errors.append({"set_id": set_id, "reason": "missing api_url/skus_url"})
            continue

        try:
            products_obj = fetch_json(BASE_URL + api_url)
            skus_obj = fetch_json(BASE_URL + skus_url)
            pricing_obj = fetch_json(BASE_URL + pricing_url) if pricing_url else {}
        except Exception as e:
            errors.append({"set_id": set_id, "set_code": set_code, "reason": str(e)})
            continue

        products = products_obj.get("products", [])
        product_by_id = {}
        for p in products:
            try:
                product_by_id[int(p.get("id"))] = p
            except Exception:
                continue

        sku_products = skus_obj.get("products", {})
        pricing_products = pricing_obj.get("prices", {}) if isinstance(pricing_obj, dict) else {}
        for product_id_str, sku_map in sku_products.items():
            try:
                product_id = int(product_id_str)
            except Exception:
                continue

            product = product_by_id.get(product_id, {})
            scryfall_id = (product.get("scryfall_id") or "").strip()
            if not scryfall_id:
                continue

            name = (product.get("name") or "").strip()
            collector_number = str(product.get("number") or "").strip()
            tcgplayer_id = product_id

            entry = sid_prices.setdefault(
                scryfall_id,
                {
                    "name": name,
                    "set": set_code.lower(),
                    "set_name": set_name,
                    "collector_number": collector_number,
                    "tcgplayer_id": tcgplayer_id,
                    "tcg_low": "",
                    "tcg_low_foil": "",
                    "tcg_low_etched": "",
                    "tcg_market": "",
                    "tcg_market_foil": "",
                    "tcg_market_etched": "",
                    "tcg_nm_qty": 0,
                    "conditions": {},
                },
            )

            # Prefer pricing endpoint defaults for displayed tcg low/market values.
            apply_pricing_defaults(entry, (pricing_products or {}).get(str(product_id)) or {})

            for sku_id_str, sku in (sku_map or {}).items():
                lng = (sku.get("lng") or "").upper()
                if lng != "EN":
                    continue
                cnd = (sku.get("cnd") or "").upper()
                var = (sku.get("var") or "N").upper()
                low = to_decimal(sku.get("low"))
                mkt = to_decimal(sku.get("mkt"))
                hi = to_decimal(sku.get("hi"))
                cnt = int(sku.get("cnt") or 0)

                by_var = entry["conditions"].setdefault(var, {})
                by_var[cnd] = {
                    "low": q2(low) if low > 0 else "",
                    "market": q2(mkt) if mkt > 0 else "",
                    "high": q2(hi) if hi > 0 else "",
                    "count": cnt,
                    "sku_id": sku_id_str,
                }

                # Redundancy rule: tcg_low uses the higher of pricing low and SKU NM low.
                if cnd == "NM":
                    apply_sku_nm_low_floor(entry, var, low)

                table_rows.append(
                    {
                        "scryfall_id": scryfall_id,
                        "name": name,
                        "set_code": set_code,
                        "set_name": set_name,
                        "collector_number": collector_number,
                        "tcgplayer_product_id": str(tcgplayer_id),
                        "sku_id": str(sku_id_str),
                        "variant": var,
                        "condition": cnd,
                        "tcg_low": q2(low) if low > 0 else "",
                        "tcg_market": q2(mkt) if mkt > 0 else "",
                        "tcg_high": q2(hi) if hi > 0 else "",
                        "listing_count": str(cnt),
                        "is_default_nm": "1" if cnd == "NM" else "0",
                    }
                )

        if sleep_ms > 0:
            time.sleep(sleep_ms / 1000.0)
        if i % 25 == 0:
            print(f"processed {i}/{len(sets)} sets; sid_prices={len(sid_prices)} rows={len(table_rows)}", file=sys.stderr)

    cache = {
        "meta": {
            "source": "tcgtracking",
            "category_id": category_id,
            "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "english_only": True,
            "default_tcg_low_condition": "NM",
            "sets_processed": len(sets),
            "sid_count": len(sid_prices),
            "row_count": len(table_rows),
            "errors": errors,
        },
        "sid_prices": sid_prices,
    }
    return cache, table_rows


def write_csv(path: str, rows: list[dict]) -> None:
    fieldnames = [
        "scryfall_id",
        "name",
        "set_code",
        "set_name",
        "collector_number",
        "tcgplayer_product_id",
        "sku_id",
        "variant",
        "condition",
        "tcg_low",
        "tcg_market",
        "tcg_high",
        "listing_count",
        "is_default_nm",
    ]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def print_preview(rows: list[dict], limit: int = 15) -> None:
    cols = ["name", "set_code", "collector_number", "variant", "condition", "tcg_low", "tcg_market"]
    sample = rows[:limit]
    if not sample:
        print("No rows.")
        return
    widths = {c: max(len(c), max(len(r.get(c, "")) for r in sample)) for c in cols}
    header = " | ".join(c.ljust(widths[c]) for c in cols)
    sep = "-+-".join("-" * widths[c] for c in cols)
    print(header)
    print(sep)
    for r in sample:
        print(" | ".join(r.get(c, "").ljust(widths[c]) for c in cols))


def main() -> int:
    ap = argparse.ArgumentParser(
        prog="build_tcgtracking_tcg_low_cache",
        description="Build an English-only TCGTracking cache for NM-default TCG low/market plus all conditions.",
    )
    ap.add_argument("--category-id", type=int, default=1, help="TCGTracking category id (default: 1 = MTG)")
    ap.add_argument("--output-json", default=DEFAULT_JSON_OUT, help=f"Output cache JSON (default: {DEFAULT_JSON_OUT})")
    ap.add_argument("--output-csv", default=DEFAULT_CSV_OUT, help=f"Output flat table CSV (default: {DEFAULT_CSV_OUT})")
    ap.add_argument("--max-sets", type=int, help="Limit sets for quick test runs")
    ap.add_argument("--sleep-ms", type=int, default=0, help="Sleep between sets in milliseconds")
    ap.add_argument("--no-preview", action="store_true", help="Skip terminal preview table")
    args = ap.parse_args()

    cache, rows = build_cache(args.category_id, args.max_sets, args.sleep_ms)

    with open(args.output_json, "w", encoding="utf-8") as f:
        json.dump(cache, f, indent=2)
    write_csv(args.output_csv, rows)

    print(f"Wrote JSON cache: {args.output_json}")
    print(f"Wrote CSV table: {args.output_csv}")
    print(f"sid_prices={cache['meta']['sid_count']} rows={cache['meta']['row_count']} sets={cache['meta']['sets_processed']}")
    if cache["meta"]["errors"]:
        print(f"errors={len(cache['meta']['errors'])} (see JSON meta.errors)")
    if not args.no_preview:
        print()
        print_preview(rows, limit=15)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
