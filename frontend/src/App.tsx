import React, { useState } from 'react'
import type { AnalysisResult, TooltipData } from './types'
import GraphView from './GraphView'
import RingTable from './RingTable'
import AccountDetailPanel from './AccountDetailPanel'
import Dashboard from './Dashboard'

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

  return (
    <div className="app">
      <header>
        <h1>Financial Forensics Engine</h1>
        <p>Upload transaction CSV to detect money muling networks</p>
      </header>

      {!result && (
        <div className="upload-section">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <label>
            {file ? file.name : 'Choose CSV File'}
            <input type="file" accept=".csv" onChange={handleFileChange} />
          </label>
          {file && <span className="file-info">{(file.size / 1024).toFixed(1)} KB</span>}
          <button className="analyze-btn" disabled={!file || loading} onClick={handleAnalyze}>
            {loading ? 'Analyzing...' : 'Analyze Transactions'}
          </button>
        </div>
      )}

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <p>Processing transactions and detecting fraud rings...</p>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      {result && (
        <>
          <div className="summary-grid">
            <div className="summary-card">
              <div className="value">{result.summary.total_accounts_analyzed}</div>
              <div className="label">Accounts Analyzed</div>
            </div>
            <div className="summary-card">
              <div className="value" style={{ color: '#ef4444' }}>{result.summary.suspicious_accounts_flagged}</div>
              <div className="label">Suspicious Accounts</div>
            </div>
            <div className="summary-card">
              <div className="value" style={{ color: '#f59e0b' }}>{result.summary.fraud_rings_detected}</div>
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
              <button className="download-btn" onClick={handleDownload}>Download JSON Report</button>
              <button className="reset-btn" onClick={handleReset}>New Analysis</button>
            </div>

            {selectedAccountId && (
              <AccountDetailPanel
                accountId={selectedAccountId}
                data={result}
                onClose={() => setSelectedAccountId(null)}
              />
            )}
          </>
      )}
    </div>
  )
}

export default App
