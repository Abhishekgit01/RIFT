"""
Unit and integration tests for the Financial Forensics Engine.
"""
import os
import json
import pytest
import pandas as pd
from fastapi.testclient import TestClient

# Add parent to path
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.main import app
from app.parser import parse_csv
from app.detection import _detect_cycles, _detect_smurfing, _detect_shell_networks, detect_all
from app.scoring import compute_scores, _is_merchant_like, _is_payroll_like
import networkx as nx


FIXTURE_PATH = os.path.join(os.path.dirname(__file__), "fixture.csv")

client = TestClient(app)


# ---- Parser tests ----

def test_parse_csv_valid():
    with open(FIXTURE_PATH) as f:
        df = parse_csv(f.read())
    assert len(df) > 0
    assert list(df.columns) == ["transaction_id", "sender_id", "receiver_id", "amount", "timestamp"]
    assert df["amount"].dtype == float


def test_parse_csv_missing_column():
    csv_text = "transaction_id,sender_id,amount,timestamp\nT1,A,100,2024-01-01 00:00:00"
    with pytest.raises(Exception):
        parse_csv(csv_text)


def test_parse_csv_bad_amount():
    csv_text = "transaction_id,sender_id,receiver_id,amount,timestamp\nT1,A,B,notanumber,2024-01-01 00:00:00"
    with pytest.raises(Exception):
        parse_csv(csv_text)


def test_parse_csv_bad_timestamp():
    csv_text = "transaction_id,sender_id,receiver_id,amount,timestamp\nT1,A,B,100,not-a-date"
    with pytest.raises(Exception):
        parse_csv(csv_text)


# ---- Cycle detection tests ----

def test_detect_cycle_triangle():
    G = nx.DiGraph()
    G.add_edge("A", "B")
    G.add_edge("B", "C")
    G.add_edge("C", "A")
    cycles = _detect_cycles(G)
    assert len(cycles) >= 1
    assert {"A", "B", "C"} in cycles


def test_detect_cycle_length_4():
    G = nx.DiGraph()
    G.add_edge("A", "B")
    G.add_edge("B", "C")
    G.add_edge("C", "D")
    G.add_edge("D", "A")
    cycles = _detect_cycles(G)
    member_sets = [set(c) for c in cycles]
    assert {"A", "B", "C", "D"} in member_sets


def test_no_cycle_in_chain():
    G = nx.DiGraph()
    G.add_edge("A", "B")
    G.add_edge("B", "C")
    G.add_edge("C", "D")
    cycles = _detect_cycles(G)
    assert len(cycles) == 0


# ---- Smurfing detection tests ----

def test_detect_fan_in():
    rows = []
    for i in range(12):
        rows.append({
            "transaction_id": f"T{i}",
            "sender_id": f"S{i}",
            "receiver_id": "HUB",
            "amount": 50.0,
            "timestamp": pd.Timestamp("2024-01-15 10:00:00") + pd.Timedelta(hours=i),
        })
    df = pd.DataFrame(rows)
    results = _detect_smurfing(df)
    fan_in = [r for r in results if r["pattern_type"] == "fan_in"]
    assert len(fan_in) >= 1
    assert "HUB" in fan_in[0]["members"]


def test_detect_fan_out():
    rows = []
    for i in range(12):
        rows.append({
            "transaction_id": f"T{i}",
            "sender_id": "HUB",
            "receiver_id": f"R{i}",
            "amount": 50.0,
            "timestamp": pd.Timestamp("2024-01-15 10:00:00") + pd.Timedelta(hours=i),
        })
    df = pd.DataFrame(rows)
    results = _detect_smurfing(df)
    fan_out = [r for r in results if r["pattern_type"] == "fan_out"]
    assert len(fan_out) >= 1
    assert "HUB" in fan_out[0]["members"]


# ---- Shell network tests ----

def test_detect_shell_basic():
    """Shell accounts with 2-3 transactions in a chain."""
    rows = [
        {"transaction_id": "T1", "sender_id": "SRC", "receiver_id": "SHELL1", "amount": 100, "timestamp": pd.Timestamp("2024-01-15 10:00:00")},
        {"transaction_id": "T2", "sender_id": "SHELL1", "receiver_id": "SHELL2", "amount": 95, "timestamp": pd.Timestamp("2024-01-15 11:00:00")},
        {"transaction_id": "T3", "sender_id": "SHELL2", "receiver_id": "DEST", "amount": 90, "timestamp": pd.Timestamp("2024-01-15 12:00:00")},
    ]
    df = pd.DataFrame(rows)
    G = nx.DiGraph()
    for r in rows:
        G.add_edge(r["sender_id"], r["receiver_id"])
    shells = _detect_shell_networks(df, G)
    # SHELL1 and SHELL2 each have 2 transactions => shell accounts
    # We should find at least the chain
    assert len(shells) >= 1


# ---- Scoring tests ----

def test_scoring_output_format():
    with open(FIXTURE_PATH) as f:
        df = parse_csv(f.read())
    rings, patterns, centrality = detect_all(df)
    result = compute_scores(df, rings, patterns, centrality)
    assert "suspicious_accounts" in result
    assert "fraud_rings" in result
    for acc in result["suspicious_accounts"]:
        assert "account_id" in acc
        assert "suspicion_score" in acc
        assert "detected_patterns" in acc
        assert "ring_id" in acc
        assert 0 <= acc["suspicion_score"] <= 100


def test_scoring_sorted():
    with open(FIXTURE_PATH) as f:
        df = parse_csv(f.read())
    rings, patterns, centrality = detect_all(df)
    result = compute_scores(df, rings, patterns, centrality)
    scores = [a["suspicion_score"] for a in result["suspicious_accounts"]]
    assert scores == sorted(scores, reverse=True)


# ---- JSON schema test ----

def test_json_schema():
    with open(FIXTURE_PATH) as f:
        df = parse_csv(f.read())
    rings, patterns, centrality = detect_all(df)
    result = compute_scores(df, rings, patterns, centrality)
    from app.output import build_output
    output = build_output(df, result, 1.0, centrality)

    # Validate top-level keys
    assert "suspicious_accounts" in output
    assert "fraud_rings" in output
    assert "summary" in output
    assert "graph" in output

    # Validate summary
    s = output["summary"]
    assert "total_accounts_analyzed" in s
    assert "suspicious_accounts_flagged" in s
    assert "fraud_rings_detected" in s
    assert "processing_time_seconds" in s

    # Ring IDs should be deterministic
    for ring in output["fraud_rings"]:
        assert ring["ring_id"].startswith("RING_")
        assert ring["member_accounts"] == sorted(ring["member_accounts"])


# ---- Integration test ----

def test_integration_upload():
    with open(FIXTURE_PATH, "rb") as f:
        response = client.post("/analyze", files={"file": ("fixture.csv", f, "text/csv")})
    assert response.status_code == 200
    data = response.json()
    assert "suspicious_accounts" in data
    assert "fraud_rings" in data
    assert "summary" in data
    assert data["summary"]["total_accounts_analyzed"] > 0

    # Cycle ring (ACC_001, ACC_002, ACC_003) should be detected
    flagged_ids = {a["account_id"] for a in data["suspicious_accounts"]}
    ring_members = set()
    for ring in data["fraud_rings"]:
        ring_members.update(ring["member_accounts"])

    # The triangle ACC_001->ACC_002->ACC_003->ACC_001 should be detected
    assert "ACC_001" in ring_members or "ACC_001" in flagged_ids


def test_integration_invalid_file():
    response = client.post("/analyze", files={"file": ("test.txt", b"not csv", "text/plain")})
    assert response.status_code == 400
