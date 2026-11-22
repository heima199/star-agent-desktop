import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'

const apis = vi.hoisted(() => ({
  deleteTask: vi.fn(),
  outputBlob: vi.fn(),
}))

vi.mock('@/api/star', () => ({
  starApi: apis,
  starErrorText: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}))

import type { StarMediaTask } from '@/api/star'
import { useStarStore } from '@/stores/starStore'
import { useUIStore } from '@/stores/uiStore'
import { StarTaskCard } from './starMedia'

const DONE: StarMediaTask = {
  id: 'task-cat',
  kind: 'image',
  mode: 'text2image',
  model: 'image-model',
  prompt: '窗台上看雨的橘猫',
  params: {},
  references: { images: [], videos: [] },
  status: 'succeeded',
  progress: 100,
  message: '',
  outputs: [{ kind: 'image', url: 'https://files.example/cat.webp', file: '/outputs/cat.webp', name: 'cat.webp' }],
  source: 'desktop',
  createdAt: 1,
  updatedAt: 2,
}

/** A job whose result could not be saved to disk: only the remote link is left. */
const NOT_SAVED: StarMediaTask = { ...DONE, id: 'task-remote', outputs: [{ kind: 'image', url: 'https://files.example/cat.webp', name: 'cat.webp' }] }

const FAILED: StarMediaTask = { ...DONE, id: 'task-failed', status: 'failed', outputs: [], error: '生成失败' }

const toasts = () => useUIStore.getState().toasts.map(toast => `${toast.type}: ${toast.message}`)
const kept = () => useStarStore.getState().tasks.map(task => task.id)

function deleteRecordOf(task: StarMediaTask) {
  useStarStore.setState({ tasks: [task] })
  render(<StarTaskCard task={task} />)
  fireEvent.click(screen.getByRole('button', { name: '删除记录' }))
}

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState({ toasts: [] })
  useStarStore.setState({ tasks: [] })
  apis.deleteTask.mockResolvedValue({ ok: true })
  apis.outputBlob.mockReturnValue(new Promise(() => {}))
})

describe('StarTaskCard: 删除记录', () => {
  it('removes the record only, and says that the produced file is still on disk', async () => {
    deleteRecordOf(DONE)

    await waitFor(() => expect(kept()).toEqual([]))
    // `false`: the files are not removed with the record.
    expect(apis.deleteTask).toHaveBeenCalledWith('task-cat', false)
    expect(toasts()).toEqual(['success: 记录已删除，生成的文件仍保留在输出文件夹里'])
  })

  it.each([
    ['a result that was never saved to disk', NOT_SAVED],
    ['a failed job', FAILED],
  ])('does not promise a file for %s', async (_case, task) => {
    deleteRecordOf(task)

    await waitFor(() => expect(kept()).toEqual([]))
    expect(toasts()).toEqual(['success: 记录已删除'])
  })

  it('keeps the record and shows the reason when the local service refuses', async () => {
    apis.deleteTask.mockRejectedValue(new Error('任务仍在进行，完成后再删除'))
    deleteRecordOf(DONE)

    await waitFor(() => expect(toasts()).toEqual(['error: 任务仍在进行，完成后再删除']))
    expect(kept()).toEqual(['task-cat'])
  })
})
