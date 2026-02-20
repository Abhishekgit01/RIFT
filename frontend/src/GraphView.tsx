import React, { useRef, useEffect, useState, useCallback } from 'react'
import cytoscape from 'cytoscape'
import type { AnalysisResult, TooltipData } from './types'

// High-contrast neon palette — every colour is max-sat on a dark bg
const RING_COLORS = [
  '#ff2a6d', '#ffe14d', '#00f5a0', '#00d4ff', '#b84dff', '#ff5ed4', '#c8dadc', '#ff8800',
  '#ff4444', '#ffaa22', '#c084fc', '#ff6b9d', '#20e3b2', '#ff9933', '#bacdd0', '#7dff3a',
  '#ff006e', '#ffea00', '#39ff14', '#0096ff', '#d946ef', '#ff6d00', '#abbec2', '#84cc16'
]
// Scale caps with dataset size so small graphs stay snappy but large ones
// still show the surrounding "blue ocean" of safe nodes.
function getGraphCaps(totalNodes: number, totalEdges: number) {
  const nodeCap = Math.min(Math.max(400, Math.round(totalNodes * 0.12)), 900)
  const edgeCap = Math.min(Math.max(1200, Math.round(totalEdges * 0.15)), 3000)
  return { nodeCap, edgeCap }
}

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

    const { nodeCap, edgeCap } = getGraphCaps(data.graph.nodes.length, data.graph.edges.length)

    // Step 1: split edge budget so safe/blue edges are always visible.
    // 65% for suspicious (both endpoints ring/suspicious), 35% for normal.
    const suspEdgeBudget = Math.round(edgeCap * 0.65)
    const normalEdgeBudget = edgeCap - suspEdgeBudget

    const suspEdges: typeof data.graph.edges = []
    const normalEdges: typeof data.graph.edges = []
    for (const e of data.graph.edges) {
      if (ringMemberSet.has(e.source) && ringMemberSet.has(e.target)) suspEdges.push(e)
      else normalEdges.push(e)
    }
    // Sort each bucket by amount desc (most impactful first)
    suspEdges.sort((a, b) => b.amount - a.amount)
    normalEdges.sort((a, b) => b.amount - a.amount)

    const pickedEdges = [
      ...suspEdges.slice(0, suspEdgeBudget),
      ...normalEdges.slice(0, normalEdgeBudget),
    ]

    // Step 2: only include nodes that appear in picked edges (guarantees connectivity)
    const connectedIds = new Set<string>()
    pickedEdges.forEach(e => { connectedIds.add(e.source); connectedIds.add(e.target) })

    // Cap nodes — reserve ≥25% for non-suspicious nodes so blue ocean is visible
    let finalNodeIds = connectedIds
    if (connectedIds.size > nodeCap) {
      const nodeMap = new Map(data.graph.nodes.map(n => [n.id, n]))
      const suspNodes: string[] = []
      const safeNodes: string[] = []
      for (const id of connectedIds) {
        const nd = nodeMap.get(id)
        if (nd?.suspicious || ringMemberSet.has(id)) suspNodes.push(id)
        else safeNodes.push(id)
      }
      // Sort each bucket by importance
      const score = (id: string) => {
        const nd = nodeMap.get(id)
        return (nd?.suspicious ? 100 : 0) + (ringMemberSet.has(id) ? 50 : 0) + ((nd?.betweenness || 0) * 1000)
      }
      suspNodes.sort((a, b) => score(b) - score(a))
      safeNodes.sort((a, b) => score(b) - score(a))

      const safeFloor = Math.min(Math.round(nodeCap * 0.25), safeNodes.length)
      const suspCeil = nodeCap - safeFloor
      finalNodeIds = new Set([
        ...suspNodes.slice(0, suspCeil),
        ...safeNodes.slice(0, safeFloor),
      ])
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
      const isMerchant = node.merchant === true
      const ringId = node.ring_id || ''
      const isRingMember = ringMemberSet.has(node.id)
      // All ring members get their ring's color; suspicious-only get red;
      // merchants get gold; clean nodes get steely grey
      const color = (ringId && ringColorMap[ringId])
        ? ringColorMap[ringId]
        : (isSusp ? '#ff1f5a' : (isMerchant ? '#f0b232' : '#c0c8d0'))
      const betweenness = node.betweenness || 0
      const centralitySize = 22 + (betweenness / maxBetweenness) * 38
      // All nodes are circles (ellipse) — size differentiates importance
      const size = isSusp
        ? Math.max(40, centralitySize * 1.1)
        : (isRingMember ? Math.max(28, centralitySize * 0.9)
          : (isMerchant ? Math.max(36, centralitySize * 0.85) : Math.max(22, centralitySize * 0.65)))

      elements.push({
        data: {
          id: node.id,
          label: isMerchant ? 'M' : node.id,
          accountLabel: node.id,
          suspicious: isSusp,
          isMerchant,
          merchantReason: isMerchant ? (node.merchant_reason || 'Verified merchant') : '',
          ringId,
          isRingMember,
          score: node.suspicion_score || 0,
          pagerank: node.pagerank || 0,
          betweenness,
          color,
          size: Math.round(size),
          // Bold visible border for ring & suspicious nodes
          borderWidth: isSusp ? 3.5 : (isRingMember ? 2.5 : (isMerchant ? 2.5 : 1.5)),
          borderColor: isSusp ? '#ffffff' : (isRingMember ? 'rgba(255,255,255,0.9)' : (isMerchant ? 'rgba(240, 178, 50, 0.7)' : 'rgba(192, 200, 208, 0.45)')),
          glowColor: color,
          // Merchants get diamond; rest are ellipse (circle)
          shape: isMerchant ? 'diamond' : 'ellipse',
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
          color: bothRing ? 'rgba(255, 31, 90, 0.75)' : (eitherSusp ? 'rgba(255, 170, 34, 0.55)' : 'rgba(192, 200, 208, 0.18)'),
          arrowColor: bothRing ? '#ff1f5a' : (eitherSusp ? '#ffaa22' : 'rgba(192, 200, 208, 0.45)'),          
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
            'color': '#b0ffd0',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'border-width': 'data(borderWidth)',
            'border-color': 'data(borderColor)',
            'text-outline-color': '#030805',
            'text-outline-width': 2,
            'opacity': 1,
            'min-zoomed-font-size': 6,
            'overlay-opacity': 0,
          } as any,
        },
        {
          selector: 'node[?suspicious]',
          style: {
            'shadow-blur': 32,
            'shadow-color': 'data(color)',
            'shadow-opacity': 0.75,
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
            'label': 'data(label)',
            'font-size': '8px',
          } as any,
        },
        {
          selector: 'node[?isRingMember]',
          style: {
            'shadow-blur': 22,
            'shadow-color': 'data(color)',
            'shadow-opacity': 0.55,
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
            'label': 'data(label)',
            'font-size': '7px',
          } as any,
        },
        {
          selector: 'node[?isMerchant]',
          style: {
            'shadow-blur': 18,
            'shadow-color': '#f0b232',
            'shadow-opacity': 0.5,
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
            'label': 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-margin-y': 0,
            'font-size': '14px',
            'font-weight': 900,
            'color': '#1a1000',
            'text-outline-color': '#f0b232',
            'text-outline-width': 1.5,
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
            'shadow-color': '#0fff8a',
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
          } as any
        },
        {
          selector: '.edge-highlighted', style: {
            'opacity': 1,
            'width': 3.5,
            'line-color': '#0fff8a',
            'target-arrow-color': '#0fff8a',
            'z-index': 100,
          } as any
        },
        {
          selector: '.search-match', style: {
            'shadow-blur': 30,
            'shadow-opacity': 0.7,
            'shadow-color': '#0fff8a',
            'shadow-offset-x': 0,
            'shadow-offset-y': 0,
            'border-color': '#0fff8a',
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

    // ── Live force-directed physics ──
    // Real physics: repulsion between all node pairs, edge spring attraction,
    // random turbulence, center gravity, damping. NO cy.batch() — direct updates.
    const DAMPING        = 0.92
    const REPULSE_K      = 800        // Coulomb-like repulsion constant
    const SPRING_K       = 0.006      // edge spring stiffness
    const SPRING_LEN     = 120        // rest length for edge springs
    const CENTER_GRAVITY = 0.0004     // pull toward center so graph doesn't fly off
    const NUDGE_CHANCE   = 0.12       // 12% random perturbation per node/frame
    const NUDGE_FORCE    = 1.2
    const MAX_SPEED      = 4.0
    const MIN_MOVE       = 0.01
    const PAIRWISE_CAP   = 300        // full O(n²) repulsion up to this node count

    // Velocity store (keyed by id)
    const vel = new Map<string, { vx: number; vy: number }>()
    cy.nodes().forEach((n: any) => {
      vel.set(n.id(), { vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2 })
    })

    // Build neighbour map from cy edges for spring forces
    const edgePairs: [string, string][] = []
    cy.edges().forEach((e: any) => {
      edgePairs.push([e.source().id(), e.target().id()])
    })

    // Compute initial centroid for center gravity target
    let cx = 0, cy2 = 0
    const allN = cy.nodes().toArray()
    allN.forEach((n: any) => { const p = n.position(); cx += p.x; cy2 += p.y })
    const centroid = { x: allN.length ? cx / allN.length : 0, y: allN.length ? cy2 / allN.length : 0 }

    let grabbedNodeId: string | null = null
    cy.on('grab', 'node', (e: any) => { grabbedNodeId = e.target.id() })
    cy.on('free', 'node', (e: any) => {
      // zero-out velocity on release so node doesn't shoot off
      const v = vel.get(e.target.id())
      if (v) { v.vx = 0; v.vy = 0 }
      grabbedNodeId = null
    })

    // Animate suspicious edges (marching ants) + pulsing ring glow
    let offset = 0
    let glowPhase = 0

    const animLoop = () => {
      offset = (offset + 0.6) % 12
      glowPhase = (glowPhase + 0.03) % (Math.PI * 2)
      const pulse = 0.55 + Math.sin(glowPhase) * 0.25
      cy.edges('[?suspicious]').style('line-dash-offset', -offset)
      cy.nodes('[?suspicious]').style('shadow-opacity', pulse)

      // --- Physics tick ---
      const nodes = cy.nodes().filter((n: any) => !n.hasClass('timeline-hidden')).toArray()

      // Snapshot positions (read once per frame)
      const pos: Record<string, { x: number; y: number }> = {}
      nodes.forEach((n: any) => { const p = n.position(); pos[n.id()] = { x: p.x, y: p.y } })

      // 1) Pairwise repulsion (Coulomb-like: F = K / d²)
      if (nodes.length <= PAIRWISE_CAP) {
        for (let i = 0; i < nodes.length; i++) {
          const idA = nodes[i].id()
          if (idA === grabbedNodeId) continue
          const pA = pos[idA]
          const vA = vel.get(idA)!
          for (let j = i + 1; j < nodes.length; j++) {
            const idB = nodes[j].id()
            if (idB === grabbedNodeId) continue
            const pB = pos[idB]
            const vB = vel.get(idB)!
            let dx = pA.x - pB.x
            let dy = pA.y - pB.y
            let d2 = dx * dx + dy * dy
            if (d2 < 1) { dx = (Math.random() - 0.5) * 2; dy = (Math.random() - 0.5) * 2; d2 = dx * dx + dy * dy }
            const d = Math.sqrt(d2)
            const f = REPULSE_K / d2
            const fx = (dx / d) * f
            const fy = (dy / d) * f
            vA.vx += fx; vA.vy += fy
            vB.vx -= fx; vB.vy -= fy
          }
        }
      }

      // 2) Edge spring attraction (Hooke's law)
      edgePairs.forEach(([sId, tId]) => {
        const pS = pos[sId], pT = pos[tId]
        if (!pS || !pT) return
        const vS = vel.get(sId), vT = vel.get(tId)
        if (!vS || !vT) return
        const dx = pT.x - pS.x
        const dy = pT.y - pS.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const disp = d - SPRING_LEN
        const fx = (dx / d) * disp * SPRING_K
        const fy = (dy / d) * disp * SPRING_K
        if (sId !== grabbedNodeId) { vS.vx += fx; vS.vy += fy }
        if (tId !== grabbedNodeId) { vT.vx -= fx; vT.vy -= fy }
      })

      // 3) Per-node: center gravity + turbulence + damping + clamp + apply
      nodes.forEach((n: any) => {
        const id = n.id()
        if (id === grabbedNodeId) return
        const v = vel.get(id)!
        const p = pos[id]

        // Center gravity
        v.vx += (centroid.x - p.x) * CENTER_GRAVITY
        v.vy += (centroid.y - p.y) * CENTER_GRAVITY

        // Random turbulence
        if (Math.random() < NUDGE_CHANCE) {
          v.vx += (Math.random() - 0.5) * NUDGE_FORCE
          v.vy += (Math.random() - 0.5) * NUDGE_FORCE
        }

        // Damping
        v.vx *= DAMPING
        v.vy *= DAMPING

        // Speed limit
        const spd = Math.sqrt(v.vx * v.vx + v.vy * v.vy)
        if (spd > MAX_SPEED) { const s = MAX_SPEED / spd; v.vx *= s; v.vy *= s }

        // Apply — direct position set (no batch)
        if (Math.abs(v.vx) > MIN_MOVE || Math.abs(v.vy) > MIN_MOVE) {
          n.position({ x: p.x + v.vx, y: p.y + v.vy })
        }
      })

      animFrameRef.current = requestAnimationFrame(animLoop)
    }
    animFrameRef.current = requestAnimationFrame(animLoop)
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
      ctx.fillStyle = node.data('color') || '#00cc78'
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
            <span className="gt-stat-item"><span className="gt-stat-dot" style={{ background: '#c0c8d0' }} />{graphStats.nodes} nodes</span>
            <span className="gt-stat-item"><span className="gt-stat-dot" style={{ background: '#1a5c3a' }} />{graphStats.edges} edges</span>
            <span className="gt-stat-item"><span className="gt-stat-dot" style={{ background: '#ff1f5a' }} />{graphStats.clusters} rings</span>
            <span className="gt-stat-item"><span className="gt-stat-dot" style={{ background: '#ffaa22' }} />{graphStats.suspicious} flagged</span>
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
              <span className="gt-sr-dot" style={{ background: data.graph.nodes.find(n => n.id === id)?.suspicious ? '#ff1f5a' : (data.graph.nodes.find(n => n.id === id)?.merchant ? '#f0b232' : '#c0c8d0') }} />
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
          <div className="gl-item"><div className="gl-dot" style={{ background: '#c0c8d0' }} /><span>Normal</span></div>
          <div className="gl-item"><div className="gl-dot" style={{ background: '#f0b232', transform: 'rotate(45deg)', borderRadius: '3px' }} /><span>Merchant</span></div>
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
          ) : tooltip.node.merchant ? (
            <div className="tt-merchant-info">
              <div className="tt-merchant-badge">Ⓜ VERIFIED MERCHANT</div>
              <div className="tt-merchant-reason">{tooltip.node.merchant_reason || 'Legitimate high-volume account'}</div>
              <div className="tt-clean" style={{ color: '#f0b232', marginTop: '4px' }}>False-Positive Protected — Score Reduced</div>
            </div>
          ) : (
            <div className="tt-clean">No suspicious activity detected</div>
          )}
        </div>
      )}
    </div>
  )
}
