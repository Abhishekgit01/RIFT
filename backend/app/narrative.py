"""
AI Risk Narrative generator: produces plain-English explanations
for flagged accounts using rule-based NLG (no LLM required).
"""
from typing import Dict, List


PATTERN_EXPLANATIONS = {
    "cycle_length_3": "participates in a 3-account circular transfer loop — funds return to origin through intermediaries",
    "cycle_length_4": "is part of a 4-account fund rotation ring, adding distance between source and destination",
    "cycle_length_5": "belongs to a complex 5-account cycle, a sophisticated layering structure",
    "fan_in": "receives deposits from 10+ unique accounts within a 72-hour window — classic fund collection/structuring",
    "fan_out": "disperses funds to 10+ unique accounts within 72 hours — consistent with distribution-phase laundering",
    "layered_shell": "routes money through shell accounts that have only 2-3 lifetime transactions — throwaway intermediaries",
    "high_velocity": "shows abnormally high transaction velocity (>20 txn/day), suggesting automated or bot-driven activity",
    "small_amounts": "operates with unusually small average amounts (<$500), a common structuring tactic to avoid reporting thresholds",
    "high_betweenness": "sits at a critical junction in the transaction network, bridging multiple account clusters — hallmark of a mule intermediary",
    "high_pagerank": "is a high-flow node receiving significant transaction volume from multiple sources across the network",
}

RISK_LEVELS = [
    (80, "CRITICAL", "immediate investigation and potential account freeze"),
    (60, "HIGH", "priority review by compliance team within 24 hours"),
    (40, "ELEVATED", "enhanced monitoring and secondary review"),
    (25, "MODERATE", "flagged for routine compliance review"),
]

RING_PATTERN_DESC = {
    "cycle": "circular fund routing ring",
    "fan_in": "fund collection (smurfing) network",
    "fan_out": "fund distribution network",
    "layered_shell": "layered shell company network",
}


def generate_narrative(account: dict, ring_info: dict = None, profile: dict = None) -> dict:
    """
    Generate a plain-English risk narrative for a flagged account.
    
    Args:
        account: dict with account_id, suspicion_score, detected_patterns, ring_id
        ring_info: optional dict with ring_id, member_accounts, pattern_type, risk_score
        profile: optional dict with velocity, avg_amount, counterparty_count, etc.
    
    Returns:
        dict with narrative, risk_level, recommendation, key_findings
    """
    score = account["suspicion_score"]
    patterns = account["detected_patterns"]
    acc_id = account["account_id"]
    ring_id = account.get("ring_id", "NONE")

    # Determine risk level
    risk_level = "LOW"
    action = "no immediate action required"
    for threshold, level, rec in RISK_LEVELS:
        if score >= threshold:
            risk_level = level
            action = rec
            break

    # Build key findings
    findings = []
    for pat in patterns:
        explanation = PATTERN_EXPLANATIONS.get(pat, f"flagged for {pat.replace('_', ' ')} pattern")
        findings.append(f"This account {explanation}.")

    # Build narrative paragraphs
    paragraphs = []

    # Opening
    paragraphs.append(
        f"Account {acc_id} has been flagged with a suspicion score of {score}/100, "
        f"classified as {risk_level} risk. "
        f"The forensic engine detected {len(patterns)} suspicious pattern{'s' if len(patterns) != 1 else ''} "
        f"associated with this account."
    )

    # Pattern details
    if patterns:
        pattern_desc = []
        for pat in patterns:
            exp = PATTERN_EXPLANATIONS.get(pat, pat.replace("_", " "))
            pattern_desc.append(exp)
        paragraphs.append(
            f"Specifically, this account {'; and '.join(pattern_desc)}."
        )

    # Ring context
    if ring_id != "NONE" and ring_info:
        ring_type = RING_PATTERN_DESC.get(ring_info.get("pattern_type", ""), "fraud ring")
        member_count = len(ring_info.get("member_accounts", []))
        ring_score = ring_info.get("risk_score", 0)
        paragraphs.append(
            f"This account is a member of {ring_id}, a {ring_type} "
            f"comprising {member_count} accounts with a collective risk score of {ring_score}/100. "
            f"The coordinated activity pattern across these accounts strengthens the confidence of this detection."
        )

    # Velocity/profile context
    if profile:
        velocity = profile.get("velocity", 0)
        avg_amt = profile.get("avg_amount", 0)
        counterparties = profile.get("counterparty_count", 0)
        if velocity > 0 or avg_amt > 0:
            paragraphs.append(
                f"Behavioral profile: {velocity:.1f} transactions/day, "
                f"${avg_amt:,.2f} average transaction size, "
                f"{counterparties} unique counterparties."
            )

    # Recommendation
    paragraphs.append(
        f"Recommended action: {action}."
    )

    return {
        "narrative": " ".join(paragraphs),
        "risk_level": risk_level,
        "recommendation": action,
        "key_findings": findings,
        "pattern_count": len(patterns),
        "score": score,
    }


def generate_all_narratives(result: dict, profiles: dict = None) -> List[dict]:
    """
    Generate narratives for all suspicious accounts.
    """
    if profiles is None:
        profiles = {}

    ring_lookup = {}
    for ring in result.get("fraud_rings", []):
        ring_lookup[ring["ring_id"]] = ring

    narratives = []
    for account in result.get("suspicious_accounts", []):
        ring_id = account.get("ring_id", "NONE")
        ring_info = ring_lookup.get(ring_id)
        profile = profiles.get(account["account_id"])
        narrative = generate_narrative(account, ring_info, profile)
        narrative["account_id"] = account["account_id"]
        narratives.append(narrative)

    return narratives
