# Financial Forensics Engine

A web-based application that processes transaction data and detects money muling networks through graph analysis and interactive visualization.

## Live Demo URL

> _Deployed URL will be added after deployment._

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.14, FastAPI, pandas, NetworkX, Pydantic |
| Frontend | React 18, TypeScript, Vite, Cytoscape.js |
| Testing | pytest, FastAPI TestClient |

## System Architecture

```
┌─────────────────────┐     POST /analyze      ┌──────────────────────────────┐
│   React + Vite      │ ──────────────────────> │   FastAPI Backend             │
│   (Cytoscape.js)    │ <────────────────────── │                              │
│   - CSV Upload      │     JSON Response       │   ┌──────────┐              │
│   - Graph View      │                         │   │  Parser   │ CSV → DF     │
│   - Ring Table      │                         │   └────┬─────┘              │
│   - JSON Download   │                         │        │                     │
└─────────────────────┘                         │   ┌────▼─────┐              │
                                                │   │ Detection │              │
                                                │   │ - Cycles  │ NetworkX     │
                                                │   │ - Smurf   │ DiGraph      │
                                                │   │ - Shell   │              │
                                                │   └────┬─────┘              │
                                                │        │                     │
                                                │   ┌────▼─────┐              │
                                                │   │ Scoring   │ FP controls  │
                                                │   └────┬─────┘              │
                                                │        │                     │
                                                │   ┌────▼─────┐              │
                                                │   │  Output   │ JSON builder │
                                                │   └──────────┘              │
                                                └──────────────────────────────┘
```

## Algorithm Approach

### 1. Circular Fund Routing (Cycle Detection)

- **Method**: Uses NetworkX `simple_cycles()` with `length_bound=5` to find all directed cycles of length 3-5.
- **Complexity**: O(V + E) per cycle enumeration bounded by length. The Johnson's algorithm variant used internally is O((V+E)(C+1)) where C is the number of circuits.
- **Rationale**: Cycles represent money flowing in loops (A -> B -> C -> A) to obscure origin.

### 2. Smurfing Detection (Fan-in / Fan-out)

- **Method**: Groups transactions by receiver (fan-in) or sender (fan-out) and checks if 10+ unique counterparties exist within any 72-hour rolling window.
- **Complexity**: O(n log n) for sorting + O(n * w) for window scanning where w is window size.
- **Rationale**: Many small deposits aggregated into one account then quickly dispersed indicates structuring to avoid reporting thresholds.

### 3. Layered Shell Networks

- **Method**: Identifies "shell accounts" (2-3 total transactions), then finds chains of 3+ hops through these intermediaries using DFS with depth limit 6.
- **Complexity**: O(V * b^d) where b is branching factor and d is max depth (capped at 6).
- **Rationale**: Money passing through thin-activity intermediaries suggests layering.

## Suspicion Score Methodology

### Base Scores (per pattern detected)

| Pattern | Base Score |
|---------|-----------|
| `cycle_length_3` | 35.0 |
| `cycle_length_4` | 30.0 |
| `cycle_length_5` | 25.0 |
| `fan_in` | 30.0 |
| `fan_out` | 30.0 |
| `layered_shell` | 25.0 |

### Bonuses

- **High velocity** (>20 txns/24h): +10.0
- **Small amounts** (avg < $500): +5.0

### False-Positive Reductions

- **Merchant-like** (15+ counterparties, 7+ days active, receive >> send, no cycles): -30.0
- **Payroll-like** (5+ sends, CV of amounts < 0.15, regular time gaps CV < 0.3): -25.0

### Normalization

Raw scores are normalized to 0-100 scale: `min(100, (raw / max_raw) * 100)`.

### Threshold

Accounts with normalized score < **25.0** are not flagged. This threshold balances recall (catching most suspicious accounts) with precision (not over-flagging).

## Installation & Setup

### Prerequisites

- Python 3.11+
- Node.js 18+ or Bun

### Backend

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### Frontend

```bash
cd frontend
bun install   # or npm install
bun run dev   # or npm run dev
```

The frontend runs on `http://localhost:5173` and proxies API calls to the backend on port 8000.

### Running Tests

```bash
cd backend
pytest tests/test_engine.py -v
```

## Usage Instructions

1. Open the application in your browser at `http://localhost:5173`.
2. Click "Choose CSV File" and select a CSV file with columns: `transaction_id`, `sender_id`, `receiver_id`, `amount`, `timestamp`.
3. Click "Analyze Transactions".
4. View results:
   - **Summary cards**: Total accounts, suspicious accounts, fraud rings, processing time.
   - **Interactive graph**: Nodes are accounts, edges are transactions. Suspicious nodes are larger and colored by ring. Hover for details.
   - **Fraud ring table**: Ring ID, pattern type, member count, risk score, member accounts.
5. Click "Download JSON Report" to export the analysis results.
6. Click "New Analysis" to start over.

## CSV Input Format

```csv
transaction_id,sender_id,receiver_id,amount,timestamp
TXN_001,ACC_001,ACC_002,500.00,2024-01-15 10:00:00
```

| Column | Type | Format |
|--------|------|--------|
| transaction_id | String | Unique identifier |
| sender_id | String | Sender account ID |
| receiver_id | String | Receiver account ID |
| amount | Float | Currency units |
| timestamp | DateTime | YYYY-MM-DD HH:MM:SS |

## Known Limitations

1. **Scale**: Optimized for up to 10K transactions. Larger datasets may exceed the 30-second target due to cycle enumeration.
2. **Single-edge graph**: Multiple transactions between the same pair are collapsed into a single edge in cycle detection (but all are counted for scoring).
3. **Static thresholds**: Fan-in/fan-out threshold of 10 and shell account threshold of 2-3 transactions are fixed; real-world tuning may be needed.
4. **No ML component**: Detection relies entirely on heuristic graph patterns. A production system would benefit from supervised learning on labeled data.
5. **Currency agnostic**: No currency conversion or amount normalization across different currencies.
6. **No persistence**: Results are not stored between sessions.

