/**
 * A PDF made of pictures, one JPEG per page, with no PDF library: the format
 * needs only a catalog, a page tree, and per page a content stream that paints
 * one DCT-encoded image across the page. Used to export what is drawn on a
 * canvas (a conversation, a design board) when a single PNG would be too tall.
 */

export type PdfImagePage = {
  /** Baseline JPEG bytes. */
  jpeg: Uint8Array
  /** Pixel size of the JPEG. */
  width: number
  height: number
}

/** A4 width in points; pages keep the picture's aspect ratio. */
export const PDF_PAGE_WIDTH_PT = 595.28
/** Acrobat's page size ceiling (200 in): taller pages do not open everywhere. */
export const PDF_MAX_PAGE_PT = 14_400

const encoder = new TextEncoder()

/** Builds the PDF bytes; every page is `pageWidthPt` wide and as tall as its picture's aspect ratio asks. */
export function buildImagePdf(pages: readonly PdfImagePage[], pageWidthPt = PDF_PAGE_WIDTH_PT): Uint8Array<ArrayBuffer> {
  if (!pages.length) throw new Error('A PDF needs at least one page')
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  // Object numbers: 1 catalog, 2 page tree, then page / contents / image per page.
  const objectNumber = (page: number, part: 0 | 1 | 2) => 3 + page * 3 + part
  const begin = (number: number) => {
    offsets[number] = length
    push(`${number} 0 obj\n`)
  }
  const fixed = (value: number) => Number(value.toFixed(2)).toString()

  // The binary comment marks the file as binary for transfer tools.
  push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')
  begin(1)
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  begin(2)
  push(`<< /Type /Pages /Kids [${pages.map((_, index) => `${objectNumber(index, 0)} 0 R`).join(' ')}] /Count ${pages.length} >>\nendobj\n`)

  pages.forEach((page, index) => {
    if (!page.width || !page.height) throw new Error(`Page ${index + 1} has no size`)
    const widthPt = pageWidthPt
    const heightPt = Math.min(PDF_MAX_PAGE_PT, (pageWidthPt * page.height) / page.width)
    const content = `q ${fixed(widthPt)} 0 0 ${fixed(heightPt)} 0 0 cm /Im0 Do Q\n`

    begin(objectNumber(index, 0))
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fixed(widthPt)} ${fixed(heightPt)}] /Resources << /XObject << /Im0 ${objectNumber(index, 2)} 0 R >> >> /Contents ${objectNumber(index, 1)} 0 R >>\nendobj\n`)

    begin(objectNumber(index, 1))
    push(`<< /Length ${encoder.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`)

    begin(objectNumber(index, 2))
    push(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`)
    push(page.jpeg)
    push('\nendstream\nendobj\n')
  })

  const count = 3 + pages.length * 3
  const xref = length
  // Each xref entry is exactly 20 bytes: 10-digit offset, space, 5-digit generation, space, flag, CR LF.
  const entries = ['0000000000 65535 f\r\n']
  for (let number = 1; number < count; number++) entries.push(`${String(offsets[number]).padStart(10, '0')} 00000 n\r\n`)
  push(`xref\n0 ${count}\n${entries.join('')}trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/** The canvas as baseline JPEG bytes (white behind transparent pixels, which JPEG cannot hold). */
export async function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.9): Promise<PdfImagePage> {
  const flat = document.createElement('canvas')
  flat.width = canvas.width
  flat.height = canvas.height
  const context = flat.getContext('2d')
  if (!context) throw new Error('Canvas unavailable')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, flat.width, flat.height)
  context.drawImage(canvas, 0, 0)
  const blob = await new Promise<Blob | null>(resolve => flat.toBlob(resolve, 'image/jpeg', quality))
  if (!blob) throw new Error('Could not encode the page')
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), width: flat.width, height: flat.height }
}

/**
 * Cuts a tall canvas into page-sized strips, top to bottom. `pageHeightPx` is
 * the strip height in canvas pixels; the last strip keeps what is left.
 */
export function sliceCanvas(canvas: HTMLCanvasElement, pageHeightPx: number): HTMLCanvasElement[] {
  const strips: HTMLCanvasElement[] = []
  const step = Math.max(1, Math.floor(pageHeightPx))
  for (let top = 0; top < canvas.height; top += step) {
    const height = Math.min(step, canvas.height - top)
    const strip = document.createElement('canvas')
    strip.width = canvas.width
    strip.height = height
    strip.getContext('2d')?.drawImage(canvas, 0, top, canvas.width, height, 0, 0, canvas.width, height)
    strips.push(strip)
  }
  return strips
}

/** The PDF as a downloadable blob. */
export function pdfBlob(bytes: Uint8Array<ArrayBuffer>): Blob {
  return new Blob([bytes], { type: 'application/pdf' })
}
