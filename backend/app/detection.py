"""
Detection module: cycle detection, smurfing, and layered shell networks.
"""
import pandas as pd
import networkx as nx
from collections import defaultdict
from typing import Dict, List, Set, Tuple


def detect_all(df: pd.DataFrame) -> Tuple[List[dict], Dict[str, List[str]]]:
    """
    Run all detection algorithms. Returns:
      - rings: list of dicts with keys: members (sorted list), pattern_type (str)
      - account_patterns: dict mapping account_id -> list of pattern strings
    """
    G = nx.DiGraph()
    for _, row in df.iterrows():
        G.add_edge(row["sender_id"], row["receiver_id"],
                    amount=row["amount"], timestamp=row["timestamp"],
                    txn_id=row["transaction_id"])

    account_patterns: Dict[str, List[str]] = defaultdict(list)
    rings: List[dict] = []

    # --- 1. Circular fund routing (cycles length 3-5) ---
    cycle_rings = _detect_cycles(G)
    for cycle_members in cycle_rings:
        ring = {"members": sorted(cycle_members), "pattern_type": "cycle"}
        rings.append(ring)
        clen = len(cycle_members)
        for acc in cycle_members:
            pat = f"cycle_length_{clen}"
            if pat not in account_patterns[acc]:
                account_patterns[acc].append(pat)

    # --- 2. Smurfing (fan-in / fan-out) with 72h window ---
    smurf_rings = _detect_smurfing(df)
    for smurf in smurf_rings:
        ring = {"members": sorted(smurf["members"]), "pattern_type": smurf["pattern_type"]}
        rings.append(ring)
        for acc in smurf["members"]:
            pat = smurf["pattern_type"]
            if pat not in account_patterns[acc]:
                account_patterns[acc].append(pat)

    # --- 3. Layered shell networks ---
    shell_rings = _detect_shell_networks(df, G)
    for shell_members in shell_rings:
        ring = {"members": sorted(shell_members), "pattern_type": "layered_shell"}
        rings.append(ring)
        for acc in shell_members:
            if "layered_shell" not in account_patterns[acc]:
                account_patterns[acc].append("layered_shell")

    # Deduplicate rings by sorted member tuple + pattern
    seen = set()
    unique_rings = []
    for r in rings:
        key = (tuple(r["members"]), r["pattern_type"])
        if key not in seen:
            seen.add(key)
            unique_rings.append(r)

    return unique_rings, dict(account_patterns)


def _detect_cycles(G: nx.DiGraph) -> List[Set[str]]:
    """Detect directed cycles of length 3 to 5."""
    cycles = []
    seen_sets = set()

    for cycle in nx.simple_cycles(G, length_bound=5):
        if len(cycle) < 3:
            continue
        fs = frozenset(cycle)
        if fs not in seen_sets:
            seen_sets.add(fs)
            cycles.append(set(cycle))

    return cycles


def _detect_smurfing(df: pd.DataFrame) -> List[dict]:
    """Detect fan-in and fan-out patterns with 72-hour rolling windows."""
    results = []
    df_sorted = df.sort_values("timestamp")

    # Fan-in: 10+ unique senders to one receiver within 72h
    fan_in_candidates = df_sorted.groupby("receiver_id")["sender_id"].nunique()
    fan_in_candidates = fan_in_candidates[fan_in_candidates >= 10].index.tolist()

    for receiver in fan_in_candidates:
        sub = df_sorted[df_sorted["receiver_id"] == receiver].copy()
        sub = sub.set_index("timestamp").sort_index()
        # Use 72h rolling window
        window_senders = set()
        txns = sub.reset_index()
        for i, row in txns.iterrows():
            window_start = row["timestamp"] - pd.Timedelta(hours=72)
            window_txns = txns[(txns["timestamp"] >= window_start) & (txns["timestamp"] <= row["timestamp"])]
            senders_in_window = set(window_txns["sender_id"].unique())
            if len(senders_in_window) >= 10:
                window_senders = senders_in_window
                break

        if len(window_senders) >= 10:
            members = window_senders | {receiver}
            results.append({"members": members, "pattern_type": "fan_in"})

    # Fan-out: 1 sender to 10+ unique receivers within 72h
    fan_out_candidates = df_sorted.groupby("sender_id")["receiver_id"].nunique()
    fan_out_candidates = fan_out_candidates[fan_out_candidates >= 10].index.tolist()

    for sender in fan_out_candidates:
        sub = df_sorted[df_sorted["sender_id"] == sender].copy()
        txns = sub.reset_index(drop=True)
        for i, row in txns.iterrows():
            window_start = row["timestamp"] - pd.Timedelta(hours=72)
            window_txns = txns[(txns["timestamp"] >= window_start) & (txns["timestamp"] <= row["timestamp"])]
            receivers_in_window = set(window_txns["receiver_id"].unique())
            if len(receivers_in_window) >= 10:
                members = receivers_in_window | {sender}
                results.append({"members": members, "pattern_type": "fan_out"})
                break

    return results


def _detect_shell_networks(df: pd.DataFrame, G: nx.DiGraph) -> List[Set[str]]:
    """Detect chains of 3+ hops where intermediates have 2-3 total transactions."""
    # Count total transactions per account (as sender or receiver)
    tx_counts = defaultdict(int)
    for _, row in df.iterrows():
        tx_counts[row["sender_id"]] += 1
        tx_counts[row["receiver_id"]] += 1

    # Identify shell accounts: only 2-3 total transactions
    shell_accounts = {acc for acc, cnt in tx_counts.items() if 2 <= cnt <= 3}

    if not shell_accounts:
        return []

    # Build time-sorted edge list for path finding
    edges_by_time = df.sort_values("timestamp")[["sender_id", "receiver_id", "timestamp"]].values.tolist()

    # Find chains of 3+ hops through shell intermediaries
    chains = []
    seen = set()

    # Start from all nodes, not just shell accounts
    for start_node in G.nodes():
        visited = {start_node}
        chain = [start_node]
        _find_shell_chains(G, start_node, shell_accounts, visited, chain, chains, seen, depth=0)

    return chains


def _find_shell_chains(G, current, shell_accounts, visited, chain, results, seen, depth=0):
    """Recursively find chains through shell accounts."""
    if depth > 6:
        return

    for neighbor in G.successors(current):
        if neighbor in visited:
            continue

        new_chain = chain + [neighbor]
        visited_copy = visited | {neighbor}

        # A valid shell chain: 3+ hops (4+ nodes) with at least 1 shell intermediate
        if len(new_chain) >= 4:
            intermediates = new_chain[1:-1]
            shell_intermediates = [a for a in intermediates if a in shell_accounts]
            if len(shell_intermediates) >= 1:
                fs = frozenset(new_chain)
                if fs not in seen:
                    seen.add(fs)
                    results.append(set(new_chain))

        _find_shell_chains(G, neighbor, shell_accounts, visited_copy, new_chain, results, seen, depth + 1)
