import React, { useEffect, useRef } from 'react'

interface NetworkScannerProps {
  active: boolean
}

const NetworkScanner: React.FC<NetworkScannerProps> = ({ active }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const mouseRef = useRef({ x: -1000, y: -1000 })

  useEffect(() => {
    if (!active) return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }

    const handleMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY }
    }

    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', handleMouseMove)
    resize()

    // Generate static "fraud network" points
    const points: { x: number; y: number; id: string; risk: number }[] = []
    for (let i = 0; i < 40; i++) {
      points.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        id: `ACC-${Math.floor(Math.random() * 9000) + 1000}`,
        risk: Math.random() * 100
      })
    }

    let frame = 0
    const animate = () => {
      frame++
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const mouse = mouseRef.current
      const scannerRadius = 180

      // Draw scanner circle
      ctx.beginPath()
      ctx.arc(mouse.x, mouse.y, scannerRadius, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0, 255, 157, 0.3)'
      ctx.lineWidth = 1
      ctx.stroke()

      // Scanner crosshair
      ctx.beginPath()
      ctx.moveTo(mouse.x - 20, mouse.y)
      ctx.lineTo(mouse.x + 20, mouse.y)
      ctx.moveTo(mouse.x, mouse.y - 20)
      ctx.lineTo(mouse.x, mouse.y + 20)
      ctx.stroke()

      // Draw nodes and connections within the scanner
      points.forEach((p, i) => {
        const dx = p.x - mouse.x
        const dy = p.y - mouse.y
        const dist = Math.sqrt(dx * dx + dy * dy)

        if (dist < scannerRadius) {
          const opacity = 1 - dist / scannerRadius
          
          // Draw connection to nearby points if they are also in scanner
          points.forEach((p2, j) => {
            if (i === j) return
            const dx2 = p2.x - mouse.x
            const dy2 = p2.y - mouse.y
            const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)

            if (dist2 < scannerRadius) {
              const dx12 = p.x - p2.x
              const dy12 = p.y - p2.y
              const d12 = Math.sqrt(dx12 * dx12 + dy12 * dy12)

              if (d12 < 150) {
                ctx.beginPath()
                ctx.moveTo(p.x, p.y)
                ctx.lineTo(p2.x, p2.y)
                ctx.strokeStyle = `rgba(${p.risk > 70 ? '255, 0, 60' : '0, 255, 157'}, ${opacity * 0.4})`
                ctx.lineWidth = 0.5
                ctx.stroke()
              }
            }
          })

          // Draw node
          ctx.beginPath()
          ctx.arc(p.x, p.y, 2, 0, Math.PI * 2)
          ctx.fillStyle = p.risk > 70 ? '#ff003c' : '#00ff9d'
          ctx.fill()

          // Text labels
          if (dist < 80) {
            ctx.font = '10px monospace'
            ctx.fillStyle = `rgba(${p.risk > 70 ? '255, 0, 60' : '0, 255, 157'}, ${opacity})`
            ctx.fillText(`${p.id}`, p.x + 6, p.y + 4)
            ctx.fillText(`RISK: ${p.risk.toFixed(1)}%`, p.x + 6, p.y + 16)
          }
        }
      })

      // Scanning text near mouse
      if (mouse.x > 0) {
        ctx.font = '11px monospace'
        ctx.fillStyle = 'rgba(0, 255, 157, 0.6)'
        const scanText = frame % 60 < 30 ? 'SCANNING...' : 'SCANNING'
        ctx.fillText(scanText, mouse.x + 20, mouse.y - 20)
        ctx.fillText(`X:${mouse.x.toFixed(0)} Y:${mouse.y.toFixed(0)}`, mouse.x + 20, mouse.y - 8)
      }

      requestAnimationFrame(animate)
    }

    animate()

    return () => {
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [active])

  if (!active) return null

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2,
        pointerEvents: 'none',
      }}
    />
  )
}

export default NetworkScanner
