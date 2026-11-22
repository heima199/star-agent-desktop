import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const apis = vi.hoisted(() => ({
  knowledgeBases: vi.fn(),
  knowledgeBase: vi.fn(),
  createKnowledgeBase: vi.fn(),
  updateKnowledgeBase: vi.fn(),
  deleteKnowledgeBase: vi.fn(),
}))

vi.mock('@/api/star', () => ({
  starApi: apis,
  starErrorText: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}))

import type { KnowledgeBase, KnowledgeBaseSummary } from '@/api/star'
import { useUIStore } from '@/stores/uiStore'
import { clearPageCache } from '../starPageCache'
import { KnowledgePage } from './CommunityPages'

const BASE: KnowledgeBase = {
  id: 'kb-handbook',
  name: '产品手册',
  description: '售前常见问题',
  dir: '/knowledge/kb-handbook',
  createdAt: 1,
  updatedAt: 2,
  docs: [{ id: 'doc-1', name: 'faq.md', file: 'files/doc-1-faq.md', textFile: 'text/doc-1-faq.md', size: 163, chars: 102, via: 'local', addedAt: 3 }],
}

function summaryOf(base: KnowledgeBase): KnowledgeBaseSummary {
  const { docs, ...rest } = base
  return { ...rest, docCount: docs.length, chars: docs.reduce((sum, doc) => sum + doc.chars, 0) }
}

const NAME_FIELD = '名称，例如：产品手册'
const PURPOSE_FIELD = '用途说明（可选）'
const NO_BASES = '还没有知识库'

const toasts = () => useUIStore.getState().toasts.map(toast => `${toast.type}: ${toast.message}`)

async function openBase() {
  render(<KnowledgePage />)
  fireEvent.click(await screen.findByRole('button', { name: /产品手册/ }))
  await screen.findByText('faq.md')
}

beforeEach(() => {
  vi.clearAllMocks()
  clearPageCache()
  useUIStore.setState({ toasts: [] })
  apis.knowledgeBases.mockResolvedValue({ root: '/knowledge', bases: [summaryOf(BASE)] })
  apis.knowledgeBase.mockResolvedValue({ base: BASE })
})

describe('KnowledgePage', () => {
  it('creates a knowledge base from the name typed into the focused field, and opens it', async () => {
    const created: KnowledgeBase = { ...BASE, id: 'kb-rules', name: '制度文件', description: '', docs: [] }
    apis.knowledgeBases.mockResolvedValue({ root: '/knowledge', bases: [] })
    apis.createKnowledgeBase.mockResolvedValue({ base: created })
    apis.knowledgeBase.mockResolvedValue({ base: created })
    render(<KnowledgePage />)
    await screen.findByText(NO_BASES)

    fireEvent.click(screen.getByRole('button', { name: '新建知识库' }))
    const dialog = screen.getByRole('dialog', { name: '新建知识库' })
    const name = within(dialog).getByPlaceholderText(NAME_FIELD)
    // Typing has to work straight away, without a click on the field first.
    expect(document.activeElement).toBe(name)
    expect(within(dialog).getByRole('button', { name: '创建' })).toBeDisabled()

    fireEvent.change(name, { target: { value: ' 制度文件 ' } })
    fireEvent.keyDown(name, { key: 'Enter' })

    await waitFor(() => expect(apis.createKnowledgeBase).toHaveBeenCalledWith({ name: '制度文件', description: '' }))
    expect(await screen.findByText(/还没有文档/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(apis.knowledgeBase).toHaveBeenCalledWith('kb-rules')
  })

  it('renames a knowledge base from its page', async () => {
    apis.updateKnowledgeBase.mockResolvedValue({ base: { ...BASE, name: '售前手册', description: '' } })
    await openBase()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const dialog = screen.getByRole('dialog', { name: '编辑知识库' })
    const name = within(dialog).getByPlaceholderText(NAME_FIELD)
    const purpose = within(dialog).getByPlaceholderText(PURPOSE_FIELD)
    expect(name).toHaveValue('产品手册')
    expect(purpose).toHaveValue('售前常见问题')

    fireEvent.change(name, { target: { value: '   ' } })
    expect(within(dialog).getByRole('button', { name: '保存' })).toBeDisabled()

    fireEvent.change(name, { target: { value: ' 售前手册 ' } })
    fireEvent.change(purpose, { target: { value: '' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(apis.updateKnowledgeBase).toHaveBeenCalledWith('kb-handbook', { name: '售前手册', description: '' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('售前手册')).toBeInTheDocument()
    expect(screen.queryByText('产品手册')).not.toBeInTheDocument()
  })

  it('keeps the edit form open, with what was typed, when saving fails', async () => {
    apis.updateKnowledgeBase.mockRejectedValue(new Error('disk is full'))
    await openBase()

    fireEvent.click(screen.getByRole('button', { name: '编辑' }))
    const dialog = screen.getByRole('dialog', { name: '编辑知识库' })
    fireEvent.change(within(dialog).getByPlaceholderText(NAME_FIELD), { target: { value: '售前手册' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(toasts()).toEqual(['error: disk is full']))
    expect(within(dialog).getByPlaceholderText(NAME_FIELD)).toHaveValue('售前手册')
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '保存' })).toBeEnabled())
  })

  it('deletes a knowledge base only once that is confirmed, then returns to the list', async () => {
    apis.deleteKnowledgeBase.mockResolvedValue({ ok: true })
    await openBase()

    fireEvent.click(screen.getByRole('button', { name: '删除知识库' }))
    const dialog = screen.getByRole('dialog', { name: '删除知识库' })
    expect(dialog).toHaveTextContent('产品手册')
    expect(dialog).toHaveTextContent('1 篇文档')
    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(apis.deleteKnowledgeBase).not.toHaveBeenCalled()
    expect(screen.getByText('faq.md')).toBeInTheDocument()

    apis.knowledgeBases.mockResolvedValue({ root: '/knowledge', bases: [] })
    fireEvent.click(screen.getByRole('button', { name: '删除知识库' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: '删除知识库' })).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(apis.deleteKnowledgeBase).toHaveBeenCalledWith('kb-handbook'))
    expect(await screen.findByText(NO_BASES)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('stays on the knowledge base when deleting it fails', async () => {
    apis.deleteKnowledgeBase.mockRejectedValue(new Error('folder is in use'))
    await openBase()

    fireEvent.click(screen.getByRole('button', { name: '删除知识库' }))
    const dialog = screen.getByRole('dialog', { name: '删除知识库' })
    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() => expect(toasts()).toEqual(['error: folder is in use']))
    expect(screen.getByText('faq.md')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByRole('button', { name: '删除' })).toBeEnabled())
  })

  it('shows the size of a document smaller than a kilobyte instead of 0 KB', async () => {
    await openBase()

    expect(screen.getByText(/^163 B · 102 字/)).toBeInTheDocument()
    expect(screen.queryByText(/0 KB/)).not.toBeInTheDocument()
  })
})
