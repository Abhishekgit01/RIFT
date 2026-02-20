export interface SuspiciousAccount {
  account_id: string
  suspicion_score: number
  detected_patterns: string[]
  ring_id: string
}

export interface FraudRing {
  ring_id: string
  member_accounts: string[]
  pattern_type: string
  risk_score: number
}

export interface Summary {
  total_accounts_analyzed: number
  suspicious_accounts_flagged: number
  fraud_rings_detected: number
  processing_time_seconds: number
}

export interface GraphNode {
  id: string
  suspicious: boolean
  merchant?: boolean
  merchant_reason?: string
  suspicion_score?: number
  detected_patterns?: string[]
  ring_id?: string
  pagerank?: number
  betweenness?: number
}

export interface GraphEdge {
  source: string
  target: string
  amount: number
  transaction_id: string
  timestamp: string
}

export interface Narrative {
  account_id: string
  narrative: string
  risk_level: string
  recommendation: string
  key_findings: string[]
  pattern_count: number
  score: number
}

// ── Casefile types ──
export interface CasefileEvidence {
  transaction_id: string
  from: string
  to: string
  amount: number
  timestamp: string
}

export interface CasefileTemporal {
  first_activity: string
  last_activity: string
  span_hours: number
  internal_transactions: number
  internal_volume: number
}

export interface CasefileMemberProfile {
  total_txns: number
  velocity: number
  avg_amount: number
  counterparties: number
  pagerank: number
  betweenness: number
}

export interface CasefileMember {
  account_id: string
  suspicion_score: number
  detected_patterns: string[]
  role: string
  risk_contribution: Record<string, number>
  profile?: CasefileMemberProfile
  fp_justification?: string[]
  fp_status?: string
}

export interface CasefileRiskFactor {
  factor: string
  total_points: number
}

export interface Casefile {
  ring_id: string
  pattern_type: string
  risk_score: number
  member_count: number
  temporal: CasefileTemporal
  top_evidence: CasefileEvidence[]
  risk_factors: CasefileRiskFactor[]
  members: CasefileMember[]
}

export interface AnalysisResult {
  suspicious_accounts: SuspiciousAccount[]
  fraud_rings: FraudRing[]
  summary: Summary
  graph: {
    nodes: GraphNode[]
    edges: GraphEdge[]
  }
  narratives?: Narrative[]
  casefiles?: Casefile[]
}

export interface TooltipData {
  x: number
  y: number
  node: GraphNode
}
