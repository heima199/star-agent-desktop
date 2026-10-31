import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const api = vi.hoisted(() => ({
  plaza: vi.fn(),
  designLibrary: vi.fn(),
  designProjects: vi.fn(),
  designPrompts: vi.fn(),
  createDesignProject: vi.fn(),
}))

vi.mock('@/api/star', () => ({
  starApi: api,
  starErrorText: (error: unknown) => String(error),
  designFileUrl: (id: string, file: string) => `/design/${id}/${file}`,
}))
vi.mock('html2canvas', () => ({ default: vi.fn() }))

import html2canvas from 'html2canvas'
import { InspirationPage } from './pages/CommunityPages'
import { DesignHome } from './design/DesignHome'
import { BoardTooLargeForImageError, fillTableFromRows, fitsOneImage, flipLayer, hasImageEdits, individualTransform, MAX_IMAGE_SIDE, parseCopiedRange, pasteIntoTable, pdfStripHeight, readImageAdjustment, renderBoardPng, resetImageEdits, rotateLayer, setImageAdjustment, TABLE_IMPORT_LIMITS, tableRows } from './design/designEditor'
import type { EditorController } from './design/BoardEditor'
import { PropertiesPanel } from './design/CanvasPanels'
import { rowsToCsv, rowsToXlsx, rowsToXlsxBytes, spreadsheetRowsFromBytes } from './design/tableSpreadsheet'
import { workbookOf } from '@/test/fixtures/xlsx'
import { FEED_PAGE_SIZE } from './starFeed'
import { useStarStore } from '@/stores/starStore'

type Observer = { callback: IntersectionObserverCallback; target?: Element; live: boolean }
const observers: Observer[] = []

function report(visible: boolean) {
  act(() => {
    for (const observer of observers.filter(item => item.live && item.target)) {
      observer.callback([{ isIntersecting: visible, target: observer.target! } as IntersectionObserverEntry], {} as IntersectionObserver)
    }
  })
}

/** The end of the list is in view and the user scrolls down with the wheel. */
function scrollToEnd() {
  report(true)
  act(() => {
    fireEvent.wheel(window, { deltaY: 120 })
  })
}

function works(prefix: string, from: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${from + index}`,
    category: 'image',
    subcategory: '',
    title: `作品 ${from + index}`,
    summary: '',
    coverUrl: `https://cdn.example.test/${prefix}/${from + index}.png`,
    prompt: `提示词 ${from + index}`,
    invokePath: '/image',
  }))
}

beforeEach(() => {
  observers.length = 0
  class IntersectionObserverMock {
    private readonly entry: Observer
    constructor(callback: IntersectionObserverCallback) {
      this.entry = { callback, live: true }
      observers.push(this.entry)
    }
    observe(target: Element) { this.entry.target = target }
    disconnect() { this.entry.live = false }
    unobserve() {}
    takeRecords() { return [] }
  }
  Object.defineProperty(window, 'IntersectionObserver', { configurable: true, value: IntersectionObserverMock })
  for (const mock of Object.values(api)) mock.mockReset()
})

afterEach(() => {
  Reflect.deleteProperty(window, 'IntersectionObserver')
})

const placeholders = () => document.querySelectorAll('[data-feed-placeholder]').length

// 灵感社区: 12 at a time, the next 12 on scrolling down, no broken pictures.
describe('InspirationPage', () => {
  it('loads 12 works per step and the next step when scrolled to the end', async () => {
    expect(FEED_PAGE_SIZE).toBe(12)
    api.plaza.mockImplementation(async ({ page }: { page: number }) => ({
      categories: [],
      items: works('wall', (page - 1) * FEED_PAGE_SIZE, FEED_PAGE_SIZE),
      total: 40,
    }))
    render(<InspirationPage />)

    const wall = await screen.findByTestId('inspiration-wall')
    await waitFor(() => expect(within(wall).getAllByRole('button')).toHaveLength(FEED_PAGE_SIZE))
    expect(api.plaza).toHaveBeenCalledTimes(1)
    expect(api.plaza).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, pageSize: FEED_PAGE_SIZE }))

    scrollToEnd()
    await waitFor(() => expect(within(screen.getByTestId('inspiration-wall')).getAllByRole('button')).toHaveLength(FEED_PAGE_SIZE * 2))
    expect(api.plaza).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: FEED_PAGE_SIZE }))
  })

  // The wall is drawn before the works arrive: a step of placeholder cards,
  // and another one under the wall while the next step is on its way.
  it('holds the place of a step with placeholder cards while it loads', async () => {
    let resolveSecond!: (value: { categories: never[]; items: ReturnType<typeof works>; total: number }) => void
    let resolveFirst!: typeof resolveSecond
    api.plaza.mockImplementation(({ page }: { page: number }) => new Promise(resolve => {
      if (page === 1) resolveFirst = resolve
      else resolveSecond = resolve
    }))
    render(<InspirationPage />)

    expect(screen.getByTestId('inspiration-wall')).toHaveAttribute('aria-busy', 'true')
    expect(placeholders()).toBe(FEED_PAGE_SIZE)
    await act(async () => { resolveFirst({ categories: [], items: works('slow', 0, FEED_PAGE_SIZE), total: 40 }) })
    expect(within(screen.getByTestId('inspiration-wall')).getAllByRole('button')).toHaveLength(FEED_PAGE_SIZE)
    expect(placeholders()).toBe(0)

    scrollToEnd()
    expect(placeholders()).toBe(FEED_PAGE_SIZE)
    await act(async () => { resolveSecond({ categories: [], items: works('slow', FEED_PAGE_SIZE, FEED_PAGE_SIZE), total: 40 }) })
    expect(placeholders()).toBe(0)
    expect(within(screen.getByTestId('inspiration-wall')).getAllByRole('button')).toHaveLength(FEED_PAGE_SIZE * 2)
  })

  // Pictures load their height late, so the sentinel starts out on screen;
  // that must not chain page after page (it once loaded every work at once).
  it('loads nothing more until the user scrolls down, then one step per gesture', async () => {
    api.plaza.mockImplementation(async ({ page }: { page: number }) => ({
      categories: [],
      items: works('idle', (page - 1) * FEED_PAGE_SIZE, FEED_PAGE_SIZE),
      total: 90,
    }))
    render(<InspirationPage />)

    await waitFor(() => expect(within(screen.getByTestId('inspiration-wall')).getAllByRole('button')).toHaveLength(FEED_PAGE_SIZE))
    // The end sliding in and out of view on its own (pictures settling) loads nothing,
    // and neither does scrolling up.
    report(true)
    report(false)
    report(true)
    act(() => {
      fireEvent.wheel(window, { deltaY: -120 })
    })
    expect(api.plaza).toHaveBeenCalledTimes(1)
    // No 加载更多 button any more: turning the wheel down is the whole gesture,
    // and works for a list too short to scroll.
    expect(within(screen.getByTestId('inspiration-more')).queryByRole('button')).toBeNull()

    act(() => {
      fireEvent.wheel(window, { deltaY: 120 })
    })
    await waitFor(() => expect(within(screen.getByTestId('inspiration-wall')).getAllByRole('button')).toHaveLength(FEED_PAGE_SIZE * 2))
    expect(api.plaza).toHaveBeenCalledTimes(2)
  })

  // The STAR service answers with the whole list whatever pageSize says.
  it('still shows one step at a time when the service sends every work at once', async () => {
    api.plaza.mockResolvedValue({ categories: [], items: works('all', 0, 100), total: 100 })
    render(<InspirationPage />)

    await waitFor(() => expect(within(screen.getByTestId('inspiration-wall')).getAllByRole('button')).toHaveLength(FEED_PAGE_SIZE))
    scrollToEnd()
    await waitFor(() => expect(within(screen.getByTestId('inspiration-wall')).getAllByRole('button')).toHaveLength(FEED_PAGE_SIZE * 2))
    // The rest was already here, so no second request.
    expect(api.plaza).toHaveBeenCalledTimes(1)
  })

  it('says when the end is reached', async () => {
    api.plaza.mockResolvedValue({ categories: [], items: works('end', 0, 5), total: 5 })
    render(<InspirationPage />)

    expect(await within(screen.getByTestId('inspiration-more')).findByText('已经到底了')).toBeInTheDocument()
  })

  it('stops asking once a page comes back short', async () => {
    api.plaza.mockResolvedValue({ categories: [], items: works('short', 0, 6), total: 999 })
    render(<InspirationPage />)

    await waitFor(() => expect(within(screen.getByTestId('inspiration-wall')).getAllByRole('button')).toHaveLength(6))
    scrollToEnd()
    expect(api.plaza).toHaveBeenCalledTimes(1)
  })

  it('drops a work whose picture fails to load instead of showing a broken image', async () => {
    api.plaza.mockResolvedValue({ categories: [], items: works('broken', 0, 3), total: 3 })
    render(<InspirationPage />)

    const wall = await screen.findByTestId('inspiration-wall')
    await waitFor(() => expect(within(wall).getAllByRole('button')).toHaveLength(3))
    fireEvent.error(wall.querySelector('img[src$="/broken/1.png"]')!)

    await waitFor(() => expect(within(screen.getByTestId('inspiration-wall')).getAllByRole('button')).toHaveLength(2))
    expect(screen.getByTestId('inspiration-wall').querySelector('img[src$="/broken/1.png"]')).toBeNull()
  })
})

describe('DesignHome', () => {
  beforeEach(() => {
    api.designLibrary.mockResolvedValue({ systems: [], templates: [], skills: [] })
    api.designProjects.mockResolvedValue({ projects: [] })
    api.designPrompts.mockResolvedValue({ items: [] })
  })

  // 自由创作 … 网页: all nine side by side, never wrapping to a second row.
  it('keeps the nine design types on one row', async () => {
    api.plaza.mockResolvedValue({ categories: [], items: [], total: 0 })
    render(<DesignHome onOpen={() => {}} />)

    const row = screen.getByTestId('design-kind-row')
    expect(row).toHaveClass('flex', 'flex-nowrap')
    expect(row).not.toHaveClass('flex-wrap')
    const kinds = within(row).getAllByRole('button')
    expect(kinds.map(kind => kind.textContent)).toEqual(['自由创作', '海报', '社交媒体', '信息图', '演示文稿', '长图海报', '套图', '矢量图', '网页'])
    for (const kind of kinds) expect(kind.querySelector('span:last-child')).toHaveClass('whitespace-nowrap')
    await waitFor(() => expect(api.plaza).toHaveBeenCalled())
  })

  it('shows one step of inspiration pictures at a time and drops broken ones', async () => {
    api.plaza.mockImplementation(async ({ page }: { page: number }) => ({
      categories: [],
      items: works('home', (page - 1) * FEED_PAGE_SIZE, FEED_PAGE_SIZE),
      total: FEED_PAGE_SIZE * 2,
    }))
    render(<DesignHome onOpen={() => {}} />)

    const feed = await screen.findByTestId('design-inspiration-feed')
    await waitFor(() => expect(within(feed).getAllByRole('img')).toHaveLength(FEED_PAGE_SIZE))
    expect(api.plaza).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'image', page: 1, pageSize: FEED_PAGE_SIZE }))

    // A broken picture leaves, and the next work moves up from the next page:
    // the wall stays full instead of showing a hole.
    fireEvent.error(within(feed).getAllByRole('img')[0]!)
    await waitFor(() => expect(api.plaza).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, pageSize: FEED_PAGE_SIZE })))
    await waitFor(() => expect(within(screen.getByTestId('design-inspiration-feed')).getAllByRole('img')).toHaveLength(FEED_PAGE_SIZE))
    expect(screen.getByTestId('design-inspiration-feed').querySelector('img[src$="/home/0.png"]')).toBeNull()

    scrollToEnd()
    await waitFor(() => expect(within(screen.getByTestId('design-inspiration-feed')).getAllByRole('img')).toHaveLength(FEED_PAGE_SIZE * 2 - 1))
  })

  // The STAR list once opened with 47 works whose pictures were missing or
  // gone: the first steps showed nothing but a 加载更多 button.
  it('skips works without a usable picture so the first step is never empty', async () => {
    const missing = works('gone', 0, 20).map(item => ({ ...item, coverUrl: '' }))
    const relative = works('rel', 0, 5).map(item => ({ ...item, coverUrl: 'cover.png' }))
    api.plaza.mockResolvedValue({ categories: [], items: [...missing, ...relative, ...works('ok', 0, 30)], total: 55 })
    render(<DesignHome onOpen={() => {}} />)

    const feed = await screen.findByTestId('design-inspiration-feed')
    await waitFor(() => expect(within(feed).getAllByRole('img')).toHaveLength(FEED_PAGE_SIZE))
    for (const image of within(feed).getAllByRole('img')) expect(image.getAttribute('src')).toContain('/ok/')
    expect(api.plaza).toHaveBeenCalledTimes(1)
  })

  // The design box remembers: sent prompts come back with ↑ or the 历史 menu,
  // and text not yet sent survives leaving the page.
  it('remembers sent prompts and keeps an unsent draft', async () => {
    api.plaza.mockResolvedValue({ categories: [], items: [], total: 0 })
    api.createDesignProject.mockResolvedValue({ project: { id: 'p1' } })
    try {
      const view = render(<DesignHome onOpen={() => {}} />)
      const input = screen.getByPlaceholderText('和 STAR 一起创作')
      for (const [index, text] of ['国庆促销海报', '咖啡店菜单'].entries()) {
        fireEvent.change(input, { target: { value: text } })
        fireEvent.keyDown(input, { key: 'Enter' })
        await waitFor(() => expect(api.createDesignProject).toHaveBeenCalledTimes(index + 1))
        await waitFor(() => expect(input).toHaveValue(''))
      }
      expect(JSON.parse(localStorage.getItem('star.design.promptHistory')!)).toEqual(['咖啡店菜单', '国庆促销海报'])

      // ↑ on the empty box walks back; ↓ walks forward to what was being typed.
      fireEvent.keyDown(input, { key: 'ArrowUp' })
      expect(input).toHaveValue('咖啡店菜单')
      fireEvent.keyDown(input, { key: 'ArrowUp' })
      expect(input).toHaveValue('国庆促销海报')
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      fireEvent.keyDown(input, { key: 'ArrowDown' })
      expect(input).toHaveValue('')

      fireEvent.click(screen.getByRole('button', { name: '历史' }))
      fireEvent.click(screen.getByRole('menuitem', { name: '国庆促销海报' }))
      expect(input).toHaveValue('国庆促销海报')

      view.unmount()
      render(<DesignHome onOpen={() => {}} />)
      expect(screen.getByPlaceholderText(/和 STAR 一起创作/)).toHaveValue('国庆促销海报')

      fireEvent.click(screen.getByRole('button', { name: '历史' }))
      fireEvent.click(screen.getByRole('menuitem', { name: '清空历史' }))
      expect(localStorage.getItem('star.design.promptHistory')).toBeNull()
      expect(screen.queryByRole('button', { name: '历史' })).not.toBeInTheDocument()
      await waitFor(() => expect(api.plaza).toHaveBeenCalled())
    } finally {
      localStorage.removeItem('star.design.promptHistory')
      localStorage.removeItem('star.design.promptDraft')
    }
  })

  // The description is the agent's first message, and its models come with
  // the STAR account: signed out, the sign-in comes first and the text stays,
  // instead of a new project whose first reply is "Not logged in".
  it('asks to sign in before starting a design while signed out', async () => {
    const initialRefreshStatus = useStarStore.getState().refreshStatus
    api.plaza.mockResolvedValue({ categories: [], items: [], total: 0 })
    useStarStore.setState({ status: { signedIn: false } as never, loginOpen: false })
    try {
      render(<DesignHome onOpen={() => {}} />)
      const input = screen.getByPlaceholderText(/和 STAR 一起创作/)
      fireEvent.change(input, { target: { value: '科技峰会竖版海报' } })
      fireEvent.keyDown(input, { key: 'Enter' })

      await waitFor(() => expect(useStarStore.getState().loginOpen).toBe(true))
      expect(api.createDesignProject).not.toHaveBeenCalled()
      expect(input).toHaveValue('科技峰会竖版海报')
      expect(localStorage.getItem('star.design.promptHistory')).toBeNull()

      // Right after start the status is not loaded yet: it is asked for first.
      const refreshStatus = vi.fn(async () => ({ signedIn: false }) as never)
      useStarStore.setState({ status: null, loginOpen: false, refreshStatus })
      fireEvent.keyDown(input, { key: 'Enter' })
      await waitFor(() => expect(useStarStore.getState().loginOpen).toBe(true))
      expect(refreshStatus).toHaveBeenCalledTimes(1)
      expect(api.createDesignProject).not.toHaveBeenCalled()
      await waitFor(() => expect(api.plaza).toHaveBeenCalled())
    } finally {
      useStarStore.setState({ status: null, loginOpen: false, refreshStatus: initialRefreshStatus })
      localStorage.removeItem('star.design.promptDraft')
    }
  })
})

// A board past the canvas ceiling cannot become one picture; the export says
// so and points at PDF, which draws it page by page.
describe('design board export', () => {
  it('knows which boards fit one picture', () => {
    expect(fitsOneImage(1080, 1920)).toBe(true)
    expect(fitsOneImage(1440, MAX_IMAGE_SIDE)).toBe(true)
    expect(fitsOneImage(1440, MAX_IMAGE_SIDE + 1)).toBe(false)
    // Under the side limit both ways, but over the area limit.
    expect(fitsOneImage(20_000, 20_000)).toBe(false)
  })

  it('refuses an oversized board before drawing it, and names PDF as the way out', async () => {
    await expect(renderBoardPng(document, 1440, 40_000)).rejects.toThrow(BoardTooLargeForImageError)
    await expect(renderBoardPng(document, 1440, 40_000)).rejects.toThrow(/导出 PDF/)
    expect(html2canvas).not.toHaveBeenCalled()
  })

  it('cuts PDF pages small enough to draw and to open', () => {
    expect(pdfStripHeight(1440)).toBe(8_192)
    // A very wide board: each strip still stays under the canvas area ceiling.
    expect(1440 * 20 * pdfStripHeight(1440 * 20)).toBeLessThanOrEqual(16_384 * 16_384)
    expect(pdfStripHeight(10)).toBeGreaterThan(0)
  })
})

// 表格编辑 takes spreadsheets: a range copied from Excel pastes into a board
// table, a workbook imports as one, and a table leaves as .xlsx or .csv.
describe('board tables and spreadsheets', () => {
  const newTable = (rows: string[][]) => {
    const table = document.createElement('table')
    document.body.appendChild(table)
    fillTableFromRows(table, rows)
    return table
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('reads a range the way Excel puts it on the clipboard', () => {
    expect(parseCopiedRange('季度\t营收\r\nQ1\t120\r\nQ2\t"1,30\t0"\r\n')).toEqual([['季度', '营收'], ['Q1', '120'], ['Q2', '1,30\t0']])
    // A quoted cell may hold a line break and doubled quotes.
    expect(parseCopiedRange('"第一行\n第二行"\t"说 ""好"""')).toEqual([['第一行\n第二行', '说 "好"']])
    // One plain value is text for one cell, not a range.
    expect(parseCopiedRange('只是一句话')).toBeNull()
  })

  it('pastes a range from the current cell, growing the table past its edge', () => {
    const table = newTable([['项目', '数值'], ['A', '1']])
    const last = pasteIntoTable(table, table.rows[1]!.cells[1]!, [['10', '备注一'], ['20', '备注二']])

    expect(tableRows(table)).toEqual([['项目', '数值', ''], ['A', '10', '备注一'], ['', '20', '备注二']])
    expect(last.textContent).toBe('备注二')
  })

  it('builds a table with a header from rows, within the board limits', () => {
    const wide = Array.from({ length: TABLE_IMPORT_LIMITS.rows + 5 }, (_, row) => Array.from({ length: TABLE_IMPORT_LIMITS.columns + 3 }, (_, col) => `${row}-${col}`))
    const table = document.createElement('table')

    expect(fillTableFromRows(table, wide)).toEqual({ truncated: true })
    expect(table.tHead?.rows[0]?.cells[0]?.tagName).toBe('TH')
    expect(table.rows).toHaveLength(TABLE_IMPORT_LIMITS.rows)
    expect(table.rows[0]!.cells).toHaveLength(TABLE_IMPORT_LIMITS.columns)
    expect(fillTableFromRows(table, [['名称'], ['甲']])).toEqual({ truncated: false })
    expect(tableRows(table)).toEqual([['名称'], ['甲']])
  })

  it('imports the first visible sheet of a workbook, and CSV text by its name', async () => {
    const bytes = workbookOf([
      { name: '隐藏', rows: [['不该出现']], hidden: 1 },
      { name: '销售', rows: [['区域', '销量'], ['华东', 120], ['华南', 98], [null, null]] },
    ])
    expect(await spreadsheetRowsFromBytes(bytes, '销售.xlsx')).toEqual({ rows: [['区域', '销量'], ['华东', '120'], ['华南', '98']], truncated: false })

    const csv = new TextEncoder().encode('城市,人口\n北京,"2,189"\n')
    expect(await spreadsheetRowsFromBytes(csv, '城市.csv')).toEqual({ rows: [['城市', '人口'], ['北京', '2,189']], truncated: false })
    await expect(spreadsheetRowsFromBytes(new TextEncoder().encode('not a workbook'), 'x.xlsx')).rejects.toThrow('无法读取这个文件')
  })

  it('writes a table back out as a workbook and as CSV Excel reads correctly', async () => {
    const rows = [['名称', '备注'], ['甲', '含,逗号'], ['乙', '含"引号"']]
    expect(rowsToCsv(rows)).toBe('\ufeff名称,备注\r\n甲,"含,逗号"\r\n乙,"含""引号"""\r\n')

    const back = await spreadsheetRowsFromBytes(await rowsToXlsxBytes(rows, '表格:1/2'), '表格.xlsx')
    expect(back.rows).toEqual(rows)
    expect((await rowsToXlsx(rows)).type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  })

  // Numbers leave as numbers, so Excel can add them up; text that would
  // change as a number (a code, a trailing zero) stays text.
  it('writes plain numbers as numbers and keeps the rest as typed', async () => {
    const XLSX = await import('xlsx')
    const rows = [['区域', '销量', '编号', '比例', '金额'], ['华东', '120', '007', '0.10', '-3.5'], ['华南', '1e5', '1,234', '12345678901234567890', '0']]
    const sheet = XLSX.read(await rowsToXlsxBytes(rows)).Sheets.Sheet1!
    const kinds = (row: number) => ['A', 'B', 'C', 'D', 'E'].map(col => sheet[`${col}${row}`]?.t)
    expect(kinds(2)).toEqual(['s', 'n', 's', 's', 'n'])
    expect(kinds(3)).toEqual(['s', 's', 's', 's', 'n'])
    expect(sheet.B2!.v).toBe(120)
    expect((await spreadsheetRowsFromBytes(await rowsToXlsxBytes(rows), 'x.xlsx')).rows).toEqual(rows)
  })
})

// 图片编辑: an image layer turns, mirrors and takes adjustments as CSS on the
// layer; the export draws them although html2canvas reads neither.
describe('board image editing', () => {
  const newImage = () => {
    const image = document.createElement('img')
    image.setAttribute('src', 'data:image/png;base64,iVBORw0KGgo=')
    document.body.appendChild(image)
    return image
  }

  afterEach(() => {
    document.body.innerHTML = ''
    vi.mocked(html2canvas).mockReset()
  })

  it('turns and mirrors a layer by quarters, and back to no edit at all', () => {
    const image = newImage()
    rotateLayer(image, 1)
    expect(image.style.rotate).toBe('90deg')
    rotateLayer(image, -1)
    rotateLayer(image, -1)
    expect(image.style.rotate).toBe('270deg')
    rotateLayer(image, 1)
    expect(image.getAttribute('style') ?? '').not.toContain('rotate')

    flipLayer(image, 'x')
    expect(image.style.scale).toBe('-1 1')
    flipLayer(image, 'y')
    flipLayer(image, 'x')
    expect(image.style.scale).toBe('1 -1')
    expect(hasImageEdits(image)).toBe(true)
    flipLayer(image, 'y')
    expect(hasImageEdits(image)).toBe(false)
  })

  it('adjusts in percent next to the filters the board already had', () => {
    const image = newImage()
    image.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.2))'

    setImageAdjustment(image, 'grayscale', 100)
    setImageAdjustment(image, 'brightness', 120)
    expect(image.style.filter).toBe('drop-shadow(0 2px 4px rgba(0,0,0,0.2)) brightness(120%) grayscale(100%)')
    expect(readImageAdjustment(image, 'brightness')).toBe(120)
    setImageAdjustment(image, 'saturate', 999)
    expect(readImageAdjustment(image, 'saturate')).toBe(200)

    resetImageEdits(image)
    expect(image.style.filter).toBe('drop-shadow(0 2px 4px rgba(0,0,0,0.2))')
    expect(hasImageEdits(image)).toBe(false)
    // A filter written as a number reads in percent too.
    image.style.filter = 'contrast(1.5)'
    expect(readImageAdjustment(image, 'contrast')).toBe(150)
  })

  it('writes the separate rotate and scale as one transform, in the order CSS applies them', () => {
    expect(individualTransform({ translate: 'none', rotate: '90deg', scale: '-1 1', transform: 'matrix(1, 0, 0, 1, -50, -50)' }))
      .toBe('rotate(90deg) scale(-1, 1) matrix(1, 0, 0, 1, -50, -50)')
    expect(individualTransform({ translate: '4px 5px', rotate: 'none', scale: '2', transform: 'none' })).toBe('translate(4px, 5px) scale(2, 2)')
    expect(individualTransform({ translate: 'none', rotate: 'none', scale: 'none', transform: 'none' })).toBeNull()
    // A 3D turn is left for the browser.
    expect(individualTransform({ translate: 'none', rotate: 'x 45deg', scale: 'none', transform: 'none' })).toBeNull()
  })

  it('exports a turned and mirrored image through transform, and puts the board back after', async () => {
    const image = newImage()
    rotateLayer(image, 1)
    flipLayer(image, 'x')
    let drawn: Record<string, string> = {}
    vi.mocked(html2canvas).mockImplementation(async () => {
      drawn = { transform: image.style.transform, rotate: image.style.rotate, scale: image.style.scale }
      return { toBlob: (done: BlobCallback) => done(new Blob(['png'], { type: 'image/png' })) } as unknown as HTMLCanvasElement
    })

    await renderBoardPng(document, 200, 100)

    expect(drawn).toEqual({ transform: 'rotate(90deg) scale(-1, 1)', rotate: 'none', scale: 'none' })
    expect(image.style.rotate).toBe('90deg')
    expect(image.style.scale).toBe('-1 1')
    expect(image.style.transform).toBe('')
  })

  it('edits the selected image from the properties panel, a slider going into undo once', () => {
    const image = newImage()
    const changed = vi.fn()
    const controller = { doc: document, changed, remove: vi.fn(), activeCell: () => null, table: vi.fn() } as unknown as EditorController
    render(<PropertiesPanel controller={controller} element={image} />)

    const section = screen.getByTestId('image-section')
    fireEvent.click(within(section).getByRole('button', { name: '向右旋转 90°' }))
    expect(image.style.rotate).toBe('90deg')
    expect(changed).toHaveBeenCalledTimes(1)

    const brightness = within(section).getByRole('slider', { name: /亮度/ })
    fireEvent.change(brightness, { target: { value: '150' } })
    fireEvent.change(brightness, { target: { value: '160' } })
    expect(image.style.filter).toBe('brightness(160%)')
    expect(within(section).getByText('160%')).toBeInTheDocument()
    expect(changed).toHaveBeenCalledTimes(1)
    fireEvent.pointerUp(brightness)
    expect(changed).toHaveBeenCalledTimes(2)

    fireEvent.click(within(section).getByRole('button', { name: '还原' }))
    expect(image.getAttribute('style') ?? '').not.toMatch(/rotate|filter/)
    expect(within(section).queryByRole('button', { name: '还原' })).not.toBeInTheDocument()
  })
})
