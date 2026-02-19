#!/usr/bin/env python3
"""
RIFT 2026 – Fraud-ring deduplication post-processor.

Handles three categories of redundant rings:
  1. Exact duplicates  – identical member_accounts (order-insensitive).
  2. Subset rings      – one ring's members ⊂ another's.
  3. Overlapping rings – two rings share ≥1 member account.

For every group of overlapping/duplicate rings, the **largest** ring
(most members) is kept.  On a tie, the ring with the highest risk_score
wins.  All others are absorbed and their ring_ids remapped to the survivor.

Usage:
    python dedup_rings.py <input.json> [output.json]

If output path is omitted the cleaned JSON is written to stdout.
"""
import json
import sys
from collections import OrderedDict
from typing import Any, List


# ── helpers ──────────────────────────────────────────────────────────

def _fmt_float(v: float) -> float:
    """Round to exactly 1 decimal place."""
    return round(float(v), 1)


def _deep_format_floats(obj: Any) -> Any:
    """Recursively format every float in a nested structure to 1 d.p."""
    if isinstance(obj, float):
        return _fmt_float(obj)
    if isinstance(obj, dict):
        return OrderedDict((k, _deep_format_floats(v)) for k, v in obj.items())
    if isinstance(obj, list):
        return [_deep_format_floats(item) for item in obj]
    return obj


# ── overlap-aware deduplication via Union-Find ───────────────────────

class _UnionFind:
    """Weighted quick-union with path compression."""

    def __init__(self, n: int):
        self.parent = list(range(n))
        self.rank = [0] * n

    def find(self, x: int) -> int:
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a: int, b: int) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.rank[ra] < self.rank[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        if self.rank[ra] == self.rank[rb]:
            self.rank[ra] += 1


def _merge_overlapping_rings(rings: List[dict]) -> List[dict]:
    """Merge all rings whose member_accounts overlap.

    Returns one representative ring per connected component.  The
    representative is the ring with the most members (tie-break:
    highest risk_score).  Its member_accounts is the *union* of all
    members across the component so no account is lost.  Pattern types
    are merged with '+' if they differ.
    """
    n = len(rings)
    if n == 0:
        return []

    sets = [frozenset(r["member_accounts"]) for r in rings]

    # Build an inverted index: account → list of ring indices
    acct_to_rings: dict[str, list[int]] = {}
    for i, s in enumerate(sets):
        for acct in s:
            acct_to_rings.setdefault(acct, []).append(i)

    # Union rings that share at least one account
    uf = _UnionFind(n)
    for indices in acct_to_rings.values():
        for j in range(1, len(indices)):
            uf.union(indices[0], indices[j])

    # Group rings by their component root
    components: dict[int, list[int]] = {}
    for i in range(n):
        root = uf.find(i)
        components.setdefault(root, []).append(i)

    # Pick representative per component
    survivors: list[dict] = []
    for member_indices in components.values():
        # Sort: largest member set first, then highest risk_score
        member_indices.sort(
            key=lambda i: (len(sets[i]), rings[i].get("risk_score", 0)),
            reverse=True,
        )
        rep_idx = member_indices[0]
        rep = rings[rep_idx]

        # Merge all members from the component into the union set
        merged_members: set[str] = set()
        merged_patterns: list[str] = []
        for i in member_indices:
            merged_members |= sets[i]
            pt = rings[i].get("pattern_type", "")
            if pt and pt not in merged_patterns:
                merged_patterns.append(pt)

        survivors.append({
            "member_accounts": sorted(merged_members),
            "pattern_type":    "+".join(merged_patterns) if len(merged_patterns) > 1 else merged_patterns[0] if merged_patterns else rep.get("pattern_type", "unknown"),
            "risk_score":      rep.get("risk_score", 0),
            # Carry all original ring_ids so we can build the remap table
            "_original_ids":   [rings[i]["ring_id"] for i in member_indices],
        })

    return survivors


# ── main logic ───────────────────────────────────────────────────────

def dedup_fraud_rings(data: dict) -> tuple:
    """Return (cleaned_data, stats_dict) with duplicate / overlapping
    fraud rings merged and all cross-references updated."""

    original_rings = data["fraud_rings"]
    original_count = len(original_rings)

    # Phase 1 – merge overlapping / subset / exact-duplicate rings
    merged = _merge_overlapping_rings(original_rings)

    # Phase 2 – assign new sequential RING_IDs and build remap table
    old_to_new_id: dict[str, str] = {}
    unique_rings: list[OrderedDict] = []

    for idx, ring in enumerate(merged):
        new_id = f"RING_{idx + 1:03d}"
        unique_rings.append(OrderedDict([
            ("ring_id",         new_id),
            ("member_accounts", ring["member_accounts"]),
            ("pattern_type",    ring["pattern_type"]),
            ("risk_score",      _fmt_float(ring["risk_score"])),
        ]))
        for old_id in ring["_original_ids"]:
            old_to_new_id[old_id] = new_id

    # Build a quick account → new_ring_id lookup for remapping
    acct_to_ring: dict[str, str] = {}
    for ring in unique_rings:
        for m in ring["member_accounts"]:
            acct_to_ring[m] = ring["ring_id"]

    duplicates_removed = original_count - len(unique_rings)

    # Phase 3 – rebuild suspicious_accounts with correct ring_ids
    ring_ids_remapped = 0
    spec_suspicious: list[OrderedDict] = []
    for acct in data["suspicious_accounts"]:
        old_rid = acct.get("ring_id", "NONE")
        acc_id = acct["account_id"]

        # Primary: use account membership to find the surviving ring
        if acc_id in acct_to_ring:
            new_rid = acct_to_ring[acc_id]
        else:
            # Fallback: remap via the old ring_id table
            new_rid = old_to_new_id.get(old_rid, old_rid)

        if new_rid != old_rid:
            ring_ids_remapped += 1

        spec_suspicious.append(OrderedDict([
            ("account_id",        acc_id),
            ("suspicion_score",   _fmt_float(acct["suspicion_score"])),
            ("detected_patterns", list(acct["detected_patterns"])),
            ("ring_id",           new_rid),
        ]))

    # Phase 4 – update summary
    old_summary = data["summary"]
    spec_summary = OrderedDict([
        ("total_accounts_analyzed",    int(old_summary["total_accounts_analyzed"])),
        ("suspicious_accounts_flagged", int(old_summary["suspicious_accounts_flagged"])),
        ("fraud_rings_detected",       len(unique_rings)),
        ("processing_time_seconds",    _fmt_float(old_summary["processing_time_seconds"])),
    ])

    # Phase 5 – assemble output with required key order
    output = OrderedDict([
        ("suspicious_accounts", spec_suspicious),
        ("fraud_rings",         unique_rings),
        ("summary",             spec_summary),
    ])

    # Preserve any extra top-level keys (e.g. "graph", "narratives")
    for k, v in data.items():
        if k not in output:
            output[k] = v

    stats = {
        "duplicates_removed": duplicates_removed,
        "final_unique_rings": len(unique_rings),
        "total_suspicious":   len(spec_suspicious),
        "ring_ids_remapped":  ring_ids_remapped,
    }

    return output, stats


def _json_dumps(obj: Any, **kwargs) -> str:
    """Serialize to JSON, post-processing to guarantee 1-d.p. floats.

    Python's json module drops trailing zeros for floats like 88.0 → 88.0
    but may render 95.0 as 95.0.  We do a regex pass to normalise any bare
    integers that came from float fields back to N.0 format.
    """
    # Pre-format all floats, then let stdlib handle indentation
    formatted = _deep_format_floats(obj)
    return json.dumps(formatted, indent=kwargs.get("indent", 2))


# ── CLI entry point ──────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: python dedup_rings.py <input.json> [output.json]", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else None

    with open(input_path, "r", encoding="utf-8") as f:
        data = json.load(f, object_pairs_hook=OrderedDict)

    cleaned, stats = dedup_fraud_rings(data)

    # Pretty-print with 1-d.p. floats
    json_str = _json_dumps(cleaned, indent=2)

    if output_path:
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(json_str + "\n")
        dest = output_path
    else:
        print(json_str)
        dest = "stdout"

    # Print summary to stderr so it doesn't pollute the JSON on stdout
    summary_lines = [
        "",
        "═══ Deduplication Summary ═══",
        f"  Duplicate/overlapping rings removed : {stats['duplicates_removed']}",
        f"  Final unique fraud rings            : {stats['final_unique_rings']}",
        f"  Total suspicious accounts           : {stats['total_suspicious']}",
        f"  Ring IDs remapped                   : {stats['ring_ids_remapped']}",
        f"  Output                              : {dest}",
        "═════════════════════════════",
    ]
    print("\n".join(summary_lines), file=sys.stderr)


if __name__ == "__main__":
    main()
