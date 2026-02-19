import json
import requests


def main() -> None:
    with open(r"D:\Project\Money Mule\test_data.csv", "rb") as f:
        r = requests.post(
            "http://localhost:8000/analyze",
            files={"file": ("test.csv", f, "text/csv")},
            timeout=30,
        )
    print(r.status_code)
    data = r.json()
    # Check centrality fields exist
    node = data["graph"]["nodes"][0]
    print("Node keys:", list(node.keys()))
    print("Sample node:", json.dumps(node, indent=2))
    print("Rings:", len(data["fraud_rings"]))
    print("Suspicious:", len(data["suspicious_accounts"]))
    if data["suspicious_accounts"]:
        print("Sample account:", json.dumps(data["suspicious_accounts"][0], indent=2))


if __name__ == "__main__":
    main()
