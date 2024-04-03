import { SVGPathData } from 'svg-pathdata'
import type { Color, ShapeNode, Shape, Layer, Glyph, FontMaster, GlyphFont } from './types'

export const parseGlyphs = (input: string) => {
  let index = 0

  const skipWhitespace = () => {
    while (index < input.length && /\s/.test(input[index])) index++
  }

  const parseString = () => {
    let value = ''

    const hasQuotes = input[index] === '"'
    if (hasQuotes) {
      index++ // Consume opening quote
      while (index < input.length && input[index] !== '"') {
        value += input[index++]
      }
      index++ // Consume closing quote
    } else {
      while (index < input.length && /\w|\./.test(input[index])) {
        value += input[index++]
      }
    }

    return value
  }

  const parseNumber = () => {
    let value = ''
    if (input[index] === '-') value += input[index++]
    while (index < input.length && /\d|\./.test(input[index])) {
      value += input[index++]
    }
    return Number(value)
  }

  const parseArray = () => {
    let array: unknown[] = []
    skipWhitespace()
    if (input[index] !== '(') throw new Error("Expected '('")
    index++ // Consume opening bracket
    skipWhitespace()

    while (index < input.length) {
      skipWhitespace()
      if (input[index] === ')') break // End of array
      array.push(parseValue())
      skipWhitespace()
      if (input[index] === ',') index++ // Consume comma
    }
    index++ // Consume closing bracket
    if (input[index] === ';') index++ // Consume comma
    return array
  }

  const parseObject = () => {
    let object: any = {}
    skipWhitespace()
    if (input[index] !== '{') throw new Error("Expected '{'")
    index++ // Consume opening brace

    while (index < input.length) {
      skipWhitespace()
      if (input[index] === '}') break // End of object
      let key = parseString()
      skipWhitespace()
      if (input[index++] !== '=') throw new Error("Expected '='")
      object[key] = parseValue()
      skipWhitespace()
      // if (input[index] === ',') index++ // Consume comma
      if (input[index] === ';') index++ // Consume comma
    }

    index++ // Consume closing brace
    return object
  }

  const parseValue = (): unknown => {
    skipWhitespace()

    if (/\d|-/.test(input[index])) {
      return parseNumber()
    } else if (input[index] === '{') {
      return parseObject()
    } else if (input[index] === '(') {
      return parseArray()
    } else if (input[index] === '"' || /\w|\./.test(input[index])) {
      return parseString()
    } else {
      throw new Error(`parseGlyphsError: ${index} ${input[index]}`)
    }
  }

  return parseValue() as GlyphFont
}

export const stringifyGlyphs = (glyphsObj: GlyphFont) => {
  const encodeArray = (v: any[]): string => `(${v.map(encodeValue).join(',')})`

  const encodeObj = (val: any) => {
    let r = ''
    Object.keys(val).forEach(k => {
      const v = val[k]
      if (typeof v === 'string') {
        r += `${k} = "${v}";`
      } else if (typeof v === 'number') {
        r += `${k} = ${v};`
      } else if (typeof v === 'object') {
        if (Array.isArray(v)) {
          r += `${k} = ${encodeArray(v)};`
        } else {
          r += `${k} = {${encodeObj(v)}};`
        }
      }
    })
    return r
  }

  const encodeValue = (v: any) => {
    if (typeof v === 'string') {
      return `"${v}"`
    } else if (typeof v === 'number') {
      return `${Math.round(v * 1000) / 1000}`
    } else if (typeof v === 'object') {
      if (Array.isArray(v)) {
        return `${encodeArray(v)}`
      } else {
        return `{${encodeObj(v)}}`
      }
    }
  }

  return `{${encodeObj(glyphsObj)}}\n`
}

const defaultUnitsPerEm = 1024

const metricsBaseGen = (ascender: number, descender: number) => ({
  metricValues: [
    {
      pos: ascender
    },
    {
      pos: -descender
    },
    {
      pos: 0
    }
  ],
  customParameters: [
    {
      name: 'typoAscender',
      value: ascender
    },
    {
      name: 'typoDescender',
      value: -descender
    },
    {
      name: 'typoLineGap',
      value: 0
    },
    {
      name: 'winAscent',
      value: ascender
    },
    {
      name: 'winDescent',
      value: descender
    },
    {
      name: 'hheaAscender',
      value: ascender
    },
    {
      name: 'hheaDescender',
      value: -descender
    }
    // {
    //   name: 'strikeoutPosition',
    //   value: 5
    // },
    // {
    //   name: 'strikeoutSize',
    //   value: 1
    // }
  ]
})
const base: GlyphFont = {
  '.appVersion': '3134',
  '.formatVersion': 3,
  familyName: '',
  fontMaster: [],
  glyphs: [],
  unitsPerEm: defaultUnitsPerEm,
  metrics: [{ type: 'ascender' }, { type: 'descender' }, { type: 'baseline' }],
  versionMajor: 1,
  versionMinor: 0
}

// path必须以M开始且闭合
export const createGlyph = (p: {
  name: string
  unicode: number
  layers: {
    layerId: string
    width?: number
    paths: string[]
    fillColor?: (Color | null)[]
  }[]
  height: number
  unitsPerEm?: number
}): Glyph => {
  const unitsPerEm = p?.unitsPerEm ?? defaultUnitsPerEm
  const layers: Layer[] = p.layers.map(layer => {
    const shapes: Shape[] = []
    layer.paths.forEach((path, i) => {
      const pathData = new SVGPathData(path)
      pathData.scale(unitsPerEm / p.height)
      const color = layer.fillColor?.[i]
      let mCommand = pathData.commands[0]
      let nodes: ShapeNode[] = []
      if (mCommand.type !== SVGPathData.MOVE_TO)
        throw new Error('First command must be a move to command')

      for (let i = 0; i < pathData.commands.length; i++) {
        const c = pathData.commands[i]
        if (c.type === SVGPathData.LINE_TO) {
          nodes.push([c.x, c.y, 'l'])
        } else if (c.type === SVGPathData.CURVE_TO) {
          nodes.push([c.x1, c.y1, 'o'])
          nodes.push([c.x2, c.y2, 'o'])
          nodes.push([c.x, c.y, 'c'])
        } else if (c.type === SVGPathData.MOVE_TO) {
          nodes.push([c.x, c.y, 'l'])
          mCommand = c
        } else if (c.type === SVGPathData.CLOSE_PATH) {
          nodes.push([mCommand.x, mCommand.y, 'l'])
          shapes.push({
            attr: color ? { fillColor: color } : undefined,
            closed: 1,
            nodes
          })
          nodes = []
        }
      }
    })

    // attr color 需要在shapes字段之前
    return {
      layerId: layer.layerId,
      attr: layer.fillColor?.length ? { color: 1 } : undefined,
      width: layer.width || unitsPerEm,
      shapes
    }
  })

  return {
    glyphname: p.name,
    unicode: p.unicode,
    layers: layers
  }
}

export const createGlyphsFile = (p: {
  name?: string
  axes?: {
    name: string
    tag: string
    min: number
    max: number
    default: number
  }[]
  glyphs: Glyph[]
  unitsPerEm?: number
  ascender?: number
  descender?: number
}) => {
  const v = structuredClone(base)
  if (p.unitsPerEm) {
    v.unitsPerEm = p.unitsPerEm
  }
  const masters: FontMaster[] = []
  const ascender = p.ascender ?? v.unitsPerEm
  const descender = p.descender ?? 0
  const metricsBase = metricsBaseGen(ascender, descender)
  const defaultAxesValues = p.axes?.map(v => v.default)
  masters.push({
    id: 'regular',
    name: 'Regular',
    visible: 1,
    axesValues: defaultAxesValues,
    ...metricsBase
  })
  p.axes?.forEach((axis, i) => {
    const minValues = structuredClone(defaultAxesValues)!
    minValues[i] = axis.min
    const maxValues = structuredClone(defaultAxesValues)!
    maxValues[i] = axis.max
    masters.push(
      {
        id: `${axis.tag}-min`,
        name: `${axis.name}-min`,
        visible: 1,
        axesValues: minValues,
        ...metricsBase
      },
      {
        id: `${axis.tag}-max`,
        name: `${axis.name}-max`,
        visible: 1,
        axesValues: maxValues,
        ...metricsBase
      }
    )
  }) || []

  if (p.axes?.length) {
    v.axes = p.axes.map(v => ({ name: v.name, tag: v.tag }))
    v.instances = [
      {
        axesValues: defaultAxesValues!,
        instanceInterpolations: {
          regular: 1
        },
        name: 'Regular',
        type: 'variable'
      }
    ]
  }

  v.fontMaster = masters
  v.familyName = p.name || 'MyFont'
  v.glyphs.push(...p.glyphs)
  return v
}
