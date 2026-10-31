import { memo, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { designFileUrl, type DesignBoard } from '@/api/star'
import { StarVideoPlayer } from '@/components/star/StarVideoPlayer'

/** One artboard on the canvas: its label, its content and the selection ring. */
export const BoardNode = memo(function BoardNode({ projectId, board, x, y, zoom, selected, editing, busy, onPointerDown, onDoubleClick, children }: {
  projectId: string
  board: DesignBoard
  x: number
  y: number
  zoom: number
  selected: boolean
  editing: boolean
  busy?: string
  onPointerDown: (event: ReactPointerEvent, board: DesignBoard) => void
  onDoubleClick: (board: DesignBoard) => void
  /** The editor iframe replaces the preview while the board is edited. */
  children?: ReactNode
}) {
  const src = designFileUrl(projectId, board.path, board.updatedAt)
  const labelScale = 1 / zoom
  return (
    <div
      data-board={board.path}
      className="absolute"
      style={{ left: x, top: y, width: board.width, height: board.height, opacity: board.hidden ? 0.25 : 1 }}
      onPointerDown={event => onPointerDown(event, board)}
      onDoubleClick={() => onDoubleClick(board)}
    >
      <div
        className={`absolute left-0 flex origin-bottom-left items-center gap-1.5 whitespace-nowrap text-[12px] ${selected ? 'text-[#4f7cff]' : 'text-[var(--color-text-tertiary)]'}`}
        style={{ bottom: '100%', transform: `scale(${labelScale})`, paddingBottom: 6 }}
      >
        <span className="font-medium">{board.name}</span>
        <span className="opacity-70">{board.width}×{board.height}</span>
        {board.versions > 1 ? <span className="opacity-70">· {board.versions} 个版本</span> : null}
      </div>
      <div className="absolute inset-0 overflow-hidden bg-white shadow-[0_2px_12px_rgba(0,0,0,0.18)]">
        {editing && children ? children : board.kind === 'html' ? (
          <iframe title={board.name} src={src} sandbox="allow-scripts" tabIndex={-1} className="pointer-events-none h-full w-full border-0" style={{ width: board.width, height: board.height }} />
        ) : board.kind === 'video' ? (
          selected ? (
            // The app's player, with its bar kept at screen size whatever the zoom.
            <StarVideoPlayer src={src} label={board.name} loop muted chromeScale={labelScale} className="h-full w-full" videoClassName="h-full w-full" />
          ) : (
            <video src={src} muted loop playsInline className="pointer-events-none h-full w-full object-contain" />
          )
        ) : (
          <img src={src} alt={board.name} draggable={false} className="pointer-events-none h-full w-full object-contain" />
        )}
      </div>
      {selected || editing ? (
        <div className="pointer-events-none absolute inset-0" style={{ boxShadow: `0 0 0 ${2 / zoom}px ${editing ? '#f0a020' : '#4f7cff'}` }} />
      ) : null}
      {busy ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35">
          <span className="flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-white" style={{ transform: `scale(${labelScale})`, fontSize: 13 }}>
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />{busy}
          </span>
        </div>
      ) : null}
    </div>
  )
})
