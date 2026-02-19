import requests

r = requests.post(
    "http://localhost:8000/analyze",
    files={"file": ("test.csv", open(r"D:\Project\Money Mule\test_data.csv", "rb"), "text/csv")},
)
print("Status:", r.status_code)
print("Body:", r.text[:2000])
