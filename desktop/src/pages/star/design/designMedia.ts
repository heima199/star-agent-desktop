import { designFileUrl, starApi, type DesignBoard, type DesignProject, type StarMediaTask } from '@/api/star'
import { getStarBrandName } from '@/stores/starBrandStore'
import { BoardTooLargeForImageError, fitsOneImage, pictureToPdf, renderBoardPdf, renderBoardPng, withBoardDocument } from './designEditor'

/** PNG (or the original bitmap) of a board. */
export async function boardImageBlob(project: DesignProject, board: DesignBoard): Promise<Blob> {
  if (board.kind === 'image') return (await fetch(designFileUrl(project.id, board.path, board.updatedAt))).blob()
  if (board.kind === 'html') {
    const html = await starApi.designFileText(project.id, board.path)
    return withBoardDocument(project.id, html, board.width, board.height, doc => renderBoardPng(doc, board.width, board.height))
  }
  if (board.kind === 'svg') {
    if (!fitsOneImage(board.width, board.height)) throw new BoardTooLargeForImageError(board.width, board.height)
    const svg = await starApi.designFileText(project.id, board.path)
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = board.width
      canvas.height = board.height
      canvas.getContext('2d')!.drawImage(image, 0, 0, board.width, board.height)
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new BoardTooLargeForImageError(board.width, board.height))), 'image/png'))
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  throw new Error('视频画板不能作为参考图')
}

/** A board as a PDF, a page per strip, for boards too tall for one picture. */
export async function boardPdfBlob(project: DesignProject, board: DesignBoard, onProgress?: (page: number, total: number) => void): Promise<Blob> {
  if (board.kind === 'html') {
    const html = await starApi.designFileText(project.id, board.path)
    return withBoardDocument(project.id, html, board.width, board.height, doc => renderBoardPdf(doc, board.width, board.height, onProgress))
  }
  if (board.kind === 'svg' || board.kind === 'image') {
    const source = board.kind === 'svg'
      ? new Blob([await starApi.designFileText(project.id, board.path)], { type: 'image/svg+xml' })
      : await (await fetch(designFileUrl(project.id, board.path, board.updatedAt))).blob()
    const url = URL.createObjectURL(source)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      return await pictureToPdf(image, board.width, board.height, onProgress)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  throw new Error('视频画板不能导出为 PDF')
}

export async function uploadBoardReference(project: DesignProject, board: DesignBoard): Promise<string> {
  const blob = await boardImageBlob(project, board)
  return starApi.uploadReference(blob, 'image', `${board.name || 'board'}.png`)
}

async function waitForTask(task: StarMediaTask, onProgress?: (task: StarMediaTask) => void): Promise<StarMediaTask> {
  const deadline = Date.now() + 15 * 60_000
  let current = task
  while (current.status !== 'succeeded' && current.status !== 'failed') {
    if (Date.now() > deadline) throw new Error(`生成超时，可在「${getStarBrandName()} 创作」任务中心查看`)
    await new Promise(resolve => setTimeout(resolve, 3000))
    current = (await starApi.task(current.id)).task
    onProgress?.(current)
  }
  if (current.status === 'failed') throw new Error(current.error || current.message || '生成失败')
  return current
}

export type BoardOperation = 'image2image' | 'cutout' | 'image2video'

const CUTOUT_PROMPT = '抠出画面主体：完整保留主体的轮廓、细节和颜色，移除全部背景，背景改为纯白色，不添加任何新元素。'

/** Runs a STAR media job from a board and adds every output as a new board to its right. */
export async function runBoardOperation(project: DesignProject, board: DesignBoard, operation: BoardOperation, prompt: string, onProgress?: (text: string) => void): Promise<DesignProject> {
  onProgress?.('上传参考图…')
  const reference = await uploadBoardReference(project, board)
  onProgress?.('提交生成任务…')
  const started = operation === 'image2video'
    ? (await starApi.generateVideo({ prompt: prompt || '让画面自然地动起来，镜头缓慢推进', firstFrame: reference, duration: 5 })).task
    : (await starApi.generateImage({ prompt: operation === 'cutout' ? CUTOUT_PROMPT : prompt, references: [reference], count: 1 })).task
  const done = await waitForTask(started, task => onProgress?.(`${task.message || '生成中'} ${task.progress ? `${task.progress}%` : ''}`.trim()))
  let latest = project
  let offset = 0
  for (const output of done.outputs) {
    const label = operation === 'image2video' ? `${board.name}-视频` : operation === 'cutout' ? `${board.name}-抠图` : `${board.name}-改图`
    latest = (await starApi.addDesignMediaBoard(project.id, {
      ...(output.file ? { file: output.file } : { url: output.url }),
      name: label,
      x: board.x + board.width + 120 + offset,
      y: board.y,
    })).project
    offset += board.width + 120
  }
  return latest
}
