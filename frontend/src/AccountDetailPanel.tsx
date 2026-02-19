import React from 'react'
import type { AnalysisResult, GraphNode, GraphEdge } from './types'

interface Props {
  accountId: string
  data: AnalysisResult
  onClose: () => void
}

export default function AccountDetailPanel({ accountId, data, onClose }: Props) {
  const node = data.graph.nodes.find(n => n.id === accountId)
  if (!node) return null

  // Transactions where this account is sender or receiver
  const sent = data.graph.edges.filter(e => e.source === accountId)
  const received = data.graph.edges.filter(e => e.target === accountId)
  const allTxns = [...sent, ...received].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )

  // Connected accounts
  const connections = new Set<string>()
  sent.forEach(e => connections.add(e.target))
  received.forEach(e => connections.add(e.source))

  const totalSent = sent.reduce((s, e) => s + e.amount, 0)
  const totalReceived = received.reduce((s, e) => s + e.amount, 0)

  // Risk level
  const score = node.suspicion_score || 0
  const riskLevel = score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low'
  const riskLabel = score >= 70 ? 'High Risk' : score >= 40 ? 'Medium Risk' : 'Low Risk'

  // Ring info
  const ring = node.ring_id
    ? data.fraud_rings.find(r => r.ring_id === node.ring_id)
    : null

  return (
    <div className="adp-overlay" onClick={onClose}>
      <div className="adp-panel" onClick={e => e.stopPropagation()}>
        <button className="adp-close" onClick={onClose} title="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        {/* Header */}
        <div className="adp-header">
          <div className="adp-avatar" data-suspicious={node.suspicious ? 'true' : 'false'}>
            {accountId.slice(-3)}
          </div>
          <div>
            <h2 className="adp-title">{accountId}</h2>
            {node.suspicious && (
              <span className={`risk-badge ${riskLevel}`}>{riskLabel} ({score})</span>
            )}
            {!node.suspicious && (
              <span className="risk-badge low">Clean</span>
            )}
          </div>
        </div>

        {/* Stats row */}
        <div className="adp-stats">
          <div className="adp-stat">
            <div className="adp-stat-value">{sent.length}</div>
            <div className="adp-stat-label">Sent</div>
          </div>
          <div className="adp-stat">
            <div className="adp-stat-value">{received.length}</div>
            <div className="adp-stat-label">Received</div>
          </div>
          <div className="adp-stat">
            <div className="adp-stat-value">${totalSent.toLocaleString()}</div>
            <div className="adp-stat-label">Total Out</div>
          </div>
          <div className="adp-stat">
            <div className="adp-stat-value">${totalReceived.toLocaleString()}</div>
            <div className="adp-stat-label">Total In</div>
          </div>
          <div className="adp-stat">
            <div className="adp-stat-value">{connections.size}</div>
            <div className="adp-stat-label">Connections</div>
          </div>
        </div>

        {/* Centrality */}
        <div className="adp-section">
          <h3>Network Centrality</h3>
          <div className="adp-centrality">
            <div className="adp-centrality-bar">
              <span className="adp-centrality-label">PageRank</span>
              <div className="adp-bar-track">
                <div className="adp-bar-fill" style={{ width: `${Math.min((node.pagerank || 0) * 500, 100)}%` }} />
              </div>
              <span className="adp-centrality-val">{(node.pagerank || 0).toFixed(4)}</span>
            </div>
            <div className="adp-centrality-bar">
              <span className="adp-centrality-label">Betweenness</span>
              <div className="adp-bar-track">
                <div className="adp-bar-fill" style={{ width: `${Math.min((node.betweenness || 0) * 200, 100)}%` }} />
              </div>
              <span className="adp-centrality-val">{(node.betweenness || 0).toFixed(4)}</span>
            </div>
          </div>
        </div>

        {/* Patterns */}
        {node.detected_patterns && node.detected_patterns.length > 0 && (
          <div className="adp-section">
            <h3>Detected Patterns</h3>
            <div className="adp-patterns">
              {node.detected_patterns.map(p => (
                <span key={p} className="adp-pattern-tag">{p.replace(/_/g, ' ')}</span>
              ))}
            </div>
          </div>
        )}

          {/* AI Risk Narrative */}
          {data.narratives && (() => {
            const narrative = data.narratives.find(n => n.account_id === accountId)
            if (!narrative) return null
            return (
              <div className="adp-section adp-narrative">
                <h3>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                  AI Risk Assessment
                </h3>
                <div className={`adp-narr-level adp-narr-${narrative.risk_level.toLowerCase()}`}>
                  {narrative.risk_level} RISK
                </div>
                <p className="adp-narr-text">{narrative.narrative}</p>
                {narrative.key_findings.length > 0 && (
                  <div className="adp-narr-findings">
                    <h4>Key Findings</h4>
                    <ul>
                      {narrative.key_findings.map((f, i) => <li key={i}>{f}</li>)}
                    </ul>
                  </div>
                )}
                <div className="adp-narr-action">
                  <strong>Recommendation:</strong> {narrative.recommendation}
                </div>
              </div>
            )
          })()}

          {/* Ring info */}
          {ring && (
            <div className="adp-section">
              <h3>Ring Membership</h3>
            <div className="adp-ring-info">
              <span className="adp-ring-label">{ring.ring_id}</span>
              <span className="adp-ring-type">{ring.pattern_type.replace(/_/g, ' ')}</span>
              <span className="adp-ring-members">{ring.member_accounts.length} members</span>
            </div>
          </div>
        )}

        {/* Transaction history */}
        <div className="adp-section">
          <h3>Transaction History ({allTxns.length})</h3>
          <div className="adp-txn-list">
            {allTxns.map(txn => {
              const isSender = txn.source === accountId
              return (
                <div key={txn.transaction_id} className="adp-txn">
                  <div className={`adp-txn-dir ${isSender ? 'out' : 'in'}`}>
                    {isSender ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
                      </svg>
                    )}
                  </div>
                  <div className="adp-txn-details">
                    <div className="adp-txn-peer">
                      {isSender ? txn.target : txn.source}
                    </div>
                    <div className="adp-txn-meta">
                      {txn.transaction_id} &middot; {new Date(txn.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <div className={`adp-txn-amount ${isSender ? 'out' : 'in'}`}>
                    {isSender ? '-' : '+'}${txn.amount.toLocaleString()}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Connected accounts */}
        <div className="adp-section">
          <h3>Connected Accounts ({connections.size})</h3>
          <div className="adp-connections">
            {Array.from(connections).map(cid => {
              const cNode = data.graph.nodes.find(n => n.id === cid)
              return (
                <div key={cid} className="adp-conn">
                  <span className={`adp-conn-dot ${cNode?.suspicious ? 'suspicious' : ''}`} />
                  <span className="adp-conn-id">{cid}</span>
                  {cNode?.suspicious && (
                    <span className="adp-conn-score">{cNode.suspicion_score}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
