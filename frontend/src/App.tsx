import React, { useState, useEffect, useRef } from 'react'
import type { AnalysisResult } from './types'
import GraphView from './GraphView'
import RingTable from './RingTable'
import AccountDetailPanel from './AccountDetailPanel'
import Dashboard from './Dashboard'

import SankeyDiagram from './SankeyDiagram'
import ScanLoader from './ScanLoader'

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

const protocols = [
  { num: '01', color: '#ff003c', title: 'Circular Fund Routing', size: 'wide' as const,
    icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/><circle cx="12" cy="12" r="2"/></svg>,
    brief: 'Detects closed-loop transfers between 3-5 accounts forming fraud rings.',
    desc: 'Our engine builds a directed transaction graph and runs cycle detection (NetworkX simple_cycles) to find closed loops of length 3-5. When Account A sends to B, B to C, and C back to A, that circular pattern is a strong indicator of coordinated money laundering.',
    detail: 'Directed cycle enumeration with length_bound=5. Deduplication via frozenset hashing. Each cycle assigned unique RING_ID.',
    tags: ['cycle_3 +35pts', 'cycle_4 +30pts', 'cycle_5 +25pts'],
    how: ['Build directed graph from sender → receiver pairs', 'Run simple_cycles with length_bound=5', 'Deduplicate via frozenset hashing', 'Assign RING_ID to each unique cycle', 'Score: 3-node +35, 4-node +30, 5-node +25'],
    example: 'A sends $5,000 to B → B sends $4,800 to C → C sends $4,600 back to A. The $200 decrements are mule commissions.',
  },
  { num: '02', color: '#00ff9d', title: 'Smurfing Detection', size: 'normal' as const,
    icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
    brief: 'Flags structuring — funds split across 10+ accounts in 72h windows.',
    desc: 'Detects structuring attacks where funds are split across many accounts to avoid detection thresholds. Fan-in: 10+ unique senders deposit into one account within 72 hours. Fan-out: one account disperses to 10+ receivers.',
    detail: '72-hour rolling window analysis. Flags both collection (fan_in) and distribution (fan_out) patterns independently.',
    tags: ['fan_in +30pts', 'fan_out +30pts', '72h window'],
    how: ['Group transactions by receiver (fan-in) and sender (fan-out)', 'Sort by timestamp, apply 72h sliding window', 'Count unique counterparties per window', '10+ counterparties in any window → flag', 'fan_in and fan_out scored at +30pts each'],
    example: '12 accounts deposit $800-$900 into Account X within 48h. Each below $1,000 thresholds — classic structuring.',
  },
  { num: '03', color: '#00f3ff', title: 'Velocity Profiling', size: 'normal' as const,
    icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>,
    brief: 'Profiles txn speed per account — flags >20 txn/day bot behavior.',
    desc: 'Each account is profiled by transactions-per-24-hours. Accounts exceeding 20 txn/day get +10pts. Combined with small amounts (<$500 avg), this catches automated bot-driven laundering.',
    detail: 'velocity = total_txns / (span_hours / 24). Threshold >20 = high_velocity. Small amounts <$500 avg = +5pts bonus.',
    tags: ['high_velocity +10pts', 'small_amounts +5pts', '24h norm'],
    how: ['Count total txns (sent + received) per account', 'Compute time span first→last in hours', 'Normalize: velocity = txns / (hours / 24)', 'Flag if >20 transactions per day', 'Avg amount <$500 adds +5pts bonus'],
    example: 'Account Z: 87 txns in 3 days (29/day), averaging $340. High frequency + low amounts = bot laundering.',
  },
  { num: '04', color: '#3daa5c', title: 'Graph Centrality', size: 'tall' as const,
    icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><circle cx="4" cy="6" r="2"/><circle cx="20" cy="6" r="2"/><circle cx="4" cy="18" r="2"/><circle cx="20" cy="18" r="2"/><line x1="6" y1="7" x2="9.5" y2="10.5"/><line x1="18" y1="7" x2="14.5" y2="10.5"/><line x1="6" y1="17" x2="9.5" y2="13.5"/><line x1="18" y1="17" x2="14.5" y2="13.5"/></svg>,
    brief: 'PageRank + betweenness to find intermediary mule nodes.',
    desc: 'Computes PageRank (alpha=0.85) and Betweenness Centrality across the network. High betweenness accounts sit on many shortest paths — hallmark of mule intermediaries routing between clusters.',
    detail: 'Betweenness >0.05 = +15pts, >0.02 = +8pts. PageRank >0.02 = +5pts. Normalized centrality scores.',
    tags: ['PageRank +5pts', 'Betweenness +15pts', 'alpha=0.85'],
    how: ['Build full transaction graph (all accounts as nodes)', 'Run PageRank with damping alpha=0.85', 'Compute Betweenness Centrality per node', 'betweenness >0.05 = +15pts, >0.02 = +8pts', 'PageRank >0.02 = +5pts for high-flow accounts'],
    example: 'Account M: betweenness 0.07 — sits on 7% of all shortest paths, bridging two separate clusters as a mule.',
  },
  { num: '05', color: '#a078dc', title: 'Layered Shell Networks', size: 'wide' as const,
    icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 12l3-3 3 3-3 3zM15 12l3-3 3 3-3 3z"/><path d="M9 6l3-3 3 3-3 3zM9 18l3-3 3 3-3 3z"/><line x1="6" y1="12" x2="15" y2="12" strokeDasharray="2 2"/><line x1="12" y1="6" x2="12" y2="15" strokeDasharray="2 2"/></svg>,
    brief: 'Traces multi-hop chains through throwaway shell accounts.',
    desc: 'Identifies chains of 4+ accounts where intermediaries have only 2-3 total transactions. These "shell" accounts exist solely to add layers between source and destination.',
    detail: 'Shell criteria: 2-3 total txns. Chain needs 1+ shell intermediate. DFS max depth: 6 hops.',
    tags: ['layered_shell +25pts', 'Shell 2-3 txns', 'DFS depth 6'],
    how: ['Count total txns per account (sent + received)', 'Mark accounts with 2-3 txns as potential shells', 'Run recursive DFS from each account, depth limit 6', 'Record 4+ account chains with 1+ shell intermediate', 'All chain members get +25pts layered_shell flag'],
    example: 'Source → Shell1 (2 txns) → Shell2 (3 txns) → Shell3 (2 txns) → Dest. Three throwaway accounts create distance.',
  },
  { num: '06', color: '#f0b450', title: 'Composite Risk Score', size: 'normal' as const,
    icon: <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4l2 2"/></svg>,
    brief: 'Combines all signals into 0-100 score with false-positive reduction.',
    desc: 'All signals summed into a 0-100 suspicion score. Velocity and centrality bonuses added, false-positive reductions applied. Merchants get -30pts, payroll accounts -25pts (CV<0.15).',
    detail: 'Threshold: >= 25 to flag. Ring risk = avg(members) * 1.1. Max capped at 100.',
    tags: ['Threshold 25/100', 'Merchant -30pts', 'Payroll -25pts'],
    how: ['Sum base scores from all detected patterns', 'Add velocity (+10/+5) and centrality (+8/+15/+5) bonuses', 'Subtract FP adjustments: merchants -30, payroll -25', 'Cap at 100, flag accounts >= 25', 'Ring risk = avg(member scores) * 1.1'],
    example: '3-node cycle (+35) + high velocity (+10) + betweenness 0.03 (+8) = 53pts. Well above 25pt threshold → flagged.',
  },
]

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [selectedRingId, setSelectedRingId] = useState<string | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [expandedProtocol, setExpandedProtocol] = useState<string | null>(null)

  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  // Scroll-reveal for bento cards
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('revealed') })
    }, { threshold: 0.08 })
    cardRefs.current.forEach(el => { if (el) obs.observe(el) })
    return () => obs.disconnect()
  }, [result])

  // Escape to close modal
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpandedProtocol(null) }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])

  // Lock scroll when modal open
  useEffect(() => {
    document.body.style.overflow = expandedProtocol ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [expandedProtocol])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFile(e.target.files?.[0] ?? null)
    setError(null)
  }

  const handleAnalyze = async () => {
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(`${API_URL}/analyze`, { method: 'POST', body: formData })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(body.detail || `Error ${res.status}`)
      }
      setResult(await res.json())
    } catch (err: any) {
      setError(err.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    if (!result) return
    // Rebuild JSON with exact hackathon spec: key order, field order, only required fields
    const specOutput = {
      suspicious_accounts: result.suspicious_accounts.map(a => ({
        account_id: a.account_id,
        suspicion_score: a.suspicion_score,
        detected_patterns: a.detected_patterns,
        ring_id: a.ring_id,
      })),
      fraud_rings: result.fraud_rings.map(r => ({
        ring_id: r.ring_id,
        member_accounts: r.member_accounts,
        pattern_type: r.pattern_type,
        risk_score: r.risk_score,
      })),
      summary: {
        total_accounts_analyzed: result.summary.total_accounts_analyzed,
        suspicious_accounts_flagged: result.summary.suspicious_accounts_flagged,
        fraud_rings_detected: result.summary.fraud_rings_detected,
        processing_time_seconds: result.summary.processing_time_seconds,
      },
    }
    const blob = new Blob([JSON.stringify(specOutput, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'forensics_results.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    setFile(null)
    setResult(null)
    setError(null)
    setSelectedRingId(null)
    setSelectedAccountId(null)
  }

  const active = expandedProtocol ? protocols.find(p => p.num === expandedProtocol) : null

  /* ── Landing page ── */
  if (!result) {
    return (
      <div className="app" style={{ position: 'relative', zIndex: 10 }}>
          {/* Background */}
          <div className="landing-bg" />

          {/* Hero */}
        <div className="landing-hero">
          <div className="landing-badge">Mule Network Forensics v2.0</div>
          <h1>Financial Forensics Engine</h1>
          <p>
            The industry's most advanced tool for identifying complex money laundering networks
            and uncovering fraud rings hidden within massive datasets.
          </p>
        </div>

        {/* Upload */}
        <div className="upload-inline">
          <label className="csv-glass-btn">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            {file ? file.name : 'Choose CSV File'}
            <input type="file" accept=".csv" onChange={handleFileChange} />
          </label>

          {file && <span className="file-info">{(file.size / 1024).toFixed(1)} KB READY FOR ANALYSIS</span>}

          {file && (
            <button
              className="analyze-glow-btn"
              disabled={loading}
              onClick={handleAnalyze}
              style={{ background: 'var(--cyber-red)', boxShadow: '0 0 20px rgba(255, 0, 60, 0.4)' }}
            >
              {loading ? 'INITIALIZING SCAN...' : 'EXECUTE ANALYSIS'}
            </button>
          )}
        </div>

          {loading && <ScanLoader />}

        {error && <div className="error">{error}</div>}

        {/* Detection Protocols Bento Grid */}
        <div className="learn-section">
          <div className="learn-header">
            <div className="learn-badge">Forensic Engine</div>
            <h2>Detection Protocols</h2>
            <p>Six layers of algorithmic analysis. Click any card to dive deeper.</p>
          </div>

          <div className="bp-grid">
            {protocols.map((p, i) => (
              <div
                key={p.num}
                ref={el => cardRefs.current[i] = el}
                className={`bp-card bp-${p.size}`}
                style={{ '--bp-color': p.color } as React.CSSProperties}
                onClick={() => setExpandedProtocol(p.num)}
              >
                <div className="bp-accent" />
                <div className="bp-top">
                  <span className="bp-num">{p.num}</span>
                  <span className="bp-icon">{p.icon}</span>
                </div>
                <h3>{p.title}</h3>
                <p>{p.brief}</p>
                <div className="bp-tags">
                  {p.tags.slice(0, 2).map(t => <span key={t}>{t}</span>)}
                </div>
                <div className="bp-hint">Click to explore</div>
              </div>
            ))}
          </div>
        </div>

        {/* Protocol Modal */}
        {active && (
          <div className="bp-overlay" onClick={() => setExpandedProtocol(null)}>
            <div className="bp-modal" onClick={e => e.stopPropagation()} style={{ '--bp-color': active.color } as React.CSSProperties}>
              <button className="bp-close" onClick={() => setExpandedProtocol(null)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
              <div className="bp-modal-accent" />
              <div className="bp-modal-head">
                <span className="bp-modal-num">PROTOCOL {active.num}</span>
                <span className="bp-modal-icon">{active.icon}</span>
              </div>
              <h2>{active.title}</h2>
              <p className="bp-modal-desc">{active.desc}</p>
              <div className="bp-modal-section">
                <h4>How It Works</h4>
                <ol>
                  {active.how.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </div>
              <div className="bp-modal-example">
                <h4>Real-World Example</h4>
                <p>{active.example}</p>
              </div>
              <div className="bp-modal-impl">
                <code>{active.detail}</code>
              </div>
              <div className="bp-modal-tags">
                {active.tags.map(t => <span key={t}>{t}</span>)}
              </div>
            </div>
          </div>
        )}

        <div className="landing-footer">
          Powered by graph analytics and anomaly detection algorithms
        </div>
      </div>
    )
  }

  /* ── Results page ── */
  return (
    <div className="app">
      <header>
        <h1>Financial Forensics Engine</h1>
        <p>Analysis Results</p>
      </header>

      <div className="summary-grid">
        <div className="summary-card">
          <div className="value">{result.summary.total_accounts_analyzed}</div>
          <div className="label">Accounts Analyzed</div>
        </div>
        <div className="summary-card">
          <div className="value" style={{ color: '#e54545' }}>{result.summary.suspicious_accounts_flagged}</div>
          <div className="label">Suspicious Accounts</div>
        </div>
        <div className="summary-card">
          <div className="value" style={{ color: '#d4943a' }}>{result.summary.fraud_rings_detected}</div>
          <div className="label">Fraud Rings</div>
        </div>
        <div className="summary-card">
          <div className="value">{result.summary.processing_time_seconds}s</div>
          <div className="label">Processing Time</div>
        </div>
      </div>

      <Dashboard data={result} />

      <SankeyDiagram data={result} />

      <div className="graph-container">
        <h2>Transaction Network Graph</h2>
        <GraphView data={result} selectedRingId={selectedRingId} onSelectAccount={setSelectedAccountId} />
      </div>

      <RingTable rings={result.fraud_rings} selectedRingId={selectedRingId} onSelectRing={setSelectedRingId} />

      <div className="actions">
        <button className="btn" onClick={handleDownload}>Download JSON Report</button>
        <button className="btn btn-secondary" onClick={handleReset}>New Analysis</button>
      </div>

      {selectedAccountId && (
        <AccountDetailPanel
          accountId={selectedAccountId}
          data={result}
          onClose={() => setSelectedAccountId(null)}
        />
      )}
    </div>
  )
}

export default App
