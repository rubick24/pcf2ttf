export type ShapeNode = [number, number, 'l' | 'o' | 'c']
export type Color = [number, number, number, number]

export type Shape = {
  closed: 0 | 1
  nodes: ShapeNode[]
  attr?: {
    fillColor?: Color
    gradient?: {
      colors: [Color, number][]
      start: [number, number]
      end: [number, number]
    }
  }
}

export type Layer = {
  layerId: string
  width: number
  shapes?: Shape[]
  attr?: {
    color?: 0 | 1
  }
}

export type Glyph = {
  glyphname: string
  unicode?: number
  lastChange?: string
  layers: Layer[]
}

export type FontMaster = {
  id: string
  name: string // Regular
  visible: 1
  axesValues?: number[]
  metricValues?: any[]
  customParameters?: any[]
}

export type GlyphFont = {
  '.appVersion': '3134'
  '.formatVersion': 3
  axes?: {
    name: string // myAxis
    tag: string // myax
  }[]
  date?: string // "2023-12-22 06:42:01 +0000"
  familyName: string // MyFont
  fontMaster: FontMaster[]
  glyphs: Glyph[]
  instances?: {
    axesValues: number[]
    instanceInterpolations: Record<string, number> // { m01 = 1; } // masterId = interpolationValue
    name: string // Regular
    type: string // variable
  }[]
  metrics?: any[]
  unitsPerEm: number
  versionMajor: number
  versionMinor: number
}
