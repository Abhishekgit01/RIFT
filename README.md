# Argus Spider — RIFT 2026 Money Muling Detection Engine

Graph Theory / Financial Crime Detection Track submission for **RIFT 2026 Hackathon**.

## Challenge Alignment

This project is built for:
- Money Muling Detection Challenge
- Graph-based ring detection (cycles, smurfing, layered shell networks)
- Web-based workflow with **CSV upload on homepage**
- Interactive graph + ring summary table + downloadable JSON report

## Live Demo URL

- App: `https://argusspider.vercel.app/`
- Backend Health: `https://rift-olive.vercel.app/health`

## Tech Stack

- Frontend: React 18, TypeScript, Vite, Cytoscape.js
- Backend: FastAPI, pandas, NetworkX, NumPy
- Testing: pytest, FastAPI TestClient
- Deployment target: Vercel/Render/Railway compatible

## Input Specification (Implemented)

CSV upload expects these required columns:
- `transaction_id` (string)
- `sender_id` (string)
- `receiver_id` (string)
- `amount` (float)
- `timestamp` (`YYYY-MM-DD HH:MM:SS`)

Validation performed server-side:
- file extension check (`.csv`)
- UTF-8 decoding check
- required column presence
- numeric amount coercion
- strict timestamp format parsing

## Required Outputs (Implemented)

### 1) Interactive Graph Visualization
- All accounts rendered as nodes
- Directed edges as money flow (`sender -> receiver`)
- Detected rings highlighted
- Suspicious nodes visually distinct
- Hover/click details for account-level context

### 2) Downloadable JSON (Exact Required Shape)
Download action outputs this schema:

```json
{
  "suspicious_accounts": [
    {
      "account_id": "ACC_00123",
      "suspicion_score": 87.5,
      "detected_patterns": ["cycle_length_3", "high_velocity"],
      "ring_id": "RING_001"
    }
  ],
  "fraud_rings": [
    {
      "ring_id": "RING_001",
      "member_accounts": ["ACC_00123"],
      "pattern_type": "cycle",
      "risk_score": 95.3
    }
  ],
  "summary": {
    "total_accounts_analyzed": 500,
    "suspicious_accounts_flagged": 15,
    "fraud_rings_detected": 4,
    "processing_time_seconds": 2.3
  }
}
```

Format guarantees:
- deterministic key/field ordering
- `suspicious_accounts` sorted by `suspicion_score` desc
- 1-decimal numeric formatting for score/time fields

### 3) Fraud Ring Summary Table
UI table includes:
- Ring ID
- Pattern Type
- Member Count
- Risk Score
- Member Account IDs (comma-separated)

## Detection Logic

### Circular Fund Routing (Cycles)
- Finds directed cycles length 3–5 using NetworkX (`simple_cycles`, bounded length)
- Flags all accounts in each cycle as ring members

### Smurfing (Fan-in / Fan-out)
- Fan-in: `>=10` unique senders to one receiver
- Fan-out: `>=10` unique receivers from one sender
- Uses 72-hour rolling temporal windows

### Layered Shell Networks
- Detects chains of 3+ hops (4+ nodes)
- Intermediate accounts must be low-activity shell accounts (2–3 transactions)

### False Positive Control
- Merchant-like profile reduction
- Payroll-like profile reduction
- Explicit handling to avoid naive high-volume false flags

## Suspicion Scoring Methodology

Base pattern weights:
- `cycle_length_3`: +35
- `cycle_length_4`: +30
- `cycle_length_5`: +25
- `fan_in`: +30
- `fan_out`: +30
- `layered_shell`: +25

Additional signals:
- high velocity bonus
- small amount bonus
- centrality bonuses (PageRank / betweenness)

False-positive reductions:
- merchant-like behavior: `-30`
- payroll-like behavior: `-25`

Normalization:
- scaled to 0–100
- suspicious threshold currently `>=25`

## Performance Notes

Target requirement: up to 10K transactions within 30s.
Current optimizations include:
- vectorized profile/stat aggregation
- bounded cycle and shell enumeration
- deterministic + lightweight post-processing
- precomputed payroll stats to avoid repeated dataframe scans

## System Architecture

1. Upload CSV in frontend
2. POST to backend `/analyze`
3. Parse + validate input
4. Detect graph patterns (cycle/smurf/shell)
5. Score accounts + assign rings
6. Build output payload + graph structures
7. Render graph/table/dashboard
8. Download exact-format JSON report

## Local Setup

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Tests

```bash
cd backend
pytest tests/test_engine.py -v
```

### Build

```bash
cd frontend
npm run build
```

## Usage

1. Open app home page
2. Upload CSV
3. Run analysis
4. Inspect graph and ring table
5. Download JSON report

## Known Limitations

- Heuristic approach (no supervised ML model)
- Thresholds may need dataset-specific tuning
- Very dense graphs can still stress cycle search despite caps
- API response includes additional UI fields; downloadable report is strict-format

## Submission Checklist (Mandatory)

- [ ] Live deployed web app URL (public, no auth)
- [ ] CSV upload visible on homepage
- [ ] Public GitHub repository
- [ ] Public LinkedIn demo video (2–3 min)
- [ ] LinkedIn tags/hashtags included:
  - `#RIFTHackathon`
  - `#MoneyMulingDetection`
  - `#FinancialCrime`
- [ ] README complete (this file)

## Submission Fields to Fill

- Problem Statement selected: `MONEY MULING DETECTION CHALLENGE`
- GitHub Repo URL: `https://github.com/Abhishekgit01/RIFT`
- Hosted App URL: `https://argusspider.vercel.app/`
- LinkedIn Demo URL: `ADD_LINKEDIN_POST_URL_HERE`
