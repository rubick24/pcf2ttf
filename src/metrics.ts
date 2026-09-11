import type { PcfFont } from './types.js'

export const numericProperty = (font: PcfFont, name: string): number | undefined => {
  const value = font.properties[name]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new Error(`PCF ${name} must be an integer`)
  return value
}

/** Logical line extents are independent of the ink bounds of individual glyphs. */
export const getPcfLineMetrics = (font: PcfFont) => {
  const accelerator = font.bdfAccelerators ?? font.accelerators
  const encodedMetrics = [...new Set(font.encoding.glyphIndices.values())].map(index => font.metrics[index])
  return {
    ascent:
      accelerator?.fontAscent ??
      numericProperty(font, 'FONT_ASCENT') ??
      encodedMetrics.reduce((max, metric) => Math.max(max, metric.ascent), 0),
    descent:
      accelerator?.fontDescent ??
      numericProperty(font, 'FONT_DESCENT') ??
      encodedMetrics.reduce((max, metric) => Math.max(max, metric.descent), 0),
  }
}
