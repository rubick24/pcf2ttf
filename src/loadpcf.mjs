import fs from 'fs/promises'

export const loadPcf = async filePath => {
  const buffer = await fs.readFile(filePath)
  // least significant byte first => little endian
  // most significant byte first => big endian

  const typeEnum = {
    PCF_PROPERTIES: 1 << 0,
    PCF_ACCELERATORS: 1 << 1,
    PCF_METRICS: 1 << 2,
    PCF_BITMAPS: 1 << 3,
    PCF_INK_METRICS: 1 << 4,
    PCF_BDF_ENCODINGS: 1 << 5,
    PCF_SWIDTHS: 1 << 6,
    PCF_GLYPH_NAMES: 1 << 7,
    PCF_BDF_ACCELERATORS: 1 << 8
  }
  const typeEnumEntries = Object.entries(typeEnum)
  const formatEnum = {
    PCF_DEFAULT_FORMAT: 0x00000000,
    PCF_INKBOUNDS: 0x00000200,
    PCF_ACCEL_W_INKBOUNDS: 0x00000100,
    PCF_COMPRESSED_METRICS: 0x00000100
  }
  // const formatMask = {
  //   PCF_GLYPH_PAD_MASK: 0b0011 /* See the bitmap table for explanation */,
  //   PCF_BYTE_MASK: 0b0100 /* If set then Most Sig Byte First */,
  //   PCF_BIT_MASK: 0b1000 /* If set then Most Sig Bit First */,
  //   PCF_SCAN_UNIT_MASK: 0b110000
  // }

  const parseHeader = () => {
    const testPcf = buffer.subarray(0, 4).equals(new Uint8Array([0x01, 0x66, 0x63, 0x70]))

    if (!testPcf) {
      throw new Error('Not a PCF file')
    }

    let index = 4
    const nextInt32 = () => {
      const val = buffer.readInt32LE(index)
      index += 4
      return val
    }
    const tableCount = nextInt32()
    const tocEntries = Array.from({ length: tableCount }, () => {
      return {
        type: nextInt32(),
        format: nextInt32(),
        size: nextInt32(),
        offset: nextInt32()
      }
    })
    return tocEntries
  }

  const propertiesTable = entry => {
    const start = entry.offset
    const format = buffer.readInt32LE(start)
    // PCF_BYTE_MASK & PCF_BIT_MASK for big endian
    const endian = (format & 0b1100) > 0 ? 'BE' : 'LE'
    const nprops = buffer['readInt32' + endian](start + 4)
    let index = start + 8
    const propsList = Array.from({ length: nprops }, (_, i) => {
      const res = {
        name_offset: buffer['readInt32' + endian](index),
        is_string_prop: buffer.readInt8(index + 4),
        value: buffer['readInt32' + endian](index + 5)
      }
      index += 9
      return res
    })
    const padding = (nprops & 3) === 0 ? 0 : 4 - (nprops & 3)
    index += padding
    const stringSize = buffer['readInt32' + endian](index)
    index += 4
    const stringStart = index
    const props = {}
    const findNext = (i, name) => {
      if (name && propsList[i].is_string_prop) {
        return propsList[i].value
      }
      if (i < propsList.length - 1) {
        return propsList[i + 1].name_offset
      }
      return stringSize
    }
    for (let i = 0; i < propsList.length; i++) {
      const p = propsList[i]
      const nameEnd = findNext(i, true)

      const name = buffer
        .subarray(stringStart + p.name_offset, stringStart + nameEnd)
        .toString()
        .replace(/\x00$/, '')
      if (p.is_string_prop) {
        const valueEnd = findNext(i)
        props[name] = buffer
          .subarray(stringStart + p.value, stringStart + valueEnd)
          .toString()
          .replace(/\x00$/, '')
      } else {
        props[name] = p.value
      }
    }
    return props
  }

  const parseMetricsData = (compressed, endian, index) => {
    if (compressed) {
      return {
        left_sided_bearing: buffer.readUint8(index + 0) - 0x80,
        right_side_bearing: buffer.readUint8(index + 1) - 0x80,
        character_width: buffer.readUint8(index + 2) - 0x80,
        character_ascent: buffer.readUint8(index + 3) - 0x80,
        character_descent: buffer.readUint8(index + 4) - 0x80
      }
    } else {
      return {
        left_sided_bearing: buffer['readInt16' + endian](index + 0),
        right_side_bearing: buffer['readInt16' + endian](index + 2),
        character_width: buffer['readInt16' + endian](index + 4),
        character_ascent: buffer['readInt16' + endian](index + 6),
        character_descent: buffer['readInt16' + endian](index + 8),
        character_attributes: buffer['readUInt16' + endian](index + 10)
      }
    }
  }

  const acceleratorTable = entry => {
    const start = entry.offset
    const format = buffer.readInt32LE(start)
    const endian = (format & 0b1100) > 0 ? 'BE' : 'LE'

    const noOverlap = buffer.readUint8(start + 4)
    const constantMetrics = buffer.readUint8(start + 5)
    const terminalFont = buffer.readUint8(start + 6)
    const constantWidth = buffer.readUint8(start + 7)

    const inkInside = buffer.readUint8(start + 8)
    const inkMetrics = buffer.readUint8(start + 9)
    const drawDirection = buffer.readUint8(start + 10)
    // 1 byte padding here
    const fontAscent = buffer['readInt32' + endian](start + 12) // 12
    const fontDescent = buffer['readInt32' + endian](start + 16) // 3
    const maxOverlap = buffer['readInt32' + endian](start + 20) // 11

    const minBounds = parseMetricsData(false, endian, start + 24)
    const maxBounds = parseMetricsData(false, endian, start + 36)

    const hasInkBound = format & (formatEnum.PCF_ACCEL_W_INKBOUNDS > 0)

    const inkMinBounds = hasInkBound ? parseMetricsData(false, endian, start + 48) : minBounds
    const inkMaxBounds = hasInkBound ? parseMetricsData(false, endian, start + 60) : maxBounds

    return {
      noOverlap,
      constantMetrics,
      terminalFont,
      constantWidth,
      inkInside,
      inkMetrics,
      drawDirection,
      fontAscent,
      fontDescent,
      maxOverlap,
      minBounds,
      maxBounds,
      inkMinBounds,
      inkMaxBounds
    }
  }
  const metricsTable = entry => {
    const start = entry.offset
    const format = buffer.readInt32LE(start)
    const compressed = (format & formatEnum.PCF_COMPRESSED_METRICS) > 0
    const endian = (format & 0b1100) > 0 ? 'BE' : 'LE'
    // if (compressed) {
    //   const metrics_count = buffer['readInt16' + endian](start + 4)
    //   const metrics = Array.from({ length: metrics_count }, (_, i) =>
    //     parseMetricsData(true, endian, start + 6 + i * 12)
    //   )
    //   return { metrics_count, metrics }
    // } else {
    //   const metrics_count = buffer['readInt32' + endian](start + 4)
    //   const metrics = Array.from({ length: metrics_count }, (_, i) =>
    //     parseMetricsData(false, endian, start + 8 + i * 12)
    //   )
    //   return { metrics_count, metrics }
    // }
    const metrics_count = buffer[`readInt${compressed ? 16 : 32}${endian}`](start + 4)
    const metrics = Array.from({ length: metrics_count }, (_, i) =>
      parseMetricsData(compressed, endian, start + (compressed ? 6 : 8) + i * (compressed ? 5 : 12))
    )
    return { metrics_count, metrics }
  }
  const bitmapTable = entry => {
    const start = entry.offset
    const format = buffer.readInt32LE(start)
    // check format is default here
    const endian = (format & 0b1100) > 0 ? 'BE' : 'LE'
    const glyphCount = buffer['readInt32' + endian](start + 4)
    const offsets = Array.from({ length: glyphCount }, (_, i) =>
      buffer['readInt32' + endian](start + 8 + i * 4)
    )
    const bitmapSizeStart = start + 8 + glyphCount * 4
    const bitmapSizes = Array.from({ length: 4 }, (_, i) =>
      buffer['readInt32' + endian](bitmapSizeStart + i * 4)
    )

    const bitmapDataLength = bitmapSizes[format & 3]
    /* how each row in each glyph's bitmap is padded (format&3) */
    /*  0=>bytes, 1=>shorts, 2=>ints */
    /* what the bits are stored in (bytes, shorts, ints) (format>>4)&3 */
    /*  0=>bytes, 1=>shorts, 2=>ints */
    const rowLength = format & 3
    const bitsFormat = (format >> 4) & 3

    const bitmapDataStart = bitmapSizeStart + 16
    const bitmapData = Array.from({ length: glyphCount }, (_, i) => {
      const offset = offsets[i]
      const nextOffset = i < glyphCount - 1 ? offsets[i + 1] : bitmapDataLength
      const data = buffer.subarray(bitmapDataStart + offset, bitmapDataStart + nextOffset)
      return data
    })

    return { rowLength, bitsFormat, bitmapData, format }
  }

  const encodingTable = entry => {
    const start = entry.offset
    const format = buffer.readInt32LE(start)
    const endian = (format & 0b1100) > 0 ? 'BE' : 'LE'
    const min_char_or_byte2 = buffer['readInt16' + endian](start + 4)
    const max_char_or_byte2 = buffer['readInt16' + endian](start + 6)
    const min_byte1 = buffer['readInt16' + endian](start + 8)
    const max_byte1 = buffer['readInt16' + endian](start + 10)
    const default_char = buffer['readInt16' + endian](start + 12)

    const encodingLength = (max_char_or_byte2 - min_char_or_byte2 + 1) * (max_byte1 - min_byte1 + 1)
    const glyphIndicesStart = start + 14
    const glyphIndices = Array.from({ length: encodingLength }, (_, i) =>
      buffer['readInt16' + endian](glyphIndicesStart + i * 2)
    )
    /* a value of 0xffff means no glyph for that encoding */
    return { glyphIndices, default_char }
  }

  const scalableWidthTable = entry => {
    const start = entry.offset
    const format = buffer.readInt32LE(start)
    const endian = (format & 0b1100) > 0 ? 'BE' : 'LE'
    const glyphCount = buffer['readInt32' + endian](start + 4)
    const sWidths = Array.from({ length: glyphCount }, (_, i) =>
      buffer['readInt32' + endian](start + 8 + i * 4)
    )
    return { sWidths }
  }

  const glyphNamesTable = entry => {
    const start = entry.offset
    const format = buffer.readInt32LE(start)
    const endian = (format & 0b1100) > 0 ? 'BE' : 'LE'
    const glyphCount = buffer['readInt32' + endian](start + 4)
    const offsets = Array.from({ length: glyphCount }, (_, i) =>
      buffer['readInt32' + endian](start + 8 + i * 4)
    )
    const stringSizeStart = start + 8 + glyphCount * 4
    const stringSize = buffer['readInt32' + endian](stringSizeStart)
    const stringStart = stringSizeStart + 4
    const names = Array.from({ length: glyphCount }, (_, i) => {
      const nameStart = offsets[i]
      const nameEnd = i < glyphCount - 1 ? offsets[i + 1] : stringSize
      return buffer
        .subarray(stringStart + nameStart, stringStart + nameEnd)
        .toString()
        .replace(/\x00$/, '')
    })
    return { names }
  }

  const tocEntries = parseHeader()
  const tables = tocEntries.reduce((p, entry) => {
    const tableMap = {
      [typeEnum.PCF_PROPERTIES]: () => propertiesTable(entry),
      [typeEnum.PCF_ACCELERATORS]: () => acceleratorTable(entry),
      [typeEnum.PCF_BDF_ACCELERATORS]: () => acceleratorTable(entry),
      [typeEnum.PCF_METRICS]: () => metricsTable(entry),
      [typeEnum.PCF_INK_METRICS]: () => metricsTable(entry),
      [typeEnum.PCF_BITMAPS]: () => bitmapTable(entry),
      [typeEnum.PCF_BDF_ENCODINGS]: () => encodingTable(entry),
      [typeEnum.PCF_SWIDTHS]: () => scalableWidthTable(entry),
      [typeEnum.PCF_GLYPH_NAMES]: () => glyphNamesTable(entry)
    }
    const tableName = typeEnumEntries.find(([_, v]) => v === entry.type)[0]

    p[tableName] = tableMap[entry.type]?.()
    return p
  }, {})
  return tables
}

export const genGlyphArray = (tables, index, isBitmapIndex = true) => {
  const bitmapIndex = isBitmapIndex ? index : tables['PCF_BDF_ENCODINGS'].glyphIndices[index]
  // console.log(tables['PCF_SWIDTHS'].sWidths[bitmapIndex])
  const bitmapTable = tables['PCF_BITMAPS']
  const { rowLength, bitsFormat, format } = bitmapTable
  const formatLengthMap = [1, 2, 4]
  const endian = (format & 0b1100) > 0 ? 'BE' : 'LE'
  const data = bitmapTable.bitmapData[bitmapIndex]
  const size = formatLengthMap[rowLength]
  const dataArray = Array.from({ length: data.length / size }, (_, i) =>
    data[`readUInt${size * 8}${endian}`](i * size)
  )
  return dataArray.map(v =>
    v
      .toString(2)
      .padStart(formatLengthMap[rowLength] * 8, '0')
      .replaceAll('0', ' ')
      .replaceAll('1', '#')
  )
}

// const test = async () => {
//   const tables = await loadPcf('./wenquanyi_9pt.pcf')
//   for (let i = 65; i < 70; i++) {
//     console.log(genGlyphArray(tables, i))
//   }
//   console.log(genGlyphArray(tables, 20013))
//   console.log(genGlyphArray(tables, 25991))
//   console.log(genGlyphArray(tables, 39253))
// }
// test()
