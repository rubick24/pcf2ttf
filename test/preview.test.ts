import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Script } from 'node:vm'
import { convertPcfToTtf } from '../src/index.js'
import { createPreviewHtml } from '../src/preview.js'
import { fixture } from './fixtures.js'

test('HTML embeds exactly the generated TTF and reports its serialized metrics', () => {
  const bytes = convertPcfToTtf(fixture(), { assumeUnicode: true, scale: 200 })
  const html = createPreviewHtml(bytes, 200)
  const embedded = html.match(/data:font\/ttf;base64,([A-Za-z0-9+/=]+)/)?.[1]
  assert.ok(embedded)
  assert.deepEqual(Buffer.from(embedded, 'base64'), bytes)
  const json = html.match(/<script id="font-metrics" type="application\/json">(.*?)<\/script>/s)?.[1]
  assert.ok(json)
  const metrics = JSON.parse(json)
  assert.equal(metrics.em, 600)
  assert.equal(metrics.pixels, 3)
  assert.equal(metrics.ascent, 400)
  assert.equal(metrics.descent, -200)
  assert.deepEqual(metrics.codes, [65])
  assert.match(html, /baseline<\/td><td>0/)
  assert.match(html, /ctx.textBaseline = 'alphabetic'/)
  assert.match(html, /font-synthesis: none/)
  const script = html.match(/<script>\n(.*?)<\/script>/s)?.[1]
  assert.ok(script)
  assert.doesNotThrow(() => new Script(script))
  assert.doesNotMatch(html, /(?:src|href)=["']https?:/)
})

test('font names cannot inject HTML or scripts into the preview', () => {
  const familyName = '</title><script>alert("injection")</script>&'
  const html = createPreviewHtml(convertPcfToTtf(fixture(), { assumeUnicode: true, familyName }), 100)
  assert.ok(!html.includes(familyName))
  assert.match(html, /&lt;script&gt;alert\(&quot;injection&quot;\)&lt;\/script&gt;&amp;/)
  assert.equal((html.match(/<script\b/g) ?? []).length, 2)
})

test('preview controls update text, missing-character feedback and alphabetic baseline guides', async () => {
  const html = createPreviewHtml(convertPcfToTtf(fixture(), { assumeUnicode: true }), 100)
  const json = html.match(/<script id="font-metrics" type="application\/json">(.*?)<\/script>/s)?.[1]
  const source = html.match(/<script>\n(.*?)<\/script>/s)?.[1]
  assert.ok(json && source)
  const events = new Map<string, () => void>()
  const drawn: Array<{ text: string; x: number; y: number }> = []
  const context = {
    scale: () => {},
    setLineDash: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fillText: (text: string, x: number, y: number) => drawn.push({ text, x, y }),
    textBaseline: '',
  }
  const element = (id: string, value = '') => ({
    value,
    textContent: '',
    style: {} as Record<string, string>,
    addEventListener: (_event: string, callback: () => void) => events.set(id, callback),
  })
  const elements = {
    'font-metrics': { textContent: json },
    text: element('text', 'A'),
    size: element('size', '30'),
    leading: element('leading', '1.4'),
    live: element('live'),
    missing: element('missing'),
    status: element('status'),
    guides: {
      ...element('guides'),
      width: 0,
      height: 0,
      parentElement: { clientWidth: 800 },
      getContext: () => context,
    },
  }
  new Script(source).runInNewContext({
    document: {
      getElementById: (id: keyof typeof elements) => elements[id],
      fonts: { load: async () => [{}] },
    },
    window: { devicePixelRatio: 2, addEventListener: () => {} },
  })
  await new Promise(resolve => setImmediate(resolve))
  assert.match(elements.status.textContent, /字体已加载/)
  assert.equal(context.textBaseline, 'alphabetic')
  assert.deepEqual(drawn.at(-1), { text: 'A', x: 24, y: 52 })
  elements.text.value = 'A🙂\nA'
  elements.size.value = '60'
  elements.leading.value = '2'
  events.get('text')?.()
  assert.equal(elements.live.textContent, 'A🙂\nA')
  assert.equal(elements.live.style.fontSize, '60px')
  assert.equal(elements.live.style.lineHeight, '2')
  assert.match(elements.missing.textContent, /1 个字符/)
  assert.deepEqual(drawn.at(-1), { text: 'A🙂', x: 24, y: 72 })
})
