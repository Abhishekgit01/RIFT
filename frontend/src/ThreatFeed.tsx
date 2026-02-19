import React, { useEffect, useRef, useState } from 'react'

const THREAT_TYPES = [
  { type: 'CYCLE', color: '#ff003c', icon: '⟳', prefix: 'Ring Detected' },
  { type: 'SMURF', color: '#00ff9d', icon: '◈', prefix: 'Structuring Alert' },
  { type: 'SHELL', color: '#a078dc', icon: '◇', prefix: 'Shell Chain' },
  { type: 'VELOCITY', color: '#00f3ff', icon: '⚡', prefix: 'Velocity Spike' },
  { type: 'CENTRALITY', color: '#f0b450', icon: '◉', prefix: 'Hub Node' },
  { type: 'FP_CLEAR', color: '#3b82f6', icon: '✓', prefix: 'FP Cleared' },
]

const ACCOUNTS = [
  'ACC_7291', 'ACC_4810', 'ACC_3382', 'ACC_9154', 'ACC_0037',
  'ACC_6643', 'ACC_1278', 'ACC_5590', 'ACC_8821', 'ACC_2046',
  'ACC_7734', 'ACC_4105', 'ACC_9963', 'ACC_0582', 'ACC_3319',
]

function randomAmount() {
  return (Math.random() * 45000 + 500).toFixed(2)
}

function randomScore() {
  return Math.floor(Math.random() * 75 + 25)
}

function generateEvent(): { id: number; type: typeof THREAT_TYPES[number]; message: string; time: string; score: number } {
  const t = THREAT_TYPES[Math.floor(Math.random() * THREAT_TYPES.length)]
  const acc1 = ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)]
  const acc2 = ACCOUNTS[Math.floor(Math.random() * ACCOUNTS.length)]
  const amt = randomAmount()
  const score = randomScore()
  const now = new Date()
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  let message = ''
  switch (t.type) {
    case 'CYCLE':
      message = `3-node cycle: ${acc1} → ${acc2} → ACC_${Math.floor(Math.random() * 9000 + 1000)} → ${acc1} ($${amt})`
      break
    case 'SMURF':
      message = `Fan-in: ${Math.floor(Math.random() * 8 + 10)} sources → ${acc1} within 72h window ($${amt} total)`
      break
    case 'SHELL':
      message = `Shell chain depth 4: ${acc1} → [2-txn shell] → [3-txn shell] → ${acc2}`
      break
    case 'VELOCITY':
      message = `${acc1}: ${Math.floor(Math.random() * 30 + 21)} txn/24h detected, avg $${(Math.random() * 400 + 100).toFixed(0)}`
      break
    case 'CENTRALITY':
      message = `${acc1} betweenness=0.${Math.floor(Math.random() * 8 + 2)}${Math.floor(Math.random() * 10)} — bridges ${Math.floor(Math.random() * 4 + 2)} clusters`
      break
    case 'FP_CLEAR':
      message = `${acc1} merchant heuristic: ${Math.floor(Math.random() * 20 + 15)} counterparties, 14d span → -30pts`
      break
  }

  return { id: Date.now() + Math.random(), type: t, message, time, score }
}

export default function ThreatFeed() {
  const [events, setEvents] = useState<ReturnType<typeof generateEvent>[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Seed initial events
    const seed = Array.from({ length: 5 }, () => generateEvent())
    setEvents(seed)

    const interval = setInterval(() => {
      setEvents(prev => {
        const next = [generateEvent(), ...prev]
        return next.slice(0, 12) // Keep max 12
      })
    }, 2800)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="threat-feed" ref={containerRef}>
      <div className="tf-header">
        <span className="tf-dot" />
        <span className="tf-title">LIVE THREAT FEED</span>
        <span className="tf-status">MONITORING</span>
      </div>
      <div className="tf-list">
        {events.map((ev, i) => (
          <div
            key={ev.id}
            className={`tf-event ${i === 0 ? 'tf-new' : ''}`}
            style={{ '--tf-color': ev.type.color } as React.CSSProperties}
          >
            <div className="tf-ev-left">
              <span className="tf-ev-icon" style={{ color: ev.type.color }}>{ev.type.icon}</span>
              <div className="tf-ev-body">
                <div className="tf-ev-prefix">{ev.type.prefix}</div>
                <div className="tf-ev-msg">{ev.message}</div>
              </div>
            </div>
            <div className="tf-ev-right">
              <span className="tf-ev-score" style={{ color: ev.score >= 60 ? '#ff003c' : ev.score >= 40 ? '#f0b450' : '#00ff9d' }}>
                {ev.score}
              </span>
              <span className="tf-ev-time">{ev.time}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
