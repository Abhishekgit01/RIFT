import React, { useState, useEffect } from 'react'
import type { AnalysisResult } from './types'
import GraphView from './GraphView'
import RingTable from './RingTable'
import AccountDetailPanel from './AccountDetailPanel'
import Dashboard from './Dashboard'
import NetworkScanner from './NetworkScanner'
import ProtocolsPage from './ProtocolsPage'
import ThreatFeed from './ThreatFeed'
import SankeyDiagram from './SankeyDiagram'

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [selectedRingId, setSelectedRingId] = useState<string | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [page, setPage] = useState<'home' | 'protocols'>('home')
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 })

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ 
        x: (e.clientX / window.innerWidth) * 100, 
        y: (e.clientY / window.innerHeight) * 100 
      })
    }
    window.addEventListener('mousemove', handleMouseMove)
    return () => window.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    setFile(f)
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
      const data: AnalysisResult = await res.json()
      setResult(data)
    } catch (err: any) {
      setError(err.message || 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    if (!result) return
    const output = {
      suspicious_accounts: result.suspicious_accounts,
      fraud_rings: result.fraud_rings,
      summary: result.summary,
    }
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' })
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

    /* ── Protocols page ── */
    if (page === 'protocols') {
      return <ProtocolsPage onBack={() => setPage('home')} />
    }

    /* ── Landing page (before CSV results) ── */
    if (!result) {
      return (
        <>
          <div className="landing-bg" />
          <NetworkScanner active={!result} />
          <div 
            className="scanner-active-overlay" 
            style={{ '--mouse-x': `${mousePos.x}%`, '--mouse-y': `${mousePos.y}%` } as React.CSSProperties} 
          />
          <div className="app" style={{ position: 'relative', zIndex: 10 }}>
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

              {/* Protocols link */}
              <div className="protocols-link-section">
                <button className="protocols-link-btn" onClick={() => setPage('protocols')}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                  Explore Detection Protocols
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><polyline points="12 5 19 12 12 19"/></svg>
                </button>
                <p className="protocols-link-sub">Learn how our 6-layer forensic engine detects mules, rings, and shell networks</p>
              </div>

              {/* Live Threat Feed */}
              <ThreatFeed />

            {loading && (
              <div className="loading">
                <div className="spinner" />
                <p>Processing transactions and detecting fraud rings...</p>
              </div>
            )}

            {error && <div className="error">{error}</div>}

            <div className="landing-footer">
              Powered by graph analytics and anomaly detection algorithms
            </div>
          </div>
        </>
      )
    }

    /* ── Results page (after CSV analysis) - plain dark theme, no GlassSurface ── */
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
