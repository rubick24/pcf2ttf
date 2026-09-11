import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { getGlyphBitmap, parsePcf } from '../src/index.js'
import { Bytes, fixture, fixtureTables, metric, metricBytes, pack } from './fixtures.js'

test('metrics support both byte orders independently of bit order, compressed and uncompressed', () => {
  for (const format of [0, 4, 8, 12]) {
    for (const compressed of [false, true]) {
      const font = parsePcf(fixture({ format, compressed }))
      assert.deepEqual(font.metrics, [metric])
      assert.deepEqual(getGlyphBitmap(font, 0), ['# #', ' # ', '###'])
      assert.deepEqual([...font.encoding.glyphIndices], [[65, 0]])
    }
  }
})

test('bitmap rows span multiple padding units, exclude padding, and respect scan units', () => {
  const rows = [
    '#       ##       #                #',
    ' #              # #              # ',
    '###################################',
    '                                   ',
  ]
  for (let padding = 0; padding < 4; padding++) {
    for (let scan = 0; scan < 4; scan++) {
      for (const order of [0, 4, 8, 12]) {
        const format = padding | (scan << 4) | order
        const font = parsePcf(
          fixture({
            format,
            metrics: [{ ...metric, leftSideBearing: 0, rightSideBearing: 35, ascent: 4, descent: 0 }],
            rows: [rows],
          }),
        )
        // Only whole scan units can be byte-swapped.
        if (Boolean(order & 4) !== Boolean(order & 8) && font.bitmaps.data.length % (1 << scan)) continue
        assert.deepEqual(getGlyphBitmap(font, 0), rows, `format ${format}`)
      }
    }
  }
})

test('uses actual two-byte codes and treats only 0xffff as missing', () => {
  const font = parsePcf(
    fixture({ minLow: 0x40, maxLow: 0x41, minHigh: 0x21, maxHigh: 0x22, indices: [0, 0xffff, 0xffff, 0] }),
  )
  assert.deepEqual(
    [...font.encoding.glyphIndices],
    [
      [0x2140, 0],
      [0x2241, 0],
    ],
  )
  const empty = { ...metric, rightSideBearing: -1, ascent: 0, descent: 0 }
  const large = parsePcf(
    fixture({ compressed: true, metrics: Array.from({ length: 32769 }, () => empty), indices: [32768] }),
  )
  assert.equal(large.encoding.glyphIndices.get(65), 32768)
  assert.equal(large.metrics.length, 32769)
})

test('string tables accept shared, unordered offsets and signed numeric properties', () => {
  const tables = fixtureTables()
  const strings = Buffer.from('value\0NAME\0NUMBER\0')
  const properties = new Bytes(8)
    .u32(2)
    .u32(6)
    .u8(1)
    .u32(0)
    .u32(11)
    .u8(0)
    .u32(-3)
    .bytes(Buffer.alloc(2))
    .u32(strings.length)
    .bytes(strings)
  tables.set(1, properties.build())
  tables.set(128, new Bytes().u32(1).u32(0).u32(2).bytes(Buffer.from('A\0')).build())
  tables.set(64, new Bytes().u32(1).u32(-100).build())
  const font = parsePcf(pack(tables))
  assert.deepEqual(font.properties, { NAME: 'value', NUMBER: -3 })
  assert.deepEqual(font.glyphNames, ['A'])
  assert.deepEqual(font.scalableWidths, [-100])
})

test('accelerator ink bounds depend on bit 8, not glyph padding; tolerates bdftopcf final size', () => {
  for (const format of [1, 0x100, 0x104]) {
    const tables = fixtureTables()
    const bytes = new Bytes(format).bytes(Buffer.alloc(8)).u32(3).u32(1).u32(-1)
    metricBytes(bytes)
    metricBytes(bytes)
    if (format & 0x100) {
      metricBytes(bytes, { ...metric, ascent: 1 })
      metricBytes(bytes, { ...metric, ascent: 1 })
    }
    tables.set(256, bytes.build())
    const input = pack(tables)
    input.writeUInt32LE(100, 8 + 3 * 16 + 8)
    const font = parsePcf(input)
    assert.equal(font.bdfAccelerators?.inkMaxBounds.ascent, format & 0x100 ? 1 : 2)
    assert.equal(font.bdfAccelerators?.maxOverlap, -1)
  }
})

test('accepts gzip and empty glyphs', () => {
  assert.deepEqual(getGlyphBitmap(parsePcf(gzipSync(fixture())), 0), ['# #', ' # ', '###'])
  const font = parsePcf(fixture({ metrics: [{ ...metric, rightSideBearing: -1, ascent: 0, descent: 0 }] }))
  assert.deepEqual(getGlyphBitmap(font, 0), [])
})

test('rejects malformed headers, tables, strings, counts, offsets, and glyph indices', () => {
  for (const input of [Buffer.alloc(0), Buffer.alloc(8), fixture().subarray(0, 30)])
    assert.throws(() => parsePcf(input))
  const cases: Array<(input: Buffer) => void> = [
    input => input.writeUInt32LE(0xffffffff, 4),
    input => input.writeUInt32LE(0xffffffff, 20),
    input => input.writeUInt32LE(1, 12),
    input => input.writeUInt32LE(0xffffffff, input.readUInt32LE(20) + 4),
    input => input.writeUInt32LE(0xffffffff, input.readUInt32LE(36) + 8),
    input => input.writeUInt16LE(1, input.readUInt32LE(52) + 14),
  ]
  for (const mutate of cases) {
    const input = fixture()
    mutate(input)
    assert.throws(() => parsePcf(input))
  }
  const tables = fixtureTables()
  tables.delete(4)
  assert.throws(() => parsePcf(pack(tables)), /Missing required/)
  tables.set(128, new Bytes().u32(1).u32(0).u32(1).bytes(Buffer.from('A')).build())
  tables.set(4, fixtureTables().get(4) as Buffer)
  assert.throws(() => parsePcf(pack(tables)), /NUL/)
})
