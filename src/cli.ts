#!/usr/bin/env node
import { type FileHandle, lstat, open, readFile, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { convertPcfToTtf } from './convert.js'
import { createPreviewHtml } from './preview.js'

const help = `Usage: pcf2ttf [options] <input.pcf[.gz]>

Convert a PCF bitmap font to a TrueType pixel-outline font.
Also writes a standalone HTML preview beside the output (same basename).

Options:
  -o, --output <path>     Output .ttf path (default: beside input)
  -f, --family <name>     Font family (default: PCF FAMILY_NAME)
      --style <name>      Font style (default: Regular)
  -s, --scale <integer>   Font units per pixel (default: 100)
      --assume-unicode   Treat raw character codes as Unicode
      --force            Overwrite existing TTF and HTML output files
  -h, --help             Show this help
  -v, --version          Show version

Examples:
  pcf2ttf font.pcf
  pcf2ttf font.pcf.gz -o pixel.ttf --family "Pixel Font" --scale 100
  pcf2ttf -- -font.pcf
`

const main = async () => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      family: { type: 'string', short: 'f' },
      style: { type: 'string' },
      scale: { type: 'string', short: 's' },
      'assume-unicode': { type: 'boolean' },
      force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
  if (values.help) {
    process.stdout.write(help)
    return
  }
  if (values.version) {
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    process.stdout.write(`${pkg.version}\n`)
    return
  }
  if (positionals.length !== 1) throw new Error('Expected one input file. Run pcf2ttf --help for usage.')
  const input = resolve(positionals[0])
  const output = resolve(
    values.output ?? join(dirname(input), `${basename(input).replace(/\.pcf(?:\.gz)?$/i, '')}.ttf`),
  )
  if (!output.toLowerCase().endsWith('.ttf')) throw new Error('Output path must end in .ttf')
  const preview = output.replace(/\.ttf$/i, '.html')
  const source = await stat(input)
  const targets: Array<{ path: string; existed: boolean; handle?: FileHandle }> = []
  for (const path of [output, preview]) {
    if (path === input) throw new Error('Input and output must be different files')
    const destination = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
      return undefined
    })
    if (destination && (!destination.isFile() || (source.dev === destination.dev && source.ino === destination.ino))) {
      throw new Error(`Output must be a regular file distinct from input (including links): ${path}`)
    }
    if (destination && !values.force) throw new Error(`Output already exists: ${path}. Use --force to overwrite.`)
    targets.push({ path, existed: destination !== undefined })
  }
  if (values.scale !== undefined && !/^\d+$/.test(values.scale)) throw new Error('Scale must be a positive integer')
  const bytes = convertPcfToTtf(await readFile(input), {
    familyName: values.family,
    styleName: values.style,
    scale: values.scale === undefined ? undefined : Number(values.scale),
    assumeUnicode: values['assume-unicode'],
  })
  const html = createPreviewHtml(bytes, values.scale === undefined ? 100 : Number(values.scale))
  // Open both destinations before truncating either, so an HTML conflict cannot clobber the TTF.
  try {
    const identities: Array<{ dev: number; ino: number }> = [source]
    for (const target of targets) {
      target.handle = await open(target.path, target.existed ? 'r+' : 'wx')
      const identity = await target.handle.stat()
      if (!identity.isFile() || identities.some(other => other.dev === identity.dev && other.ino === identity.ino)) {
        throw new Error('Input, TTF and HTML must be distinct regular files')
      }
      identities.push(identity)
    }
    for (const [i, target] of targets.entries()) {
      if (!target.handle) throw new Error('Output file was not opened')
      await target.handle.truncate(0)
      await target.handle.writeFile(i === 0 ? bytes : html)
    }
  } catch (error) {
    for (const target of targets) {
      if (target.handle && !target.existed) await unlink(target.path).catch(() => undefined)
    }
    throw error
  } finally {
    await Promise.all(targets.map(target => target.handle?.close()))
  }
  process.stdout.write(`Created ${output} (${bytes.length} bytes)\nPreview ${preview}\n`)
}

try {
  await main()
} catch (error) {
  process.stderr.write(`pcf2ttf: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
