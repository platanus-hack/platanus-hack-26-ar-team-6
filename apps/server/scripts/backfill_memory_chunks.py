"""Backfill vector retrieval chunks for existing memory rows.

Run from the server package:

  uv run python scripts/backfill_memory_chunks.py --batch-size 25 --max-batches 20

The job is idempotent. It skips source rows that already have at least one
`memory_chunk` row and leaves chunks without embeddings when OPENAI_API_KEY is
not configured, preserving lexical fallback behavior.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from uuid import UUID


_SRC = Path(__file__).resolve().parent.parent / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from relevo.db import backfill_memory_chunks, connect  # noqa: E402


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project-id",
        type=UUID,
        default=None,
        help="Optional project UUID to backfill. Defaults to all projects.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=50,
        help="Source rows to scan per batch before chunking.",
    )
    parser.add_argument(
        "--max-batches",
        type=int,
        default=1,
        help="Maximum batches to run in this process.",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Override DATABASE_URL for this run.",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    if args.batch_size <= 0:
        raise SystemExit("--batch-size must be greater than 0")
    if args.max_batches <= 0:
        raise SystemExit("--max-batches must be greater than 0")

    total_chunks = 0
    batches = 0
    with connect(args.database_url) as conn:
        for _ in range(args.max_batches):
            indexed = backfill_memory_chunks(
                conn,
                project_id=args.project_id,
                batch_size=args.batch_size,
            )
            batches += 1
            total_chunks += indexed
            if indexed == 0:
                break

    print(
        json.dumps(
            {
                "batches": batches,
                "chunks_indexed": total_chunks,
                "project_id": str(args.project_id) if args.project_id else None,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
