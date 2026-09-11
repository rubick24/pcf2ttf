import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import type { PcfAccelerator, PcfEncoding, PcfFont, PcfMetrics } from './types.js'

const MAX_FILE_SIZE = 64 * 1024 * 1024

class Reader {
  offset = 0

  constructor(
    readonly data: Buffer,
    readonly label: string,
    readonly bigEndian = false,
  ) {}

  ensure(size: number) {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.data.length - this.offset) {
      throw new Error(`Invalid PCF ${this.label}: truncated or invalid data at byte ${this.offset}`)
    }
  }

  bytes(size: number) {
    this.ensure(size)
    const value = this.data.subarray(this.offset, this.offset + size)
    this.offset += size
    return value
  }

  u8() {
    return this.bytes(1)[0]
  }

  u16() {
    const bytes = this.bytes(2)
    return this.bigEndian ? bytes.readUInt16BE() : bytes.readUInt16LE()
  }

  i16() {
    const value = this.u16()
    return value >= 0x8000 ? value - 0x10000 : value
  }

  u32() {
    const bytes = this.bytes(4)
    return this.bigEndian ? bytes.readUInt32BE() : bytes.readUInt32LE()
  }

  i32() {
    return this.u32() | 0
  }

  count(stride: number, compressed = false) {
    const count = compressed ? this.u16() : this.u32()
    this.ensure(count * stride)
    return count
  }
}

const readString = (strings: Buffer, offset: number) => {
  const end = strings.indexOf(0, offset)
  if (offset >= strings.length || end < 0) throw new Error('Invalid PCF string offset or missing NUL terminator')
  return strings.toString('utf8', offset, end)
}

const readMetric = (reader: Reader, compressed = false): PcfMetrics => {
  const value = () => (compressed ? reader.u8() - 0x80 : reader.i16())
  return {
    leftSideBearing: value(),
    rightSideBearing: value(),
    characterWidth: value(),
    ascent: value(),
    descent: value(),
    attributes: compressed ? 0 : reader.u16(),
  }
}

const readMetrics = (reader: Reader, format: number) => {
  const compressed = (format & 0x100) !== 0
  return Array.from({ length: reader.count(compressed ? 5 : 12, compressed) }, () => readMetric(reader, compressed))
}

const readProperties = (reader: Reader) => {
  const count = reader.count(9)
  const entries = Array.from({ length: count }, () => {
    const name = reader.u32()
    const isString = reader.u8()
    if (isString > 1) throw new Error('Invalid PCF property type')
    return { name, isString, value: reader.u32() }
  })
  reader.bytes((4 - (count % 4)) % 4)
  const strings = reader.bytes(reader.u32())
  // Offsets can be shared or unordered; strings always end at their own NUL.
  return Object.fromEntries(
    entries.map(entry => [
      readString(strings, entry.name),
      entry.isString ? readString(strings, entry.value) : entry.value | 0,
    ]),
  )
}

const readAccelerator = (reader: Reader, format: number): PcfAccelerator => {
  const flags = Array.from({ length: 7 }, () => reader.u8())
  reader.u8()
  const fontAscent = reader.i32()
  const fontDescent = reader.i32()
  const maxOverlap = reader.i32()
  const minBounds = readMetric(reader)
  const maxBounds = readMetric(reader)
  const hasInkBounds = (format & 0x100) !== 0
  return {
    noOverlap: !!flags[0],
    constantMetrics: !!flags[1],
    terminalFont: !!flags[2],
    constantWidth: !!flags[3],
    inkInside: !!flags[4],
    inkMetrics: !!flags[5],
    drawDirection: flags[6],
    fontAscent,
    fontDescent,
    maxOverlap,
    minBounds,
    maxBounds,
    inkMinBounds: hasInkBounds ? readMetric(reader) : minBounds,
    inkMaxBounds: hasInkBounds ? readMetric(reader) : maxBounds,
  }
}

const readBitmaps = (reader: Reader, format: number) => {
  const offsets = Array.from({ length: reader.count(4) }, () => reader.u32())
  const sizes = Array.from({ length: 4 }, () => reader.u32())
  return { format, offsets, data: reader.bytes(sizes[format & 3]) }
}

const readEncoding = (reader: Reader): PcfEncoding => {
  const minCharOrByte2 = reader.u16()
  const maxCharOrByte2 = reader.u16()
  const minByte1 = reader.u16()
  const maxByte1 = reader.u16()
  const defaultChar = reader.u16()
  if (minCharOrByte2 > maxCharOrByte2 || minByte1 > maxByte1 || maxCharOrByte2 > 255 || maxByte1 > 255) {
    throw new Error('Invalid PCF encoding range')
  }
  reader.ensure((maxCharOrByte2 - minCharOrByte2 + 1) * (maxByte1 - minByte1 + 1) * 2)
  const glyphIndices = new Map<number, number>()
  for (let high = minByte1; high <= maxByte1; high++) {
    for (let low = minCharOrByte2; low <= maxCharOrByte2; low++) {
      const index = reader.u16()
      if (index !== 0xffff) glyphIndices.set((high << 8) | low, index)
    }
  }
  return { minCharOrByte2, maxCharOrByte2, minByte1, maxByte1, defaultChar, glyphIndices }
}

const readNames = (reader: Reader) => {
  const offsets = Array.from({ length: reader.count(4) }, () => reader.u32())
  const strings = reader.bytes(reader.u32())
  return offsets.map(offset => readString(strings, offset))
}

const bitmapLayout = (metric: PcfMetrics, format: number) => {
  const width = metric.rightSideBearing - metric.leftSideBearing
  const height = metric.ascent + metric.descent
  if (width < 0 || height < 0) throw new Error('Invalid PCF bitmap dimensions')
  const padding = 1 << (format & 3)
  const stride = Math.ceil(width / (padding * 8)) * padding
  return { width, height, stride }
}

/** Parse a PCF (or gzip-compressed PCF), retaining raw character codes. */
export const parsePcf = (input: Uint8Array): PcfFont => {
  if (input.byteLength > MAX_FILE_SIZE) throw new Error('PCF input exceeds the 64 MiB limit')
  let data = Buffer.from(input)
  if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data, { maxOutputLength: MAX_FILE_SIZE })
  const header = new Reader(data, 'header')
  if (!header.bytes(4).equals(Buffer.from([1, 0x66, 0x63, 0x70]))) throw new Error('Not a PCF file')
  const count = header.count(16)
  const entries = Array.from({ length: count }, () => ({
    type: header.u32(),
    format: header.u32(),
    size: header.u32(),
    offset: header.u32(),
  })).sort((a, b) => a.offset - b.offset)
  const tables = new Map<number, { reader: Reader; format: number }>()
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const nextOffset = entries[i + 1]?.offset ?? data.length
    // bdftopcf overstates the last accelerator table's size (100 vs 48/72).
    const allowedOverrun = entry.type === 2 || entry.type === 256 ? 100 : 3
    const last = i === entries.length - 1
    if (
      entry.offset < header.offset ||
      entry.offset % 4 !== 0 ||
      entry.size < 4 ||
      entry.offset + 4 > data.length ||
      (entry.offset + entry.size > nextOffset && (!last || entry.offset + entry.size - nextOffset > allowedOverrun))
    )
      throw new Error(`Invalid PCF table bounds for type ${entry.type}`)
    if (tables.has(entry.type)) throw new Error(`Duplicate PCF table type ${entry.type}`)
    const bytes = data.subarray(entry.offset, Math.min(entry.offset + entry.size, data.length))
    if (bytes.readUInt32LE() !== entry.format) throw new Error(`PCF table format mismatch for type ${entry.type}`)
    const reader = new Reader(bytes, `table ${entry.type}`, (entry.format & 4) !== 0)
    reader.bytes(4)
    tables.set(entry.type, { reader, format: entry.format })
  }
  const table = (type: number, alternatives = [0]) => {
    const value = tables.get(type)
    if (!value) throw new Error(`Missing required PCF table ${type}`)
    if (!alternatives.includes(value.format & 0xffffff00)) throw new Error(`Unsupported PCF format for table ${type}`)
    return value
  }
  const metricsTable = table(4, [0, 0x100])
  const bitmapTable = table(8)
  const font: PcfFont = {
    properties: tables.has(1) ? readProperties(table(1).reader) : {},
    metrics: readMetrics(metricsTable.reader, metricsTable.format),
    bitmaps: readBitmaps(bitmapTable.reader, bitmapTable.format),
    encoding: readEncoding(table(32).reader),
  }
  for (const [type, key] of [
    [2, 'accelerators'],
    [256, 'bdfAccelerators'],
  ] as const) {
    if (tables.has(type)) {
      const value = table(type, [0, 0x100])
      font[key] = readAccelerator(value.reader, value.format)
    }
  }
  if (tables.has(16)) {
    const value = table(16, [0, 0x100])
    font.inkMetrics = readMetrics(value.reader, value.format)
  }
  if (tables.has(64)) {
    const { reader } = table(64)
    font.scalableWidths = Array.from({ length: reader.count(4) }, () => reader.i32())
  }
  if (tables.has(128)) font.glyphNames = readNames(table(128).reader)
  for (const values of [font.bitmaps.offsets, font.inkMetrics, font.scalableWidths, font.glyphNames]) {
    if (values && values.length !== font.metrics.length) throw new Error('PCF glyph counts do not match')
  }
  for (const index of font.encoding.glyphIndices.values()) {
    if (index >= font.metrics.length) throw new Error(`Invalid PCF encoding glyph index ${index}`)
  }
  font.metrics.forEach((metric, index) => {
    const { stride, height } = bitmapLayout(metric, font.bitmaps.format)
    if (font.bitmaps.offsets[index] + stride * height > font.bitmaps.data.length) {
      throw new Error(`Truncated PCF bitmap for glyph ${index}`)
    }
  })
  return font
}

export const loadPcf = async (path: string | URL) => parsePcf(await readFile(path))

/** Return rows from top to bottom, cropped to the metric width (excluding row padding). */
export const getGlyphBitmap = (font: PcfFont, glyphIndex: number): string[] => {
  const metric = font.metrics[glyphIndex]
  if (!Number.isInteger(glyphIndex) || !metric) throw new Error(`Invalid glyph index ${glyphIndex}`)
  const { format, offsets, data } = font.bitmaps
  const { width, height, stride } = bitmapLayout(metric, format)
  const scanUnit = 1 << ((format >> 4) & 3)
  const msbBits = (format & 8) !== 0
  const swapBytes = ((format & 4) !== 0) !== msbBits
  const size = stride * height
  const start = offsets[glyphIndex]
  return Array.from({ length: height }, (_, y) => {
    let row = ''
    for (let x = 0; x < width; x++) {
      const logicalByte = y * stride + (x >> 3)
      // Byte swaps are within scan units across the glyph buffer, not whole rows.
      const byte = swapBytes ? logicalByte ^ (scanUnit - 1) : logicalByte
      if (byte >= size || start + byte >= data.length) throw new Error('Invalid PCF bitmap scan unit layout')
      row += data[start + byte] & (1 << (msbBits ? 7 - (x & 7) : x & 7)) ? '#' : ' '
    }
    return row
  })
}
