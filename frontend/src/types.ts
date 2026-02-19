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
  suspicion_score?: number
  detected_patterns?: string[]
  ring_id?: string
}

export interface GraphEdge {
  source: string
  target: string
  amount: number
  transaction_id: string
  timestamp: string
}

export interface AnalysisResult {
  suspicious_accounts: SuspiciousAccount[]
  fraud_rings: FraudRing[]
  summary: Summary
  graph: {
    nodes: GraphNode[]
    edges: GraphEdge[]
  }
}

export interface TooltipData {
  x: number
  y: number
  node: GraphNode
}
