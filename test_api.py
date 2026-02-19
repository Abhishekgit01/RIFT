import httpx
import json

r = httpx.post(
    "http://localhost:8000/analyze",
    files={"file": ("fixture.csv", open("backend/tests/fixture.csv", "rb"), "text/csv")},
)
print(f"Status: {r.status_code}")
data = r.json()
print(f"Accounts analyzed: {data['summary']['total_accounts_analyzed']}")
print(f"Suspicious flagged: {data['summary']['suspicious_accounts_flagged']}")
print(f"Rings detected: {data['summary']['fraud_rings_detected']}")
print(f"Processing time: {data['summary']['processing_time_seconds']}s")
print(f"\nFraud rings:")
for ring in data["fraud_rings"]:
    print(f"  {ring['ring_id']}: {ring['pattern_type']} - {ring['member_accounts']} (risk: {ring['risk_score']})")
print(f"\nSuspicious accounts:")
for acc in data["suspicious_accounts"][:10]:
    print(f"  {acc['account_id']}: score={acc['suspicion_score']}, patterns={acc['detected_patterns']}, ring={acc['ring_id']}")
