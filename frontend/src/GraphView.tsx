import React, { useRef, useEffect, useState, useCallback } from 'react'
import cytoscape from 'cytoscape'
import type { AnalysisResult, TooltipData } from './types'

const RING_COLORS = [
  '#ff4d6d', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5', '#f15bb5', '#00bbf9', '#ff9900',
  '#e54545', '#d4943a', '#9b7bd4', '#d46a90', '#3da8a0', '#cc7733', '#3da8cc', '#7aaa3d',
  '#ef476f', '#ffd60a', '#70e000', '#0077b6', '#c77dff', '#f77f00', '#4cc9f0', '#80b918'
]
const MAX_NODES = 400
const MAX_EDGES = 1200

interface Props {
  data: AnalysisResult
  selectedRingId: string | null
  onSelectAccount?: (accountId: string) => void
}

export default function GraphView({ data, selectedRingId, onSelectAccount }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<any>(null)
  const minimapRef = useRef<HTMLCanvasElement>(null)
  const [tooltip, setTooltip] = useState<TooltipData | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<string[]>([])
  const [showSearch, setShowSearch] = useState(false)
  const [graphStats, setGraphStats] = useState({ nodes: 0, edges: 0, clusters: 0, suspicious: 0 })
  const [layoutMode, setLayoutMode] = useState<'cose' | 'concentric' | 'circle'>('cose')
  const [showLabels, setShowLabels] = useState(false)
  const animFrameRef = useRef<number>(0)

  // Timeline
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelinePos, setTimelinePos] = useState(100)
  const [isPlaying, setIsPlaying] = useState(false)
  const playRef = useRef<number | null>(null)

  const timestamps = data.graph.edges.map(e => new Date(e.timestamp).getTime())
  const minTime = Math.min(...timestamps)
  const maxTime = Math.max(...timestamps)
  const currentCutoff = minTime + (timelinePos / 100) * (maxTime - minTime)

  const buildGraph = useCallback((mode: string) => {
    if (!containerRef.current) return
    if (cyRef.current) { cancelAnimationFrame(animFrameRef.current); cyRef.current.destroy() }

    const ringColorMap: Record<string, string> = {}
    data.fraud_rings.forEach((ring, i) => { ringColorMap[ring.ring_id] = RING_COLORS[i % RING_COLORS.length] })

    const ringMemberSet = new Set<string>()
    data.fraud_rings.forEach(r => r.member_accounts.forEach(m => ringMemberSet.add(m)))

    // Step 1: pick edges first (prioritize suspicious edges)
    const edgesSorted = [...data.graph.edges].sort((a, b) => {
      const aSusp = (ringMemberSet.has(a.source) && ringMemberSet.has(a.target)) ? 1 : 0
      const bSusp = (ringMemberSet.has(b.source) && ringMemberSet.has(b.target)) ? 1 : 0
      if (aSusp !== bSusp) return bSusp - aSusp
      return b.amount - a.amount
    })
    const pickedEdges = edgesSorted.slice(0, MAX_EDGES)

    // Step 2: only include nodes that appear in picked edges (guarantees connectivity)
    const connectedIds = new Set<string>()
    pickedEdges.forEach(e => { connectedIds.add(e.source); connectedIds.add(e.target) })

    // Cap nodes - if too many, keep most important
    let finalNodeIds = connectedIds
    if (connectedIds.size > MAX_NODES) {
      const nodeMap = new Map(data.graph.nodes.map(n => [n.id, n]))
      const sorted = [...connectedIds].sort((a, b) => {
        const na = nodeMap.get(a), nb = nodeMap.get(b)
        const aScore = (na?.suspicious ? 100 : 0) + (ringMemberSet.has(a) ? 50 : 0) + ((na?.betweenness || 0) * 1000)
        const bScore = (nb?.suspicious ? 100 : 0) + (ringMemberSet.has(b) ? 50 : 0) + ((nb?.betweenness || 0) * 1000)
        return bScore - aScore
      })
      finalNodeIds = new Set(sorted.slice(0, MAX_NODES))
    }

    // Step 3: filter edges to only those with both endpoints in final set
    const visibleEdges = pickedEdges.filter(e => finalNodeIds.has(e.source) && finalNodeIds.has(e.target))

    // Recompute connected from final edges (ensures no orphans)
    const trulyConnected = new Set<string>()
    visibleEdges.forEach(e => { trulyConnected.add(e.source); trulyConnected.add(e.target) })

    const visibleNodes = data.graph.nodes.filter(n => trulyConnected.has(n.id))

    const maxBetweenness = Math.max(...visibleNodes.map(n => n.betweenness || 0), 0.001)
    const amounts = visibleEdges.map(e => e.amount)
    const minAmt = Math.min(...amounts, 0)
    const maxAmt = Math.max(...amounts, 1)

    const elements: cytoscape.ElementDefinition[] = []

    visibleNodes.forEach(node => {
      const isSusp = node.suspicious
      const ringId = node.ring_id || ''
      const isRingMember = ringMemberSet.has(node.id)
      // All ring members get their ring's color; suspicious-only get red; clean nodes get steely blue
      const color = (ringId && ringColorMap[ringId])
        ? ringColorMap[ringId]
        : (isSusp ? '#ff4d6d' : '#3a6f9f')
      const betweenness = node.betweenness || 0
      const centralitySize = 22 + (betweenness / maxBetweenness) * 38
      // All nodes are circles (ellipse) — size differentiates importance
      const size = isSusp
        ? Math.max(36, centralitySize)
        : (isRingMember ? Math.max(26, centralitySize * 0.85) : Math.max(14, centralitySize * 0.55))

      elements.push({
        data: {
          id: node.id,
          label: node.id,
          suspicious: isSusp,
          ringId,
          isRingMember,
          score: node.suspicion_score || 0,
          pagerank: node.pagerank || 0,
          betweenness,
          color,
          size: Math.round(size),
          // Bold visible border for ring & suspicious nodes
          borderWidth: isSusp ? 3 : (isRingMember ? 2 : 0.8),
          borderColor: isSusp ? '#ffffff' : (isRingMember ? '#ffffff' : 'rgba(255,255,255,0.12)'),
          // All shapes are ellipse (circle) — matches screenshot
          shape: 'ellipse',
        },
      })
    })

    // Build edge lookup for fast suspicious check
    const suspNodeLookup = new Set(visibleNodes.filter(n => n.suspicious).map(n => n.id))

    visibleEdges.forEach(edge => {
      const bothRing = ringMemberSet.has(edge.source) && ringMemberSet.has(edge.target)
      const eitherSusp = suspNodeLookup.has(edge.source) || suspNodeLookup.has(edge.target) || ringMemberSet.has(edge.source) || ringMemberSet.has(edge.target)
      const normalizedAmt = maxAmt > minAmt ? (edge.amount - minAmt) / (maxAmt - minAmt) : 0.5
      const width = bothRing ? 2 + normalizedAmt * 2.5 : (eitherSusp ? 1.2 + normalizedAmt * 1.5 : 0.8 + normalizedAmt * 1.2)

      elements.push({
        data: {
          id: `${edge.source}-${edge.target}-${edge.transaction_id}`,
          source: edge.source,
          target: edge.target,
          amount: edge.amount,
          timestamp: new Date(edge.timestamp).getTime(),
          suspicious: bothRing,
          eitherSusp,
          width: Math.round(width * 10) / 10,
          color: bothRing ? 'rgba(229, 69, 69, 0.7)' : (eitherSusp ? 'rgba(212, 148, 58, 0.45)' : 'rgba(74, 143, 191, 0.25)'),
          arrowColor: bothRing ? '#e54545' : (eitherSusp ? '#d4943a' : 'rgba(120, 170, 200, 0.5)'),
        },
      })
    })

    const nodeCount = visibleNodes.length
    // Always show labels on suspicious/ring members; show all labels if few nodes or toggle on
    const showLbl = showLabels || nodeCount <= 80

    let layoutConfig: any
    if (mode === 'concentric') {
      layoutConfig = {
        name: 'concentric',
        animate: false,
        concentric: (node: any) => {
          if (node.data('suspicious')) return 10
          if (node.data('ringId')) return 7
          return 1 + (node.data('betweenness') / maxBetweenness) * 5
        },
        levelWidth: () => 2,
        minNodeSpacing: 35,
      }
    } else if (mode === 'circle') {
      layoutConfig = { name: 'circle', animate: false, spacingFactor: 1.5 }
    } else {
      layoutConfig = {
        name: 'cose',
        animate: false,
        nodeOverlap: 30,
        idealEdgeLength: () => nodeCount > 200 ? 120 : 90,
        nodeRepulsion: () => nodeCount > 200 ? 10000 : 8000,
        gravity: 0.4,
        numIter: nodeCount > 200 ? 150 : 300,
        randomize: true,
        edgeElasticity: () => 100,
      }
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'label': showLbl ? 'data(label)' : '',
            'width': 'data(size)',
            'height': 'data(size)',
            'shape': 'data(shape)' as any,
            'font-size': '7px',
            'font-weight': 700,
            'color': '#d0e8ff',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'border-width': 'data(borderWidth)',
            'border-color': 'data(borderColor)',
            'text-outline-color': '#05090c',
            'text-outline-width': 2,
            'opacity': 1,
            'min-zoomed-font-size': 6,
            'overlay-opacity': 0,
          } as any,
        },
        {
          selector: 'node[?suspicious]',
          style: {
            'shadow-blur': 24,
            'shadow-color': 'data(color)',
            'shadow-opacity': 0.6,
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
            'label': 'data(label)',
            'font-size': '8px',
          } as any,
        },
        {
          selector: 'node[?isRingMember]',
          style: {
            'shadow-blur': 16,
            'shadow-color': 'data(color)',
            'shadow-opacity': 0.45,
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
            'label': 'data(label)',
            'font-size': '7px',
          } as any,
        },
        {
          selector: 'edge',
          style: {
            'width': 'data(width)',
            'line-color': 'data(color)',
            'target-arrow-color': 'data(arrowColor)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'arrow-scale': 0.6,
            'opacity': 0.85,
          } as any,
        },
        {
          selector: 'edge[?suspicious]',
          style: {
            'line-style': 'dashed',
            'line-dash-pattern': [6, 3],
            'z-index': 10,
            'opacity': 1,
          } as any,
        },
        {
          selector: 'edge[?eitherSusp]',
          style: {
            'z-index': 5,
            'opacity': 0.9,
          } as any,
        },
        { selector: '.dimmed', style: { 'opacity': 0.04 } as any },
        { selector: '.highlighted', style: { 'opacity': 1 } as any },
        { selector: '.faded', style: { 'opacity': 0.06 } as any },
        {
          selector: '.neighbor-highlight', style: {
            'opacity': 1,
            'shadow-blur': 25,
            'shadow-opacity': 0.5,
            'shadow-color': '#00f3ff',
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
          } as any
        },
        {
          selector: '.edge-highlighted', style: {
            'opacity': 1,
            'width': 3.5,
            'line-color': '#00f3ff',
            'target-arrow-color': '#00f3ff',
            'z-index': 100,
          } as any
        },
        {
          selector: '.search-match', style: {
            'shadow-blur': 30,
            'shadow-opacity': 0.7,
            'shadow-color': '#00ff9d',
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
            'border-color': '#00ff9d',
            'border-width': 3,
            'z-index': 999,
            'label': 'data(label)',
          } as any
        },
        { selector: '.timeline-hidden', style: { 'display': 'none' } as any },
      ],
      layout: layoutConfig,
      textureOnViewport: nodeCount > 100,
      hideEdgesOnViewport: nodeCount > 200,
      hideLabelsOnViewport: true,
      wheelSensitivity: 0.3,
      pixelRatio: 1,
    } as any)

    // Hover interactions
    cy.on('mouseover', 'node', (e) => {
      const node = e.target
      const neighborhood = node.neighborhood().add(node)
      cy.elements().addClass('faded')
      neighborhood.removeClass('faded')
      node.addClass('neighbor-highlight')
      node.connectedEdges().addClass('edge-highlighted')
      node.neighborhood('node').addClass('neighbor-highlight')
      const pos = node.renderedPosition()
      const rect = containerRef.current!.getBoundingClientRect()
      const nd = data.graph.nodes.find(n => n.id === node.id())
      if (nd) setTooltip({ x: rect.left + pos.x + 15, y: rect.top + pos.y - 10, node: nd })
    })
    cy.on('mouseout', 'node', () => {
      cy.elements().removeClass('faded neighbor-highlight edge-highlighted')
      setTooltip(null)
    })
    cy.on('mouseover', 'edge', (e) => {
      e.target.addClass('edge-highlighted')
      e.target.source().addClass('neighbor-highlight')
      e.target.target().addClass('neighbor-highlight')
    })
    cy.on('mouseout', 'edge', (e) => {
      e.target.removeClass('edge-highlighted')
      e.target.source().removeClass('neighbor-highlight')
      e.target.target().removeClass('neighbor-highlight')
    })
    cy.on('tap', 'node', (e) => { if (onSelectAccount) onSelectAccount(e.target.id()) })

    const suspCount = visibleNodes.filter(n => n.suspicious).length
    setGraphStats({ nodes: visibleNodes.length, edges: visibleEdges.length, clusters: data.fraud_rings.length, suspicious: suspCount })
    cyRef.current = cy

    updateMinimap(cy)
    cy.on('pan zoom', () => updateMinimap(cy))

    // Animate suspicious edges
    let offset = 0
    const animateEdges = () => {
      offset = (offset + 0.4) % 12
      cy.edges('[?suspicious]').style('line-dash-offset', -offset)
      animFrameRef.current = requestAnimationFrame(animateEdges)
    }
    animFrameRef.current = requestAnimationFrame(animateEdges)
  }, [data, showLabels])

  useEffect(() => {
    buildGraph(layoutMode)
    return () => { cancelAnimationFrame(animFrameRef.current); if (cyRef.current) cyRef.current.destroy() }
  }, [data, layoutMode, showLabels])

  const updateMinimap = (cy: any) => {
    const canvas = minimapRef.current
    if (!canvas || !cy) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width, h = canvas.height
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = 'rgba(6, 10, 14, 0.92)'
    ctx.fillRect(0, 0, w, h)
    ctx.strokeStyle = 'rgba(74, 143, 191, 0.15)'
    ctx.lineWidth = 1
    ctx.strokeRect(0, 0, w, h)
    const bb = cy.elements().boundingBox()
    if (bb.w === 0 || bb.h === 0) return
    const scale = Math.min((w - 8) / bb.w, (h - 8) / bb.h)
    const ox = (w - bb.w * scale) / 2 - bb.x1 * scale
    const oy = (h - bb.h * scale) / 2 - bb.y1 * scale
    ctx.lineWidth = 0.5
    cy.edges().forEach((edge: any) => {
      if (edge.hasClass('timeline-hidden')) return
      ctx.strokeStyle = edge.data('suspicious') ? 'rgba(229,69,69,0.3)' : 'rgba(74,143,191,0.12)'
      const sp = edge.source().position(), tp = edge.target().position()
      ctx.beginPath()
      ctx.moveTo(sp.x * scale + ox, sp.y * scale + oy)
      ctx.lineTo(tp.x * scale + ox, tp.y * scale + oy)
      ctx.stroke()
    })
    cy.nodes().forEach((node: any) => {
      if (node.hasClass('timeline-hidden')) return
      const p = node.position()
      ctx.fillStyle = node.data('color') || '#4a8fbf'
      ctx.beginPath()
      ctx.arc(p.x * scale + ox, p.y * scale + oy, Math.max(1.5, (node.data('size') || 10) * scale * 0.3), 0, Math.PI * 2)
      ctx.fill()
    })
    const ext = cy.extent()
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.5)'
    ctx.lineWidth = 1.5
    ctx.strokeRect(ext.x1 * scale + ox, ext.y1 * scale + oy, ext.w * scale, ext.h * scale)
  }

  // Ring isolation
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    if (!selectedRingId) { cy.elements().removeClass('dimmed highlighted'); return }
    const ring = data.fraud_rings.find(r => r.ring_id === selectedRingId)
    if (!ring) return
    const memberSet = new Set(ring.member_accounts)
    cy.elements().addClass('dimmed').removeClass('highlighted')
    cy.nodes().forEach((n: any) => { if (memberSet.has(n.id())) n.removeClass('dimmed').addClass('highlighted') })
    cy.edges().forEach((e: any) => {
      if (memberSet.has(e.source().id()) && memberSet.has(e.target().id()))
        e.removeClass('dimmed').addClass('highlighted')
    })
    const ringNodes = cy.nodes().filter((n: any) => memberSet.has(n.id()))
    if (ringNodes.length > 0) cy.animate({ fit: { eles: ringNodes, padding: 60 }, duration: 400 })
  }, [selectedRingId, data])

  // Timeline filter
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    if (!timelineEnabled) { cy.elements().removeClass('timeline-hidden'); return }
    const cutoff = currentCutoff
    const visNodes = new Set<string>()
    cy.edges().forEach((e: any) => {
      if ((e.data('timestamp') as number) <= cutoff) { e.removeClass('timeline-hidden'); visNodes.add(e.source().id()); visNodes.add(e.target().id()) }
      else e.addClass('timeline-hidden')
    })
    cy.nodes().forEach((n: any) => { visNodes.has(n.id()) ? n.removeClass('timeline-hidden') : n.addClass('timeline-hidden') })
  }, [timelineEnabled, currentCutoff])

  useEffect(() => {
    if (isPlaying) {
      playRef.current = window.setInterval(() => {
        setTimelinePos(prev => { if (prev >= 100) { setIsPlaying(false); return 100 }; return prev + 0.5 })
      }, 50)
    } else { if (playRef.current) clearInterval(playRef.current) }
    return () => { if (playRef.current) clearInterval(playRef.current) }
  }, [isPlaying])

  const handleSearch = (q: string) => {
    setSearchQuery(q)
    const cy = cyRef.current
    if (!cy) return
    cy.nodes().removeClass('search-match')
    if (!q.trim()) { setSearchResults([]); return }
    const matches: string[] = []
    const lq = q.toLowerCase()
    cy.nodes().forEach((n: any) => { if (n.id().toLowerCase().includes(lq)) { n.addClass('search-match'); matches.push(n.id()) } })
    setSearchResults(matches)
    if (matches.length > 0 && matches.length <= 10)
      cy.animate({ fit: { eles: cy.nodes().filter((n: any) => matches.includes(n.id())), padding: 80 }, duration: 300 })
  }

  const focusNode = (id: string) => {
    const cy = cyRef.current
    if (!cy) return
    const node = cy.getElementById(id)
    if (node.length) cy.animate({ center: { eles: node }, zoom: 2.5, duration: 300 })
  }

  const fitAll = () => cyRef.current?.animate({ fit: { padding: 30 }, duration: 300 })
  const handlePlay = () => { if (timelinePos >= 100) setTimelinePos(0); setTimelineEnabled(true); setIsPlaying(true) }
  const handleStop = () => setIsPlaying(false)
  const handleReset = () => { setIsPlaying(false); setTimelineEnabled(false); setTimelinePos(100) }
  const formatDate = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="graph-wrapper">
      <div className="graph-toolbar">
        <div className="gt-left">
          <div className="gt-stats">
            <span className="gt-stat-item"><span className="gt-stat-dot" style={{ background: '#4a8fbf' }} />{graphStats.nodes} nodes</span>
            <span className="gt-stat-item"><span className="gt-stat-dot" style={{ background: '#4a6a7f' }} />{graphStats.edges} edges</span>
            <span className="gt-stat-item"><span className="gt-stat-dot" style={{ background: '#e54545' }} />{graphStats.clusters} rings</span>
            <span className="gt-stat-item"><span className="gt-stat-dot" style={{ background: '#d4943a' }} />{graphStats.suspicious} flagged</span>
          </div>
        </div>
        <div className="gt-right">
          <div className={`gt-search ${showSearch ? 'open' : ''}`}>
            {showSearch && (
              <input type="text" placeholder="Search accounts..." value={searchQuery}
                onChange={e => handleSearch(e.target.value)} className="gt-search-input" autoFocus />
            )}
            <button className="gt-icon-btn" onClick={() => { setShowSearch(!showSearch); if (showSearch) handleSearch('') }} title="Search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            </button>
          </div>
          <div className="gt-layout-btns">
            {(['cose', 'concentric', 'circle'] as const).map(m => (
              <button key={m} className={`gt-layout-btn ${layoutMode === m ? 'active' : ''}`} onClick={() => setLayoutMode(m)} title={m}>
                {m === 'cose' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="6" r="3" /><circle cx="18" cy="8" r="3" /><circle cx="10" cy="18" r="3" /></svg>
                ) : m === 'concentric' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="10" /></svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="4" r="2" fill="currentColor" /><circle cx="19" cy="16" r="2" fill="currentColor" /><circle cx="5" cy="16" r="2" fill="currentColor" /></svg>
                )}
              </button>
            ))}
          </div>
          <button className={`gt-icon-btn ${showLabels ? 'active' : ''}`} onClick={() => setShowLabels(!showLabels)} title="Toggle labels">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></svg>
          </button>
          <button className="gt-icon-btn" onClick={fitAll} title="Fit all">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          </button>
        </div>
      </div>

      {showSearch && searchResults.length > 0 && (
        <div className="gt-search-results">
          {searchResults.slice(0, 8).map(id => (
            <button key={id} className="gt-search-result" onClick={() => focusNode(id)}>
              <span className="gt-sr-dot" style={{ background: data.graph.nodes.find(n => n.id === id)?.suspicious ? '#e54545' : '#4a8fbf' }} />
              {id}
              {data.graph.nodes.find(n => n.id === id)?.suspicious && <span className="gt-sr-badge">FLAGGED</span>}
            </button>
          ))}
          {searchResults.length > 8 && <div className="gt-sr-more">+{searchResults.length - 8} more</div>}
        </div>
      )}

      <div ref={containerRef} id="cy" />

      <canvas ref={minimapRef} className="graph-minimap" width={180} height={120} />

      <div className="graph-legend">
        <div className="gl-title">LEGEND</div>
        <div className="gl-items">
          <div className="gl-item"><div className="gl-dot" style={{ background: '#4a8fbf' }} /><span>Normal</span></div>
          <div className="gl-item"><div className="gl-dot gl-triangle" /><span>Suspicious</span></div>
          <div className="gl-item"><div className="gl-dot gl-diamond" style={{ background: '#d4943a' }} /><span>Ring Member</span></div>
          <div className="gl-item"><div className="gl-line gl-dash" /><span>Suspicious Flow</span></div>
          <div className="gl-item"><div className="gl-line gl-solid" /><span>Normal Flow</span></div>
        </div>
      </div>

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
          <span className="timeline-label">Transaction Timeline</span>
        </div>
        <div className="timeline-slider-row">
          <span className="timeline-date">{formatDate(minTime)}</span>
          <input type="range" min="0" max="100" step="0.5" value={timelinePos}
            onChange={e => { setTimelinePos(Number(e.target.value)); setTimelineEnabled(true) }}
            className="timeline-slider" />
          <span className="timeline-date">{formatDate(maxTime)}</span>
        </div>
        {timelineEnabled && <div className="timeline-current">Current: {formatDate(currentCutoff)}</div>}
      </div>

      {tooltip && (
        <div className="node-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="tt-id">{tooltip.node.id}</div>
          <div className="tt-row"><span className="tt-label">PageRank:</span><span>{(tooltip.node.pagerank || 0).toFixed(6)}</span></div>
          <div className="tt-row"><span className="tt-label">Betweenness:</span><span>{(tooltip.node.betweenness || 0).toFixed(6)}</span></div>
          {tooltip.node.suspicious ? (
            <>
              <div className="tt-row tt-danger"><span className="tt-label">Score:</span><span>{tooltip.node.suspicion_score}</span></div>
              <div className="tt-row"><span className="tt-label">Ring:</span><span>{tooltip.node.ring_id}</span></div>
              <div className="tt-row"><span className="tt-label">Patterns:</span><span>{tooltip.node.detected_patterns?.join(', ')}</span></div>
            </>
          ) : (
            <div className="tt-clean">No suspicious activity detected</div>
          )}
        </div>
      )}
    </div>
  )
}
