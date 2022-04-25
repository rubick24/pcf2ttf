import opentype from 'opentype.js'
import { loadPcf, genGlyphArray } from './loadpcf.mjs'

const tables = await loadPcf('./assets/wenquanyi_9pt.pcf')
const scale = 100
const genPath = bIndex => {
  const glyphData = genGlyphArray(tables, bIndex)
  glyphData.reverse()
  const height = glyphData.length
  const width = glyphData[0].length
  const columns = Array.from({ length: height }, () => new Array(width + 1).fill(0))
  const rows = Array.from({ length: height + 1 }, () => new Array(width).fill(0))

  const metrics = tables['PCF_METRICS'].metrics[bIndex]
  const ascent = metrics.character_ascent
  const descent = metrics.character_descent

  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      if (glyphData[i][j] === '#') {
        // set 4 edge of this point
        columns[i][j] = 1 - columns[i][j]
        columns[i][j + 1] = 1 - columns[i][j + 1]
        rows[i][j] = 1 - rows[i][j]
        rows[i + 1][j] = 1 - rows[i + 1][j]
      }
    }
  }
  // set edge direction，1：left and down 2: right and up
  for (let i = 0; i < height + 1; i++) {
    for (let j = 0; j < width + 1; j++) {
      if (rows[i]?.[j] && glyphData[i - 1]?.[j] === '#') {
        rows[i][j] = 2
      }
      if (columns[i]?.[j] && glyphData[i][j - 1] === '#') {
        columns[i][j] = 2
      }
    }
  }

  const points = Array.from({ length: height + 1 }, () => new Array(width + 1).fill(false))

  const directionMap = {
    top: (i, j) => [i - 1, j],
    bottom: (i, j) => [i + 1, j],
    left: (i, j) => [i, j - 1],
    right: (i, j) => [i, j + 1]
  }
  const edgeMap = {
    top: (i, j) => [i - 1, j],
    bottom: (i, j) => [i, j],
    left: (i, j) => [i, j - 1],
    right: (i, j) => [i, j]
  }
  const getPointConnection = (i, j) => {
    const r = {}
    const dir = ['top', 'bottom', 'left', 'right']
    const neg = ['top', 'right']
    const vert = ['top', 'bottom']
    dir.forEach(edge => {
      const [ei, ej] = edgeMap[edge](i, j)
      const vertical = vert.includes(edge)
      const negative = neg.includes(edge)
      const targetVal = negative ? 2 : 1 // only visitable in allowed direction
      r[edge] = vertical ? columns[ei]?.[ej] === targetVal : rows[ei]?.[ej] === targetVal
    })
    r.count = r.top + r.bottom + r.left + r.right
    return r
  }

  const path = new opentype.Path()

  let lastDir = null

  const tp = (i, j, direction) => {
    const [ni, nj] = directionMap[direction](i, j)
    const [ei, ej] = edgeMap[direction](i, j)
    const vertical = ['top', 'bottom'].includes(direction)
    if (vertical) {
      columns[ei][ej] = 0
    } else {
      rows[ei][ej] = 0
    }
    const lastCommand = path.commands[path.commands.length - 1]
    if (lastCommand.type === 'L' && direction === lastDir) {
      path.commands.pop()
    }
    path.lineTo(nj, ni - descent)
    lastDir = direction
    const nextConnection = getPointConnection(ni, nj)
    travelPoint(ni, nj, nextConnection)
  }
  const travelPoint = (i, j, pc) => {
    const { top, bottom, left, right, count } = pc
    // case not exist
    if (count === 0) {
      points[i][j] = true
      return
    } else if (count === 1) {
      points[i][j] = true
      const direction = top ? 'top' : bottom ? 'bottom' : left ? 'left' : 'right'
      tp(i, j, direction)
    } else {
      // count === 3
      if (right) {
        tp(i, j, 'right')
      } else if (bottom) {
        tp(i, j, 'bottom')
      } else if (left) {
        tp(i, j, 'left')
      } else if (top) {
        tp(i, j, 'top')
      }
    }
  }

  for (let i = 0; i < height + 1; i++) {
    for (let j = 0; j < width + 1; j++) {
      if (points[i][j]) {
        // point is already visited
        continue
      }
      const pc = getPointConnection(i, j)
      if (pc.count < 1) {
        // point has no connection
        continue
      }
      path.moveTo(j, i - descent)
      lastDir = null
      travelPoint(i, j, pc)
    }
  }
  // scale up path
  path.commands.forEach(v => {
    v.x = v.x * scale
    v.y = v.y * scale
  })
  path.close()
  // console.log(path.toPathData(2))
  return path
}

console.info('before generate glyphs', performance.now())

const glyphs = []
const encodingTable = tables['PCF_BDF_ENCODINGS']
for (let i = 0; i < encodingTable.glyphIndices.length; i++) {
  const v = encodingTable.glyphIndices[i]
  if (v < 0) {
    continue
  }
  const glyph = new opentype.Glyph({
    name: tables['PCF_GLYPH_NAMES'].names[v],
    unicode: i,
    advanceWidth: tables['PCF_METRICS'].metrics[v].character_width * scale,
    path: genPath(v)
  })
  glyphs.push(glyph)
}

console.info('before generate glyphs', performance.now())

// const ascent = 11
// const descent = 1
// const fontHeight = 12
const accelerator = tables['PCF_ACCELERATORS']
const ascent = accelerator.fontAscent
const descent = accelerator.fontDescent
const fontHeight = ascent + descent
const font = new opentype.Font({
  familyName: 'MyPixelFont',
  styleName: 'Medium',
  unitsPerEm: fontHeight * scale,
  ascender: ascent * scale,
  descender: -descent * scale,
  glyphs: glyphs
})

console.info('before download', performance.now())

font.download()

console.info('after download', performance.now())
