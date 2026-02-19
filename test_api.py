import requests

r = requests.post(
    "http://localhost:8000/analyze",
    files={"file": ("test.csv", open(r"D:\Project\Money Mule\test_data.csv", "rb"), "text/csv")},
)
print(r.status_code)
import json
data = r.json()
# Check centrality fields exist
node = data["graph"]["nodes"][0]
print("Node keys:", list(node.keys()))
print("Sample node:", json.dumps(node, indent=2))
print("Rings:", len(data["fraud_rings"]))
print("Suspicious:", len(data["suspicious_accounts"]))
if data["suspicious_accounts"]:
    print("Sample account:", json.dumps(data["suspicious_accounts"][0], indent=2))
