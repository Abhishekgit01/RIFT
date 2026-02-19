import React, { useRef, useEffect, useState, useCallback } from 'react'
import cytoscape from 'cytoscape'
import type { AnalysisResult, TooltipData, GraphNode } from './types'

const RING_COLORS = ['#ef4444', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#84cc16']

interface Props {
  data: AnalysisResult
  selectedRingId: string | null
}

export default function GraphView({ data, selectedRingId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<any>(null)
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)

  // Timeline state
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelinePos, setTimelinePos] = useState(100) // 0-100 percentage
  const [isPlaying, setIsPlaying] = useState(false)
  const playRef = useRef<number | null>(null)

  // Compute time range
  const timestamps = data.graph.edges.map(e => new Date(e.timestamp).getTime())
  const minTime = Math.min(...timestamps)
  const maxTime = Math.max(...timestamps)

  const currentCutoff = minTime + (timelinePos / 100) * (maxTime - minTime)

  // Build cytoscape once
  useEffect(() => {
    if (!containerRef.current) return

    const ringColorMap: Record<string, string> = {}
    data.fraud_rings.forEach((ring, i) => {
      ringColorMap[ring.ring_id] = RING_COLORS[i % RING_COLORS.length]
    })

    const ringMemberSet = new Set<string>()
    data.fraud_rings.forEach(r => r.member_accounts.forEach(m => ringMemberSet.add(m)))

    // Compute max betweenness for scaling node sizes
    const maxBetweenness = Math.max(...data.graph.nodes.map(n => n.betweenness || 0), 0.001)

    const elements: cytoscape.ElementDefinition[] = []

    data.graph.nodes.forEach(node => {
      const isSuspicious = node.suspicious
      const ringId = node.ring_id || ''
      const color = ringId && ringColorMap[ringId] ? ringColorMap[ringId] : (isSuspicious ? '#ef4444' : '#4b5563')

      // Size by betweenness centrality: min 15, max 50
      const betweenness = node.betweenness || 0
      const centralitySize = 15 + (betweenness / maxBetweenness) * 35
      const size = isSuspicious ? Math.max(30, centralitySize) : Math.max(15, centralitySize * 0.7)

      elements.push({
        data: {
          id: node.id,
          label: node.id,
          suspicious: isSuspicious,
          ringId,
          score: node.suspicion_score || 0,
          pagerank: node.pagerank || 0,
          betweenness: betweenness,
          color,
          size: Math.round(size),
          borderWidth: ringMemberSet.has(node.id) ? 3 : 1,
          borderColor: ringMemberSet.has(node.id) ? '#fff' : '#333',
        },
      })
    })

    data.graph.edges.forEach(edge => {
      elements.push({
        data: {
          id: `${edge.source}-${edge.target}-${edge.transaction_id}`,
          source: edge.source,
          target: edge.target,
          amount: edge.amount,
          timestamp: new Date(edge.timestamp).getTime(),
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
            'opacity': 1,
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
            'opacity': 1,
          },
        },
        {
          selector: '.dimmed',
          style: { 'opacity': 0.08 },
        },
        {
          selector: '.highlighted',
          style: { 'opacity': 1 },
        },
        {
          selector: '.timeline-hidden',
          style: { 'opacity': 0 },
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

  // Ring isolation effect
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    if (!selectedRingId) {
      // Show all
      cy.elements().removeClass('dimmed highlighted')
      return
    }

    const ring = data.fraud_rings.find(r => r.ring_id === selectedRingId)
    if (!ring) return

    const memberSet = new Set(ring.member_accounts)

    cy.elements().addClass('dimmed').removeClass('highlighted')

    // Highlight ring members and their connecting edges
      cy.nodes().forEach((node: any) => {
        if (memberSet.has(node.id())) {
          node.removeClass('dimmed').addClass('highlighted')
        }
      })

      cy.edges().forEach((edge: any) => {
        const src = edge.source().id()
        const tgt = edge.target().id()
        if (memberSet.has(src) && memberSet.has(tgt)) {
          edge.removeClass('dimmed').addClass('highlighted')
        }
      })
    }, [selectedRingId, data])

  // Timeline effect
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    if (!timelineEnabled) {
      cy.elements().removeClass('timeline-hidden')
      return
    }

    const cutoff = currentCutoff

    // Show/hide edges based on timestamp
    const visibleNodes = new Set<string>()

      cy.edges().forEach((edge: any) => {
        const ts = edge.data('timestamp') as number
        if (ts <= cutoff) {
          edge.removeClass('timeline-hidden')
          visibleNodes.add(edge.source().id())
          visibleNodes.add(edge.target().id())
        } else {
          edge.addClass('timeline-hidden')
        }
      })

      cy.nodes().forEach((node: any) => {
        if (visibleNodes.has(node.id())) {
          node.removeClass('timeline-hidden')
        } else {
          node.addClass('timeline-hidden')
        }
      })
  }, [timelineEnabled, currentCutoff])

  // Play animation
  useEffect(() => {
    if (isPlaying) {
      playRef.current = window.setInterval(() => {
        setTimelinePos(prev => {
          if (prev >= 100) {
            setIsPlaying(false)
            return 100
          }
          return prev + 0.5
        })
      }, 50)
    } else {
      if (playRef.current) clearInterval(playRef.current)
    }
    return () => {
      if (playRef.current) clearInterval(playRef.current)
    }
  }, [isPlaying])

  const handlePlay = () => {
    if (timelinePos >= 100) setTimelinePos(0)
    setTimelineEnabled(true)
    setIsPlaying(true)
  }

  const handleStop = () => {
    setIsPlaying(false)
  }

  const handleReset = () => {
    setIsPlaying(false)
    setTimelineEnabled(false)
    setTimelinePos(100)
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div style={{ position: 'relative' }}>
      <div ref={containerRef} id="cy" />

      {/* Timeline controls */}
      <div className="timeline-controls">
        <div className="timeline-buttons">
          {!isPlaying ? (
            <button className="timeline-btn" onClick={handlePlay} title="Play">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
            </button>
          ) : (
            <button className="timeline-btn" onClick={handleStop} title="Pause">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" /></svg>
            </button>
          )}
          <button className="timeline-btn" onClick={handleReset} title="Reset">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
          </button>
          <span className="timeline-label">Timeline</span>
        </div>
        <div className="timeline-slider-row">
          <span className="timeline-date">{formatDate(minTime)}</span>
          <input
            type="range"
            min="0"
            max="100"
            step="0.5"
            value={timelinePos}
            onChange={e => {
              setTimelinePos(Number(e.target.value))
              setTimelineEnabled(true)
            }}
            className="timeline-slider"
          />
          <span className="timeline-date">{formatDate(maxTime)}</span>
        </div>
        {timelineEnabled && (
          <div className="timeline-current">
            Current: {formatDate(currentCutoff)}
          </div>
        )}
      </div>

      {tooltip && (
        <div className="node-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="tt-id">{tooltip.node.id}</div>
          <div className="tt-row">
            <span className="tt-label">PageRank:</span>
            <span>{(tooltip.node.pagerank || 0).toFixed(4)}</span>
          </div>
          <div className="tt-row">
            <span className="tt-label">Betweenness:</span>
            <span>{(tooltip.node.betweenness || 0).toFixed(4)}</span>
          </div>
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
            <div style={{ color: '#8892a8', fontSize: '0.8rem', marginTop: 4 }}>No suspicious activity</div>
          )}
        </div>
      )}
    </div>
  )
}
