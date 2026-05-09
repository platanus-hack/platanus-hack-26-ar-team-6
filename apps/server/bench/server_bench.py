"""Server-tier latency bench. No LLM. Drives FastAPI endpoints directly.

Measures handler latency for /agent-ctx, /global-ctx, /memory-updates with a
warm pool. Reports min/p50/p95/max in milliseconds.

Run:
    cd apps/server
    AUTO_MIGRATE=1 AUTO_SEED=1 \\
      DATABASE_URL=postgresql://relevo:relevo@localhost:5432/relevo \\
      uv run python bench/server_bench.py --iters 50 --warmup 5

Server is spawned in-process via uvicorn on a free port. Auth uses the seeded
legacy token dev-token-user1.
"""

from __future__ import annotations

import argparse
import json
import socket
import statistics
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

REPO_ROOT = Path(__file__).resolve().parents[3]
SERVER_SRC = REPO_ROOT / "apps" / "server" / "src"
sys.path.insert(0, str(SERVER_SRC))


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _wait_for_health(port: int, timeout_s: float = 15.0) -> None:
    deadline = time.monotonic() + timeout_s
    url = f"http://127.0.0.1:{port}/health"
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as resp:
                if resp.status == 200:
                    return
        except (urllib.error.URLError, OSError) as exc:
            last_err = exc
        time.sleep(0.1)
    raise RuntimeError(f"server did not become healthy on :{port}: {last_err}")


def _post(url: str, body: dict, headers: dict[str, str]) -> tuple[int, bytes, float]:
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30.0) as resp:
            data = resp.read()
            elapsed = (time.perf_counter() - started) * 1000.0
            return resp.status, data, elapsed
    except urllib.error.HTTPError as exc:
        elapsed = (time.perf_counter() - started) * 1000.0
        return exc.code, exc.read() if exc.fp else b"", elapsed


@dataclass
class BenchSamples:
    label: str
    samples_ms: list[float]

    def summary(self) -> dict[str, float]:
        if not self.samples_ms:
            return {}
        sorted_samples = sorted(self.samples_ms)
        n = len(sorted_samples)
        p50 = sorted_samples[n // 2]
        p95 = sorted_samples[max(0, int(n * 0.95) - 1)]
        return {
            "n": n,
            "min": min(sorted_samples),
            "p50": p50,
            "p95": p95,
            "max": max(sorted_samples),
            "mean": statistics.fmean(sorted_samples),
        }


def _bootstrap_ids(headers: dict[str, str], port: int) -> tuple[str, str]:
    url = f"http://127.0.0.1:{port}/bootstrap"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=10.0) as resp:
        payload = json.loads(resp.read())
    project_id = payload["project"]["id"]
    roster = payload.get("roster", [])
    user_id = payload["user"]["id"]
    target_id = next((m["id"] for m in roster if m["id"] != user_id), user_id)
    return project_id, target_id


def main() -> None:
    parser = argparse.ArgumentParser(description="Server bench")
    parser.add_argument("--iters", type=int, default=50)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--token", default="dev-token-user1")
    parser.add_argument(
        "--external-server",
        help="Skip in-process spawn; use this base URL (e.g. http://127.0.0.1:8000)",
    )
    parser.add_argument("--csv", help="Optional CSV output path")
    args = parser.parse_args()

    if args.external_server:
        base_url = args.external_server.rstrip("/")
        port = int(base_url.rsplit(":", 1)[-1].split("/")[0])
        proc = None
    else:
        port = _free_port()
        env_extra = {
            "AUTO_MIGRATE": "1",
            "AUTO_SEED": "1",
        }
        cmd = [
            sys.executable,
            "-m",
            "uvicorn",
            "relevo.main:create_app",
            "--factory",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
            "--no-access-log",
        ]
        import os

        env = {**os.environ, **env_extra}
        proc = subprocess.Popen(cmd, env=env, stdout=sys.stdout, stderr=sys.stderr)
        base_url = f"http://127.0.0.1:{port}"
        try:
            _wait_for_health(port)
        except Exception:
            proc.terminate()
            raise

    try:
        headers = {"Authorization": f"Bearer {args.token}"}
        project_id, target_id = _bootstrap_ids(headers, port)
        headers_with_project = {**headers, "X-Project-Id": project_id}

        endpoints = {
            "agent_ctx": (
                "/agent-ctx",
                lambda: {"agent_id": target_id, "query": "what does the team do?"},
            ),
            "global_ctx": (
                "/global-ctx",
                lambda: {"query": "what is the project about?"},
            ),
            "memory_updates_1op": (
                "/memory-updates",
                lambda: {
                    "chat_session_id": str(uuid4()),
                    "checkpoint_index": 1,
                    "operations": [
                        {
                            "author_agent_id": target_id,
                            "importance": "local",
                            "document_key": f"bench-doc-{uuid4()}",
                            "canonical_content": "bench content",
                            "event_content": "bench event",
                            "metadata": {"bench": True},
                        }
                    ],
                },
            ),
            "memory_updates_5ops": (
                "/memory-updates",
                lambda: {
                    "chat_session_id": str(uuid4()),
                    "checkpoint_index": 1,
                    "operations": [
                        {
                            "author_agent_id": target_id,
                            "importance": "local",
                            "document_key": f"bench-doc-{uuid4()}",
                            "canonical_content": f"bench content {i}",
                            "event_content": f"bench event {i}",
                            "metadata": {"bench": True, "i": i},
                        }
                        for i in range(5)
                    ],
                },
            ),
        }

        results: list[BenchSamples] = []
        for label, (path, body_factory) in endpoints.items():
            url = f"{base_url}{path}"
            for _ in range(args.warmup):
                _post(url, body_factory(), headers_with_project)
            samples: list[float] = []
            errors = 0
            for _ in range(args.iters):
                status, data, elapsed_ms = _post(url, body_factory(), headers_with_project)
                if status != 200:
                    errors += 1
                    if errors <= 3:
                        print(
                            f"[warn] {label} status={status} body={data[:200]!r}",
                            file=sys.stderr,
                        )
                    continue
                samples.append(elapsed_ms)
            if errors:
                print(f"[warn] {label}: {errors}/{args.iters} errors", file=sys.stderr)
            results.append(BenchSamples(label=label, samples_ms=samples))

        print(f"\nBench summary (ms, client-observed): n={args.iters} warmup={args.warmup}")
        print(f"server={base_url} pool=psycopg ConnectionPool min=2 max=10")
        print(f"{'endpoint':<22} {'n':>4} {'min':>8} {'p50':>8} {'p95':>8} {'max':>8} {'mean':>8}")
        for r in results:
            s = r.summary()
            if not s:
                print(f"{r.label:<22} (no successful samples)")
                continue
            print(
                f"{r.label:<22} {int(s['n']):>4} "
                f"{s['min']:>8.2f} {s['p50']:>8.2f} {s['p95']:>8.2f} {s['max']:>8.2f} {s['mean']:>8.2f}"
            )

        if args.csv:
            csv_path = Path(args.csv)
            with csv_path.open("w") as fh:
                fh.write("endpoint,iter,elapsed_ms\n")
                for r in results:
                    for i, ms in enumerate(r.samples_ms):
                        fh.write(f"{r.label},{i},{ms:.4f}\n")
            print(f"\nCSV written to {csv_path}")
    finally:
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    main()
