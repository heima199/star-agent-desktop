// Rasterizes the composer mascot animations (frame-by-frame vector SVGs) into
// WebP sprite sheets for src/assets/star-mascot.
//
// The source SVGs keep every frame as a <g id="fN"> in <defs> and flip a single
// <use> through them with SMIL. They run 28-34 MB each, far too heavy to parse
// in the composer, so each frame is drawn once by Chromium at the cell size and
// packed into one sheet that ComposerMascot plays on a canvas.
//
// usage (from desktop/):
//   node_modules/electron/dist/electron scripts/build-star-mascot-sprites.cjs --src=<folder with the SVGs> [--cell=160] [--cols=16] [--quality=0.86]
// The SVG file names must start with 思考 / 工作 / 空闲 / 休息.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const arg = (name, fallback) => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}
const SOURCE_DIR = arg('src')
const CELL = Number(arg('cell', '160'))
const COLS = Number(arg('cols', '16'))
const QUALITY = Number(arg('quality', '0.86'))
const OUT_DIR = path.resolve(__dirname, '..', 'src', 'assets', 'star-mascot')
const STATES = [
  ['思考', 'thinking'],
  ['工作', 'working'],
  ['空闲', 'idle'],
  ['休息', 'resting'],
]

app.setPath('userData', path.join(os.tmpdir(), 'star-mascot-sprite-build'))

/** Splits the source into self-contained single-frame SVG documents. */
function splitFrames(svgText) {
  const viewBox = /viewBox="([^"]+)"/.exec(svgText)?.[1]
  if (!viewBox) throw new Error('no viewBox')
  const duration = Number(/data-duration="([\d.]+)"/.exec(svgText)?.[1] ?? 'NaN')
  const frames = []
  for (let index = 0; ; index += 1) {
    const start = svgText.indexOf(`<g id="f${index}" data-frame="${index}">`)
    if (start < 0) break
    let end = svgText.indexOf(`<g id="f${index + 1}" data-frame="${index + 1}">`, start)
    if (end < 0) end = svgText.indexOf('</defs><use id="player"', start)
    if (end < 0) throw new Error(`frame ${index} has no end`)
    frames.push(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${viewBox}" width="${CELL}" height="${CELL}">${svgText.slice(start, end)}</svg>`,
    )
  }
  if (!frames.length) throw new Error('no frames found')
  return { frames, duration }
}

/** Runs in the renderer: draws every frame into one sheet and returns it as WebP. */
async function drawSheet({ framesFile, cell, cols, quality }) {
  const frames = JSON.parse(require('node:fs').readFileSync(framesFile, 'utf8'))
  const rows = Math.ceil(frames.length / cols)
  const canvas = document.createElement('canvas')
  canvas.width = cols * cell
  canvas.height = rows * cell
  const context = canvas.getContext('2d')
  for (let index = 0; index < frames.length; index += 1) {
    const url = URL.createObjectURL(new Blob([frames[index]], { type: 'image/svg+xml' }))
    const image = new Image()
    image.src = url
    await image.decode()
    context.drawImage(image, (index % cols) * cell, Math.floor(index / cols) * cell, cell, cell)
    URL.revokeObjectURL(url)
  }
  return canvas.toDataURL('image/webp', quality)
}

app.whenReady().then(async () => {
  if (!SOURCE_DIR) throw new Error('--src=<folder> is required')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const page = path.join(os.tmpdir(), 'star-mascot-sprite-build.html')
  fs.writeFileSync(page, '<!doctype html><html><body></body></html>')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false },
  })
  await win.loadFile(page)
  const files = fs.readdirSync(SOURCE_DIR).filter((name) => name.endsWith('.svg'))
  const report = []
  for (const [prefix, state] of STATES) {
    const file = files.find((name) => name.startsWith(prefix))
    if (!file) throw new Error(`missing SVG for ${prefix}`)
    const { frames, duration } = splitFrames(fs.readFileSync(path.join(SOURCE_DIR, file), 'utf8'))
    const framesFile = path.join(os.tmpdir(), `star-mascot-${state}.frames.json`)
    fs.writeFileSync(framesFile, JSON.stringify(frames))
    const dataUrl = await win.webContents.executeJavaScript(`(${drawSheet.toString()})(${JSON.stringify({ framesFile, cell: CELL, cols: COLS, quality: QUALITY })})`)
    fs.rmSync(framesFile, { force: true })
    const webp = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
    fs.writeFileSync(path.join(OUT_DIR, `${state}.webp`), webp)
    report.push({ state, source: file, frames: frames.length, duration, fps: Number((frames.length / duration).toFixed(3)), bytes: webp.length })
  }
  console.log(JSON.stringify({ cell: CELL, cols: COLS, quality: QUALITY, out: OUT_DIR, sheets: report }, null, 2))
  app.quit()
}).catch((error) => {
  console.error(error)
  app.exit(1)
})
