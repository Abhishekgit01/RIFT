"""
Ring Casefile & Explainability Scorecard builder.

For every detected fraud ring, produces a structured evidence dossier:
  - Top evidence transactions (amounts, timestamps, direction)
  - Per-member breakdown (patterns triggered, score contribution, role)
  - Risk-factor decomposition (which rules fired and their point totals)
  - False-positive justification (why each member is NOT a merchant/payroll)
  - Temporal analysis (first/last activity, burst windows)
"""
import pandas as pd
from typing import Dict, List

from .scoring import PATTERN_SCORES, _is_merchant_like, _is_payroll_like

# Human-readable pattern descriptions for the scorecard
_PATTERN_LABEL: Dict[str, str] = {
    "cycle_length_3": "3-Account Cycle",
    "cycle_length_4": "4-Account Cycle",
    "cycle_length_5": "5-Account Cycle",
    "fan_in": "Fan-In (Smurfing)",
    "fan_out": "Fan-Out (Distribution)",
    "layered_shell": "Layered Shell Network",
    "high_velocity": "High Velocity (>20 txn/day)",
    "small_amounts": "Small Amounts (<$500 avg)",
    "high_betweenness": "High Betweenness Centrality",
    "high_pagerank": "High PageRank",
}

_ROLE_PRIORITY = ["cycle_length_3", "cycle_length_4", "cycle_length_5",
                  "fan_in", "fan_out", "layered_shell",
                  "high_betweenness", "high_velocity"]


def _infer_role(patterns: List[str]) -> str:
    """Infer a human-readable role for an account based on its patterns."""
    for pat in _ROLE_PRIORITY:
        if pat in patterns:
            if "cycle" in pat:
                return "Ring Participant"
            if pat == "fan_in":
                return "Fund Collector"
            if pat == "fan_out":
                return "Fund Distributor"
            if pat == "layered_shell":
                return "Shell Intermediary"
            if pat == "high_betweenness":
                return "Network Bridge"
            if pat == "high_velocity":
                return "Bot / Automated Mule"
    return "Flagged Account"


def build_casefiles(
    df: pd.DataFrame,
    result: dict,
    profiles: Dict[str, dict],
    centrality: Dict[str, dict],
) -> List[dict]:
    """Build one casefile per fraud ring.

    Args:
        df: raw transaction DataFrame
        result: output of compute_scores (suspicious_accounts + fraud_rings)
        profiles: output of _build_profiles
        centrality: output of _compute_centrality

    Returns:
        List of casefile dicts, one per ring, sorted by ring_id.
    """
    acct_lookup = {a["account_id"]: a for a in result["suspicious_accounts"]}
    casefiles: List[dict] = []

    for ring in result["fraud_rings"]:
        ring_id = ring["ring_id"]
        members = ring["member_accounts"]
        member_set = set(members)

        # ── 1. Evidence transactions ────────────────────────────────
        ring_txns = df[
            (df["sender_id"].isin(member_set)) & (df["receiver_id"].isin(member_set))
        ].copy()

        # Internal edges sorted by amount desc
        ring_txns_sorted = ring_txns.sort_values("amount", ascending=False)
        top_evidence = []
        for _, row in ring_txns_sorted.head(10).iterrows():
            top_evidence.append({
                "transaction_id": row["transaction_id"],
                "from": row["sender_id"],
                "to": row["receiver_id"],
                "amount": round(float(row["amount"]), 2),
                "timestamp": row["timestamp"].strftime("%Y-%m-%d %H:%M:%S"),
            })

        # ── 2. Temporal analysis ────────────────────────────────────
        if not ring_txns.empty:
            ts = ring_txns["timestamp"]
            first_activity = ts.min().strftime("%Y-%m-%d %H:%M:%S")
            last_activity = ts.max().strftime("%Y-%m-%d %H:%M:%S")
            span_hours = round((ts.max() - ts.min()).total_seconds() / 3600, 1)
            total_internal_txns = len(ring_txns)
            total_volume = round(float(ring_txns["amount"].sum()), 2)
        else:
            first_activity = last_activity = "N/A"
            span_hours = 0.0
            total_internal_txns = 0
            total_volume = 0.0

        # ── 3. Per-member breakdown ─────────────────────────────────
        member_cards: List[dict] = []
        risk_factors: Dict[str, float] = {}

        for acc_id in sorted(members):
            acct = acct_lookup.get(acc_id)
            if not acct:
                # member exists in ring but wasn't flagged as suspicious
                member_cards.append({
                    "account_id": acc_id,
                    "suspicion_score": 0.0,
                    "detected_patterns": [],
                    "role": "Ring Member (below threshold)",
                    "risk_contribution": {},
                    "fp_status": "not_evaluated",
                })
                continue

            patterns = acct["detected_patterns"]
            score = acct["suspicion_score"]

            # Break down which patterns contributed how many points
            contribution: Dict[str, float] = {}
            for pat in patterns:
                pts = PATTERN_SCORES.get(pat, 10.0)
                contribution[_PATTERN_LABEL.get(pat, pat)] = pts
                risk_factors[_PATTERN_LABEL.get(pat, pat)] = (
                    risk_factors.get(_PATTERN_LABEL.get(pat, pat), 0) + pts
                )

            # False-positive justification
            prof = profiles.get(acc_id, {})
            fp_checks: List[str] = []
            is_merch = _is_merchant_like(prof, patterns)
            is_pay = _is_payroll_like(prof, df, acc_id)
            if is_merch:
                fp_checks.append("Merchant-like traits detected but overridden by cycle involvement")
            else:
                reasons = []
                if prof.get("counterparty_count", 0) < 15:
                    reasons.append(f"only {prof.get('counterparty_count', 0)} counterparties (<15)")
                if prof.get("time_span_hours", 0) < 168:
                    reasons.append(f"activity span {prof.get('time_span_hours', 0):.0f}h (<168h)")
                recv = prof.get("received_count", 0)
                sent = prof.get("sent_count", 0)
                if not (recv > sent * 3):
                    reasons.append(f"recv/sent ratio {recv}:{sent} (not >3:1)")
                fp_checks.append("Not merchant-like: " + "; ".join(reasons))

            if is_pay:
                fp_checks.append("Payroll-like traits detected but overridden by pattern flags")
            else:
                fp_checks.append("Not payroll: irregular amounts or timing")

            role = _infer_role(patterns)
            cent = centrality.get(acc_id, {})

            member_cards.append({
                "account_id": acc_id,
                "suspicion_score": score,
                "detected_patterns": patterns,
                "role": role,
                "risk_contribution": contribution,
                "profile": {
                    "total_txns": prof.get("total_txns", 0),
                    "velocity": round(prof.get("velocity", 0), 1),
                    "avg_amount": round(prof.get("avg_amount", 0), 2),
                    "counterparties": prof.get("counterparty_count", 0),
                    "pagerank": round(cent.get("pagerank", 0), 6),
                    "betweenness": round(cent.get("betweenness", 0), 6),
                },
                "fp_justification": fp_checks,
            })

        # ── 4. Aggregate risk factor breakdown ──────────────────────
        sorted_factors = sorted(risk_factors.items(), key=lambda x: -x[1])

        # ── 5. Assemble casefile ────────────────────────────────────
        casefiles.append({
            "ring_id": ring_id,
            "pattern_type": ring["pattern_type"],
            "risk_score": ring["risk_score"],
            "member_count": len(members),
            "temporal": {
                "first_activity": first_activity,
                "last_activity": last_activity,
                "span_hours": span_hours,
                "internal_transactions": total_internal_txns,
                "internal_volume": total_volume,
            },
            "top_evidence": top_evidence,
            "risk_factors": [
                {"factor": f, "total_points": pts}
                for f, pts in sorted_factors
            ],
            "members": member_cards,
        })

    return casefiles
