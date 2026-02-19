"""
Output builder: constructs the final JSON response.
"""
import pandas as pd
from typing import Dict


def build_output(df: pd.DataFrame, result: dict, elapsed: float, centrality: dict = None) -> dict:
    """Build the final output matching the required JSON schema."""
    if centrality is None:
        centrality = {}

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
        }
        if acc in account_lookup:
            info = account_lookup[acc]
            node["suspicion_score"] = info["suspicion_score"]
            node["detected_patterns"] = info["detected_patterns"]
            node["ring_id"] = info["ring_id"]
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
            "timestamp": str(row["timestamp"]),
        })

    return {
        "suspicious_accounts": result["suspicious_accounts"],
        "fraud_rings": result["fraud_rings"],
        "summary": {
            "total_accounts_analyzed": len(all_accounts),
            "suspicious_accounts_flagged": len(result["suspicious_accounts"]),
            "fraud_rings_detected": len(result["fraud_rings"]),
            "processing_time_seconds": elapsed,
        },
        "graph": {
            "nodes": nodes,
            "edges": edges,
        },
    }
