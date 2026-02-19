import React, { useRef, useEffect, useState } from 'react'
import cytoscape from 'cytoscape'
import type { AnalysisResult, TooltipData, GraphNode } from './types'

// Assign ring colors
const RING_COLORS = ['#ef4444', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16']

interface Props {
  data: AnalysisResult
}

export default function GraphView({ data }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Build ring color map
    const ringColorMap: Record<string, string> = {}
    data.fraud_rings.forEach((ring, i) => {
      ringColorMap[ring.ring_id] = RING_COLORS[i % RING_COLORS.length]
    })

    const suspiciousMap: Record<string, GraphNode> = {}
    data.graph.nodes.forEach(n => {
      if (n.suspicious) suspiciousMap[n.id] = n
    })

    const ringMemberSet = new Set<string>()
    data.fraud_rings.forEach(r => r.member_accounts.forEach(m => ringMemberSet.add(m)))

    const elements: cytoscape.ElementDefinition[] = []

    // Nodes
    data.graph.nodes.forEach(node => {
      const isSuspicious = node.suspicious
      const ringId = node.ring_id || ''
      const color = ringId && ringColorMap[ringId] ? ringColorMap[ringId] : (isSuspicious ? '#ef4444' : '#4b5563')

      elements.push({
        data: {
          id: node.id,
          label: node.id,
          suspicious: isSuspicious,
          ringId,
          score: node.suspicion_score || 0,
          color,
          size: isSuspicious ? 35 : 20,
          borderWidth: ringMemberSet.has(node.id) ? 3 : 1,
          borderColor: ringMemberSet.has(node.id) ? '#fff' : '#333',
        },
      })
    })

    // Edges
    data.graph.edges.forEach(edge => {
      elements.push({
        data: {
          id: `${edge.source}-${edge.target}-${edge.transaction_id}`,
          source: edge.source,
          target: edge.target,
          amount: edge.amount,
        },
      })
    })

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'label': 'data(label)',
            'width': 'data(size)',
            'height': 'data(size)',
            'font-size': '10px',
            'color': '#e0e6f0',
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'border-width': 'data(borderWidth)',
            'border-color': 'data(borderColor)',
          } as any,
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': '#2a3555',
            'target-arrow-color': '#3b82f6',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 0.8,
          },
        },
      ],
      layout: {
        name: 'cose',
        animate: false,
        nodeOverlap: 20,
        idealEdgeLength: () => 100,
        nodeRepulsion: () => 8000,
        gravity: 0.25,
      } as any,
    })

    // Tooltip on hover
    cy.on('mouseover', 'node', (e) => {
      const node = e.target
      const pos = node.renderedPosition()
      const containerRect = containerRef.current!.getBoundingClientRect()
      const nodeData = data.graph.nodes.find(n => n.id === node.id())
      if (nodeData) {
        setTooltip({
          x: containerRect.left + pos.x + 15,
          y: containerRect.top + pos.y - 10,
          node: nodeData,
        })
      }
    })

    cy.on('mouseout', 'node', () => {
      setTooltip(null)
    })

    cyRef.current = cy

    return () => {
      cy.destroy()
    }
  }, [data])

  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} id="cy" />
      {tooltip && (
        <div className="node-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="tt-id">{tooltip.node.id}</div>
          {tooltip.node.suspicious && (
            <>
              <div className="tt-row">
                <span className="tt-label">Score:</span>
                <span>{tooltip.node.suspicion_score}</span>
              </div>
              <div className="tt-row">
                <span className="tt-label">Ring:</span>
                <span>{tooltip.node.ring_id}</span>
              </div>
              <div className="tt-row">
                <span className="tt-label">Patterns:</span>
                <span>{tooltip.node.detected_patterns?.join(', ')}</span>
              </div>
            </>
          )}
          {!tooltip.node.suspicious && (
            <div style={{ color: '#8892a8', fontSize: '0.8rem' }}>No suspicious activity</div>
          )}
        </div>
      )}
    </div>
  )
}
