import { Font } from 'fonteditor-core'

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    char =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char] ?? char,
  )

/** Embed the exact output bytes so a preview also works offline via file://. */
export const createPreviewHtml = (bytes: Buffer, scale: number): string => {
  const font = Font.create(bytes, { type: 'ttf' }).get()
  const codes = Object.keys(font.cmap)
    .map(Number)
    .filter(code => code !== 0xffff && font.cmap[code] > 0)
  const supported = new Set(codes)
  const samples = [
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789',
    'abcdefghijklmnopqrstuvwxyz · Ag Hx gjpqy',
    '我能吞下玻璃而不伤身体。中文点阵字体预览',
  ]
    .map(line => [...line].filter(char => supported.has(char.codePointAt(0) ?? 0)).join(''))
    .filter(Boolean)
  const initialText = samples.length
    ? samples.join('\n')
    : codes
        .filter(code => !/\p{C}/u.test(String.fromCodePoint(code)))
        .slice(0, 48)
        .map(code => String.fromCodePoint(code))
        .join('')
  const family = font.name.fontFamily
  const style = font.name.fontSubFamily
  const em = font.head.unitsPerEm
  const pixels = em / scale
  const os2 = font['OS/2']
  const metrics = {
    em,
    pixels,
    ascent: font.hhea.ascent,
    descent: font.hhea.descent,
    lineGap: font.hhea.lineGap,
    xHeight: os2.sxHeight,
    capHeight: os2.sCapHeight,
    inkTop: font.head.yMax,
    inkBottom: font.head.yMin,
    codes,
  }
  const table = [
    ['unitsPerEm', em],
    ['baseline', 0],
    ['hhea.ascent / sTypoAscender', font.hhea.ascent],
    ['hhea.descent / sTypoDescender', font.hhea.descent],
    ['lineGap / sTypoLineGap', font.hhea.lineGap],
    ['usWinAscent（防裁切）', os2.usWinAscent],
    ['usWinDescent（正数）', os2.usWinDescent],
    ['实际轮廓 yMax', font.head.yMax],
    ['实际轮廓 yMin', font.head.yMin],
    ['x-height', os2.sxHeight],
    ['cap-height', os2.sCapHeight],
  ] as const
  const fontSize = Math.min(256, pixels * 2)
  const sampleSizes = [1, 2, 3]
    .map(
      multiplier =>
        `<article><h3>${multiplier}× · ${pixels * multiplier}px</h3><div class="sample" style="font-size:${pixels * multiplier}px">${escapeHtml(initialText)}</div></article>`,
    )
    .join('\n')
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(family)} · 字体预览</title>
<style>
@font-face { font-family: 'PCFPreview'; src: url(data:font/ttf;base64,${bytes.toString('base64')}) format('truetype'); font-weight: normal; font-style: normal; font-display: block; }
* { box-sizing: border-box; }
body { margin: 0; color: #202820; background: #f4f5ef; font: 15px/1.6 system-ui, sans-serif; }
main { max-width: 1120px; margin: auto; padding: 48px 24px 72px; }
h1 { margin: 4px 0 8px; font-size: clamp(26px, 4vw, 42px); line-height: 1.2; overflow-wrap: anywhere; }
h2 { margin: 0 0 18px; font-size: 20px; } h3 { font-size: 13px; color: #596456; }
p { margin: 8px 0; } .muted { color: #596456; } .eyebrow { letter-spacing: .15em; font-size: 12px; font-weight: 700; color: #477542; }
section { background: white; border: 1px solid #d9dfd2; border-radius: 12px; padding: 24px; margin-top: 24px; }
.controls { display: flex; flex-wrap: wrap; gap: 20px; align-items: center; margin-bottom: 16px; }
label { display: block; font-weight: 600; } input, textarea, button { font: inherit; }
input[type=number] { width: 85px; margin-left: 8px; padding: 4px 8px; }
textarea { width: 100%; min-height: 116px; padding: 12px; border: 1px solid #aebaa5; border-radius: 6px; resize: vertical; margin: 8px 0 16px; }
.sample { font-family: 'PCFPreview'; font-synthesis: none; font-kerning: none; font-variant-ligatures: none; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.4; padding: 16px 0; }
#live { min-height: 100px; } .canvas-scroll { overflow: auto; border: 1px solid #e1e5dc; border-radius: 6px; } canvas { display: block; }
.legend { display: flex; flex-wrap: wrap; gap: 16px; font-size: 13px; margin: 12px 0; }
.legend span::before { content: ''; display: inline-block; width: 20px; border-top: 2px solid currentColor; margin-right: 6px; vertical-align: middle; }
.baseline { color: #bc4632; } .logical { color: #347347; } .ink { color: #8663ad; } .letter { color: #3677a5; }
.status { font-size: 13px; color: #477542; } #missing { color: #9b4a20; } .table-scroll { overflow: auto; }
table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; } th, td { padding: 9px 12px; text-align: left; border-bottom: 1px solid #e5e9e0; } th { color: #596456; font-size: 13px; } td:first-child { font-family: ui-monospace, monospace; font-size: 13px; }
article + article { border-top: 1px solid #e5e9e0; padding-top: 8px; }
@media (max-width: 600px) { main { padding: 24px 12px; } section { padding: 16px; } }
</style>
</head>
<body>
<main>
<header><div class="eyebrow">PCF → TRUETYPE</div><h1>${escapeHtml(family)}</h1><p class="muted">${escapeHtml(style)} · ${codes.length.toLocaleString('en-US')} 个字符 · 原始像素高度 ${pixels}px</p><p id="status" class="status" role="status">正在加载字体…</p></header>
<section>
<h2>文字预览</h2>
<div class="controls"><label>字号 <input id="size" type="number" min="1" max="256" step="1" value="${fontSize}"> px</label><label>行高 <input id="leading" type="number" min="0.5" max="4" step="0.1" value="1.4"> 倍</label></div>
<label for="text">预览文字</label><textarea id="text" maxlength="2000" spellcheck="false">${escapeHtml(initialText)}</textarea>
<p id="missing" role="status"></p><div id="live" class="sample">${escapeHtml(initialText)}</div>
</section>
<section>
<h2>基线与字形边界</h2><p class="muted">显示输入的第一行，使用 alphabetic baseline。基线为 y=0，上方为正，下方为负。</p>
<div class="legend"><span class="baseline">Baseline</span><span class="logical">Ascent / Descent</span><span class="ink">全字体轮廓边界</span><span class="letter">x-height / cap-height</span></div>
<div class="canvas-scroll"><canvas id="guides" aria-label="字体基线与度量辅助线">浏览器需要支持 Canvas 才能显示辅助线。</canvas></div>
<p class="muted">字形可能越过逻辑 ascent/descent。防裁切范围由 usWinAscent/usWinDescent 覆盖；紧行高仍可能造成相邻行重叠。</p>
</section>
<section><h2>整数倍像素预览</h2>${sampleSizes}</section>
<section><h2>生成字体中的实际度量</h2><div class="table-scroll"><table><thead><tr><th>属性</th><th>字体单位</th><th>源像素</th></tr></thead><tbody>${table.map(([name, value]) => `<tr><td>${escapeHtml(name)}</td><td>${value}</td><td>${value / scale}</td></tr>`).join('')}</tbody></table></div>
<p class="muted">逻辑行高 = ascent − descent + lineGap。CSS 的 line-height 会额外分配行间空间；baseline 不是需要另写入的独立偏移属性。</p></section>
<footer><p class="muted">此页面内嵌本次生成的字体，可离线打开，也可单独分享。字号取 ${pixels}px 的整数倍时最接近源点阵；屏幕缩放和抗锯齿仍可能影响显示。</p></footer>
<noscript>请启用 JavaScript 以使用字号调节和基线辅助线；静态文字预览仍可使用。</noscript>
</main>
<script id="font-metrics" type="application/json">${JSON.stringify(metrics).replaceAll('<', '\\u003c')}</script>
<script>
const metrics = JSON.parse(document.getElementById('font-metrics').textContent)
const text = document.getElementById('text')
const size = document.getElementById('size')
const leading = document.getElementById('leading')
const live = document.getElementById('live')
const canvas = document.getElementById('guides')
const supported = new Set(metrics.codes)
let ready = false
const update = () => {
  const px = Math.max(1, Math.min(256, Number(size.value) || metrics.pixels))
  const lineHeight = Math.max(0.5, Math.min(4, Number(leading.value) || 1.4))
  live.style.fontSize = px + 'px'
  live.style.lineHeight = String(lineHeight)
  live.textContent = text.value
  const missing = [...new Set([...text.value].filter(char => char !== '\\n' && char !== '\\r' && !supported.has(char.codePointAt(0))))]
  document.getElementById('missing').textContent = missing.length ? '字体未包含 ' + missing.length + ' 个字符，可能显示回退字体：' + missing.slice(0, 20).join(' ') : ''
  if (!ready) return
  const factor = px / metrics.em
  const top = Math.max(metrics.ascent, metrics.inkTop, metrics.xHeight, metrics.capHeight, 0)
  const bottom = Math.min(metrics.descent, metrics.inkBottom, 0)
  const width = Math.max(720, canvas.parentElement.clientWidth)
  const height = Math.ceil(64 + (top - bottom) * factor)
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.ceil(width * dpr)
  canvas.height = Math.ceil(height * dpr)
  canvas.style.width = width + 'px'
  canvas.style.height = height + 'px'
  const ctx = canvas.getContext('2d')
  ctx.scale(dpr, dpr)
  const baseline = 32 + top * factor
  const guide = (value, color, dashed) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.setLineDash(dashed ? [5, 4] : [])
    const y = baseline - value * factor
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
  }
  guide(metrics.inkTop, '#8663ad', true); guide(metrics.inkBottom, '#8663ad', true)
  if (metrics.xHeight) guide(metrics.xHeight, '#3677a5', true)
  if (metrics.capHeight) guide(metrics.capHeight, '#3677a5', true)
  guide(metrics.ascent, '#347347', false); guide(metrics.descent, '#347347', false)
  guide(0, '#bc4632', false)
  ctx.font = px + 'px PCFPreview'
  ctx.fontKerning = 'none'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#202820'
  ctx.fillText(text.value.split('\\n')[0], 24, baseline)
}
text.addEventListener('input', update)
size.addEventListener('input', update)
leading.addEventListener('input', update)
window.addEventListener('resize', update)
document.fonts.load('16px PCFPreview').then(fonts => {
  if (!fonts.length) throw new Error('Font unavailable')
  ready = true
  document.getElementById('status').textContent = '字体已加载 · 可离线预览'
  update()
}).catch(() => { document.getElementById('status').textContent = '字体加载失败，当前可能显示回退字体。' })
update()
</script>
</body>
</html>
`
}
