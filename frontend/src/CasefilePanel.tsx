import { useState } from 'react'
import type { Casefile } from './types'

const TABS = ['Overview', 'Evidence', 'Members', 'Risk Factors'] as const
type Tab = typeof TABS[number]

const PATTERN_ICONS: Record<string, string> = {
  cycle: '🔄', fan_in: '📥', fan_out: '📤', layered_shell: '🐚',
  'cycle+fan_in': '🔄📥', 'cycle+fan_out': '🔄📤', 'cycle+layered_shell': '🔄🐚',
}

function riskColor(score: number): string {
  if (score >= 80) return '#ff003c'
  if (score >= 60) return '#ff6b35'
  if (score >= 40) return '#ffd166'
  return '#06d6a0'
}

function riskLabel(score: number): string {
  if (score >= 80) return 'CRITICAL'
  if (score >= 60) return 'HIGH'
  if (score >= 40) return 'ELEVATED'
  return 'MODERATE'
}

interface Props {
  casefile: Casefile
  onClose: () => void
}

export default function CasefilePanel({ casefile, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('Overview')

  const rc = riskColor(casefile.risk_score)
  const rl = riskLabel(casefile.risk_score)
  const icon = PATTERN_ICONS[casefile.pattern_type] || '🔍'
  const maxFactor = casefile.risk_factors.length > 0
    ? Math.max(...casefile.risk_factors.map(f => f.total_points))
    : 1

  return (
    <div className="cf-overlay" onClick={onClose}>
      <div className="cf-panel" onClick={e => e.stopPropagation()}>
        {/* ── Header ── */}
        <div className="cf-header">
          <div className="cf-header-left">
            <span className="cf-icon">{icon}</span>
            <div>
              <div className="cf-ring-id">{casefile.ring_id}</div>
              <div className="cf-pattern">{casefile.pattern_type.replace(/_/g, ' ').replace(/\+/g, ' + ')}</div>
            </div>
          </div>
          <div className="cf-header-right">
            <div className="cf-risk-pill" style={{ background: rc }}>
              {rl} — {casefile.risk_score}
            </div>
            <button className="cf-close" onClick={onClose}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="cf-tabs">
          {TABS.map(t => (
            <button key={t} className={`cf-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        {/* ── Tab Content ── */}
        <div className="cf-body">

          {/* ─── Overview ─── */}
          {tab === 'Overview' && (
            <div className="cf-overview">
              <div className="cf-stat-grid">
                <div className="cf-stat-card">
                  <div className="cf-stat-val">{casefile.member_count}</div>
                  <div className="cf-stat-lbl">Members</div>
                </div>
                <div className="cf-stat-card">
                  <div className="cf-stat-val">{casefile.temporal.internal_transactions}</div>
                  <div className="cf-stat-lbl">Internal Txns</div>
                </div>
                <div className="cf-stat-card">
                  <div className="cf-stat-val">${casefile.temporal.internal_volume.toLocaleString()}</div>
                  <div className="cf-stat-lbl">Total Volume</div>
                </div>
                <div className="cf-stat-card">
                  <div className="cf-stat-val">{casefile.temporal.span_hours}h</div>
                  <div className="cf-stat-lbl">Activity Span</div>
                </div>
              </div>

              <div className="cf-timeline-bar">
                <div className="cf-tl-label">Timeline</div>
                <div className="cf-tl-track">
                  <div className="cf-tl-fill" style={{ background: `linear-gradient(90deg, ${rc}44, ${rc})` }} />
                </div>
                <div className="cf-tl-dates">
                  <span>{casefile.temporal.first_activity}</span>
                  <span>{casefile.temporal.last_activity}</span>
                </div>
              </div>

              {/* Risk factor mini chart */}
              <div className="cf-section-title">Risk Factor Breakdown</div>
              <div className="cf-factor-list">
                {casefile.risk_factors.slice(0, 6).map(f => (
                  <div key={f.factor} className="cf-factor-row">
                    <span className="cf-factor-name">{f.factor}</span>
                    <div className="cf-factor-bar-track">
                      <div className="cf-factor-bar-fill" style={{ width: `${(f.total_points / maxFactor) * 100}%`, background: rc }} />
                    </div>
                    <span className="cf-factor-pts">+{f.total_points}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ─── Evidence ─── */}
          {tab === 'Evidence' && (
            <div className="cf-evidence">
              <div className="cf-section-title">Top Evidence Transactions</div>
              {casefile.top_evidence.length === 0 ? (
                <div className="cf-empty">No internal transactions between ring members found.</div>
              ) : (
                <div className="cf-ev-table">
                  <div className="cf-ev-header">
                    <span>From</span><span>To</span><span>Amount</span><span>Timestamp</span>
                  </div>
                  {casefile.top_evidence.map((ev, i) => (
                    <div key={i} className="cf-ev-row">
                      <span className="cf-ev-acct">{ev.from}</span>
                      <span className="cf-ev-arrow">→</span>
                      <span className="cf-ev-acct">{ev.to}</span>
                      <span className="cf-ev-amt">${ev.amount.toLocaleString()}</span>
                      <span className="cf-ev-ts">{ev.timestamp}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="cf-ev-summary">
                <span>{casefile.temporal.internal_transactions} total internal transactions</span>
                <span>${casefile.temporal.internal_volume.toLocaleString()} total volume</span>
              </div>
            </div>
          )}

          {/* ─── Members ─── */}
          {tab === 'Members' && (
            <div className="cf-members">
              {casefile.members.map(m => (
                <div key={m.account_id} className="cf-member-card">
                  <div className="cf-member-head">
                    <div className="cf-member-id">{m.account_id}</div>
                    <div className="cf-member-role" style={{ color: rc }}>{m.role}</div>
                    <div className="cf-member-score" style={{ borderColor: riskColor(m.suspicion_score) }}>
                      {m.suspicion_score}
                    </div>
                  </div>

                  {/* Patterns */}
                  <div className="cf-member-patterns">
                    {m.detected_patterns.map(p => (
                      <span key={p} className="cf-pattern-tag">{p}</span>
                    ))}
                    {m.detected_patterns.length === 0 && <span className="cf-pattern-tag cf-tag-dim">none</span>}
                  </div>

                  {/* Risk contribution */}
                  {Object.keys(m.risk_contribution).length > 0 && (
                    <div className="cf-member-contrib">
                      {Object.entries(m.risk_contribution).map(([factor, pts]) => (
                        <div key={factor} className="cf-contrib-row">
                          <span>{factor}</span><span className="cf-contrib-pts">+{pts}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Profile stats */}
                  {m.profile && (
                    <div className="cf-member-profile">
                      <span>{m.profile.total_txns} txns</span>
                      <span>{m.profile.velocity}/day</span>
                      <span>${m.profile.avg_amount.toLocaleString()} avg</span>
                      <span>{m.profile.counterparties} cps</span>
                    </div>
                  )}

                  {/* FP justification */}
                  {m.fp_justification && m.fp_justification.length > 0 && (
                    <div className="cf-member-fp">
                      <div className="cf-fp-label">False-Positive Check</div>
                      {m.fp_justification.map((line, i) => (
                        <div key={i} className="cf-fp-line">
                          <span className="cf-fp-icon">✓</span> {line}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* ─── Risk Factors ─── */}
          {tab === 'Risk Factors' && (
            <div className="cf-risk-tab">
              <div className="cf-section-title">Aggregate Detection Signal Breakdown</div>
              <p className="cf-risk-desc">
                Points accumulated across all {casefile.member_count} members. Higher totals indicate
                more members triggered that specific detection rule.
              </p>
              <div className="cf-risk-grid">
                {casefile.risk_factors.map((f, i) => (
                  <div key={f.factor} className="cf-risk-card" style={{ '--cf-delay': `${i * 60}ms` } as React.CSSProperties}>
                    <div className="cf-risk-card-bar" style={{ height: `${(f.total_points / maxFactor) * 100}%`, background: rc }} />
                    <div className="cf-risk-card-pts">+{f.total_points}</div>
                    <div className="cf-risk-card-name">{f.factor}</div>
                  </div>
                ))}
              </div>

              <div className="cf-section-title" style={{ marginTop: 24 }}>Ring Classification Summary</div>
              <div className="cf-classify-grid">
                <div className="cf-classify-item">
                  <span className="cf-classify-label">Primary Pattern</span>
                  <span className="cf-classify-val">{casefile.pattern_type.replace(/_/g, ' ')}</span>
                </div>
                <div className="cf-classify-item">
                  <span className="cf-classify-label">Threat Level</span>
                  <span className="cf-classify-val" style={{ color: rc }}>{rl}</span>
                </div>
                <div className="cf-classify-item">
                  <span className="cf-classify-label">Confidence</span>
                  <span className="cf-classify-val">
                    {casefile.risk_factors.length >= 3 ? 'HIGH' : casefile.risk_factors.length >= 2 ? 'MEDIUM' : 'LOW'}
                    {' '}({casefile.risk_factors.length} signals)
                  </span>
                </div>
                <div className="cf-classify-item">
                  <span className="cf-classify-label">Recommended Action</span>
                  <span className="cf-classify-val">
                    {casefile.risk_score >= 80 ? 'Immediate freeze & investigation' :
                     casefile.risk_score >= 60 ? 'Priority compliance review' :
                     casefile.risk_score >= 40 ? 'Enhanced monitoring' : 'Routine review'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
