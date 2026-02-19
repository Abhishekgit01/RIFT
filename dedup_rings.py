#!/usr/bin/env python3
"""
RIFT 2026 – Fraud-ring deduplication post-processor.

Reads a JSON file produced by the Financial Forensics Engine,
removes duplicate fraud_rings (same set of member_accounts regardless
of ordering or ring_id), remaps ring_id references in suspicious_accounts,
re-sequences ring IDs, updates the summary counter, and writes the
cleaned JSON in spec-compliant format.

Usage:
    python dedup_rings.py <input.json> [output.json]

If output path is omitted the cleaned JSON is written to stdout.
"""
import json
import sys
from collections import OrderedDict
from typing import Any


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


def _canonical_key(members: list) -> tuple:
    """Order-independent canonical key for a set of member accounts."""
    return tuple(sorted(members))


# ── main logic ───────────────────────────────────────────────────────

def dedup_fraud_rings(data: dict) -> dict:
    """Return a new dict with duplicate fraud rings removed and all
    cross-references updated."""

    original_rings = data["fraud_rings"]
    original_count = len(original_rings)

    # 1. Deduplicate rings – keep the first occurrence per unique member set
    seen: dict[tuple, int] = {}          # canonical_key → index in unique list
    unique_rings: list[dict] = []
    old_to_new_id: dict[str, str] = {}   # old ring_id → surviving ring_id

    for ring in original_rings:
        key = _canonical_key(ring["member_accounts"])
        if key not in seen:
            new_idx = len(unique_rings)
            new_id = f"RING_{new_idx + 1:03d}"
            seen[key] = new_idx
            # Build a fresh ring dict with correct field order
            unique_rings.append(OrderedDict([
                ("ring_id",          new_id),
                ("member_accounts",  sorted(ring["member_accounts"])),
                ("pattern_type",     ring["pattern_type"]),
                ("risk_score",       _fmt_float(ring["risk_score"])),
            ]))
            old_to_new_id[ring["ring_id"]] = new_id
        else:
            # Duplicate – map its old ring_id to the surviving one
            surviving_idx = seen[key]
            old_to_new_id[ring["ring_id"]] = unique_rings[surviving_idx]["ring_id"]

    duplicates_removed = original_count - len(unique_rings)

    # 2. Rebuild suspicious_accounts with remapped ring_ids
    spec_suspicious = []
    for acct in data["suspicious_accounts"]:
        old_rid = acct.get("ring_id", "NONE")
        new_rid = old_to_new_id.get(old_rid, old_rid)
        spec_suspicious.append(OrderedDict([
            ("account_id",        acct["account_id"]),
            ("suspicion_score",   _fmt_float(acct["suspicion_score"])),
            ("detected_patterns", list(acct["detected_patterns"])),
            ("ring_id",           new_rid),
        ]))

    # 3. Update summary
    old_summary = data["summary"]
    spec_summary = OrderedDict([
        ("total_accounts_analyzed",    int(old_summary["total_accounts_analyzed"])),
        ("suspicious_accounts_flagged", int(old_summary["suspicious_accounts_flagged"])),
        ("fraud_rings_detected",       len(unique_rings)),
        ("processing_time_seconds",    _fmt_float(old_summary["processing_time_seconds"])),
    ])

    # 4. Assemble output with required key order
    output = OrderedDict([
        ("suspicious_accounts", spec_suspicious),
        ("fraud_rings",         unique_rings),
        ("summary",             spec_summary),
    ])

    # Preserve any extra top-level keys (e.g. "graph", "narratives")
    for k, v in data.items():
        if k not in output:
            output[k] = v

    return output, duplicates_removed


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

    cleaned, duplicates_removed = dedup_fraud_rings(data)

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
    total_suspicious = len(cleaned["suspicious_accounts"])
    final_rings = len(cleaned["fraud_rings"])
    summary_lines = [
        "",
        "═══ Deduplication Summary ═══",
        f"  Duplicate rings removed : {duplicates_removed}",
        f"  Unique fraud rings      : {final_rings}",
        f"  Suspicious accounts     : {total_suspicious}",
        f"  Output                  : {dest}",
        "═════════════════════════════",
    ]
    print("\n".join(summary_lines), file=sys.stderr)


if __name__ == "__main__":
    main()
