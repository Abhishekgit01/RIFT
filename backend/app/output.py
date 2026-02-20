"""
Output builder: constructs the final JSON response.
Enforces exact hackathon spec:
  - Key order: suspicious_accounts, fraud_rings, summary
  - Float formatting: exactly 1 decimal place throughout
  - Field order in every object is spec-compliant
"""
import pandas as pd
from typing import Dict


def _fmt_float(v: float) -> float:
    """Round to 1 decimal place and ensure float type."""
    return round(float(v), 1)


def build_output(df: pd.DataFrame, result: dict, elapsed: float, centrality: dict = None, merchant_accounts: set = None) -> dict:
    """Build the final output matching the required JSON schema exactly."""
    if centrality is None:
        centrality = {}
    if merchant_accounts is None:
        merchant_accounts = set()

    all_accounts = set(df["sender_id"].unique()) | set(df["receiver_id"].unique())

    # Build graph data for frontend visualization
    nodes = []
    suspicious_ids = {a["account_id"] for a in result["suspicious_accounts"]}
    account_lookup = {a["account_id"]: a for a in result["suspicious_accounts"]}
    ring_member_map = {}
    for ring in result["fraud_rings"]:
        for m in ring["member_accounts"]:
            ring_member_map[m] = ring["ring_id"]

    for acc in sorted(all_accounts):
        node = {
            "id": acc,
            "suspicious": acc in suspicious_ids,
            "merchant": acc in merchant_accounts,
        }
        if acc in account_lookup:
            info = account_lookup[acc]
            node["suspicion_score"] = info["suspicion_score"]
            node["detected_patterns"] = info["detected_patterns"]
            node["ring_id"] = info["ring_id"]
        elif acc in ring_member_map:
            # Non-suspicious ring members still need ring_id for graph coloring
            node["ring_id"] = ring_member_map[acc]
        # Add centrality metrics
        cent = centrality.get(acc, {})
        node["pagerank"] = cent.get("pagerank", 0)
        node["betweenness"] = cent.get("betweenness", 0)
        nodes.append(node)

    edges = []
    for _, row in df.iterrows():
        edges.append({
            "source": row["sender_id"],
            "target": row["receiver_id"],
            "amount": float(row["amount"]),
            "transaction_id": row["transaction_id"],
            "timestamp": row["timestamp"].strftime("%Y-%m-%d %H:%M:%S"),
        })

    # Build spec-compliant suspicious_accounts — exact field order, exact float format
    spec_suspicious = []
    for a in result["suspicious_accounts"]:
        spec_suspicious.append({
            "account_id": a["account_id"],
            "suspicion_score": _fmt_float(a["suspicion_score"]),
            "detected_patterns": list(a["detected_patterns"]),
            "ring_id": a["ring_id"],
        })

    # Build spec-compliant fraud_rings — exact field order, exact float format
    spec_fraud_rings = []
    for r in result["fraud_rings"]:
        spec_fraud_rings.append({
            "ring_id": r["ring_id"],
            "member_accounts": sorted(r["member_accounts"]),
            "pattern_type": r["pattern_type"],
            "risk_score": _fmt_float(r["risk_score"]),
        })

    # Build spec-compliant summary — exact field order, exact float format
    spec_summary = {
        "total_accounts_analyzed": int(len(all_accounts)),
        "suspicious_accounts_flagged": int(len(spec_suspicious)),
        "fraud_rings_detected": int(len(spec_fraud_rings)),
        "processing_time_seconds": _fmt_float(elapsed),
    }

    # Return with exact key order: suspicious_accounts, fraud_rings, summary
    # (Python 3.7+ dicts preserve insertion order, FastAPI/json serializes in insertion order)
    return {
        "suspicious_accounts": spec_suspicious,
        "fraud_rings": spec_fraud_rings,
        "summary": spec_summary,
        "graph": {
            "nodes": nodes,
            "edges": edges,
        },
    }
