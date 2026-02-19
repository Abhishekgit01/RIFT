"""
Scoring module: compute suspicion scores with false-positive controls.
"""
import pandas as pd
import numpy as np
from collections import defaultdict
from typing import Dict, List, Tuple


# Threshold: accounts below this score are not flagged
SUSPICION_THRESHOLD = 25.0

# Pattern base scores
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
) -> dict:
    """
    Compute suspicion_score per account and risk_score per ring.
    Apply false-positive controls for merchant-like and payroll-like accounts.

    Returns dict with keys: suspicious_accounts, fraud_rings
    """
    # --- Build account profile ---
    profiles = _build_profiles(df)

    # --- Compute raw suspicion score per account ---
    raw_scores: Dict[str, float] = {}
    for acc, patterns in account_patterns.items():
        score = 0.0
        for pat in patterns:
            score += PATTERN_SCORES.get(pat, 10.0)

        # Velocity bonus: many transactions in short time
        prof = profiles.get(acc, {})
        velocity = prof.get("velocity", 0)
        if velocity > 20:
            score += 10.0
            if "high_velocity" not in patterns:
                account_patterns[acc].append("high_velocity")

        # Amount variance bonus for small amounts (smurfing indicator)
        avg_amount = prof.get("avg_amount", 0)
        if avg_amount > 0 and avg_amount < 500:
            score += 5.0
            if "small_amounts" not in patterns:
                account_patterns[acc].append("small_amounts")

        raw_scores[acc] = score

    # --- Apply false-positive reductions ---
    for acc, score in raw_scores.items():
        prof = profiles.get(acc, {})
        reduction = 0.0

        # Merchant-like: many counterparties, long active period, low loop involvement
        if _is_merchant_like(prof, account_patterns.get(acc, [])):
            reduction += 30.0

        # Payroll-like: periodic disbursements with low amount variance
        if _is_payroll_like(prof, df, acc):
            reduction += 25.0

        raw_scores[acc] = max(0.0, score - reduction)

    # --- Normalize to 0-100 ---
    max_raw = max(raw_scores.values()) if raw_scores else 1.0
    if max_raw == 0:
        max_raw = 1.0

    suspicion_scores: Dict[str, float] = {}
    for acc, score in raw_scores.items():
        normalized = min(100.0, (score / max_raw) * 100.0)
        suspicion_scores[acc] = round(normalized, 1)

    # --- Filter by threshold ---
    flagged = {acc: s for acc, s in suspicion_scores.items() if s >= SUSPICION_THRESHOLD}

    # --- Assign accounts to rings ---
    ring_results = []
    account_ring_map: Dict[str, str] = {}

    # Sort rings deterministically
    sorted_rings = sorted(rings, key=lambda r: (r["pattern_type"], tuple(r["members"])))

    for idx, ring in enumerate(sorted_rings):
        ring_id = f"RING_{idx + 1:03d}"
        members = ring["members"]  # already sorted

        # Risk score: average of member suspicion scores, weighted by pattern count
        member_scores = [suspicion_scores.get(m, 0) for m in members]
        if member_scores:
            risk_score = round(np.mean(member_scores) * 1.1, 1)  # slight boost for being in a ring
            risk_score = min(100.0, risk_score)
        else:
            risk_score = 0.0

        ring_results.append({
            "ring_id": ring_id,
            "member_accounts": members,
            "pattern_type": ring["pattern_type"],
            "risk_score": risk_score,
        })

        for m in members:
            if m not in account_ring_map:
                account_ring_map[m] = ring_id

    # --- Build suspicious accounts list ---
    suspicious = []
    for acc, score in flagged.items():
        suspicious.append({
            "account_id": acc,
            "suspicion_score": score,
            "detected_patterns": sorted(account_patterns.get(acc, [])),
            "ring_id": account_ring_map.get(acc, "NONE"),
        })

    # Sort by suspicion_score desc, then account_id asc
    suspicious.sort(key=lambda x: (-x["suspicion_score"], x["account_id"]))

    return {
        "suspicious_accounts": suspicious,
        "fraud_rings": ring_results,
    }


def _build_profiles(df: pd.DataFrame) -> Dict[str, dict]:
    """Build account-level profiles for FP reduction."""
    profiles: Dict[str, dict] = {}

    all_accounts = set(df["sender_id"].unique()) | set(df["receiver_id"].unique())

    for acc in all_accounts:
        sent = df[df["sender_id"] == acc]
        received = df[df["receiver_id"] == acc]
        all_txns = pd.concat([sent, received])

        counterparties = set(sent["receiver_id"].unique()) | set(received["sender_id"].unique())

        if len(all_txns) > 0:
            time_span = (all_txns["timestamp"].max() - all_txns["timestamp"].min()).total_seconds() / 3600
            avg_amount = all_txns["amount"].mean() if "amount" in all_txns else 0
            amount_std = sent["amount"].std() if len(sent) > 1 else 0
        else:
            time_span = 0
            avg_amount = 0
            amount_std = 0

        # Velocity: transactions per 24h
        hours = max(time_span, 1)
        velocity = len(all_txns) / (hours / 24.0)

        profiles[acc] = {
            "total_txns": len(all_txns),
            "sent_count": len(sent),
            "received_count": len(received),
            "counterparty_count": len(counterparties),
            "time_span_hours": time_span,
            "avg_amount": avg_amount,
            "amount_std": amount_std if not pd.isna(amount_std) else 0,
            "velocity": velocity,
        }

    return profiles


def _is_merchant_like(prof: dict, patterns: List[str]) -> bool:
    """
    Merchant heuristic: many counterparties, long active period, primarily receives.
    """
    if not prof:
        return False
    has_cycle = any("cycle" in p for p in patterns)
    return (
        prof.get("counterparty_count", 0) >= 15
        and prof.get("time_span_hours", 0) >= 168  # 7+ days
        and prof.get("received_count", 0) > prof.get("sent_count", 0) * 3
        and not has_cycle
    )


def _is_payroll_like(prof: dict, df: pd.DataFrame, acc: str) -> bool:
    """
    Payroll heuristic: periodic disbursements with low amount variance.
    """
    if not prof:
        return False
    sent = df[df["sender_id"] == acc]
    if len(sent) < 5:
        return False

    # Low amount variance (coefficient of variation < 0.15)
    mean_amt = sent["amount"].mean()
    if mean_amt <= 0:
        return False
    cv = sent["amount"].std() / mean_amt
    if cv > 0.15:
        return False

    # Check periodicity: time gaps between sends should be regular
    times = sent["timestamp"].sort_values()
    if len(times) < 3:
        return False
    gaps = times.diff().dropna().dt.total_seconds()
    gap_cv = gaps.std() / gaps.mean() if gaps.mean() > 0 else 1
    return gap_cv < 0.3
