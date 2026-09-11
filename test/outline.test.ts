import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TTF } from 'fonteditor-core'
import { traceBitmap } from '../src/outline.js'
import { metric } from './fixtures.js'

const signedArea = (contour: TTF.Contour) =>
  contour.reduce((area, point, i) => {
    const next = contour[(i + 1) % contour.length]
    return area + point.x * next.y - next.x * point.y
  }, 0) / 2

const winding = (contours: TTF.Contour[], x: number, y: number) => {
  let value = 0
  for (const contour of contours) {
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i]
      const b = contour[(i + 1) % contour.length]
      const cross = (b.x - a.x) * (y - a.y) - (x - a.x) * (b.y - a.y)
      if (a.y <= y && b.y > y && cross > 0) value++
      if (a.y > y && b.y <= y && cross < 0) value--
    }
  }
  return value
}

test('hole winding, diagonal contacts, side bearings, descenders and collinear simplification', () => {
  const contours = traceBitmap(['###', '# #', '###'], metric, 100)
  assert.equal(contours.length, 2)
  assert.deepEqual(
    contours.map(signedArea).sort((a, b) => a - b),
    [-90000, 10000],
  )
  assert.ok(contours.every(contour => contour.length === 4))
  assert.equal(Math.min(...contours.flat().map(point => point.x)), -100)
  assert.equal(Math.min(...contours.flat().map(point => point.y)), -100)
  assert.equal(traceBitmap(['# ', ' #'], metric, 1).length, 2)
  assert.deepEqual(traceBitmap([], metric, 1), [])
})

test('all 512 3×3 bitmaps retain their exact filled pixels and total area', () => {
  for (let mask = 0; mask < 512; mask++) {
    const rows = Array.from({ length: 3 }, (_, y) =>
      Array.from({ length: 3 }, (_, x) => (mask & (1 << (y * 3 + x)) ? '#' : ' ')).join(''),
    )
    const contours = traceBitmap(rows, metric, 1)
    let pixels = 0
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const filled = rows[y][x] === '#'
        assert.equal(
          winding(contours, x + metric.leftSideBearing + 0.5, metric.ascent - y - 0.5) !== 0,
          filled,
          `mask ${mask}, ${x},${y}`,
        )
        if (filled) pixels++
      }
    }
    assert.equal(-contours.reduce((sum, contour) => sum + signedArea(contour), 0) || 0, pixels)
  }
})

test('long contours do not recurse', () => {
  const contours = traceBitmap(['#'.repeat(20000)], metric, 1)
  assert.equal(contours.length, 1)
  assert.equal(contours[0].length, 4)
})
