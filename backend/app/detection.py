"""
Detection module: cycle detection, smurfing, and layered shell networks.
Optimised for ≤30s on 10K-transaction datasets.
"""
import pandas as pd
import networkx as nx
from collections import defaultdict
from typing import Dict, List, Set, Tuple


def detect_all(df: pd.DataFrame) -> Tuple[List[dict], Dict[str, List[str]], Dict[str, dict]]:
    # Build graph using vectorised zip (no iterrows)
    G = nx.DiGraph()
    senders = df["sender_id"].values
    receivers = df["receiver_id"].values
    amounts = df["amount"].values
    timestamps = df["timestamp"].values
    txn_ids = df["transaction_id"].values

    for i in range(len(senders)):
        G.add_edge(senders[i], receivers[i], amount=amounts[i], timestamp=timestamps[i], txn_id=txn_ids[i])

    account_patterns: Dict[str, List[str]] = defaultdict(list)
    rings: List[dict] = []

    # 1. Circular fund routing (cycles 3-5) -- cap at 500 cycles
    cycle_rings = _detect_cycles(G, max_cycles=500)
    for cycle_members in cycle_rings:
        ring = {"members": sorted(cycle_members), "pattern_type": "cycle"}
        rings.append(ring)
        clen = len(cycle_members)
        for acc in cycle_members:
            pat = f"cycle_length_{clen}"
            if pat not in account_patterns[acc]:
                account_patterns[acc].append(pat)

    # 2. Smurfing (fan-in / fan-out)
    smurf_rings = _detect_smurfing(df)
    for smurf in smurf_rings:
        ring = {"members": sorted(smurf["members"]), "pattern_type": smurf["pattern_type"]}
        rings.append(ring)
        for acc in smurf["members"]:
            pat = smurf["pattern_type"]
            if pat not in account_patterns[acc]:
                account_patterns[acc].append(pat)

    # 3. Layered shell networks (iterative DFS, capped)
    shell_rings = _detect_shell_networks(df, G)
    for shell_members in shell_rings:
        ring = {"members": sorted(shell_members), "pattern_type": "layered_shell"}
        rings.append(ring)
        for acc in shell_members:
            if "layered_shell" not in account_patterns[acc]:
                account_patterns[acc].append("layered_shell")

    # Deduplicate & merge overlapping rings — rings that share any
    # member account are merged into a single connected component.
    unique_rings = _merge_overlapping_rings(rings)

    # 4. Graph centrality
    centrality = _compute_centrality(G)

    return unique_rings, dict(account_patterns), centrality


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
    """Merge rings that share any member account.

    Uses Union-Find to group overlapping rings into connected components.
    For each component the representative is the ring with the most members
    (tie-break: alphabetically-first pattern_type).  The merged ring's
    ``members`` list is the union of all members across the component.
    Pattern types are joined with ``+`` when they differ.
    """
    n = len(rings)
    if n == 0:
        return []

    sets = [frozenset(r["members"]) for r in rings]

    # Inverted index: account → ring indices
    acct_to_idx: Dict[str, List[int]] = defaultdict(list)
    for i, s in enumerate(sets):
        for acct in s:
            acct_to_idx[acct].append(i)

    # Union rings sharing at least one account
    uf = _UnionFind(n)
    for indices in acct_to_idx.values():
        for j in range(1, len(indices)):
            uf.union(indices[0], indices[j])

    # Group by component root
    components: Dict[int, List[int]] = defaultdict(list)
    for i in range(n):
        components[uf.find(i)].append(i)

    # Build one merged ring per component
    merged: List[dict] = []
    for member_indices in components.values():
        # Sort: largest member set first
        member_indices.sort(key=lambda i: len(sets[i]), reverse=True)

        all_members: Set[str] = set()
        patterns: List[str] = []
        for i in member_indices:
            all_members |= sets[i]
            pt = rings[i]["pattern_type"]
            if pt not in patterns:
                patterns.append(pt)

        merged.append({
            "members": sorted(all_members),
            "pattern_type": "+".join(patterns) if len(patterns) > 1 else patterns[0],
        })

    return merged


def _detect_cycles(G: nx.DiGraph, max_cycles: int = 500) -> List[Set[str]]:
    cycles = []
    seen_sets = set()
    for cycle in nx.simple_cycles(G, length_bound=5):
        if len(cycle) < 3:
            continue
        fs = frozenset(cycle)
        if fs not in seen_sets:
            seen_sets.add(fs)
            cycles.append(set(cycle))
            if len(cycles) >= max_cycles:
                break
    return cycles


def _detect_smurfing(df: pd.DataFrame) -> List[dict]:
    """Vectorised smurfing detection with 72h rolling windows."""
    results = []
    df_sorted = df.sort_values("timestamp")

    # Fan-in
    fi_counts = df_sorted.groupby("receiver_id")["sender_id"].nunique()
    fi_candidates = fi_counts[fi_counts >= 10].index
    for receiver in fi_candidates:
        sub = df_sorted[df_sorted["receiver_id"] == receiver][["sender_id", "timestamp"]].values
        senders_set = _rolling_window_check(sub, 10)
        if senders_set is not None:
            results.append({"members": senders_set | {receiver}, "pattern_type": "fan_in"})

    # Fan-out
    fo_counts = df_sorted.groupby("sender_id")["receiver_id"].nunique()
    fo_candidates = fo_counts[fo_counts >= 10].index
    for sender in fo_candidates:
        sub = df_sorted[df_sorted["sender_id"] == sender][["receiver_id", "timestamp"]].values
        receivers_set = _rolling_window_check(sub, 10)
        if receivers_set is not None:
            results.append({"members": receivers_set | {sender}, "pattern_type": "fan_out"})

    return results


def _rolling_window_check(arr, threshold: int):
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
    """Iterative DFS for shell chain detection. Capped at 100 chains."""
    tx_counts = defaultdict(int)
    for s, r in zip(df["sender_id"].values, df["receiver_id"].values):
        tx_counts[s] += 1
        tx_counts[r] += 1

    shell_accounts = {acc for acc, cnt in tx_counts.items() if 2 <= cnt <= 3}
    if not shell_accounts:
        return []

    chains: List[Set[str]] = []
    seen: set = set()
    max_chains = 100
    max_depth = 6

    # Iterative DFS with explicit stack
    for start_node in G.nodes():
        if len(chains) >= max_chains:
            break
        # Stack: (current_node, visited_set, chain_list)
        stack = [(start_node, frozenset([start_node]), [start_node])]
        while stack and len(chains) < max_chains:
            current, visited, chain = stack.pop()
            if len(chain) > max_depth:
                continue
            for neighbor in G.successors(current):
                if neighbor in visited:
                    continue
                new_chain = chain + [neighbor]
                new_visited = visited | {neighbor}
                if len(new_chain) >= 4:
                    intermediates = new_chain[1:-1]
                    if intermediates and all(a in shell_accounts for a in intermediates):
                        fs = frozenset(new_chain)
                        if fs not in seen:
                            seen.add(fs)
                            chains.append(set(new_chain))
                            if len(chains) >= max_chains:
                                break
                if len(new_chain) < max_depth:
                    stack.append((neighbor, new_visited, new_chain))

    return chains


def _compute_centrality(G: nx.DiGraph) -> Dict[str, dict]:
    if len(G.nodes()) == 0:
        return {}
    pr = nx.pagerank(G, alpha=0.85, max_iter=50, tol=1e-4)
    # Sample-based betweenness for speed
    k = min(len(G.nodes()), 100)
    bc = nx.betweenness_centrality(G, normalized=True, k=k)
    centrality = {}
    for node in G.nodes():
        centrality[node] = {
            "pagerank": round(pr.get(node, 0), 6),
            "betweenness": round(bc.get(node, 0), 6),
        }
    return centrality
