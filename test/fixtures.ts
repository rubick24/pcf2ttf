import type { PcfMetrics } from '../src/types.js'

export const metric: PcfMetrics = {
  leftSideBearing: -1,
  rightSideBearing: 2,
  characterWidth: 4,
  ascent: 2,
  descent: 1,
  attributes: 0,
}

export class Bytes {
  chunks: Buffer[] = []

  constructor(readonly format = 0) {
    const buffer = Buffer.alloc(4)
    buffer.writeUInt32LE(format)
    this.chunks.push(buffer)
  }

  u8(value: number) {
    this.chunks.push(Buffer.from([value]))
    return this
  }

  u16(value: number) {
    const buffer = Buffer.alloc(2)
    if (this.format & 4) buffer.writeUInt16BE(value & 0xffff)
    else buffer.writeUInt16LE(value & 0xffff)
    this.chunks.push(buffer)
    return this
  }

  u32(value: number) {
    const buffer = Buffer.alloc(4)
    if (this.format & 4) buffer.writeUInt32BE(value >>> 0)
    else buffer.writeUInt32LE(value >>> 0)
    this.chunks.push(buffer)
    return this
  }

  bytes(value: Buffer) {
    this.chunks.push(value)
    return this
  }

  build() {
    return Buffer.concat(this.chunks)
  }
}

export const metricBytes = (writer: Bytes, value = metric, compressed = false) => {
  for (const field of [
    value.leftSideBearing,
    value.rightSideBearing,
    value.characterWidth,
    value.ascent,
    value.descent,
  ]) {
    if (compressed) writer.u8(field + 128)
    else writer.u16(field)
  }
  if (!compressed) writer.u16(value.attributes)
  return writer
}

export const pack = (tables: Map<number, Buffer>) => {
  const header = Buffer.alloc(8 + 16 * tables.size)
  header.writeUInt32LE(0x70636601)
  header.writeUInt32LE(tables.size, 4)
  const buffers = [header]
  let offset = header.length
  let index = 8
  for (const [type, data] of tables) {
    const padded = Buffer.alloc(Math.ceil(data.length / 4) * 4)
    data.copy(padded)
    header.writeUInt32LE(type, index)
    header.writeUInt32LE(data.readUInt32LE(), index + 4)
    header.writeUInt32LE(padded.length, index + 8)
    header.writeUInt32LE(offset, index + 12)
    buffers.push(padded)
    offset += padded.length
    index += 16
  }
  return Buffer.concat(buffers)
}

export interface FixtureOptions {
  format?: number
  compressed?: boolean
  metrics?: PcfMetrics[]
  rows?: string[][]
  minLow?: number
  maxLow?: number
  minHigh?: number
  maxHigh?: number
  indices?: number[]
  defaultChar?: number
}

export const fixtureTables = (options: FixtureOptions = {}) => {
  const {
    format = 0,
    compressed = false,
    metrics = [metric],
    rows = [['# #', ' # ', '###']],
    minLow = 65,
    maxLow = 65,
    minHigh = 0,
    maxHigh = 0,
    indices = [0],
    defaultChar = 65,
  } = options
  const metricTable = new Bytes(format | (compressed ? 0x100 : 0))
  if (compressed) metricTable.u16(metrics.length)
  else metricTable.u32(metrics.length)
  for (const value of metrics) metricBytes(metricTable, value, compressed)
  const glyphData = metrics.map((value, index) => {
    const width = value.rightSideBearing - value.leftSideBearing
    const height = value.ascent + value.descent
    const pad = 2 ** (format & 3)
    const stride = Math.ceil(Math.ceil(width / 8) / pad) * pad
    const bytes = Buffer.alloc(stride * height)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (rows[index]?.[y]?.[x] === '#')
          bytes[y * stride + Math.floor(x / 8)] |= 1 << (format & 8 ? 7 - (x % 8) : x % 8)
      }
    }
    if (Boolean(format & 4) !== Boolean(format & 8)) {
      const unit = 2 ** ((format >> 4) & 3)
      for (let i = 0; i < bytes.length; i += unit) bytes.subarray(i, i + unit).reverse()
    }
    return bytes
  })
  const bitmaps = new Bytes(format).u32(metrics.length)
  let offset = 0
  for (const data of glyphData) {
    bitmaps.u32(offset)
    offset += data.length
  }
  for (let i = 0; i < 4; i++) bitmaps.u32(offset)
  for (const data of glyphData) bitmaps.bytes(data)
  const encoding = new Bytes(format).u16(minLow).u16(maxLow).u16(minHigh).u16(maxHigh).u16(defaultChar)
  for (const index of indices) encoding.u16(index)
  return new Map<number, Buffer>([
    [4, metricTable.build()],
    [8, bitmaps.build()],
    [32, encoding.build()],
  ])
}

export const fixture = (options: FixtureOptions = {}) => pack(fixtureTables(options))
