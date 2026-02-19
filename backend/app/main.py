from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import time
from .parser import parse_csv
from .detection import detect_all
from .scoring import compute_scores
from .output import build_output

app = FastAPI(title="Financial Forensics Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
async def analyze(file: UploadFile = File(...)):
    start = time.time()

    if not file.filename or not file.filename.endswith(".csv"):
        raise HTTPException(400, "File must be a .csv")

    content = await file.read()
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "File must be UTF-8 encoded")

    df = parse_csv(text)
    rings, account_patterns = detect_all(df)
    result = compute_scores(df, rings, account_patterns)
    elapsed = round(time.time() - start, 1)
    output = build_output(df, result, elapsed)

    return output
