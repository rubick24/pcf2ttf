// import { getLocation, safeJSONParse } from '../utils'
// import { SVGIconConfig, getPaths } from '@bilibili/svg-processing'
import { createGlyph, createGlyphsFile, stringifyGlyphs } from './glyphs'
import { Glyph } from './types'
import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { cwd } from 'process'
import { resolve } from 'path'
import { execSync } from 'child_process'

import { loadPcf, genGlyphArray } from './loadpcf'
import { SVGPathData } from 'svg-pathdata'

export const generateFont = async () => {
  const tables = await loadPcf('./assets/wenquanyi_9pt.pcf')

  const genPath = (bIndex: number) => {
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

    type Direction = 'left' | 'right' | 'top' | 'bottom'
    type PointConnection = {
      count: number
      top: number
      bottom: number
      left: number
      right: number
    }
    const directionMap: Record<Direction, (x: number, y: number) => [number, number]> = {
      top: (i, j) => [i - 1, j],
      bottom: (i, j) => [i + 1, j],
      left: (i, j) => [i, j - 1],
      right: (i, j) => [i, j + 1]
    }
    const edgeMap: Record<Direction, (x: number, y: number) => [number, number]> = {
      top: (i, j) => [i - 1, j],
      bottom: (i, j) => [i, j],
      left: (i, j) => [i, j - 1],
      right: (i, j) => [i, j]
    }
    const getPointConnection = (i: number, j: number) => {
      const r: PointConnection = {
        count: 0,
        top: 0,
        bottom: 0,
        left: 0,
        right: 0
      }
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

    const paths: string[] = []
    const path = new SVGPathData('')
    let lastDir: Direction | null = null

    const tp = (i: number, j: number, direction: 'left' | 'right' | 'top' | 'bottom') => {
      const [ni, nj] = directionMap[direction](i, j)
      const [ei, ej] = edgeMap[direction](i, j)
      const vertical = ['top', 'bottom'].includes(direction)
      if (vertical) {
        columns[ei][ej] = 0
      } else {
        rows[ei][ej] = 0
      }

      const lastCommand = path.commands[path.commands.length - 1]
      if (lastCommand.type === SVGPathData.LINE_TO && direction === lastDir) {
        path.commands.pop()
      }
      path.commands.push({
        type: SVGPathData.LINE_TO,
        x: nj,
        y: ni - descent,
        relative: false
      })

      // path.lineTo(nj, ni - descent)
      lastDir = direction
      const nextConnection = getPointConnection(ni, nj)
      travelPoint(ni, nj, nextConnection)
    }
    const travelPoint = (i: number, j: number, pc: PointConnection) => {
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
        if (path.commands.length) {
          path.commands.push({ type: SVGPathData.CLOSE_PATH })
          paths.push(path.encode())
          path.commands = []
        }

        path.commands.push({
          type: SVGPathData.MOVE_TO,
          x: j,
          y: i - descent,
          relative: false
        })
        lastDir = null
        travelPoint(i, j, pc)
      }
    }
    if (path.commands.length) {
      path.commands.push({ type: SVGPathData.CLOSE_PATH })
      paths.push(path.encode())
      path.commands = []
    }
    return paths
    // if (!path.commands.length) {
    //   return ''
    // }
    // // path.commands.push({ type: SVGPathData.CLOSE_PATH })
    // return path.encode()
  }

  const glyphs: Glyph[] = []
  const encodingTable = tables['PCF_BDF_ENCODINGS']
  const accelerator = tables['PCF_ACCELERATORS']
  const ascent = accelerator.fontAscent
  const descent = accelerator.fontDescent
  const fontHeight = ascent + descent
  const unitsPerEm = 2048

  for (let i = 0; i < encodingTable.glyphIndices.length; i++) {
    const v = encodingTable.glyphIndices[i]
    if (v < 0) {
      continue
    }
    const paths = genPath(v)
    if (!paths.length) {
      continue
    }
    const width = (unitsPerEm / fontHeight) * tables['PCF_METRICS'].metrics[v].character_width

    const glyph = createGlyph({
      name: tables['PCF_GLYPH_NAMES'].names[v],
      unicode: i,
      height: fontHeight,
      unitsPerEm,
      layers: [
        {
          layerId: 'regular',
          paths,
          width
        }
      ]
    })

    glyphs.push(glyph)
    // const glyph = new opentype.Glyph({
    //   name: tables['PCF_GLYPH_NAMES'].names[v],
    //   unicode: i,
    //   advanceWidth: tables['PCF_METRICS'].metrics[v].character_width * scale,
    //   path: genPath(v)
    // })
  }

  const name = `myPixelFont`

  const obj = createGlyphsFile({
    name,
    glyphs,
    unitsPerEm,
    ascender: Math.round((unitsPerEm * 13) / 15),
    descender: Math.round((unitsPerEm * 2) / 15)
  })

  const staticDir = resolve(cwd(), 'dist')
  if (!existsSync(staticDir)) {
    mkdirSync(staticDir)
  }

  const glyphsFile = `${staticDir}/${name}.glyphs`
  const localTTFFile = `${staticDir}/${name}.ttf`

  writeFileSync(glyphsFile, stringifyGlyphs(obj))

  const fontmake = resolve(cwd(), './venv/bin/fontmake')
  execSync(`${fontmake} -g ${glyphsFile} -o ttf --output-path ${localTTFFile}`)

  //   const cssFamily = `
  // @font-face {
  //   font-family: '${name}';
  //   src: url('./${name}.ttf') format('truetype');
  //   font-weight: normal;
  //   font-style: normal;
  // }
  // `
}

generateFont()
