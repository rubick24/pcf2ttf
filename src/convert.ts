import { Font, type TTF } from 'fonteditor-core'
import { getPcfLineMetrics, numericProperty } from './metrics.js'
import { traceBitmap } from './outline.js'
import { getGlyphBitmap, parsePcf } from './pcf.js'
import type { ConvertOptions, PcfFont } from './types.js'

const integer = (value: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}; got ${value}`)
  }
  return value
}

const checkCharset = (font: PcfFont, assumeUnicode: boolean) => {
  if (assumeUnicode) return
  const registry = String(font.properties.CHARSET_REGISTRY ?? '').toUpperCase()
  const encoding = String(font.properties.CHARSET_ENCODING ?? '')
  if ((registry === 'ISO10646' && encoding === '1') || (registry === 'ISO8859' && encoding === '1')) return
  throw new Error(
    `Unsupported or unspecified PCF charset: ${registry || '(missing)'}-${encoding || '(missing)'}. Use --assume-unicode only if its character codes are Unicode; legacy charsets require transcoding.`,
  )
}

const glyphFor = (font: PcfFont, index: number, scale: number, name: string, unicode: number[]): TTF.Glyph => {
  const metric = font.metrics[index]
  const advanceWidth = integer(metric.characterWidth * scale, 0, 32767, `Glyph ${index} advance width`)
  const contours = traceBitmap(getGlyphBitmap(font, index), metric, scale)
  integer(contours.length, 0, 32767, `Glyph ${index} contour count`)
  let count = 0
  let previousX = 0
  let previousY = 0
  let xMin = Infinity
  let yMin = Infinity
  let xMax = -Infinity
  let yMax = -Infinity
  for (const contour of contours) {
    count += contour.length
    for (const point of contour) {
      integer(point.x, -32768, 32767, `Glyph ${index} x coordinate`)
      integer(point.y, -32768, 32767, `Glyph ${index} y coordinate`)
      integer(point.x - previousX, -32768, 32767, `Glyph ${index} x delta`)
      integer(point.y - previousY, -32768, 32767, `Glyph ${index} y delta`)
      previousX = point.x
      previousY = point.y
      xMin = Math.min(xMin, point.x)
      xMax = Math.max(xMax, point.x)
      yMin = Math.min(yMin, point.y)
      yMax = Math.max(yMax, point.y)
    }
  }
  integer(count, 0, 65535, `Glyph ${index} point count`)
  if (!count) xMin = yMin = xMax = yMax = 0
  integer(advanceWidth - xMax, -32768, 32767, `Glyph ${index} right side bearing`)
  return { contours, xMin, yMin, xMax, yMax, advanceWidth, leftSideBearing: xMin, name, unicode }
}

/** Convert a parsed PCF to a TrueType sfnt with pixel-aligned, closed contours. */
export const createTtf = (pcf: PcfFont, options: ConvertOptions = {}): Buffer => {
  checkCharset(pcf, options.assumeUnicode ?? false)
  const scale = integer(options.scale ?? 100, 1, 16384, 'Scale')
  const { ascent, descent } = getPcfLineMetrics(pcf)
  const ascender = integer(ascent * scale, 0, 32767, 'Font ascent')
  const descender = integer(-descent * scale, -32768, 0, 'Font descent')
  const unitsPerEm = integer((ascent + descent) * scale, 16, 16384, 'Units per em (font height × scale)')
  const familyName = options.familyName ?? String(pcf.properties.FAMILY_NAME ?? 'PCF Pixel Font')
  const styleName = options.styleName ?? 'Regular'
  for (const [label, value] of [
    ['Family name', familyName],
    ['Style name', styleName],
  ]) {
    if (
      !value.trim() ||
      value.length > 255 ||
      [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    ) {
      throw new Error(`${label} must contain 1–255 characters and no control characters`)
    }
  }
  const entries = [...pcf.encoding.glyphIndices].sort(([a], [b]) => a - b)
  integer(entries.length, 1, 65534, 'Encoded glyph count')
  // Sequential Unicode/glyph runs share one format-4 segment, fixing the old CJK overflow.
  let segments = 1 // mandatory 0xffff sentinel
  let previous = -2
  for (const [code] of entries) {
    integer(code, 0, 65535, 'PCF character code')
    if ((code >= 0xd800 && code <= 0xdfff) || code === 0xffff)
      throw new Error(`Unsupported Unicode character code U+${code.toString(16).toUpperCase()}`)
    if (code !== previous + 1) segments++
    previous = code
  }
  if (16 + 8 * segments > 65535) {
    throw new Error('Character map is too fragmented for a TrueType format-4 cmap (more than 8188 encoded ranges)')
  }
  const font = Font.create()
  const data = font.get()
  const defaultIndex = pcf.encoding.glyphIndices.get(pcf.encoding.defaultChar)
  const notdef: TTF.Glyph =
    defaultIndex === undefined
      ? {
          contours: [],
          xMin: 0,
          xMax: 0,
          yMin: 0,
          yMax: 0,
          advanceWidth: unitsPerEm,
          leftSideBearing: 0,
          name: '.notdef',
          unicode: [],
        }
      : glyphFor(pcf, defaultIndex, scale, '.notdef', [])
  data.glyf = [
    notdef,
    ...entries.map(([code, index]) =>
      glyphFor(pcf, index, scale, `uni${code.toString(16).padStart(4, '0').toUpperCase()}`, [code]),
    ),
  ]
  const bold = /bold/i.test(styleName)
  const italic = /italic|oblique/i.test(styleName)
  Object.assign(data.head, {
    unitsPerEm,
    flags: 3,
    macStyle: (bold ? 1 : 0) | (italic ? 2 : 0),
    lowestRecPPEM: ascent + descent,
  })
  Object.assign(data.hhea, { ascent: ascender, descent: descender, lineGap: 0 })
  Object.assign(data.name, {
    fontFamily: familyName,
    fontSubFamily: styleName,
    fullName: `${familyName} ${styleName}`,
    uniqueSubFamily: `${familyName} ${styleName};pcf2ttf;1.0`,
    postScriptName: `${familyName}-${styleName}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 63) || 'PCFPixelFont-Regular',
    version: 'Version 1.000',
    copyright: String(pcf.properties.COPYRIGHT ?? ''),
  })
  const glyphByCode = new Map(data.glyf.flatMap(glyph => glyph.unicode.map(code => [code, glyph] as const)))
  const letterHeight = (property: string, code: number) => {
    const value = numericProperty(pcf, property)
    return integer(
      value === undefined ? Math.max(0, glyphByCode.get(code)?.yMax ?? 0) : value * scale,
      0,
      32767,
      property,
    )
  }
  Object.assign(data['OS/2'], {
    usWeightClass: bold ? 700 : /medium/i.test(styleName) ? 500 : 400,
    fsSelection: 128 | (bold ? 32 : 0) | (italic ? 1 : 0) | (!bold && !italic ? 64 : 0),
    sTypoAscender: ascender,
    sTypoDescender: descender,
    sTypoLineGap: 0,
    usWinAscent: data.glyf.reduce((max, glyph) => Math.max(max, glyph.yMax), ascender),
    usWinDescent: data.glyf.reduce((max, glyph) => Math.max(max, -glyph.yMin), -descender),
    sxHeight: letterHeight('X_HEIGHT', 0x78),
    sCapHeight: letterHeight('CAP_HEIGHT', 0x48),
    achVendID: '    ',
    ulCodePageRange1: 0,
    ulCodePageRange2: 0,
  })
  data.post.format = 3
  data.post.underlinePosition = -scale
  data.post.underlineThickness = scale
  data.post.isFixedPitch = entries.every(
    ([, index]) => pcf.metrics[index].characterWidth === pcf.metrics[entries[0][1]].characterWidth,
  )
    ? 1
    : 0
  data.maxp.maxZones = 1
  return font.write({ type: 'ttf', toBuffer: true, writeZeroContoursGlyfData: true })
}

export const convertPcfToTtf = (input: Uint8Array, options?: ConvertOptions) => createTtf(parsePcf(input), options)
