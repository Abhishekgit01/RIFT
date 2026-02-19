import React, { useState } from 'react'
import type { AnalysisResult } from './types'
import GraphView from './GraphView'
import RingTable from './RingTable'
import AccountDetailPanel from './AccountDetailPanel'
import Dashboard from './Dashboard'
import GlassSurface from './GlassSurface'

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [selectedRingId, setSelectedRingId] = useState<string | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)

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

    /* ── Landing page (before CSV results) ── */
    if (!result) {
      return (
        <>
          <div className="landing-bg" />
          <div className="app" style={{ position: 'relative', zIndex: 1 }}>
            {/* Hero */}
            <div className="landing-hero">
              <div className="landing-badge">Money Muling Detection</div>
              <h1>Financial Forensics Engine</h1>
              <p>
                Detect money mule networks, trace suspicious transaction chains
                and uncover fraud rings hidden in your data.
              </p>
            </div>

            {/* Feature cards using GlassSurface */}
            <div className="landing-features">
              <GlassSurface width="auto" height="auto" borderRadius={14} brightness={25} opacity={0.85} blur={14}>
                <div style={{ padding: '20px', textAlign: 'center' }}>
                  <div className="landing-feature-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#7ec8f0" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M9 8.5c0-.8.7-1.5 1.5-1.5h1.5c1.1 0 2 .9 2 2s-.9 2-2 2h-2c-1.1 0-2 .9-2 2s.9 2 2 2h1.5c.8 0 1.5-.7 1.5-1.5"/></svg>
                  </div>
                  <div className="landing-feature-title">Mule Detection</div>
                  <div className="landing-feature-desc">Flag accounts exhibiting rapid pass-through and layering patterns</div>
                </div>
              </GlassSurface>

              <GlassSurface width="auto" height="auto" borderRadius={14} brightness={25} opacity={0.85} blur={14}>
                <div style={{ padding: '20px', textAlign: 'center' }}>
                  <div className="landing-feature-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e87070" strokeWidth="1.5"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><line x1="8.5" y1="7" x2="15.5" y2="17"/><line x1="15.5" y1="7" x2="8.5" y2="17"/></svg>
                  </div>
                  <div className="landing-feature-title">Ring Analysis</div>
                  <div className="landing-feature-desc">Graph-based community detection to expose coordinated fraud rings</div>
                </div>
              </GlassSurface>

              <GlassSurface width="auto" height="auto" borderRadius={14} brightness={25} opacity={0.85} blur={14}>
                <div style={{ padding: '20px', textAlign: 'center' }}>
                  <div className="landing-feature-icon">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3daa5c" strokeWidth="1.5"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                  </div>
                  <div className="landing-feature-title">Network Forensics</div>
                  <div className="landing-feature-desc">Centrality metrics and transaction flow tracing across accounts</div>
                </div>
              </GlassSurface>
            </div>

            {/* Upload area */}
            <div className="upload-section">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>

              <GlassSurface
                width="auto"
                height="auto"
                borderRadius={10}
                brightness={30}
                opacity={0.9}
                blur={8}
                style={{ cursor: 'pointer' }}
              >
                <label style={{ cursor: 'pointer', padding: '10px 28px', fontWeight: 600, fontSize: '0.95rem', color: '#e8e8e8' }}>
                  {file ? file.name : 'Choose CSV File'}
                  <input type="file" accept=".csv" onChange={handleFileChange} />
                </label>
              </GlassSurface>

              {file && <span className="file-info">{(file.size / 1024).toFixed(1)} KB</span>}

              <GlassSurface
                width="auto"
                height="auto"
                borderRadius={10}
                brightness={35}
                opacity={0.9}
                blur={8}
                onClick={(!file || loading) ? undefined : handleAnalyze}
                style={{ cursor: (!file || loading) ? 'not-allowed' : 'pointer', opacity: (!file || loading) ? 0.4 : 1 }}
              >
                <span style={{ padding: '10px 36px', fontWeight: 600, fontSize: '1rem', color: '#e8e8e8' }}>
                  {loading ? 'Analyzing...' : 'Analyze Transactions'}
                </span>
              </GlassSurface>
            </div>

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
