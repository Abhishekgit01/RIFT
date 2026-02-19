import React from 'react'
import type { FraudRing } from './types'

interface Props {
  rings: FraudRing[]
  selectedRingId: string | null
  onSelectRing: (ringId: string | null) => void
}

function riskClass(score: number): string {
  if (score >= 70) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

export default function RingTable({ rings, selectedRingId, onSelectRing }: Props) {
  if (rings.length === 0) {
    return (
      <div className="ring-table-container">
        <h2>Fraud Ring Summary</h2>
        <div style={{ padding: '24px', textAlign: 'center', color: '#8892a8' }}>
          No fraud rings detected
        </div>
      </div>
    )
  }

  return (
    <div className="ring-table-container">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <h2 style={{ padding: 0, border: 'none', margin: 0 }}>Fraud Ring Summary</h2>
        {selectedRingId && (
          <button
            className="ring-clear-btn"
            onClick={() => onSelectRing(null)}
          >
            Show All
          </button>
        )}
      </div>
      <table className="ring-table">
        <thead>
          <tr>
            <th>Ring ID</th>
            <th>Pattern Type</th>
            <th>Member Count</th>
            <th>Risk Score</th>
            <th>Member Account IDs</th>
          </tr>
        </thead>
        <tbody>
          {rings.map(ring => (
            <tr
              key={ring.ring_id}
              className={`ring-row ${selectedRingId === ring.ring_id ? 'ring-row-selected' : ''}`}
              onClick={() => onSelectRing(selectedRingId === ring.ring_id ? null : ring.ring_id)}
              style={{ cursor: 'pointer' }}
            >
              <td style={{ fontWeight: 600 }}>{ring.ring_id}</td>
              <td>{ring.pattern_type}</td>
              <td>{ring.member_accounts.length}</td>
              <td>
                <span className={`risk-badge ${riskClass(ring.risk_score)}`}>
                  {ring.risk_score}
                </span>
              </td>
              <td style={{ fontSize: '0.8rem', maxWidth: '300px', wordBreak: 'break-all' }}>
                {ring.member_accounts.join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
