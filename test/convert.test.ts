import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { Font } from 'fonteditor-core'
import { convertPcfToTtf, createTtf, parsePcf } from '../src/index.js'
import { Bytes, fixture, fixtureTables, metric, metricBytes, pack } from './fixtures.js'

const readTtf = (bytes: Buffer) => Font.create(bytes, { type: 'ttf' }).get()

const checksum = (bytes: Buffer) => {
  let sum = 0
  for (let i = 0; i < bytes.length; i += 4) sum = (sum + bytes.readUInt32BE(i)) >>> 0
  return sum
}

test('writes TrueType outlines with .notdef, metrics, names, aliases and valid checksums', () => {
  const input = fixture({ minLow: 65, maxLow: 67, indices: [0, 0xffff, 0] })
  const bytes = convertPcfToTtf(input, { assumeUnicode: true, familyName: 'Test Pixel', styleName: 'Bold' })
  assert.equal(bytes.readUInt32BE(0), 0x10000)
  assert.equal(checksum(bytes), 0xb1b0afba)
  const font = readTtf(bytes)
  assert.equal(font.glyf.length, 3)
  assert.equal(font.cmap[65], 1)
  assert.equal(font.cmap[67], 2)
  assert.equal(font.cmap[66], undefined)
  assert.deepEqual(font.glyf[0].unicode ?? [], [])
  assert.deepEqual(font.glyf[0].contours, font.glyf[1].contours)
  assert.equal(font.glyf[1].advanceWidth, 400)
  assert.equal(font.glyf[1].xMin, -100)
  assert.equal(font.glyf[1].leftSideBearing, -100)
  assert.equal(font.glyf[1].yMin, -100)
  assert.equal(font.hhea.ascent, 200)
  assert.equal(font.hhea.descent, -100)
  assert.equal(font.head.unitsPerEm, 300)
  assert.equal(font.name.fontFamily, 'Test Pixel')
  assert.equal(font['OS/2'].usWeightClass, 700)
  assert.deepEqual(font.glyf[1].contours, font.glyf[2].contours)
})

test('prefers BDF accelerators, supports absent names/accelerators and blank glyphs', () => {
  const tables = fixtureTables()
  for (const [type, ascent] of [
    [2, 5],
    [256, 4],
  ]) {
    const table = new Bytes().bytes(Buffer.alloc(8)).u32(ascent).u32(1).u32(0)
    metricBytes(table)
    metricBytes(table)
    tables.set(type, table.build())
  }
  const font = readTtf(convertPcfToTtf(pack(tables), { assumeUnicode: true }))
  assert.equal(font.hhea.ascent, 400)
  assert.equal(font.head.unitsPerEm, 500)
  const blank = parsePcf(fixture())
  blank.bitmaps.data.fill(0)
  const output = readTtf(createTtf(blank, { assumeUnicode: true }))
  assert.equal(output.glyf[1].advanceWidth, 400)
  assert.equal((output.glyf[1].contours ?? []).length, 0)
})

test('validates charsets, font dimensions, scaling, naming and cmap capacity before serialization', () => {
  assert.throws(() => convertPcfToTtf(fixture()), /charset/)
  const wide = fixture({
    metrics: [{ ...metric, leftSideBearing: -300, rightSideBearing: 300 }],
    rows: [['#'.repeat(600), '', '']],
  })
  assert.throws(() => convertPcfToTtf(wide, { assumeUnicode: true }), /x delta/)

  for (const scale of [0, -1, NaN, Infinity, 1.5, 10000]) {
    assert.throws(() => convertPcfToTtf(fixture(), { assumeUnicode: true, scale }))
  }
  assert.throws(() => convertPcfToTtf(fixture(), { assumeUnicode: true, familyName: ' ' }), /Family name/)
  assert.throws(() => convertPcfToTtf(fixture(), { assumeUnicode: true, styleName: '\0' }), /Style name/)
  const font = parsePcf(fixture())
  font.properties = { CHARSET_REGISTRY: 'ISO8859', CHARSET_ENCODING: '1' }
  assert.doesNotThrow(() => createTtf(font))
  font.properties.CHARSET_ENCODING = '5'
  assert.throws(() => createTtf(font), /charset/)
  font.encoding.glyphIndices = new Map(Array.from({ length: 8200 }, (_, i) => [i * 2, 0]))
  assert.throws(() => createTtf(font, { assumeUnicode: true }), /fragmented/)
})

test('large contiguous cmap and unsigned indices survive TTF round-trip', () => {
  const font = parsePcf(fixture())
  font.encoding.glyphIndices = new Map(Array.from({ length: 40000 }, (_, i) => [i, 0]))
  font.bitmaps.data.fill(0)
  const output = readTtf(createTtf(font, { assumeUnicode: true }))
  assert.equal(output.glyf.length, 40001)
  assert.equal(output.cmap[32768], 32769)
  assert.equal(output.cmap[39999], 40000)
})

test('bundled WenQuanYi font retains every encoded character and advance width', async () => {
  const pcf = parsePcf(await readFile(new URL('../assets/wenquanyi_9pt.pcf', import.meta.url)))
  const bytes = createTtf(pcf)
  assert.equal(checksum(bytes), 0xb1b0afba)
  const ttf = readTtf(bytes)
  assert.equal(ttf.glyf.length, 30164)
  for (const [code, index] of pcf.encoding.glyphIndices) {
    assert.ok(ttf.cmap[code] > 0, `Missing U+${code.toString(16)}`)
    assert.equal(ttf.glyf[ttf.cmap[code]].advanceWidth, pcf.metrics[index].characterWidth * 100)
  }
})

test('keeps logical line metrics separate from ink bounds without shifting the baseline', () => {
  const input = fixture({
    metrics: [{ ...metric, ascent: 4, descent: 2 }],
    rows: [['###', ' # ', ' # ', ' # ', ' # ', '###']],
  })
  const pcf = parsePcf(input)
  pcf.properties.FONT_ASCENT = 2
  pcf.properties.FONT_DESCENT = 1
  const output = readTtf(createTtf(pcf, { assumeUnicode: true }))
  assert.equal(output.head.unitsPerEm, 300)
  assert.equal(output.hhea.ascent, 200)
  assert.equal(output.hhea.descent, -100)
  assert.equal(output['OS/2'].sTypoAscender, 200)
  assert.equal(output['OS/2'].sTypoDescender, -100)
  assert.equal(output['OS/2'].sTypoLineGap, 0)
  assert.equal(output['OS/2'].fsSelection & 128, 128)
  assert.equal(output.glyf[1].yMax, 400)
  assert.equal(output.glyf[1].yMin, -200)
  assert.equal(output['OS/2'].usWinAscent, 400)
  assert.equal(output['OS/2'].usWinDescent, 200)
})

test('a negative per-glyph descent keeps the entire glyph above the baseline', () => {
  const pcf = parsePcf(fixture({ metrics: [{ ...metric, ascent: 3, descent: -1 }], rows: [['###', '###']] }))
  const output = readTtf(createTtf(pcf, { assumeUnicode: true }))
  assert.equal(output.glyf[1].yMax, 300)
  assert.equal(output.glyf[1].yMin, 100)
  assert.equal(output.hhea.descent, 0)
})

test('x/cap height uses source properties or actual x/H ink, excluding padded bitmap rows', () => {
  const pcf = parsePcf(
    fixture({
      minLow: 72,
      maxLow: 120,
      metrics: [
        { ...metric, ascent: 5 },
        { ...metric, ascent: 2 },
      ],
      indices: Array.from({ length: 49 }, (_, i) => (i === 0 ? 0 : i === 48 ? 1 : 0xffff)),
      rows: [
        ['   ', '   ', '###', '# #', '###', '   '],
        ['   ', '###', '   '],
      ],
    }),
  )
  const output = readTtf(createTtf(pcf, { assumeUnicode: true }))
  assert.equal(output['OS/2'].sCapHeight, 300)
  assert.equal(output['OS/2'].sxHeight, 100)
  pcf.properties.X_HEIGHT = 2
  pcf.properties.CAP_HEIGHT = 4
  const overridden = readTtf(createTtf(pcf, { assumeUnicode: true, scale: 200 }))
  assert.equal(overridden['OS/2'].sxHeight, 400)
  assert.equal(overridden['OS/2'].sCapHeight, 800)
  pcf.properties.X_HEIGHT = -1
  assert.throws(() => createTtf(pcf, { assumeUnicode: true }), /X_HEIGHT/)
})

test('fallback line extents ignore unencoded glyphs', () => {
  const pcf = parsePcf(fixture({ metrics: [metric, { ...metric, ascent: 30 }], indices: [0] }))
  const output = readTtf(createTtf(pcf, { assumeUnicode: true }))
  assert.equal(output.hhea.ascent, 200)
  assert.equal(output.head.unitsPerEm, 300)
})
