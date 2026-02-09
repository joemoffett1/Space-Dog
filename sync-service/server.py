#!/usr/bin/env python3
import argparse
import json
import time
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


@dataclass
class RateWindow:
    tokens: float
    last_refill: float


@dataclass
class ApiState:
    data_root: Path
    max_tokens: int = 120
    refill_rate_per_sec: float = 2.0
    request_count: int = 0
    error_count: int = 0
    started_at: float = field(default_factory=time.time)
    _manifest_cache_mtime: float = 0.0
    _manifest_cache: dict | None = None
    _ip_windows: dict[str, RateWindow] = field(default_factory=dict)

    def load_manifest(self) -> dict:
        manifest_path = self.data_root / "manifest.json"
        if not manifest_path.exists():
            raise FileNotFoundError("manifest_missing")
        mtime = manifest_path.stat().st_mtime
        if self._manifest_cache is None or mtime != self._manifest_cache_mtime:
            self._manifest_cache = read_json(manifest_path)
            self._manifest_cache_mtime = mtime
        return self._manifest_cache

    def version_index(self, manifest: dict) -> dict[str, int]:
        return {
            row.get("version"): i
            for i, row in enumerate(manifest.get("versions", []))
            if row.get("version")
        }

    def allow_request(self, ip: str) -> bool:
        now = time.time()
        window = self._ip_windows.get(ip)
        if window is None:
            self._ip_windows[ip] = RateWindow(tokens=float(self.max_tokens - 1), last_refill=now)
            return True

        elapsed = max(0.0, now - window.last_refill)
        window.tokens = min(float(self.max_tokens), window.tokens + elapsed * self.refill_rate_per_sec)
        window.last_refill = now
        if window.tokens < 1.0:
            return False
        window.tokens -= 1.0
        return True


def choose_strategy(manifest: dict, current: str | None) -> tuple[str, int]:
    versions = manifest.get("versions", [])
    latest = manifest.get("latestVersion")
    if not versions or not latest:
        return "full", 0
    if not current:
        return "full", len(versions)

    idx = {row.get("version"): i for i, row in enumerate(versions) if row.get("version")}
    if current not in idx:
        return "full", len(versions)

    latest_i = idx.get(latest)
    current_i = idx.get(current)
    if latest_i is None or current_i is None:
        return "full", len(versions)
    if current_i == latest_i:
        return "noop", 0

    missed = latest_i - current_i
    policy = manifest.get("syncPolicy", {})
    compacted_threshold = int(policy.get("compactedThresholdMissed", 5))
    force_full_threshold = int(policy.get("forceFullThresholdMissed", 21))

    if missed >= force_full_threshold:
        return "full", missed

    if missed >= compacted_threshold:
        for row in manifest.get("compactedPatches", []):
            if row.get("fromVersion") == current and row.get("toVersion") == latest:
                return "compacted", missed

    return "chain", missed


class SyncApiHandler(BaseHTTPRequestHandler):
    state: ApiState

    def _send_json(self, payload, code=200):
        body = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _reject_rate_limited(self):
        self._send_json({"error": "rate_limited"}, 429)

    def _safe_manifest(self):
        try:
            return self.state.load_manifest()
        except FileNotFoundError:
            self.state.error_count += 1
            self._send_json({"error": "manifest_missing"}, 500)
            return None

    def do_GET(self):
        self.state.request_count += 1
        ip = self.client_address[0] if self.client_address else "unknown"
        if not self.state.allow_request(ip):
            self.state.error_count += 1
            self._reject_rate_limited()
            return

        parsed = urlparse(self.path)
        path = parsed.path
        q = parse_qs(parsed.query)

        if path == "/health":
            manifest = self._safe_manifest()
            if manifest is None:
                return
            self._send_json(
                {
                    "ok": True,
                    "dataset": manifest.get("dataset", "default_cards"),
                    "latestVersion": manifest.get("latestVersion"),
                    "generatedAt": manifest.get("generatedAt"),
                }
            )
            return

        if path == "/metrics":
            uptime = int(time.time() - self.state.started_at)
            self._send_json(
                {
                    "requests": self.state.request_count,
                    "errors": self.state.error_count,
                    "uptimeSeconds": uptime,
                    "trackedIps": len(self.state._ip_windows),
                }
            )
            return

        manifest = self._safe_manifest()
        if manifest is None:
            return

        if path == "/sync/status":
            current = q.get("current", [None])[0]
            strategy_hint, missed = choose_strategy(manifest, current)
            latest = manifest.get("latestVersion")
            self._send_json(
                {
                    "dataset": manifest.get("dataset", "default_cards"),
                    "latestVersion": latest,
                    "latestHash": manifest.get("latestHash"),
                    "currentVersion": current,
                    "needsSync": current != latest,
                    "strategyHint": strategy_hint,
                    "missedCount": missed,
                    "policy": manifest.get("syncPolicy", {}),
                }
            )
            return

        if path == "/sync/patch":
            from_version = q.get("from", [None])[0]
            to_version = q.get("to", [manifest.get("latestVersion")])[0]
            if not from_version:
                self.state.error_count += 1
                self._send_json({"error": "missing_from"}, 400)
                return

            strategy_hint, _ = choose_strategy(manifest, from_version)
            if strategy_hint == "full":
                self._send_json({"mode": "full_required", "latestVersion": manifest.get("latestVersion")}, 409)
                return
            if strategy_hint == "noop":
                self._send_json({"mode": "noop", "fromVersion": from_version, "toVersion": to_version})
                return

            compacted = manifest.get("compactedPatches", [])
            if strategy_hint == "compacted":
                for entry in compacted:
                    if entry.get("fromVersion") == from_version and entry.get("toVersion") == to_version:
                        patch_path = self.state.data_root / entry.get("path", "")
                        if patch_path.exists():
                            self._send_json(read_json(patch_path))
                            return

            versions = manifest.get("versions", [])
            chain_paths = []
            collecting = False
            for entry in versions:
                version = entry.get("version")
                if version == from_version:
                    collecting = True
                    continue
                if collecting and entry.get("patchFromPrevious"):
                    chain_paths.append(entry.get("patchFromPrevious"))
                if version == to_version:
                    break

            if not chain_paths:
                self.state.error_count += 1
                self._send_json({"error": "patch_not_found"}, 404)
                return

            expand = q.get("expand", ["0"])[0] == "1"
            if not expand:
                self._send_json(
                    {
                        "mode": "chain",
                        "fromVersion": from_version,
                        "toVersion": to_version,
                        "patches": chain_paths,
                    }
                )
                return

            payloads = []
            for rel in chain_paths:
                payloads.append(read_json(self.state.data_root / rel))
            self._send_json(
                {
                    "mode": "chain",
                    "fromVersion": from_version,
                    "toVersion": to_version,
                    "patches": payloads,
                }
            )
            return

        if path == "/sync/snapshot":
            version = q.get("version", [manifest.get("latestVersion")])[0]
            versions = manifest.get("versions", [])
            snapshot_rel = None
            snapshot_hash = None
            for entry in versions:
                if entry.get("version") == version:
                    snapshot_rel = entry.get("snapshot")
                    snapshot_hash = entry.get("snapshotHash")
                    break

            if not snapshot_rel:
                snapshot_rel = manifest.get("latestSnapshot")
                snapshot_hash = manifest.get("latestHash")

            if not snapshot_rel:
                self.state.error_count += 1
                self._send_json({"error": "snapshot_not_found"}, 404)
                return

            snapshot_path = self.state.data_root / snapshot_rel
            if not snapshot_path.exists():
                self.state.error_count += 1
                self._send_json({"error": "snapshot_file_missing"}, 404)
                return

            include_records = q.get("includeRecords", ["0"])[0] == "1"
            payload = {
                "version": version,
                "snapshotPath": snapshot_rel,
                "snapshotHash": snapshot_hash,
            }
            if include_records:
                payload["records"] = read_json(snapshot_path)

            self._send_json(payload)
            return

        self.state.error_count += 1
        self._send_json({"error": "not_found"}, 404)


def main():
    parser = argparse.ArgumentParser(description="MagicCollection local sync API server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8787, type=int)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--max-req-per-minute", default=120, type=int)
    args = parser.parse_args()

    state = ApiState(
        data_root=Path(args.data_root),
        max_tokens=max(10, args.max_req_per_minute),
        refill_rate_per_sec=max(0.2, args.max_req_per_minute / 60.0),
    )

    SyncApiHandler.state = state
    server = ThreadingHTTPServer((args.host, args.port), SyncApiHandler)
    print(f"Serving sync API on http://{args.host}:{args.port} using {state.data_root}")
    server.serve_forever()


if __name__ == "__main__":
    main()
