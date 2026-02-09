#!/usr/bin/env python3
import argparse
import datetime as dt
import gzip
import hashlib
import json
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_DATASET = "default_cards"
DEFAULT_POLICY = {
    "compactedThresholdMissed": 5,
    "forceFullThresholdMissed": 21,
    "compactedRetentionDays": 21,
    "expectedPublishTimeUtc": "22:30",
    "refreshUnlockLagMinutes": 60,
}


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def write_json(path: Path, payload: Any) -> None:
    ensure_dir(path.parent)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=True, separators=(",", ":"))


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def to_version_from_date(date_str: str) -> str:
    parsed = dt.datetime.strptime(date_str, "%Y-%m-%d")
    return f"v{parsed.year % 100:02d}{parsed.month:02d}{parsed.day:02d}"


def hash_payload(payload: Any) -> str:
    body = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(body).hexdigest()


def normalize_card(card: dict) -> dict:
    image_url = None
    image_uris = card.get("image_uris") or {}
    if image_uris.get("normal"):
        image_url = image_uris.get("normal")
    else:
        faces = card.get("card_faces") or []
        if faces:
            image_url = ((faces[0] or {}).get("image_uris") or {}).get("normal")

    market = (card.get("prices") or {}).get("usd")
    market_price = 0.0
    try:
        if market not in (None, ""):
            market_price = float(market)
    except Exception:
        market_price = 0.0

    return {
        "scryfallId": card.get("id"),
        "name": card.get("name", ""),
        "setCode": str(card.get("set", "")).lower(),
        "collectorNumber": str(card.get("collector_number", "")),
        "imageUrl": image_url,
        "marketPrice": float(market_price),
        "updatedAt": card.get("released_at") or "",
    }


def normalize_snapshot(cards: list[dict]) -> list[dict]:
    out = []
    for card in cards:
        if not card.get("id"):
            continue
        out.append(normalize_card(card))
    out.sort(key=lambda row: row["scryfallId"])
    return out


def load_source_cards(source_file: Path) -> list[dict]:
    if source_file.suffix.lower() == ".gz":
        with gzip.open(source_file, "rb") as handle:
            return json.loads(handle.read().decode("utf-8"))
    with source_file.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def load_snapshot_map(path: Path) -> dict[str, dict]:
    rows = read_json(path)
    return {row["scryfallId"]: row for row in rows if row.get("scryfallId")}


def diff_snapshots(old_map: dict[str, dict], new_map: dict[str, dict]) -> tuple[list[dict], list[dict], list[str]]:
    old_ids = set(old_map.keys())
    new_ids = set(new_map.keys())
    added_ids = sorted(list(new_ids - old_ids))
    removed = sorted(list(old_ids - new_ids))
    shared = old_ids & new_ids

    added = [new_map[sid] for sid in added_ids]
    updated = [new_map[sid] for sid in shared if old_map[sid] != new_map[sid]]
    updated.sort(key=lambda row: row["scryfallId"])
    return added, updated, removed


def versions_sort_key(version: str) -> str:
    return version.lower()


def load_versions_index(path: Path) -> dict:
    if path.exists():
        data = read_json(path)
        data.setdefault("dataset", DEFAULT_DATASET)
        data.setdefault("versions", [])
        data.setdefault("compactedPatches", [])
        return data
    return {
        "dataset": DEFAULT_DATASET,
        "versions": [],
        "compactedPatches": [],
    }


def find_version_entry(index: dict, version: str) -> dict | None:
    for entry in index.get("versions", []):
        if entry.get("version") == version:
            return entry
    return None


def upsert_version_entry(index: dict, entry: dict) -> None:
    versions = [row for row in index.get("versions", []) if row.get("version") != entry.get("version")]
    versions.append(entry)
    versions.sort(key=lambda row: versions_sort_key(row.get("version", "")))
    index["versions"] = versions


def build_incremental_patch(data_root: Path, from_version: str, to_version: str, old_snapshot_rel: str, new_snapshot_rel: str) -> dict:
    old_map = load_snapshot_map(data_root / old_snapshot_rel)
    new_map = load_snapshot_map(data_root / new_snapshot_rel)
    added, updated, removed = diff_snapshots(old_map, new_map)

    payload = {
        "fromVersion": from_version,
        "toVersion": to_version,
        "added": added,
        "updated": updated,
        "removed": removed,
    }
    payload["patchHash"] = hash_payload(payload)

    patch_rel = f"patches/{to_version}.from-{from_version}.patch.json"
    write_json(data_root / patch_rel, payload)
    return {
        "path": patch_rel,
        "patchHash": payload["patchHash"],
        "added": len(added),
        "updated": len(updated),
        "removed": len(removed),
    }


def build_compacted_patch(data_root: Path, from_version: str, to_version: str, from_snapshot_rel: str, latest_snapshot_rel: str) -> dict:
    old_map = load_snapshot_map(data_root / from_snapshot_rel)
    new_map = load_snapshot_map(data_root / latest_snapshot_rel)
    added, updated, removed = diff_snapshots(old_map, new_map)

    payload = {
        "fromVersion": from_version,
        "toVersion": to_version,
        "added": added,
        "updated": updated,
        "removed": removed,
    }
    payload["patchHash"] = hash_payload(payload)

    patch_rel = f"compacted/{to_version}.from-{from_version}.compacted.json"
    write_json(data_root / patch_rel, payload)
    return {
        "fromVersion": from_version,
        "toVersion": to_version,
        "path": patch_rel,
        "patchHash": payload["patchHash"],
        "createdAt": utc_now_iso(),
    }


def rebuild_patch_artifacts(index: dict, data_root: Path) -> dict:
    versions = sorted(index.get("versions", []), key=lambda row: versions_sort_key(row.get("version", "")))
    if not versions:
        index["compactedPatches"] = []
        return {"incrementals": 0, "compacted": 0}

    incremental_count = 0
    for row in versions:
        row.pop("patchFromPrevious", None)
        row.pop("patchHash", None)

    for i in range(1, len(versions)):
        previous = versions[i - 1]
        current = versions[i]
        patch = build_incremental_patch(
            data_root=data_root,
            from_version=previous["version"],
            to_version=current["version"],
            old_snapshot_rel=previous["snapshot"],
            new_snapshot_rel=current["snapshot"],
        )
        current["patchFromPrevious"] = patch["path"]
        current["patchHash"] = patch["patchHash"]
        incremental_count += 1

    latest = versions[-1]
    retention = int(DEFAULT_POLICY["compactedRetentionDays"])
    from_candidates = versions[max(0, len(versions) - (retention + 1)) : len(versions) - 1]

    compacted = []
    for row in from_candidates:
        compacted.append(
            build_compacted_patch(
                data_root=data_root,
                from_version=row["version"],
                to_version=latest["version"],
                from_snapshot_rel=row["snapshot"],
                latest_snapshot_rel=latest["snapshot"],
            )
        )

    index["versions"] = versions
    index["compactedPatches"] = compacted
    return {"incrementals": incremental_count, "compacted": len(compacted)}


def build_manifest(index: dict) -> dict:
    versions = sorted(index.get("versions", []), key=lambda row: versions_sort_key(row.get("version", "")))
    if not versions:
        raise SystemExit("Cannot build manifest without at least one version entry.")

    latest = versions[-1]
    return {
        "dataset": index.get("dataset", DEFAULT_DATASET),
        "latestVersion": latest["version"],
        "latestSnapshot": latest["snapshot"],
        "latestHash": latest.get("snapshotHash"),
        "syncPolicy": DEFAULT_POLICY,
        "versions": versions,
        "compactedPatches": index.get("compactedPatches", []),
        "generatedAt": utc_now_iso(),
    }


def ingest_source(source_file: Path, data_root: Path, version: str) -> dict:
    cards = load_source_cards(source_file)
    normalized = normalize_snapshot(cards)

    snapshot_rel = f"versions/{version}.snapshot.json"
    snapshot_path = data_root / snapshot_rel
    write_json(snapshot_path, normalized)

    return {
        "version": version,
        "snapshot": snapshot_rel,
        "snapshotHash": hash_payload(normalized),
        "rowCount": len(normalized),
        "createdAt": utc_now_iso(),
    }


def command_build_daily(args):
    data_root = Path(args.data_root)
    ensure_dir(data_root)

    source_file = Path(args.source_file) if args.source_file else data_root / "incoming" / "default-cards.json.gz"
    if args.source_url:
        ensure_dir(source_file.parent)
        with urllib.request.urlopen(args.source_url) as response:
            source_file.write_bytes(response.read())

    if not source_file.exists():
        raise SystemExit(f"Source file not found: {source_file}")

    version = args.version or to_version_from_date(dt.date.today().isoformat())

    index_path = data_root / "versions_index.json"
    index = load_versions_index(index_path)

    ingested = ingest_source(source_file=source_file, data_root=data_root, version=version)
    upsert_version_entry(index, ingested)

    patch_stats = rebuild_patch_artifacts(index=index, data_root=data_root)
    write_json(index_path, index)

    manifest = build_manifest(index)
    manifest_path = data_root / "manifest.json"
    write_json(manifest_path, manifest)

    print(
        json.dumps(
            {
                "dataset": manifest["dataset"],
                "version": version,
                "rows": ingested["rowCount"],
                "snapshotHash": ingested["snapshotHash"],
                "incrementalPatches": patch_stats["incrementals"],
                "compactedPatches": patch_stats["compacted"],
                "manifestPath": str(manifest_path),
            }
        )
    )


def command_ingest(args):
    data_root = Path(args.out_dir)
    ensure_dir(data_root)

    source_file = Path(args.source_file)
    if not source_file.exists():
        raise SystemExit(f"Source file not found: {source_file}")

    version = args.version or to_version_from_date(dt.date.today().isoformat())
    ingested = ingest_source(source_file=source_file, data_root=data_root, version=version)
    print(json.dumps(ingested))


def command_diff(args):
    data_root = Path(args.data_root)
    patch = build_incremental_patch(
        data_root=data_root,
        from_version=args.from_version,
        to_version=args.to_version,
        old_snapshot_rel=args.from_snapshot,
        new_snapshot_rel=args.to_snapshot,
    )
    print(json.dumps(patch))


def command_compact(args):
    data_root = Path(args.data_root)
    patch = build_compacted_patch(
        data_root=data_root,
        from_version=args.from_version,
        to_version=args.to_version,
        from_snapshot_rel=args.from_snapshot,
        latest_snapshot_rel=args.to_snapshot,
    )
    print(json.dumps(patch))


def command_manifest(args):
    data_root = Path(args.data_root)
    index = load_versions_index(data_root / "versions_index.json")
    manifest = build_manifest(index)
    out = data_root / "manifest.json"
    write_json(out, manifest)
    print(json.dumps({"manifestPath": str(out), "latestVersion": manifest["latestVersion"]}))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="MagicCollection sync service pipeline")
    sub = parser.add_subparsers(dest="cmd", required=True)

    build_daily = sub.add_parser("build-daily", help="Ingest source and rebuild index/patches/manifest")
    build_daily.add_argument("--data-root", required=True)
    build_daily.add_argument("--source-file", default="")
    build_daily.add_argument("--source-url", default="")
    build_daily.add_argument("--version", default="")
    build_daily.set_defaults(func=command_build_daily)

    ingest = sub.add_parser("ingest", help="Normalize one source into a snapshot only")
    ingest.add_argument("--source-file", required=True)
    ingest.add_argument("--out-dir", required=True)
    ingest.add_argument("--version", default="")
    ingest.set_defaults(func=command_ingest)

    diff = sub.add_parser("diff", help="Generate one incremental patch")
    diff.add_argument("--data-root", required=True)
    diff.add_argument("--from-snapshot", required=True)
    diff.add_argument("--to-snapshot", required=True)
    diff.add_argument("--from-version", required=True)
    diff.add_argument("--to-version", required=True)
    diff.set_defaults(func=command_diff)

    compact = sub.add_parser("compact", help="Generate one compacted patch")
    compact.add_argument("--data-root", required=True)
    compact.add_argument("--from-snapshot", required=True)
    compact.add_argument("--to-snapshot", required=True)
    compact.add_argument("--from-version", required=True)
    compact.add_argument("--to-version", required=True)
    compact.set_defaults(func=command_compact)

    manifest = sub.add_parser("manifest", help="Build manifest from versions_index.json")
    manifest.add_argument("--data-root", required=True)
    manifest.set_defaults(func=command_manifest)

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
