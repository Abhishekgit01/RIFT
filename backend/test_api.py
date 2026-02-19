import requests
import os

os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
r = requests.post(
    "http://localhost:8000/analyze",
    files={"file": ("test.csv", open("test_data.csv", "rb"), "text/csv")},
)
print("Status:", r.status_code)
print("Body:", r.text[:2000])
