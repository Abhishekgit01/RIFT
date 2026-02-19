import requests


def main() -> None:
    with open(r"D:\Project\Money Mule\test_data.csv", "rb") as f:
        r = requests.post(
            "http://localhost:8000/analyze",
            files={"file": ("test.csv", f, "text/csv")},
            timeout=30,
        )
    print("Status:", r.status_code)
    print("Body:", r.text[:2000])


if __name__ == "__main__":
    main()
