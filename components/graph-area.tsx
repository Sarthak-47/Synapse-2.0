"use client"

import * as React from "react"
import * as d3 from "d3"
import { CONTENT_TYPE_CONFIG } from "@/lib/content-types"
import type { TextBlock } from "@/components/tile-card"
import type { Contradiction } from "@/lib/ai-contradiction"
import { GraphDetailPanel } from "./graph-detail-panel"
import { useModKey } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

interface SimNode extends d3.SimulationNodeDatum {
  id: string
  block?: TextBlock
  isSynthesis?: boolean
  synthesisText?: string
  synthesisGenerating?: boolean
  degree: number
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  isSynthesisLink?: boolean
}

interface GraphAreaProps {
  blocks: TextBlock[]
  ghostNote?: { id: string; text: string; category: string; isGenerating: boolean }
  projectName: string
  onReEnrich:       (id: string) => void
  onChangeType:     (id: string, newType: import("@/lib/content-types").ContentType) => void
  onTogglePin:      (id: string) => void
  onEdit:           (id: string, text: string) => void
  onEditAnnotation: (id: string, annotation: string) => void
  highlightedBlockId?: string | null
  onHighlight?: (id: string | null) => void
  contradictions?: Contradiction[]
  isDetectingTensions?: boolean
  onDetectTensions?: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const R_MIN   = 22   // px — unconnected node
const R_MAX   = 34   // px — most connected node
const R_SYNTH = 34

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Degree = total edges touching this node (in + out). */
function calcDegrees(
  blocks: TextBlock[],
  ghostNote?: GraphAreaProps["ghostNote"],
): Map<string, number> {
  const deg = new Map<string, number>()
  const ensure = (id: string) => { if (!deg.has(id)) deg.set(id, 0) }

  for (const b of blocks) {
    ensure(b.id)
    if (!b.influencedBy?.length) continue
    for (const tid of b.influencedBy) {
      ensure(tid)
      deg.set(b.id, (deg.get(b.id) ?? 0) + 1)
      deg.set(tid,  (deg.get(tid)  ?? 0) + 1)
    }
  }

  if (ghostNote) {
    // Synthesis touches every block
    deg.set(ghostNote.id, blocks.length)
  }
  return deg
}

/** Radius for a node given its degree and the max degree in the graph. */
function calcR(degree: number, maxDeg: number): number {
  if (maxDeg === 0) return R_MIN
  return R_MIN + (R_MAX - R_MIN) * Math.sqrt(degree / maxDeg)
}

/**
 * Radial target distance from canvas centre.
 * High-degree nodes sit near centre; isolated ones at the outer ring.
 */
function radialTarget(degree: number, maxDeg: number, outerR: number): number {
  if (maxDeg === 0) return outerR * 0.72
  const t = degree / maxDeg                  // 0 (isolated) → 1 (hub)
  return outerR * (1 - t * 0.82)            // maps to outerR → outerR*0.18
}

function buildGraph(
  blocks: TextBlock[],
  ghostNote: GraphAreaProps["ghostNote"],
  cx: number,
  cy: number,
  existing: SimNode[],
  deg: Map<string, number>,
  maxDeg: number,
  outerR: number,
): { nodes: SimNode[]; links: SimLink[] } {
  const existMap = new Map(existing.map(n => [n.id, n]))
  const blockSet  = new Set(blocks.map(b => b.id))
  const nodes: SimNode[] = []
  const links: SimLink[] = []
  const edgeSet = new Set<string>()

  // ── Block nodes ──────────────────────────────────────────────────────────
  for (const b of blocks) {
    const d   = deg.get(b.id) ?? 0
    const prev = existMap.get(b.id)
    if (prev) {
      prev.block  = b
      prev.degree = d
      nodes.push(prev)
    } else {
      const r = radialTarget(d, maxDeg, outerR)
      const a = Math.random() * Math.PI * 2
      nodes.push({ id: b.id, block: b, degree: d, x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
    }
  }

  // ── Synthesis node ───────────────────────────────────────────────────────
  if (ghostNote) {
    const d   = deg.get(ghostNote.id) ?? blocks.length
    const prev = existMap.get(ghostNote.id)
    if (prev) {
      prev.synthesisText      = ghostNote.text
      prev.synthesisGenerating = ghostNote.isGenerating
      prev.degree              = d
      nodes.push(prev)
    } else {
      nodes.push({
        id: ghostNote.id,
        isSynthesis: true,
        synthesisText: ghostNote.text,
        synthesisGenerating: ghostNote.isGenerating,
        degree: d,
        x: cx + (Math.random() - 0.5) * 40,
        y: cy + (Math.random() - 0.5) * 40,
      })
    }
  }

  // ── Links ────────────────────────────────────────────────────────────────
  for (const b of blocks) {
    if (!b.influencedBy?.length) continue
    for (const tid of b.influencedBy) {
      if (!blockSet.has(tid)) continue
      const key = [b.id, tid].sort().join("§")
      if (edgeSet.has(key)) continue
      edgeSet.add(key)
      links.push({ source: b.id, target: tid })
    }
  }

  if (ghostNote) {
    for (const b of blocks) {
      links.push({ source: ghostNote.id, target: b.id, isSynthesisLink: true })
    }
  }

  return { nodes, links }
}

// ─── Hull rendering helpers ───────────────────────────────────────────────────

/**
 * D3 line generator configured for Catmull-Rom closed curves.
 * alpha: 0.5 is the "centripetal" parameterisation which produces smooth,
 * self-intersection-free curves — important for concave hull shapes.
 */
const hullLine = d3.line<[number, number]>()
  .x(d => d[0])
  .y(d => d[1])
  .curve(d3.curveCatmullRomClosed.alpha(0.5))

/**
 * Computes an SVG path string for a smooth convex hull enclosing a group of nodes.
 *
 * How it works:
 *   1. For each node, generate 8 sample points on a circle of radius = node
 *      radius + 38px padding (N/S/E/W + four diagonals at 45°). This ensures
 *      the hull encloses the full visual disc of the node, not just its centre.
 *   2. Run d3.polygonHull (Graham scan) on all sampled points to get the convex
 *      hull polygon.
 *   3. Trace a Catmull-Rom closed curve through the hull vertices for a smooth
 *      organic shape rather than sharp-cornered polygon.
 *
 * Returns null if fewer than 3 points are available (hull is degenerate).
 */
function smoothHull(nodes: SimNode[], maxDeg: number): string | null {
  if (nodes.length === 0) return null
  const pts: [number, number][] = []
  for (const n of nodes) {
    if (n.x == null || n.y == null) continue
    const r = calcR(n.degree, maxDeg) + 38   // outer radius including padding
    const d = r * 0.707                        // diagonal distance (r * cos 45°)
    // 8 sample points per node: cardinal + intercardinal directions
    pts.push(
      [n.x + r, n.y], [n.x - r, n.y],
      [n.x, n.y + r], [n.x, n.y - r],
      [n.x + d, n.y + d], [n.x - d, n.y + d],
      [n.x + d, n.y - d], [n.x - d, n.y - d],
    )
  }
  if (pts.length < 3) return null
  const hull = d3.polygonHull(pts)
  if (!hull) return null
  return hullLine(hull) ?? null
}

/** Quadratic bezier arcing gently outward from the midpoint. */
function arcPath(sx: number, sy: number, tx: number, ty: number, cx: number, cy: number): string {
  const mx = (sx + tx) / 2
  const my = (sy + ty) / 2
  const dx = mx - cx
  const dy = my - cy
  const d  = Math.hypot(dx, dy)
  if (d < 1) return `M ${sx} ${sy} L ${tx} ${ty}`
  const f = Math.min(38, d * 0.09) / d
  return `M ${sx} ${sy} Q ${mx + dx * f} ${my + dy * f} ${tx} ${ty}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GraphArea({
  blocks,
  ghostNote,
  projectName,
  onReEnrich,
  onChangeType,
  onTogglePin,
  onEdit,
  onEditAnnotation,
  highlightedBlockId,
  onHighlight,
  contradictions = [],
  isDetectingTensions = false,
  onDetectTensions,
}: GraphAreaProps) {
  const mod = useModKey()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const svgRef       = React.useRef<SVGSVGElement>(null)
  const simRef       = React.useRef<d3.Simulation<SimNode, SimLink> | null>(null)
  const nodesRef     = React.useRef<SimNode[]>([])
  const linksRef     = React.useRef<SimLink[]>([])
  const dimsRef      = React.useRef({ w: 900, h: 600 })

  const [, forceUpdate]   = React.useReducer(x => x + 1, 0)
  const [dims, setDims]   = React.useState({ w: 900, h: 600 })
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [hoveredId,  setHoveredId]  = React.useState<string | null>(null)
  const [tooltip,           setTooltip]           = React.useState<{ id: string; x: number; y: number } | null>(null)
  const [transform,         setTransform]         = React.useState({ x: 0, y: 0, k: 1 })
  const [filterType,        setFilterType]        = React.useState<import("@/lib/content-types").ContentType | null>(null)
  const [contradictionTip,  setContradictionTip]  = React.useState<{ reason: string; x: number; y: number } | null>(null)

  const isPanning   = React.useRef(false)
  const didPan      = React.useRef(false)
  const panStart    = React.useRef({ mx: 0, my: 0, tx: 0, ty: 0 })
  const draggedNode = React.useRef<SimNode | null>(null)

  // ── Container size ───────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(e => {
      const { width, height } = e[0].contentRect
      dimsRef.current = { w: width, h: height }
      setDims({ w: width, h: height })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  React.useEffect(() => { dimsRef.current = dims }, [dims])

  // ── Init simulation once ─────────────────────────────────────────────────
  React.useEffect(() => {
    simRef.current = d3
      .forceSimulation<SimNode>([])
      .force("link",
        d3.forceLink<SimNode, SimLink>([])
          .id(d => d.id)
          .distance(l => (l as SimLink).isSynthesisLink ? 180 : 120)
          .strength(l => (l as SimLink).isSynthesisLink ? 0.03 : 0.30),
      )
      .force("charge",  d3.forceManyBody<SimNode>().strength(n => n.isSynthesis ? -700 : -420))
      .force("collide", d3.forceCollide<SimNode>().radius(n => calcR(n.degree, 1) + 30).strength(0.88))
      .alphaDecay(0.012)
      .velocityDecay(0.38)
      .on("tick", () => forceUpdate())
      .stop()
    return () => { simRef.current?.stop() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rebuild graph when data changes ─────────────────────────────────────
  React.useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    const { w, h } = dimsRef.current
    const cx = w / 2
    const cy = h / 2
    const outerR = Math.min(w, h) * 0.43

    const deg    = calcDegrees(blocks, ghostNote)
    const maxDeg = Math.max(...deg.values(), 1)

    const prevBlockCount = nodesRef.current.filter(n => !n.isSynthesis).length
    const { nodes, links } = buildGraph(blocks, ghostNote, cx, cy, nodesRef.current, deg, maxDeg, outerR)

    nodesRef.current = nodes
    linksRef.current = links

    // Update collision radii dynamically (degree may have changed)
    ;(sim.force("collide") as d3.ForceCollide<SimNode>)
      .radius(n => calcR(n.degree, maxDeg) + 30)

    // Radial force: high-degree → centre, low-degree → outer ring
    sim.force("radial",
      d3.forceRadial<SimNode>(
        n => n.isSynthesis ? 0 : radialTarget(n.degree, maxDeg, outerR),
        cx, cy,
      ).strength(n => n.isSynthesis ? 0.25 : 0.10),
    )

    // Weak gravity so nodes don't drift off canvas
    sim.force("gravX", d3.forceX(cx).strength(0.018))
    sim.force("gravY", d3.forceY(cy).strength(0.018))

    sim.nodes(nodesRef.current)
    ;(sim.force("link") as d3.ForceLink<SimNode, SimLink>).links(linksRef.current)

    const isNew = blocks.length > prevBlockCount
    sim.alpha(isNew ? 0.45 : 0.20).restart()
  }, [blocks, ghostNote]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Re-anchor radial centre on resize ────────────────────────────────────
  React.useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    const cx = dims.w / 2
    const cy = dims.h / 2
    const outerR = Math.min(dims.w, dims.h) * 0.43
    const deg    = calcDegrees(blocks, ghostNote)
    const maxDeg = Math.max(...deg.values(), 1)
    sim.force("radial",
      d3.forceRadial<SimNode>(
        n => n.isSynthesis ? 0 : radialTarget(n.degree, maxDeg, outerR),
        cx, cy,
      ).strength(n => n.isSynthesis ? 0.25 : 0.10),
    )
    sim.force("gravX", d3.forceX(cx).strength(0.018))
    sim.force("gravY", d3.forceY(cy).strength(0.018))
    sim.alpha(0.12).restart()
  }, [dims]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Escape key to clear selection ────────────────────────────────────────
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedId(null) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // ── Zoom ─────────────────────────────────────────────────────────────────
  const handleWheel = React.useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const f    = e.deltaY < 0 ? 1.1 : 0.9
    const rect = svgRef.current!.getBoundingClientRect()
    const mx   = e.clientX - rect.left
    const my   = e.clientY - rect.top
    setTransform(t => {
      const k = Math.max(0.2, Math.min(5, t.k * f))
      return { x: mx - (mx - t.x) * (k / t.k), y: my - (my - t.y) * (k / t.k), k }
    })
  }, [])

  // ── Pan ──────────────────────────────────────────────────────────────────
  const handleSvgMouseDown = React.useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest(".graph-node")) return
    isPanning.current = true
    didPan.current    = false
    panStart.current  = { mx: e.clientX, my: e.clientY, tx: transform.x, ty: transform.y }
  }, [transform])

  const handleSvgMouseMove = React.useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (draggedNode.current && simRef.current) {
      const rect = svgRef.current!.getBoundingClientRect()
      draggedNode.current.fx = (e.clientX - rect.left  - transform.x) / transform.k
      draggedNode.current.fy = (e.clientY - rect.top   - transform.y) / transform.k
      // Kick simulation on first actual movement (not on mere mousedown)
      if (simRef.current.alpha() < 0.1) simRef.current.alphaTarget(0.3).restart()
      return
    }
    if (!isPanning.current) return
    didPan.current = true
    setTransform(t => ({
      ...t,
      x: panStart.current.tx + (e.clientX - panStart.current.mx),
      y: panStart.current.ty + (e.clientY - panStart.current.my),
    }))
  }, [transform])

  const handleSvgMouseUp = React.useCallback(() => {
    isPanning.current = false
    if (draggedNode.current) {
      draggedNode.current.fx = null
      draggedNode.current.fy = null
      simRef.current?.alphaTarget(0)
      draggedNode.current = null
    }
  }, [])

  // ── Hover / index-highlight / selection: connected set ───────────────────
  // selectedId is included so selecting a node keeps its connections lit even
  // after the cursor moves away; hover and index-highlight take priority.
  const focalId = hoveredId ?? selectedId ?? highlightedBlockId ?? null

  const connectedToFocal = React.useMemo(() => {
    if (!focalId) return null
    const ids = new Set<string>([focalId])
    if (nodesRef.current.find(n => n.id === focalId)?.isSynthesis) {
      for (const n of nodesRef.current) ids.add(n.id)
    } else {
      const b = blocks.find(x => x.id === focalId)
      if (b?.influencedBy) for (const id of b.influencedBy) ids.add(id)
      for (const x of blocks) if (x.influencedBy?.includes(focalId)) ids.add(x.id)
    }
    return ids
  }, [focalId, blocks])

  const selectedBlock = React.useMemo(
    () => blocks.find(b => b.id === selectedId) ?? null,
    [blocks, selectedId],
  )

  // Derive maxDeg for render (so node sizes are consistent between ticks)
  const maxDeg = React.useMemo(() => {
    const deg = calcDegrees(blocks, ghostNote)
    return Math.max(...deg.values(), 1)
  }, [blocks, ghostNote])

  const cx = dims.w / 2
  const cy = dims.h / 2
  const { x: tx, y: ty, k: tk } = transform

  // Hull groups — built each render pass because node positions change on every
  // simulation tick (forceUpdate fires). Synthesis nodes are excluded since they
  // have no content type and should not be included in any hull region.
  const hullGroups = new Map<import("@/lib/content-types").ContentType, SimNode[]>()
  for (const node of nodesRef.current) {
    if (!node.block || node.isSynthesis) continue
    const t = node.block.contentType
    if (!hullGroups.has(t)) hullGroups.set(t, [])
    hullGroups.get(t)!.push(node)
  }

  /**
   * Fits all nodes into the viewport by computing the bounding box of current
   * node positions and deriving the correct scale (k) and translation (x, y).
   *
   * Steps:
   *   1. Find min/max x and y across all positioned nodes, adding 60px padding.
   *   2. Compute the scale that fits the bounding box within the SVG dimensions,
   *      capped at 0.95 so there is always a small margin.
   *   3. Translate so the bounding box centre aligns with the viewport centre.
   */
  const resetView = () => {
    const nodes = nodesRef.current.filter(n => n.x != null && n.y != null)
    if (nodes.length === 0) { setTransform({ x: 0, y: 0, k: 1 }); return }
    const xs = nodes.map(n => n.x!)
    const ys = nodes.map(n => n.y!)
    const minX = Math.min(...xs) - 60
    const maxX = Math.max(...xs) + 60
    const minY = Math.min(...ys) - 60
    const maxY = Math.max(...ys) + 60
    const k = Math.min(0.95, Math.min(dims.w / (maxX - minX), dims.h / (maxY - minY)))
    const x = dims.w / 2 - k * ((minX + maxX) / 2)
    const y = dims.h / 2 - k * ((minY + maxY) / 2)
    setTransform({ x, y, k })
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full w-full overflow-hidden bg-background">

      {/* ── Graph canvas ─────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ width: selectedId ? "70%" : "100%" }}
        className="relative h-full transition-all duration-300 overflow-hidden"
      >
        {blocks.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-8 w-[420px]">
              <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-foreground/35">force-directed graph view</p>

              <div className="flex flex-col gap-5 w-full">
                {([
                  { color: "var(--type-claim)",    label: "claim",    text: "Caffeine improves short-term recall by ~15%" },
                  { color: "var(--type-entity)",   label: "entity",   text: "Adam Grant — organisational psychologist" },
                  { color: "var(--type-question)", label: "question", text: "Does creativity require periods of solitude?" },
                  { color: "var(--type-idea)",     label: "idea",     text: "Collaboration refines ideas, solitude generates them" },
                ] as const).map(({ color, label, text }) => (
                  <div key={label} className="flex items-start gap-4">
                    <div className="w-0.5 self-stretch rounded-full shrink-0 mt-0.5" style={{ background: color }} />
                    <div className="flex flex-col gap-1">
                      <span className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color }}>{label}</span>
                      <p className="text-[14px] leading-snug text-foreground/50">{text}</p>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-[13px] text-white uppercase tracking-[0.15em] whitespace-nowrap">
                {`type anything · #type to classify · ${mod}K for commands`}
              </p>
            </div>
          </div>
        )}

        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          className="select-none"
          style={{ cursor: isPanning.current ? "grabbing" : "grab" }}
          onWheel={handleWheel}
          onMouseDown={handleSvgMouseDown}
          onMouseMove={handleSvgMouseMove}
          onMouseUp={handleSvgMouseUp}
          onMouseLeave={handleSvgMouseUp}
          onClick={() => { if (!didPan.current) setSelectedId(null) }}
        >
          <defs>
            <filter id="glow-synth" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="7" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <filter id="glow-hub" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <radialGradient id="synth-grad" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="var(--type-thesis)" stopOpacity="1" />
              <stop offset="100%" stopColor="var(--type-claim)"  stopOpacity="0.8" />
            </radialGradient>
          </defs>

          {/* Project name — ghost label in background at canvas centre */}
          <text
            x={cx + tx}
            y={cy + ty}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={Math.max(11, 11 * tk)}
            fontFamily="monospace"
            fill="white"
            fillOpacity={Math.max(0, 0.06 - (nodesRef.current.length * 0.002))}
            style={{ pointerEvents: "none", userSelect: "none", letterSpacing: "0.08em" }}
          >
            {projectName.toUpperCase()}
          </text>

          <g transform={`translate(${tx},${ty}) scale(${tk})`}>

            {/* ── Category cluster hulls ───────────────────────────────── */}
            {/*
              One smooth convex hull per content type, drawn behind all nodes.
              pointerEvents: none so hulls never intercept node drag/click events.
              When filterType is active:
                - The selected type's hull brightens (fillOpacity 0.10, stroke 0.30).
                - All other hulls fade to near-invisible (0.01 / 0.03).
              Groups with fewer than 2 nodes are skipped (hull requires >= 3 points).
            */}
            <g style={{ pointerEvents: "none" }}>
              {Array.from(hullGroups.entries()).map(([type, nodes]) => {
                if (nodes.length < 2) return null
                const path = smoothHull(nodes, maxDeg)
                if (!path) return null
                const config = CONTENT_TYPE_CONFIG[type]
                const isFiltered = filterType === type
                const isOtherFiltered = filterType != null && filterType !== type
                return (
                  <path
                    key={type}
                    d={path}
                    fill={config.accentVar}
                    fillOpacity={isOtherFiltered ? 0.01 : isFiltered ? 0.10 : 0.045}
                    stroke={config.accentVar}
                    strokeOpacity={isOtherFiltered ? 0.03 : isFiltered ? 0.30 : 0.12}
                    strokeWidth={isFiltered ? 1.5 : 1}
                    style={{ transition: "fill-opacity 0.2s, stroke-opacity 0.2s" }}
                  />
                )
              })}
            </g>

            {/* ── Links ────────────────────────────────────────────────── */}
            <g>
              {linksRef.current.map((link, i) => {
                const s = link.source as SimNode
                const t = link.target as SimNode
                if (s.x == null || s.y == null || t.x == null || t.y == null) return null
                const [sx, sy, tx2, ty2] = [s.x, s.y, t.x, t.y]

                const isSynth = (link as SimLink).isSynthesisLink
                const dimmedByFilter = filterType != null && !isSynth &&
                  s.block?.contentType !== filterType && t.block?.contentType !== filterType
                const dimmedByFocus  = filterType == null && focalId != null &&
                  s.id !== focalId && t.id !== focalId
                const dimmed = dimmedByFilter || dimmedByFocus
                const highlighted = !dimmed && focalId != null && !isSynth

                const d = isSynth
                  ? `M ${sx} ${sy} L ${tx2} ${ty2}`
                  : arcPath(sx, sy, tx2, ty2, cx, cy)

                return (
                  <path
                    key={i}
                    d={d}
                    stroke="white"
                    strokeWidth={isSynth ? 0.5 : highlighted ? 2 : 1.2}
                    strokeDasharray={isSynth ? "3 7" : undefined}
                    strokeOpacity={
                      dimmed      ? 0.02 :
                      highlighted ? 0.75 :
                      isSynth     ? 0.05 :
                      0.22
                    }
                    fill="none"
                    style={{ transition: "stroke-opacity 0.15s, stroke-width 0.15s" }}
                  />
                )
              })}
            </g>

            {/* ── Contradiction edges (red dashed) ────────────────────── */}
            {/*
              One <line> per detected contradiction pair, rendered above regular
              edges but below nodes. Each line:
                - Is dashed (5px on, 4px off) and semi-transparent red.
                - Has onMouseEnter/Leave handlers that show a dark red tooltip
                  with the one-sentence reason for the contradiction.
                - Has a small filled circle at the midpoint as a visual anchor
                  (the circle has pointerEvents: none so it doesn't block the
                  line's hover events).
              Nodes that appear in any contradiction also receive a red dashed
              ring (see isContradicted in the Nodes section below).
            */}
            <g>
              {contradictions.map(c => {
                const nodeA = nodesRef.current.find(n => n.id === c.blockAId)
                const nodeB = nodesRef.current.find(n => n.id === c.blockBId)
                if (!nodeA || !nodeB || nodeA.x == null || nodeA.y == null || nodeB.x == null || nodeB.y == null) return null
                const mx = (nodeA.x + nodeB.x) / 2
                const my = (nodeA.y + nodeB.y) / 2
                return (
                  <g key={c.id}>
                    <line
                      x1={nodeA.x} y1={nodeA.y}
                      x2={nodeB.x} y2={nodeB.y}
                      stroke="rgb(239,68,68)"
                      strokeWidth={1.5}
                      strokeDasharray="5 4"
                      strokeOpacity={0.55}
                      style={{ cursor: "help" }}
                      onMouseEnter={e => {
                        const rect = svgRef.current!.getBoundingClientRect()
                        setContradictionTip({
                          reason: c.reason,
                          x: e.clientX - rect.left,
                          y: e.clientY - rect.top,
                        })
                      }}
                      onMouseLeave={() => setContradictionTip(null)}
                    />
                    {/* Mid-point marker — visual anchor for the contradiction edge */}
                    <circle
                      cx={mx} cy={my} r={4}
                      fill="rgb(239,68,68)"
                      fillOpacity={0.7}
                      stroke="black"
                      strokeWidth={0.5}
                      strokeOpacity={0.4}
                      style={{ pointerEvents: "none" }}
                    />
                  </g>
                )
              })}
            </g>

            {/* ── Nodes ────────────────────────────────────────────────── */}
            <g>
              {nodesRef.current.map(node => {
                if (node.x == null || node.y == null) return null

                const isSelected  = node.id === selectedId
                const isHovered   = node.id === hoveredId
                const isDimmedByFilter = filterType != null && !node.isSynthesis && node.block?.contentType !== filterType
                const isDimmedByFocus  = filterType == null && focalId != null && !isHovered &&
                  node.id !== focalId &&
                  (!connectedToFocal || !connectedToFocal.has(node.id))
                const isDimmed = isDimmedByFilter || isDimmedByFocus
                const isEnriching    = node.block?.isEnriching
                const isHub          = node.degree >= 3 && !node.isSynthesis
                const isContradicted = !node.isSynthesis && contradictions.some(
                  c => c.blockAId === node.id || c.blockBId === node.id
                )

                const r      = node.isSynthesis ? R_SYNTH : calcR(node.degree, maxDeg)
                const config = node.block ? CONTENT_TYPE_CONFIG[node.block.contentType] : null
                const Icon   = config?.icon ?? null
                const accent = config?.accentVar ?? "var(--type-thesis)"

                const fill = node.isSynthesis ? "url(#synth-grad)" : (config?.accentVar ?? "white")

                // Short label: first 4 words, truncated at 22 chars
                const labelWords = (node.block?.text ?? "").split(/\s+/).slice(0, 4).join(" ")
                const label = labelWords.length > 22 ? labelWords.slice(0, 22) + "…" : labelWords

                return (
                  <g
                    key={node.id}
                    className="graph-node"
                    transform={`translate(${node.x},${node.y})`}
                    style={{
                      opacity:    isDimmed ? 0.08 : 1,
                      filter:     node.isSynthesis ? "url(#glow-synth)" : isHub ? "url(#glow-hub)" : undefined,
                      cursor:     "pointer",
                      transition: "opacity 0.18s",
                    }}
                    onMouseDown={e => {
                      e.stopPropagation()
                      draggedNode.current = node
                    }}
                    onClick={e => {
                      e.stopPropagation()
                      setSelectedId(prev => prev === node.id ? null : node.id)
                    }}
                    onMouseEnter={e => {
                      setHoveredId(node.id)
                      const rect = svgRef.current!.getBoundingClientRect()
                      setTooltip({ id: node.id, x: e.clientX - rect.left, y: e.clientY - rect.top })
                    }}
                    onMouseMove={e => {
                      const rect = svgRef.current!.getBoundingClientRect()
                      setTooltip({ id: node.id, x: e.clientX - rect.left, y: e.clientY - rect.top })
                    }}
                    onMouseLeave={() => { setHoveredId(null); setTooltip(null) }}
                  >
                    {/* Index-highlight ring */}
                    {node.id === highlightedBlockId && !isHovered && !isSelected && (
                      <circle
                        r={r + 10}
                        fill="none"
                        stroke={node.isSynthesis ? "var(--type-thesis)" : accent}
                        strokeWidth={1.2}
                        strokeOpacity={0.55}
                      />
                    )}

                    {/* Selected / hovered ring */}
                    {(isSelected || isHovered) && (
                      <circle
                        r={r + 9}
                        fill="none"
                        stroke={node.isSynthesis ? "var(--type-thesis)" : accent}
                        strokeWidth={isSelected ? 1.5 : 1}
                        strokeOpacity={isSelected ? 0.65 : 0.35}
                      />
                    )}

                    {/* Synthesis pulse rings */}
                    {node.isSynthesis && (
                      <>
                        <circle r={r + 16} fill="none" stroke="var(--type-thesis)" strokeWidth={0.5} strokeOpacity={0.14} />
                        <circle r={r + 30} fill="none" stroke="var(--type-thesis)" strokeWidth={0.5} strokeOpacity={0.06} />
                      </>
                    )}

                    {/* Contradiction ring */}
                    {isContradicted && (
                      <circle
                        r={r + 7}
                        fill="none"
                        stroke="rgb(239,68,68)"
                        strokeWidth={1.2}
                        strokeOpacity={0.50}
                        strokeDasharray="4 3"
                      />
                    )}

                    {/* Hub degree indicator ring (for well-connected nodes) */}
                    {isHub && !node.isSynthesis && (
                      <circle
                        r={r + 5}
                        fill="none"
                        stroke={accent}
                        strokeWidth={0.8}
                        strokeOpacity={0.22}
                      />
                    )}

                    {/* Enriching ring — transformBox:fill-box rotates around element centre */}
                    {isEnriching && (
                      <circle
                        r={r + 13}
                        fill="none"
                        stroke={accent}
                        strokeWidth={1.2}
                        strokeDasharray="5 4"
                        strokeOpacity={0.55}
                        style={{
                          transformBox: "fill-box" as React.CSSProperties["transformBox"],
                          transformOrigin: "center",
                          animation: "spin 2.5s linear infinite",
                        }}
                      />
                    )}

                    {/* Main circle */}
                    <circle
                      r={r}
                      fill={fill}
                      fillOpacity={isSelected ? 1 : isHovered ? 0.97 : 0.90}
                      stroke={isSelected ? accent : "none"}
                      strokeWidth={isSelected ? 1.5 : 0}
                    />

                    {/* Icon */}
                    {Icon && (
                      <foreignObject
                        x={-17} y={-17}
                        width={34} height={34}
                        style={{ pointerEvents: "none" }}
                      >
                        <div
                          // @ts-ignore
                          xmlns="http://www.w3.org/1999/xhtml"
                          style={{ width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}
                        >
                          <Icon style={{ width: 19, height: 19, color: "white", opacity: 0.92 }} />
                        </div>
                      </foreignObject>
                    )}

                    {/* Synthesis glyph */}
                    {node.isSynthesis && (
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={13}
                        fill="white"
                        fillOpacity={0.9}
                        style={{ pointerEvents: "none" }}
                      >
                        ✦
                      </text>
                    )}

                    {/* Pin indicator */}
                    {node.block?.isPinned && (
                      <circle
                        cx={r * 0.7}
                        cy={-r * 0.7}
                        r={4}
                        fill={accent}
                        fillOpacity={0.85}
                      />
                    )}

                    {/* Node text label — fades in at normal zoom */}
                    {!node.isSynthesis && tk >= 0.65 && (
                      <text
                        y={r + 14}
                        textAnchor="middle"
                        dominantBaseline="hanging"
                        fontSize={Math.max(8, Math.min(11, 9 / tk))}
                        fontFamily="monospace"
                        fill="white"
                        fillOpacity={Math.min(0.55, (tk - 0.55) * 2.2)}
                        style={{ pointerEvents: "none", userSelect: "none" }}
                      >
                        {(node.block?.text ?? "").slice(0, 26).trimEnd()}
                        {(node.block?.text ?? "").length > 26 ? "..." : ""}
                      </text>
                    )}

                  </g>
                )
              })}
            </g>
          </g>
        </svg>

        {/* ── Floating tooltip ──────────────────────────────────────────── */}
        {tooltip && (() => {
          const node = nodesRef.current.find(n => n.id === tooltip.id)
          if (!node) return null
          const text = node.isSynthesis
            ? (node.synthesisText ?? "Synthesis")
            : (node.block?.text ?? "")
          const config = node.block ? CONTENT_TYPE_CONFIG[node.block.contentType] : null
          const accent = config?.accentVar ?? "var(--type-thesis)"
          const tipX = Math.min(tooltip.x + 14, (selectedId ? dims.w * 0.7 : dims.w) - 300)
          const tipY = tooltip.y - 16
          return (
            <div
              className="absolute z-50 pointer-events-none"
              style={{ left: tipX, top: tipY, transform: "translateY(-100%)" }}
            >
              <div
                className="rounded-sm shadow-[0_4px_24px_rgba(0,0,0,0.55)] border border-white/10 overflow-hidden"
                style={{ minWidth: 190, maxWidth: 300 }}
              >
                <div className="flex items-center gap-2 px-2.5 py-1.5" style={{ background: accent }}>
                  {config?.icon && React.createElement(config.icon, {
                    className: "h-3 w-3 flex-shrink-0",
                    style: { color: "black", opacity: 0.7 },
                  })}
                  <span className="font-mono text-[9px] font-black uppercase tracking-widest text-black/70">
                    {node.isSynthesis ? "Synthesis" : config?.label}
                  </span>
                  {node.block?.category && (
                    <span className="ml-auto font-mono text-[8px] text-black/50 truncate max-w-[90px]">
                      {node.block.category}
                    </span>
                  )}
                  {node.degree > 0 && (
                    <span className="ml-auto font-mono text-[8px] text-black/40">
                      {node.degree} link{node.degree !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <div className="bg-card/95 backdrop-blur-sm px-3 py-2.5">
                  <p className="text-sm font-semibold leading-snug text-foreground">{text}</p>
                </div>
              </div>
              <div
                className="mx-4 h-2 w-2 rotate-45 border-b border-r border-white/10 bg-card/95"
                style={{ marginTop: -1 }}
              />
            </div>
          )
        })()}

        {/* ── Legend: centrality explanation ───────────────────────────── */}
        {blocks.length > 2 && (
          <div className="absolute bottom-4 right-4 pointer-events-none flex flex-col items-end gap-1">
            <span className="font-mono text-[7.5px] text-muted-foreground/20 uppercase tracking-widest">centre = most connected</span>
            <span className="font-mono text-[7.5px] text-muted-foreground/20 uppercase tracking-widest">edge = isolated</span>
          </div>
        )}

        {/* ── Hints ─────────────────────────────────────────────────────── */}
        <div className="absolute bottom-4 left-4 pointer-events-none">
          <span className="font-mono text-[8px] text-muted-foreground/22 uppercase tracking-widest">
            scroll to zoom · drag to pan · drag node to reposition
          </span>
        </div>

        {/* ── Top bar: node count + reset view + tensions ──────────────── */}
        {blocks.length > 0 && (
          <div className="absolute top-4 left-4 flex items-center gap-3">
            <span className="font-mono text-[8px] text-muted-foreground/22 uppercase tracking-widest pointer-events-none">
              {blocks.length} node{blocks.length !== 1 ? "s" : ""}
              {ghostNote ? " · synthesis active" : ""}
              {contradictions.length > 0 ? ` · ${contradictions.length} tension${contradictions.length !== 1 ? "s" : ""}` : ""}
            </span>
            <button
              onClick={resetView}
              className="font-mono text-[8px] text-muted-foreground/30 uppercase tracking-widest hover:text-muted-foreground/60 transition-colors"
              title="Reset view"
            >
              reset
            </button>
            {onDetectTensions && (
              <button
                onClick={onDetectTensions}
                disabled={isDetectingTensions}
                className="font-mono text-[8px] uppercase tracking-widest transition-colors disabled:opacity-30"
                style={{ color: contradictions.length > 0 ? "rgb(239,68,68)" : undefined }}
                title="Detect contradictions between notes"
              >
                {isDetectingTensions ? "detecting..." : contradictions.length > 0 ? "re-detect" : "detect tensions"}
              </button>
            )}
          </div>
        )}

        {/* ── Contradiction tooltip ─────────────────────────────────────── */}
        {contradictionTip && (
          <div
            className="absolute z-50 pointer-events-none"
            style={{ left: contradictionTip.x + 10, top: contradictionTip.y - 40 }}
          >
            <div className="rounded-sm bg-red-950/90 border border-red-500/30 px-2.5 py-1.5 shadow-lg max-w-[220px]">
              <p className="font-mono text-[9px] uppercase tracking-widest text-red-400/70 mb-0.5">Tension</p>
              <p className="text-[11px] text-red-200/80 leading-snug">{contradictionTip.reason}</p>
            </div>
          </div>
        )}

        {/* ── Category legend ───────────────────────────────────────────── */}
        {/*
          Floating legend in the top-right listing all content types present in
          the graph (sorted by node count, most common first). Only shown when
          there are at least 2 distinct types.

          Clicking a type sets filterType which:
            - Brightens that type's hull and dims all others.
            - Dims nodes and edges not belonging to that type.
          Clicking the active type again (or the "clear" button) resets to no filter.
        */}
        {hullGroups.size > 1 && (
          <div className="absolute top-4 right-4 flex flex-col items-end gap-1">
            {Array.from(hullGroups.entries())
              .sort((a, b) => b[1].length - a[1].length)
              .map(([type, nodes]) => {
                const config = CONTENT_TYPE_CONFIG[type]
                const isActive = filterType === type
                return (
                  <button
                    key={type}
                    onClick={() => setFilterType(prev => prev === type ? null : type)}
                    className="flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 transition-all"
                    style={{
                      opacity: filterType != null && !isActive ? 0.3 : 1,
                      background: isActive ? config.accentVar + "20" : "transparent",
                    }}
                  >
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: config.accentVar }}
                    />
                    <span
                      className="font-mono text-[8px] uppercase tracking-widest"
                      style={{ color: isActive ? config.accentVar : "rgb(var(--muted-foreground) / 0.45)" }}
                    >
                      {config.label}
                    </span>
                    <span className="font-mono text-[7px]" style={{ color: "rgb(var(--muted-foreground) / 0.25)" }}>
                      {nodes.length}
                    </span>
                  </button>
                )
              })}
            {filterType != null && (
              <button
                onClick={() => setFilterType(null)}
                className="font-mono text-[7px] uppercase tracking-widest text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors mt-0.5 pr-1.5"
              >
                clear
              </button>
            )}
          </div>
        )}

      </div>

      {/* ── Detail panel (30%) ─────────────────────────────────────────────── */}
      {selectedId && (
        <div className="h-full overflow-hidden transition-all duration-300" style={{ width: "30%" }}>
          <GraphDetailPanel
            block={selectedBlock}
            allBlocks={blocks}
            onClose={() => setSelectedId(null)}
            onSelectNode={id => setSelectedId(id)}
            onReEnrich={onReEnrich}
            onChangeType={onChangeType}
            onTogglePin={onTogglePin}
            onEdit={onEdit}
            onEditAnnotation={onEditAnnotation}
          />
        </div>
      )}
    </div>
  )
}
