"""
Detection module: cycle detection, smurfing, and layered shell networks.
Optimised for ≤30s on 10K-transaction datasets.
"""
import pandas as pd
import networkx as nx
from collections import defaultdict
from typing import Dict, List, Set, Tuple


def detect_all(df: pd.DataFrame) -> Tuple[List[dict], Dict[str, List[str]], Dict[str, dict]]:
    G = nx.DiGraph()
    for s, r, a, ts, tid in zip(
        df["sender_id"], df["receiver_id"], df["amount"],
        df["timestamp"], df["transaction_id"]
    ):
        G.add_edge(s, r, amount=a, timestamp=ts, txn_id=tid)

    account_patterns: Dict[str, List[str]] = defaultdict(list)
    rings: List[dict] = []

    # 1. Circular fund routing (cycles length 3-5)
    cycle_rings = _detect_cycles(G)
    for cycle_members in cycle_rings:
        ring = {"members": sorted(cycle_members), "pattern_type": "cycle"}
        rings.append(ring)
        clen = len(cycle_members)
        for acc in cycle_members:
            pat = f"cycle_length_{clen}"
            if pat not in account_patterns[acc]:
                account_patterns[acc].append(pat)

    # 2. Smurfing (fan-in / fan-out) with 72h window
    smurf_rings = _detect_smurfing(df)
    for smurf in smurf_rings:
        ring = {"members": sorted(smurf["members"]), "pattern_type": smurf["pattern_type"]}
        rings.append(ring)
        for acc in smurf["members"]:
            pat = smurf["pattern_type"]
            if pat not in account_patterns[acc]:
                account_patterns[acc].append(pat)

    # 3. Layered shell networks
    shell_rings = _detect_shell_networks(df, G)
    for shell_members in shell_rings:
        ring = {"members": sorted(shell_members), "pattern_type": "layered_shell"}
        rings.append(ring)
        for acc in shell_members:
            if "layered_shell" not in account_patterns[acc]:
                account_patterns[acc].append("layered_shell")

    # Deduplicate rings
    seen = set()
    unique_rings = []
    for r in rings:
        key = (tuple(r["members"]), r["pattern_type"])
        if key not in seen:
            seen.add(key)
            unique_rings.append(r)

    # 4. Graph centrality
    centrality = _compute_centrality(G)

    return unique_rings, dict(account_patterns), centrality


def _detect_cycles(G: nx.DiGraph) -> List[Set[str]]:
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
    """Vectorised smurfing detection with 72h rolling windows."""
    results = []
    df_sorted = df.sort_values("timestamp")

    # ---- Fan-in ----
    fi_counts = df_sorted.groupby("receiver_id")["sender_id"].nunique()
    fi_candidates = fi_counts[fi_counts >= 10].index

    for receiver in fi_candidates:
        sub = df_sorted[df_sorted["receiver_id"] == receiver][["sender_id", "timestamp"]].values
        senders_set = _rolling_window_check(sub, 10)
        if senders_set is not None:
            results.append({"members": senders_set | {receiver}, "pattern_type": "fan_in"})

    # ---- Fan-out ----
    fo_counts = df_sorted.groupby("sender_id")["receiver_id"].nunique()
    fo_candidates = fo_counts[fo_counts >= 10].index

    for sender in fo_candidates:
        sub = df_sorted[df_sorted["sender_id"] == sender][["receiver_id", "timestamp"]].values
        receivers_set = _rolling_window_check(sub, 10)
        if receivers_set is not None:
            results.append({"members": receivers_set | {sender}, "pattern_type": "fan_out"})

    return results


def _rolling_window_check(arr, threshold: int):
    """Sliding-window counterparty check on pre-sorted numpy array (id, timestamp)."""
    n = len(arr)
    if n < threshold:
        return None
    window_td = pd.Timedelta(hours=72)
    left = 0
    ids_in_window: dict = defaultdict(int)
    unique_count = 0
    for right in range(n):
        cid = arr[right, 0]
        ids_in_window[cid] += 1
        if ids_in_window[cid] == 1:
            unique_count += 1
        # Shrink left
        while (arr[right, 1] - arr[left, 1]) > window_td:
            lid = arr[left, 0]
            ids_in_window[lid] -= 1
            if ids_in_window[lid] == 0:
                unique_count -= 1
                del ids_in_window[lid]
            left += 1
        if unique_count >= threshold:
            return set(ids_in_window.keys())
    return None


def _detect_shell_networks(df: pd.DataFrame, G: nx.DiGraph) -> List[Set[str]]:
    """Detect chains of 4+ nodes through shell intermediaries. Capped for performance."""
    tx_counts = defaultdict(int)
    for s, r in zip(df["sender_id"], df["receiver_id"]):
        tx_counts[s] += 1
        tx_counts[r] += 1

    shell_accounts = {acc for acc, cnt in tx_counts.items() if 2 <= cnt <= 3}
    if not shell_accounts:
        return []

    chains: List[Set[str]] = []
    seen: set = set()
    max_chains = 200

    for start_node in G.nodes():
        if len(chains) >= max_chains:
            break
        _find_shell_chains(G, start_node, shell_accounts, {start_node}, [start_node], chains, seen, 0, max_chains)

    return chains


def _find_shell_chains(G, current, shell_accounts, visited, chain, results, seen, depth, max_chains):
    if depth > 6 or len(results) >= max_chains:
        return
    for neighbor in G.successors(current):
        if neighbor in visited or len(results) >= max_chains:
            continue
        new_chain = chain + [neighbor]
        new_visited = visited | {neighbor}
        if len(new_chain) >= 4:
            intermediates = new_chain[1:-1]
            if any(a in shell_accounts for a in intermediates):
                fs = frozenset(new_chain)
                if fs not in seen:
                    seen.add(fs)
                    results.append(set(new_chain))
        _find_shell_chains(G, neighbor, shell_accounts, new_visited, new_chain, results, seen, depth + 1, max_chains)


def _compute_centrality(G: nx.DiGraph) -> Dict[str, dict]:
    if len(G.nodes()) == 0:
        return {}
    pr = nx.pagerank(G, alpha=0.85, max_iter=100)
    # Use approximate betweenness for large graphs (sample k nodes)
    k = min(len(G.nodes()), 200)
    bc = nx.betweenness_centrality(G, normalized=True, k=k)
    centrality = {}
    for node in G.nodes():
        centrality[node] = {
            "pagerank": round(pr.get(node, 0), 6),
            "betweenness": round(bc.get(node, 0), 6),
        }
    return centrality
