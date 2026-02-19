import React, { useMemo } from 'react'
import type { AnalysisResult } from './types'

interface Props {
  data: AnalysisResult
}

export default function Dashboard({ data }: Props) {
  const stats = useMemo(() => {
    const { suspicious_accounts, fraud_rings, graph, summary } = data
    const { nodes, edges } = graph

    // Risk distribution
    const high = suspicious_accounts.filter(a => a.suspicion_score >= 70).length
    const medium = suspicious_accounts.filter(a => a.suspicion_score >= 40 && a.suspicion_score < 70).length
    const low = suspicious_accounts.filter(a => a.suspicion_score > 0 && a.suspicion_score < 40).length
    const clean = summary.total_accounts_analyzed - high - medium - low

    // Top 5 suspicious accounts
    const topAccounts = [...suspicious_accounts]
      .sort((a, b) => b.suspicion_score - a.suspicion_score)
      .slice(0, 5)

    // Transaction volume over time (group by date)
    const volumeByDate: Record<string, { count: number; total: number }> = {}
    edges.forEach(e => {
      const date = e.timestamp.split(' ')[0] || e.timestamp.split('T')[0]
      if (!volumeByDate[date]) volumeByDate[date] = { count: 0, total: 0 }
      volumeByDate[date].count += 1
      volumeByDate[date].total += e.amount
    })
    const volumeEntries = Object.entries(volumeByDate).sort(([a], [b]) => a.localeCompare(b))

    // Pattern frequency
    const patternCounts: Record<string, number> = {}
    suspicious_accounts.forEach(a => {
      a.detected_patterns.forEach(p => {
        patternCounts[p] = (patternCounts[p] || 0) + 1
      })
    })
    const patternEntries = Object.entries(patternCounts).sort((a, b) => b[1] - a[1])

    // Total money flow
    const totalFlow = edges.reduce((sum, e) => sum + e.amount, 0)
    const avgTransaction = edges.length > 0 ? totalFlow / edges.length : 0

    // Ring sizes
    const avgRingSize = fraud_rings.length > 0
      ? fraud_rings.reduce((s, r) => s + r.member_accounts.length, 0) / fraud_rings.length
      : 0

    // Accounts with highest centrality
    const topCentrality = [...nodes]
      .filter(n => n.betweenness !== undefined)
      .sort((a, b) => (b.betweenness || 0) - (a.betweenness || 0))
      .slice(0, 5)

    return {
      high, medium, low, clean,
      topAccounts, volumeEntries, patternEntries,
      totalFlow, avgTransaction, avgRingSize,
      topCentrality, totalTxns: edges.length,
    }
  }, [data])

  const formatMoney = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000 ? `$${(n / 1_000).toFixed(1)}K`
      : `$${n.toFixed(0)}`

  // Pie chart helpers
  const pieTotal = stats.high + stats.medium + stats.low + stats.clean
  const pieSlices = [
    { label: 'High Risk', count: stats.high, color: '#ef4444' },
    { label: 'Medium Risk', count: stats.medium, color: '#f59e0b' },
    { label: 'Low Risk', count: stats.low, color: '#22c55e' },
    { label: 'Clean', count: stats.clean, color: '#3b82f6' },
  ].filter(s => s.count > 0)

  const pieArcs = (() => {
    const paths: { d: string; color: string; label: string; count: number }[] = []
    let cumAngle = -Math.PI / 2
    pieSlices.forEach(s => {
      const angle = (s.count / pieTotal) * 2 * Math.PI
      const x1 = 50 + 40 * Math.cos(cumAngle)
      const y1 = 50 + 40 * Math.sin(cumAngle)
      cumAngle += angle
      const x2 = 50 + 40 * Math.cos(cumAngle)
      const y2 = 50 + 40 * Math.sin(cumAngle)
      const large = angle > Math.PI ? 1 : 0
      if (pieSlices.length === 1) {
        paths.push({ d: '', color: s.color, label: s.label, count: s.count })
      } else {
        paths.push({
          d: `M 50 50 L ${x1} ${y1} A 40 40 0 ${large} 1 ${x2} ${y2} Z`,
          color: s.color, label: s.label, count: s.count,
        })
      }
    })
    return paths
  })()

  // Bar chart max
  const topMax = stats.topAccounts.length > 0 ? stats.topAccounts[0].suspicion_score : 100
  const volumeMax = stats.volumeEntries.length > 0
    ? Math.max(...stats.volumeEntries.map(([, v]) => v.total))
    : 1
  const patternMax = stats.patternEntries.length > 0 ? stats.patternEntries[0][1] : 1

  return (
    <div className="dashboard">
      <h2>Analytics Dashboard</h2>

      {/* Extended stats row */}
      <div className="dash-stats-row">
        <div className="dash-stat">
          <div className="dash-stat-value">{formatMoney(stats.totalFlow)}</div>
          <div className="dash-stat-label">Total Flow</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-value">{stats.totalTxns}</div>
          <div className="dash-stat-label">Transactions</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-value">{formatMoney(stats.avgTransaction)}</div>
          <div className="dash-stat-label">Avg Transaction</div>
        </div>
        <div className="dash-stat">
          <div className="dash-stat-value">{stats.avgRingSize.toFixed(1)}</div>
          <div className="dash-stat-label">Avg Ring Size</div>
        </div>
      </div>

      <div className="dash-grid">
        {/* Risk Distribution Pie */}
        <div className="dash-card">
          <h3>Risk Distribution</h3>
          <div className="dash-pie-wrap">
            <svg viewBox="0 0 100 100" className="dash-pie">
              {pieSlices.length === 1 ? (
                <circle cx="50" cy="50" r="40" fill={pieSlices[0].color} />
              ) : (
                pieArcs.map((arc, i) => (
                  <path key={i} d={arc.d} fill={arc.color} opacity={0.85} />
                ))
              )}
              <circle cx="50" cy="50" r="22" fill="var(--surface)" />
              <text x="50" y="48" textAnchor="middle" fill="var(--text)" fontSize="10" fontWeight="700">
                {pieTotal}
              </text>
              <text x="50" y="58" textAnchor="middle" fill="var(--text-muted)" fontSize="5">
                accounts
              </text>
            </svg>
            <div className="dash-pie-legend">
              {pieSlices.map(s => (
                <div key={s.label} className="dash-legend-item">
                  <span className="dash-legend-dot" style={{ background: s.color }} />
                  <span className="dash-legend-label">{s.label}</span>
                  <span className="dash-legend-count">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top Suspicious Accounts */}
        <div className="dash-card">
          <h3>Top Suspicious Accounts</h3>
          <div className="dash-bars">
            {stats.topAccounts.map(a => (
              <div key={a.account_id} className="dash-bar-row">
                <span className="dash-bar-label">{a.account_id}</span>
                <div className="dash-bar-track">
                  <div
                    className="dash-bar-fill"
                    style={{
                      width: `${(a.suspicion_score / topMax) * 100}%`,
                      background: a.suspicion_score >= 70 ? '#ef4444'
                        : a.suspicion_score >= 40 ? '#f59e0b' : '#22c55e',
                    }}
                  />
                </div>
                <span className="dash-bar-value">{a.suspicion_score.toFixed(0)}</span>
              </div>
            ))}
            {stats.topAccounts.length === 0 && (
              <div className="dash-empty">No suspicious accounts</div>
            )}
          </div>
        </div>

        {/* Transaction Volume Timeline */}
        <div className="dash-card">
          <h3>Transaction Volume by Date</h3>
          <div className="dash-bars">
            {stats.volumeEntries.map(([date, v]) => (
              <div key={date} className="dash-bar-row">
                <span className="dash-bar-label">{date}</span>
                <div className="dash-bar-track">
                  <div
                    className="dash-bar-fill"
                    style={{
                      width: `${(v.total / volumeMax) * 100}%`,
                      background: 'var(--accent)',
                    }}
                  />
                </div>
                <span className="dash-bar-value">{formatMoney(v.total)}</span>
              </div>
            ))}
            {stats.volumeEntries.length === 0 && (
              <div className="dash-empty">No transactions</div>
            )}
          </div>
        </div>

        {/* Pattern Frequency */}
        <div className="dash-card">
          <h3>Detected Patterns</h3>
          <div className="dash-bars">
            {stats.patternEntries.map(([pattern, count]) => (
              <div key={pattern} className="dash-bar-row">
                <span className="dash-bar-label dash-bar-label-pattern">{pattern.replace(/_/g, ' ')}</span>
                <div className="dash-bar-track">
                  <div
                    className="dash-bar-fill"
                    style={{
                      width: `${(count / patternMax) * 100}%`,
                      background: '#8b5cf6',
                    }}
                  />
                </div>
                <span className="dash-bar-value">{count}</span>
              </div>
            ))}
            {stats.patternEntries.length === 0 && (
              <div className="dash-empty">No patterns detected</div>
            )}
          </div>
        </div>

        {/* Top Centrality Nodes */}
        <div className="dash-card dash-card-wide">
          <h3>Key Network Nodes (Highest Betweenness)</h3>
          <div className="dash-centrality-grid">
            {stats.topCentrality.map(n => {
              const isSuspicious = n.suspicious
              return (
                <div key={n.id} className={`dash-centrality-card ${isSuspicious ? 'suspicious' : ''}`}>
                  <div className="dash-cent-id">{n.id}</div>
                  <div className="dash-cent-metrics">
                    <div>
                      <span className="dash-cent-label">Betweenness</span>
                      <span className="dash-cent-val">{(n.betweenness || 0).toFixed(4)}</span>
                    </div>
                    <div>
                      <span className="dash-cent-label">PageRank</span>
                      <span className="dash-cent-val">{(n.pagerank || 0).toFixed(4)}</span>
                    </div>
                  </div>
                  {isSuspicious && <span className="dash-cent-badge">Suspicious</span>}
                </div>
              )
            })}
            {stats.topCentrality.length === 0 && (
              <div className="dash-empty">No centrality data</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
