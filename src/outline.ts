import type { TTF } from 'fonteditor-core'
import type { PcfMetrics } from './types.js'

interface Edge {
  x: number
  y: number
  direction: number
  used: boolean
}

const steps = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const

/** Trace exposed pixel edges, with clockwise exteriors and counterclockwise holes in font coordinates. */
export const traceBitmap = (rows: string[], metric: PcfMetrics, scale: number): TTF.Contour[] => {
  const edges: Edge[] = []
  const outgoing = new Map<string, Edge[]>()
  const addEdge = (x: number, y: number, direction: number) => {
    const edge = { x, y, direction, used: false }
    edges.push(edge)
    const key = `${x},${y}`
    const list = outgoing.get(key) ?? []
    list.push(edge)
    outgoing.set(key, list)
  }
  const filled = (x: number, y: number) => rows[y]?.[x] === '#'
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      if (!filled(x, y)) continue
      if (!filled(x, y - 1)) addEdge(x, y, 0)
      if (!filled(x + 1, y)) addEdge(x + 1, y, 1)
      if (!filled(x, y + 1)) addEdge(x + 1, y + 1, 2)
      if (!filled(x - 1, y)) addEdge(x, y + 1, 3)
    }
  }
  const contours: TTF.Contour[] = []
  for (const start of edges) {
    if (start.used) continue
    const points: TTF.Contour = []
    let edge = start
    // Iterative traversal avoids stack overflows on long outlines.
    while (true) {
      edge.used = true
      points.push({ x: edge.x, y: edge.y, onCurve: true })
      const [dx, dy] = steps[edge.direction]
      const x = edge.x + dx
      const y = edge.y + dy
      if (x === start.x && y === start.y) break
      const candidates = outgoing.get(`${x},${y}`) ?? []
      // Turn right first at diagonal contacts to keep distinct pixels in separate contours.
      const next = [1, 0, 3, 2]
        .map(turn =>
          candidates.find(candidate => !candidate.used && candidate.direction === (edge.direction + turn) % 4),
        )
        .find(candidate => candidate !== undefined)
      if (!next) throw new Error('Cannot close bitmap contour')
      edge = next
    }
    const corners = points.filter((point, i) => {
      const previous = points[(i + points.length - 1) % points.length]
      const next = points[(i + 1) % points.length]
      return (point.x - previous.x) * (next.y - point.y) !== (point.y - previous.y) * (next.x - point.x)
    })
    contours.push(
      corners.map(point => ({
        x: (point.x + metric.leftSideBearing) * scale,
        y: (metric.ascent - point.y) * scale,
        onCurve: true,
      })),
    )
  }
  return contours
}
