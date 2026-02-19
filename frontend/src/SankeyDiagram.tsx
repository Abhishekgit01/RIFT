import React, { useMemo, useState } from 'react'
import type { AnalysisResult } from './types'

interface Props {
  data: AnalysisResult
}

interface SankeyNode {
  id: string
  x: number
  y: number
  height: number
  color: string
  suspicious: boolean
  totalFlow: number
}

interface SankeyLink {
  source: string
  target: string
  amount: number
  sy0: number
  sy1: number
  ty0: number
  ty1: number
  color: string
}

export default function SankeyDiagram({ data }: Props) {
  const [hoveredLink, setHoveredLink] = useState<SankeyLink | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  const WIDTH = 900
  const HEIGHT = 500
  const NODE_WIDTH = 18
  const PADDING = 40
  const NODE_PAD = 8

  const { nodes, links } = useMemo(() => {
    // Aggregate flows between accounts
    const flowMap = new Map<string, number>()
    const accountOutFlow = new Map<string, number>()
    const accountInFlow = new Map<string, number>()

    data.graph.edges.forEach(e => {
      const key = `${e.source}|${e.target}`
      flowMap.set(key, (flowMap.get(key) || 0) + e.amount)
      accountOutFlow.set(e.source, (accountOutFlow.get(e.source) || 0) + e.amount)
      accountInFlow.set(e.target, (accountInFlow.get(e.target) || 0) + e.amount)
    })

    // Get top flows for readability (max 30 links)
    const sortedFlows = Array.from(flowMap.entries())
      .map(([key, amount]) => {
        const [source, target] = key.split('|')
        return { source, target, amount }
      })
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 30)

    // Collect involved accounts
    const involvedAccounts = new Set<string>()
    sortedFlows.forEach(f => {
      involvedAccounts.add(f.source)
      involvedAccounts.add(f.target)
    })

    // Determine columns: sources on left, targets on right, shared in middle
    const pureSource = new Set<string>()
    const pureTarget = new Set<string>()
    const both = new Set<string>()
    
    const sourceSet = new Set(sortedFlows.map(f => f.source))
    const targetSet = new Set(sortedFlows.map(f => f.target))

    involvedAccounts.forEach(acc => {
      const isSrc = sourceSet.has(acc)
      const isTgt = targetSet.has(acc)
      if (isSrc && isTgt) both.add(acc)
      else if (isSrc) pureSource.add(acc)
      else pureTarget.add(acc)
    })

    // Build columns
    const columns: string[][] = [
      Array.from(pureSource),
      Array.from(both),
      Array.from(pureTarget),
    ].filter(c => c.length > 0)

    if (columns.length === 0) return { nodes: [], links: [] }

    // Suspicious lookup
    const suspiciousSet = new Set(data.suspicious_accounts.map(a => a.account_id))
    const ringMap = new Map<string, string>()
    data.fraud_rings.forEach(r => r.member_accounts.forEach(m => ringMap.set(m, r.ring_id)))

    // Position nodes
    const colWidth = (WIDTH - 2 * PADDING - NODE_WIDTH) / Math.max(columns.length - 1, 1)
    const sankeyNodes: SankeyNode[] = []
    const nodeMap = new Map<string, SankeyNode>()

    columns.forEach((col, ci) => {
      const x = PADDING + ci * colWidth
      const totalFlow = col.reduce((s, acc) => {
        return s + Math.max(accountOutFlow.get(acc) || 0, accountInFlow.get(acc) || 0)
      }, 0)

      const availableHeight = HEIGHT - 2 * PADDING - (col.length - 1) * NODE_PAD
      let currentY = PADDING

      col.forEach(acc => {
        const flow = Math.max(accountOutFlow.get(acc) || 0, accountInFlow.get(acc) || 0)
        const h = Math.max(12, (flow / totalFlow) * availableHeight)
        const isSusp = suspiciousSet.has(acc)

        const node: SankeyNode = {
          id: acc,
          x,
          y: currentY,
          height: h,
          color: isSusp ? (ringMap.has(acc) ? '#ff003c' : '#f0b450') : '#3b82f6',
          suspicious: isSusp,
          totalFlow: flow,
        }
        sankeyNodes.push(node)
        nodeMap.set(acc, node)
        currentY += h + NODE_PAD
      })
    })

    // Build links with vertical offsets
    const sourceOffsets = new Map<string, number>()
    const targetOffsets = new Map<string, number>()

    const sankeyLinks: SankeyLink[] = sortedFlows
      .filter(f => nodeMap.has(f.source) && nodeMap.has(f.target))
      .map(f => {
        const src = nodeMap.get(f.source)!
        const tgt = nodeMap.get(f.target)!

        const srcOffset = sourceOffsets.get(f.source) || 0
        const tgtOffset = targetOffsets.get(f.target) || 0

        const linkHeight = Math.max(2, (f.amount / src.totalFlow) * src.height)
        const tgtLinkHeight = Math.max(2, (f.amount / tgt.totalFlow) * tgt.height)

        const link: SankeyLink = {
          source: f.source,
          target: f.target,
          amount: f.amount,
          sy0: src.y + srcOffset,
          sy1: src.y + srcOffset + linkHeight,
          ty0: tgt.y + tgtOffset,
          ty1: tgt.y + tgtOffset + tgtLinkHeight,
          color: src.suspicious ? 'rgba(255,0,60,0.25)' : 'rgba(59,130,246,0.2)',
        }

        sourceOffsets.set(f.source, srcOffset + linkHeight)
        targetOffsets.set(f.target, tgtOffset + tgtLinkHeight)

        return link
      })

    return { nodes: sankeyNodes, links: sankeyLinks }
  }, [data])

  if (nodes.length === 0) return null

  const makeLinkPath = (l: SankeyLink) => {
    const src = nodes.find(n => n.id === l.source)!
    const tgt = nodes.find(n => n.id === l.target)!
    const sx = src.x + NODE_WIDTH
    const tx = tgt.x
    const mx = (sx + tx) / 2

    return `
      M ${sx} ${l.sy0}
      C ${mx} ${l.sy0}, ${mx} ${l.ty0}, ${tx} ${l.ty0}
      L ${tx} ${l.ty1}
      C ${mx} ${l.ty1}, ${mx} ${l.sy1}, ${sx} ${l.sy1}
      Z
    `
  }

  const handleLinkHover = (l: SankeyLink, e: React.MouseEvent) => {
    setHoveredLink(l)
    setTooltipPos({ x: e.clientX, y: e.clientY })
  }

  const handleNodeHover = (id: string, e: React.MouseEvent) => {
    setHoveredNode(id)
    setTooltipPos({ x: e.clientX, y: e.clientY })
  }

  return (
    <div className="sankey-container">
      <h2>Money Flow Analysis</h2>
      <p className="sankey-subtitle">Top fund flows between accounts — red paths indicate suspicious routes</p>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="sankey-svg"
        onMouseLeave={() => { setHoveredLink(null); setHoveredNode(null) }}
      >
        {/* Links */}
        {links.map((l, i) => {
          const isHighlighted = hoveredLink === l || hoveredNode === l.source || hoveredNode === l.target
          const isDimmed = (hoveredLink || hoveredNode) && !isHighlighted
          return (
            <path
              key={i}
              d={makeLinkPath(l)}
              fill={isHighlighted ? l.color.replace(/[\d.]+\)/, '0.6)') : l.color}
              stroke="none"
              opacity={isDimmed ? 0.1 : 1}
              style={{ transition: 'opacity 0.2s, fill 0.2s', cursor: 'pointer' }}
              onMouseEnter={e => handleLinkHover(l, e)}
              onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setHoveredLink(null)}
            />
          )
        })}

        {/* Nodes */}
        {nodes.map(n => {
          const isHighlighted = hoveredNode === n.id ||
            (hoveredLink && (hoveredLink.source === n.id || hoveredLink.target === n.id))
          const isDimmed = (hoveredLink || hoveredNode) && !isHighlighted
          return (
            <g key={n.id} opacity={isDimmed ? 0.3 : 1} style={{ transition: 'opacity 0.2s' }}>
              <rect
                x={n.x}
                y={n.y}
                width={NODE_WIDTH}
                height={n.height}
                rx={3}
                fill={n.color}
                stroke={isHighlighted ? '#fff' : 'none'}
                strokeWidth={1.5}
                style={{ cursor: 'pointer' }}
                onMouseEnter={e => handleNodeHover(n.id, e)}
                onMouseMove={e => setTooltipPos({ x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHoveredNode(null)}
              />
              <text
                x={n.x + NODE_WIDTH / 2}
                y={n.y - 4}
                textAnchor="middle"
                fill="#8892a4"
                fontSize="8"
                fontFamily="monospace"
              >
                {n.id.length > 10 ? n.id.slice(-6) : n.id}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Tooltip */}
      {hoveredLink && (
        <div
          className="sankey-tooltip"
          style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 30 }}
        >
          <div className="sk-tt-row">
            <span className="sk-tt-label">From:</span> {hoveredLink.source}
          </div>
          <div className="sk-tt-row">
            <span className="sk-tt-label">To:</span> {hoveredLink.target}
          </div>
          <div className="sk-tt-amount">${hoveredLink.amount.toLocaleString()}</div>
        </div>
      )}
      {hoveredNode && !hoveredLink && (
        <div
          className="sankey-tooltip"
          style={{ left: tooltipPos.x + 12, top: tooltipPos.y - 30 }}
        >
          <div className="sk-tt-id">{hoveredNode}</div>
          <div className="sk-tt-amount">
            ${nodes.find(n => n.id === hoveredNode)?.totalFlow.toLocaleString()}
          </div>
          {nodes.find(n => n.id === hoveredNode)?.suspicious && (
            <div className="sk-tt-flag">Suspicious</div>
          )}
        </div>
      )}
    </div>
  )
}
