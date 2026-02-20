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
    payroll_stats = _build_payroll_stats(df)

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
    merchant_accounts: dict = {}
    payroll_accounts: set = set()
    for acc, score in raw_scores.items():
        prof = profiles.get(acc, {})
        reduction = 0.0
        if _is_merchant_like(prof, account_patterns.get(acc, []), profiles):
            reduction += 30.0
            cp = prof.get('counterparty_count', 0)
            span_d = round(prof.get('time_span_hours', 0) / 24, 1)
            recv = prof.get('received_count', 0)
            sent = prof.get('sent_count', 0)
            merchant_accounts[acc] = (
                f"High-volume merchant: {cp} counterparties, "
                f"active {span_d} days, inbound/outbound ratio "
                f"{recv}:{sent}, no cyclic patterns"
            )
        if _is_payroll_like(prof, df, acc, payroll_stats=payroll_stats):
            reduction += 25.0
            payroll_accounts.add(acc)
            if acc not in merchant_accounts:
                pstats = payroll_stats.get(acc, {})
                tx_count = int(pstats.get("tx_count", 0))
                avg = round(float(pstats.get("mean_amount", 0.0)), 2)
                merchant_accounts[acc] = (
                    f"Payroll account: {tx_count} regular disbursements, "
                    f"avg ${avg:.2f}, consistent amounts & intervals"
                )
            else:
                merchant_accounts[acc] += ' | Also matches payroll pattern'
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

    return {
        "suspicious_accounts": suspicious,
        "fraud_rings": ring_results,
        "merchant_accounts": merchant_accounts,
        "payroll_accounts": payroll_accounts,
        "_profiles": profiles,
        "_payroll_stats": payroll_stats,
    }


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


def _build_payroll_stats(df: pd.DataFrame) -> Dict[str, dict]:
    """Precompute sender-side regularity metrics used by payroll detection."""
    stats: Dict[str, dict] = {}
    for sender, sent in df.groupby("sender_id"):
        tx_count = int(len(sent))
        if tx_count == 0:
            continue

        amounts = sent["amount"]
        mean_amt = float(amounts.mean()) if tx_count > 0 else 0.0
        amt_std = float(amounts.std()) if tx_count > 1 else 0.0
        amount_cv = (amt_std / mean_amt) if mean_amt > 0 else np.inf

        times = sent["timestamp"].sort_values()
        if tx_count > 2:
            gaps = times.diff().dropna().dt.total_seconds()
            gap_mean = float(gaps.mean()) if len(gaps) > 0 else 0.0
            gap_std = float(gaps.std()) if len(gaps) > 1 else 0.0
            gap_cv = (gap_std / gap_mean) if gap_mean > 0 else np.inf
        else:
            gap_cv = np.inf

        stats[sender] = {
            "tx_count": tx_count,
            "mean_amount": mean_amt,
            "amount_cv": amount_cv,
            "gap_cv": gap_cv,
        }
    return stats


def _is_merchant_like(prof: dict, patterns: List[str], profiles: dict = None) -> bool:
    """Detect legitimate high-volume merchants / payroll accounts.

    Uses adaptive thresholds so the detection works on both tiny demo CSVs
    and production 10K-transaction datasets:
      - counterparty_count  >= max(3, top-20 percentile of all accounts)
      - time_span_hours     >= max(2, median span across all accounts)
      - received_count      >  sent_count * 2   (inbound-heavy)
      - no cyclic transaction patterns
    """
    if not prof:
        return False
    has_cycle = any("cycle" in p for p in patterns)
    if has_cycle:
        return False

    # Adaptive thresholds based on dataset statistics
    if profiles and len(profiles) > 0:
        all_cp = sorted(p.get("counterparty_count", 0) for p in profiles.values())
        all_span = sorted(p.get("time_span_hours", 0) for p in profiles.values())
        cp_p80 = all_cp[int(len(all_cp) * 0.80)] if all_cp else 15
        span_median = all_span[len(all_span) // 2] if all_span else 168
        cp_thresh = max(3, cp_p80)
        span_thresh = max(2, span_median)
    else:
        cp_thresh = 15
        span_thresh = 168

    return (
        prof.get("counterparty_count", 0) >= cp_thresh
        and prof.get("time_span_hours", 0) >= span_thresh
        and prof.get("received_count", 0) > prof.get("sent_count", 0) * 2
        and not has_cycle
    )


def _is_payroll_like(prof: dict, df: pd.DataFrame, acc: str, payroll_stats: Dict[str, dict] = None) -> bool:
    if not prof:
        return False

    if payroll_stats is not None:
        pstats = payroll_stats.get(acc)
    else:
        pstats = _build_payroll_stats(df).get(acc)

    if not pstats:
        return False
    if pstats.get("tx_count", 0) < 3:
        return False
    if pstats.get("mean_amount", 0.0) <= 0:
        return False
    if pstats.get("amount_cv", np.inf) > 0.15:
        return False
    return pstats.get("gap_cv", np.inf) < 0.3
