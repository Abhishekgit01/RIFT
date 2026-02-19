import { useState, useEffect, useRef } from 'react'

const STAGES = [
  { label: 'Parsing CSV Transactions', pct: 8 },
  { label: 'Building Transaction Graph', pct: 18 },
  { label: 'Detecting Circular Fund Routes', pct: 32 },
  { label: 'Scanning for Smurfing Patterns', pct: 46 },
  { label: 'Analyzing Velocity Profiles', pct: 55 },
  { label: 'Computing Graph Centrality', pct: 68 },
  { label: 'Tracing Shell Networks', pct: 78 },
  { label: 'Scoring & Risk Assessment', pct: 88 },
  { label: 'Generating AI Narratives', pct: 95 },
]

export default function ScanLoader() {
  const [progress, setProgress] = useState(0)
  const [stageIdx, setStageIdx] = useState(0)
  const [blocks, setBlocks] = useState<boolean[]>(Array(64).fill(false))
  const [hashRate, setHashRate] = useState(0)
  const [txProcessed, setTxProcessed] = useState(0)
  const [nonce, setNonce] = useState('00000000')
  const [elapsed, setElapsed] = useState('0.0')
  const mountTime = useRef(Date.now())

  // Progress simulation
  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => {
        const target = STAGES[stageIdx]?.pct ?? 99
        const step = Math.random() * 1.8 + 0.3
        const next = Math.min(prev + step, target)
        if (next >= target && stageIdx < STAGES.length - 1) {
          setStageIdx(s => s + 1)
        }
        return next
      })
    }, 200)
    return () => clearInterval(interval)
  }, [stageIdx])

  // Animate mining blocks
  useEffect(() => {
    const interval = setInterval(() => {
      setBlocks(prev => {
        const next = [...prev]
        const filled = prev.filter(Boolean).length
        const target = Math.floor((progress / 100) * 64)
        if (filled < target) {
          const unfilled = prev.map((v, i) => (!v ? i : -1)).filter(i => i >= 0)
          if (unfilled.length > 0) {
            const pick = unfilled[Math.floor(Math.random() * unfilled.length)]
            next[pick] = true
          }
        }
        return next
      })
    }, 120)
    return () => clearInterval(interval)
  }, [progress])

  // Stats ticker - single interval for everything
  useEffect(() => {
    const interval = setInterval(() => {
      const secs = (Date.now() - mountTime.current) / 1000
      setElapsed(secs.toFixed(1))
      setHashRate(Math.floor(Math.random() * 400 + 800 + progress * 12))
      setTxProcessed(Math.floor(secs * (40 + progress * 2)))
      setNonce((Date.now() * 7).toString(16).slice(-8).toUpperCase())
    }, 250)
    return () => clearInterval(interval)
  }, [progress])

  return (
    <div className="scan-loader">
      <div className="sl-bg-grid" />

      <div className="sl-center">
        {/* Spinning rings */}
        <div className="sl-rings">
          <div className="sl-ring sl-ring-1" />
          <div className="sl-ring sl-ring-2" />
          <div className="sl-ring sl-ring-3" />
          <div className="sl-core">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
        </div>

        {/* Percentage */}
        <div className="sl-pct">{Math.floor(progress)}<span>%</span></div>

        {/* Stage label */}
        <div className="sl-stage">{STAGES[stageIdx]?.label ?? 'Finalizing...'}</div>

        {/* Mining block grid (8x8) */}
        <div className="sl-block-grid">
          {blocks.map((filled, i) => (
            <div key={i} className={`sl-block ${filled ? 'sl-block-filled' : ''}`} />
          ))}
        </div>

        {/* Progress bar */}
        <div className="sl-bar-track">
          <div className="sl-bar-fill" style={{ width: `${progress}%` }}>
            <div className="sl-bar-glow" />
          </div>
        </div>

        {/* Stats row */}
        <div className="sl-stats">
          <div className="sl-stat">
            <span className="sl-stat-val">{hashRate.toLocaleString()}</span>
            <span className="sl-stat-label">HASH/s</span>
          </div>
          <div className="sl-stat">
            <span className="sl-stat-val">{txProcessed.toLocaleString()}</span>
            <span className="sl-stat-label">TX SCANNED</span>
          </div>
          <div className="sl-stat">
            <span className="sl-stat-val">{elapsed}s</span>
            <span className="sl-stat-label">ELAPSED</span>
          </div>
        </div>

        {/* Live hash stream */}
        <div className="sl-hash-stream">
          <span className="sl-hash-label">NONCE</span>
          <span className="sl-hash-val">0x{nonce}</span>
          <span className="sl-hash-sep">|</span>
          <span className="sl-hash-label">BLOCK</span>
          <span className="sl-hash-val">#{Math.floor(progress * 1.47 + 100)}</span>
        </div>

        {/* Stage timeline dots */}
        <div className="sl-timeline">
          {STAGES.map((_, i) => (
            <div key={i} className={`sl-tl-dot ${i < stageIdx ? 'sl-tl-done' : i === stageIdx ? 'sl-tl-active' : ''}`}>
              <div className="sl-tl-pip" />
              {i < STAGES.length - 1 && <div className="sl-tl-line" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
