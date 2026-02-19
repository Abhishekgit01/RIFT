"""
Scoring module: compute suspicion scores with false-positive controls.
Optimised: vectorised profile building, single-pass scoring.
"""
import pandas as pd
import numpy as np
from collections import defaultdict
from typing import Dict, List

SUSPICION_THRESHOLD = 25.0

PATTERN_SCORES = {
    "cycle_length_3": 35.0,
    "cycle_length_4": 30.0,
    "cycle_length_5": 25.0,
    "fan_in": 30.0,
    "fan_out": 30.0,
    "layered_shell": 25.0,
}


def compute_scores(
    df: pd.DataFrame,
    rings: List[dict],
    account_patterns: Dict[str, List[str]],
    centrality: Dict[str, dict] = None,
) -> dict:
    if centrality is None:
        centrality = {}

    profiles = _build_profiles(df)

    # Compute raw suspicion score per account
    raw_scores: Dict[str, float] = {}
    for acc, patterns in account_patterns.items():
        score = sum(PATTERN_SCORES.get(pat, 10.0) for pat in patterns)

        prof = profiles.get(acc, {})
        velocity = prof.get("velocity", 0)
        if velocity > 20:
            score += 10.0
            if "high_velocity" not in patterns:
                account_patterns[acc].append("high_velocity")

        avg_amount = prof.get("avg_amount", 0)
        if 0 < avg_amount < 500:
            score += 5.0
            if "small_amounts" not in patterns:
                account_patterns[acc].append("small_amounts")

        cent = centrality.get(acc, {})
        betweenness = cent.get("betweenness", 0)
        pagerank = cent.get("pagerank", 0)
        if betweenness > 0.05:
            score += 15.0
            if "high_betweenness" not in patterns:
                account_patterns[acc].append("high_betweenness")
        elif betweenness > 0.02:
            score += 8.0
            if "high_betweenness" not in patterns:
                account_patterns[acc].append("high_betweenness")
        if pagerank > 0.02:
            score += 5.0
            if "high_pagerank" not in patterns:
                account_patterns[acc].append("high_pagerank")

        raw_scores[acc] = score

    # Apply false-positive reductions
    for acc, score in raw_scores.items():
        prof = profiles.get(acc, {})
        reduction = 0.0
        if _is_merchant_like(prof, account_patterns.get(acc, [])):
            reduction += 30.0
        if _is_payroll_like(prof, df, acc):
            reduction += 25.0
        raw_scores[acc] = max(0.0, score - reduction)

    # Normalize to 0-100
    max_raw = max(raw_scores.values()) if raw_scores else 1.0
    if max_raw == 0:
        max_raw = 1.0

    suspicion_scores = {
        acc: round(min(100.0, (s / max_raw) * 100.0), 1)
        for acc, s in raw_scores.items()
    }

    flagged = {acc: s for acc, s in suspicion_scores.items() if s >= SUSPICION_THRESHOLD}

    # Assign accounts to rings
    ring_results = []
    account_ring_map: Dict[str, str] = {}
    sorted_rings = sorted(rings, key=lambda r: (r["pattern_type"], tuple(r["members"])))

    for idx, ring in enumerate(sorted_rings):
        ring_id = f"RING_{idx + 1:03d}"
        members = ring["members"]
        member_scores = [suspicion_scores.get(m, 0) for m in members]
        risk_score = round(min(100.0, np.mean(member_scores) * 1.1), 1) if member_scores else 0.0

        ring_results.append({
            "ring_id": ring_id,
            "member_accounts": members,
            "pattern_type": ring["pattern_type"],
            "risk_score": risk_score,
        })
        for m in members:
            if m not in account_ring_map:
                account_ring_map[m] = ring_id

    suspicious = []
    for acc, score in flagged.items():
        suspicious.append({
            "account_id": acc,
            "suspicion_score": score,
            "detected_patterns": sorted(account_patterns.get(acc, [])),
            "ring_id": account_ring_map.get(acc, "NONE"),
        })
    suspicious.sort(key=lambda x: (-x["suspicion_score"], x["account_id"]))

    return {"suspicious_accounts": suspicious, "fraud_rings": ring_results}


def _build_profiles(df: pd.DataFrame) -> Dict[str, dict]:
    """Vectorised account profile building."""
    profiles: Dict[str, dict] = {}

    # Pre-compute grouped stats in bulk
    sent_grp = df.groupby("sender_id").agg(
        sent_count=("amount", "size"),
        sent_avg=("amount", "mean"),
        sent_std=("amount", "std"),
        sent_min_ts=("timestamp", "min"),
        sent_max_ts=("timestamp", "max"),
    )
    recv_grp = df.groupby("receiver_id").agg(
        recv_count=("amount", "size"),
        recv_avg=("amount", "mean"),
        recv_min_ts=("timestamp", "min"),
        recv_max_ts=("timestamp", "max"),
    )

    # Counterparties
    sent_cps = df.groupby("sender_id")["receiver_id"].nunique()
    recv_cps = df.groupby("receiver_id")["sender_id"].nunique()

    all_accounts = set(df["sender_id"].unique()) | set(df["receiver_id"].unique())

    for acc in all_accounts:
        s = sent_grp.loc[acc] if acc in sent_grp.index else None
        r = recv_grp.loc[acc] if acc in recv_grp.index else None

        sent_count = int(s["sent_count"]) if s is not None else 0
        recv_count = int(r["recv_count"]) if r is not None else 0
        total = sent_count + recv_count

        # Time span
        ts_vals = []
        if s is not None:
            ts_vals.extend([s["sent_min_ts"], s["sent_max_ts"]])
        if r is not None:
            ts_vals.extend([r["recv_min_ts"], r["recv_max_ts"]])
        if ts_vals:
            time_span = (max(ts_vals) - min(ts_vals)).total_seconds() / 3600
        else:
            time_span = 0

        # Avg amount (weighted)
        if s is not None and r is not None:
            avg_amount = (s["sent_avg"] * sent_count + r["recv_avg"] * recv_count) / total
        elif s is not None:
            avg_amount = s["sent_avg"]
        elif r is not None:
            avg_amount = r["recv_avg"]
        else:
            avg_amount = 0

        amount_std = s["sent_std"] if s is not None and not pd.isna(s["sent_std"]) else 0

        # Counterparties
        cp_sent = int(sent_cps.get(acc, 0))
        cp_recv = int(recv_cps.get(acc, 0))

        hours = max(time_span, 1)
        velocity = total / (hours / 24.0)

        profiles[acc] = {
            "total_txns": total,
            "sent_count": sent_count,
            "received_count": recv_count,
            "counterparty_count": cp_sent + cp_recv,
            "time_span_hours": time_span,
            "avg_amount": float(avg_amount),
            "amount_std": float(amount_std),
            "velocity": velocity,
        }

    return profiles


def _is_merchant_like(prof: dict, patterns: List[str]) -> bool:
    if not prof:
        return False
    has_cycle = any("cycle" in p for p in patterns)
    return (
        prof.get("counterparty_count", 0) >= 15
        and prof.get("time_span_hours", 0) >= 168
        and prof.get("received_count", 0) > prof.get("sent_count", 0) * 3
        and not has_cycle
    )


def _is_payroll_like(prof: dict, df: pd.DataFrame, acc: str) -> bool:
    if not prof:
        return False
    sent = df[df["sender_id"] == acc]
    if len(sent) < 5:
        return False
    mean_amt = sent["amount"].mean()
    if mean_amt <= 0:
        return False
    cv = sent["amount"].std() / mean_amt
    if cv > 0.15:
        return False
    times = sent["timestamp"].sort_values()
    if len(times) < 3:
        return False
    gaps = times.diff().dropna().dt.total_seconds()
    gap_cv = gaps.std() / gaps.mean() if gaps.mean() > 0 else 1
    return gap_cv < 0.3
