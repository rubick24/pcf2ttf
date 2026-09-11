export interface PcfMetrics {
  leftSideBearing: number
  rightSideBearing: number
  characterWidth: number
  ascent: number
  descent: number
  attributes: number
}

export interface PcfAccelerator {
  noOverlap: boolean
  constantMetrics: boolean
  terminalFont: boolean
  constantWidth: boolean
  inkInside: boolean
  inkMetrics: boolean
  drawDirection: number
  fontAscent: number
  fontDescent: number
  maxOverlap: number
  minBounds: PcfMetrics
  maxBounds: PcfMetrics
  inkMinBounds: PcfMetrics
  inkMaxBounds: PcfMetrics
}

export interface PcfEncoding {
  minCharOrByte2: number
  maxCharOrByte2: number
  minByte1: number
  maxByte1: number
  defaultChar: number
  /** Character code to glyph index. Missing encodings (0xffff) are omitted. */
  glyphIndices: Map<number, number>
}

export interface PcfFont {
  properties: Record<string, string | number>
  metrics: PcfMetrics[]
  bitmaps: { format: number; offsets: number[]; data: Buffer }
  encoding: PcfEncoding
  accelerators?: PcfAccelerator
  bdfAccelerators?: PcfAccelerator
  inkMetrics?: PcfMetrics[]
  scalableWidths?: number[]
  glyphNames?: string[]
}

export interface ConvertOptions {
  familyName?: string
  styleName?: string
  /** Integer font units per bitmap pixel. Defaults to 100. */
  scale?: number
  /** Treat unspecified or legacy PCF character codes as Unicode, without transcoding. */
  assumeUnicode?: boolean
}
