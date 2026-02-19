import io
import pandas as pd
from fastapi import HTTPException

REQUIRED_COLUMNS = ["transaction_id", "sender_id", "receiver_id", "amount", "timestamp"]


def parse_csv(text: str) -> pd.DataFrame:
    """Parse and validate the uploaded CSV text."""
    try:
        df = pd.read_csv(io.StringIO(text))
    except Exception as e:
        raise HTTPException(400, f"Cannot parse CSV: {e}")

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise HTTPException(400, f"Missing columns: {', '.join(missing)}")

    # Type coercion
    df["transaction_id"] = df["transaction_id"].astype(str)
    df["sender_id"] = df["sender_id"].astype(str)
    df["receiver_id"] = df["receiver_id"].astype(str)

    try:
        df["amount"] = pd.to_numeric(df["amount"], errors="raise")
    except (ValueError, TypeError):
        raise HTTPException(400, "Column 'amount' must be numeric")

    try:
        df["timestamp"] = pd.to_datetime(df["timestamp"], format="%Y-%m-%d %H:%M:%S")
    except Exception:
        raise HTTPException(400, "Column 'timestamp' must be YYYY-MM-DD HH:MM:SS format")

    if df["amount"].isna().any():
        raise HTTPException(400, "Column 'amount' contains invalid values")

    return df
