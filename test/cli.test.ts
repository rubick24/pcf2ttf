import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { fixture } from './fixtures.js'

const cli = fileURLToPath(new URL('../build/cli.js', import.meta.url))
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })

test('help/version do not read fonts; invalid usage fails on stderr', () => {
  const help = run('--help')
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Usage: pcf2ttf/)
  assert.equal(help.stderr, '')
  const version = run('--version')
  assert.equal(version.status, 0)
  assert.equal(version.stdout.trim(), '1.0.0')
  for (const args of [[], ['--unknown'], ['one.pcf', 'two.pcf'], ['--output']]) {
    const result = run(...args)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /^pcf2ttf:/)
    assert.equal(result.stdout, '')
  }
})

test('converts paths containing spaces, compressed inputs, default output and refuses overwrites', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pcf2ttf-cli-'))
  try {
    const input = join(directory, 'test font.pcf.gz')
    const output = join(directory, 'test font.ttf')
    await writeFile(input, gzipSync(fixture()))
    const result = run(input, '--assume-unicode', '--family', 'CLI Pixel')
    assert.equal(result.status, 0, result.stderr)
    let bytes = await readFile(output)
    const html = await readFile(join(directory, 'test font.html'), 'utf8')
    assert.match(result.stdout, /Preview /)
    assert.ok(html.includes(bytes.toString('base64')))
    assert.match(html, /CLI Pixel/)
    assert.equal(bytes.readUInt32BE(), 0x10000)
    assert.equal(run(input, '--assume-unicode').status, 1)
    assert.deepEqual(await readFile(output), bytes)
    assert.equal(run(input, '--assume-unicode', '--force', '--family', 'CLI Pixel').status, 0)
    bytes = await readFile(output)
    assert.equal(run(input, '--assume-unicode', '--scale', '1.2').status, 1)
    assert.equal(run(input, '-o', join(directory, 'wrong.otf')).status, 1)
    const alias = join(directory, 'alias.ttf')
    await symlink(input, alias)
    assert.equal(run(input, '-o', alias, '--force', '--assume-unicode').status, 1)
    assert.deepEqual(await readFile(input), gzipSync(fixture()))
    const invalid = join(directory, 'invalid.pcf')
    await writeFile(invalid, 'bad input')
    assert.equal(run(invalid, '-o', output, '--force').status, 1)
    assert.deepEqual(await readFile(output), bytes)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('checks both output paths before overwriting either artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pcf2ttf-outputs-'))
  try {
    const input = join(directory, 'font.pcf')
    const output = join(directory, 'font.ttf')
    const preview = join(directory, 'font.html')
    await writeFile(input, fixture())
    await writeFile(preview, 'existing preview')
    assert.equal(run(input, '--assume-unicode').status, 1)
    await assert.rejects(access(output))
    assert.equal(await readFile(preview, 'utf8'), 'existing preview')
    await rm(preview)
    await mkdir(preview)
    await writeFile(output, 'existing font')
    assert.equal(run(input, '--assume-unicode', '--force').status, 1)
    assert.equal(await readFile(output, 'utf8'), 'existing font')
    await rm(preview, { recursive: true })
    await link(output, preview)
    assert.equal(run(input, '--assume-unicode', '--force').status, 1)
    assert.equal(await readFile(output, 'utf8'), 'existing font')
    assert.equal(await readFile(preview, 'utf8'), 'existing font')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
