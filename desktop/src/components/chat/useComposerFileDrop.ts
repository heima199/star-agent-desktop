import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type RefObject } from 'react'
import { getDesktopHost } from '../../lib/desktopHost'
import {
  dataTransferHasFiles,
  dataTransferToComposerAttachments,
  pathsToComposerAttachments,
  type ComposerAttachment,
} from '../../lib/composerAttachments'

type DesktopDropPosition = {
  x: number
  y: number
}

type DesktopDragDropPayload =
  | { type: 'enter'; paths: string[]; position: DesktopDropPosition }
  | { type: 'over'; position: DesktopDropPosition }
  | { type: 'drop'; paths: string[]; position: DesktopDropPosition }
  | { type: 'leave' }
  | { type: 'cancel' }

type DesktopDragDropEvent = {
  payload: DesktopDragDropPayload
}

/**
 * Marks the area a composer accepts drops over when it asks for the `page`
 * zone: the chat column of a session, the new-session page.
 */
export const COMPOSER_DROP_ZONE_ATTRIBUTE = 'data-composer-drop-zone'

type UseComposerFileDropOptions = {
  disabled?: boolean
  panelRef: RefObject<HTMLElement | null>
  /**
   * `panel` takes drops over the composer card only. `page` takes them
   * anywhere in the nearest drop-zone ancestor, so a file can be let go over
   * the transcript; it falls back to the card when there is no such ancestor.
   */
  zone?: 'panel' | 'page'
  onAttachments: (attachments: ComposerAttachment[]) => void
  onError?: (error: unknown) => void
}

type DragLike = { dataTransfer: DataTransfer | null; preventDefault: () => void }

function isPointInsideElement(element: HTMLElement | null, position: DesktopDropPosition): boolean {
  if (!element) return false
  const rect = element.getBoundingClientRect()
  return (
    position.x >= rect.left &&
    position.x <= rect.right &&
    position.y >= rect.top &&
    position.y <= rect.bottom
  )
}

export function useComposerFileDrop({
  disabled = false,
  panelRef,
  zone = 'panel',
  onAttachments,
  onError,
}: UseComposerFileDropOptions) {
  const [isDragActive, setIsDragActive] = useState(false)
  const [zoneElement, setZoneElement] = useState<HTMLElement | null>(null)
  const dragDepthRef = useRef(0)
  const disabledRef = useRef(disabled)
  const zoneElementRef = useRef<HTMLElement | null>(null)
  const onAttachmentsRef = useRef(onAttachments)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    disabledRef.current = disabled
    if (disabled) {
      dragDepthRef.current = 0
      setIsDragActive(false)
    }
  }, [disabled])

  useEffect(() => {
    onAttachmentsRef.current = onAttachments
  }, [onAttachments])

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  useEffect(() => {
    const found = zone === 'page'
      ? panelRef.current?.closest<HTMLElement>(`[${COMPOSER_DROP_ZONE_ATTRIBUTE}]`) ?? null
      : null
    zoneElementRef.current = found
    setZoneElement(found)
  }, [panelRef, zone])

  useEffect(() => {
    const host = getDesktopHost()
    if (!host.isDesktop) return

    let disposed = false
    let unlisten: (() => void) | undefined

    void host.webview
      .onDragDropEvent((event) => {
        if (disposed) return

        const payload = (event as DesktopDragDropEvent).payload
        if (payload.type === 'cancel' || payload.type === 'leave') {
          dragDepthRef.current = 0
          setIsDragActive(false)
          return
        }

        const isInside = isPointInsideElement(zoneElementRef.current ?? panelRef.current, payload.position)
        if (payload.type === 'enter' || payload.type === 'over') {
          setIsDragActive(!disabledRef.current && isInside)
          return
        }

        dragDepthRef.current = 0
        setIsDragActive(false)
        if (disabledRef.current || !isInside) return

        const attachments = pathsToComposerAttachments(payload.paths)
        if (attachments.length > 0) onAttachmentsRef.current(attachments)
      })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten()
          return
        }
        unlisten = nextUnlisten
      })
      .catch((error) => {
        onErrorRef.current?.(error)
      })

    return () => {
      disposed = true
      unlisten?.()
    }
  }, [panelRef])

  const handleEnter = useCallback((event: DragLike) => {
    if (disabledRef.current || !event.dataTransfer || !dataTransferHasFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    dragDepthRef.current += 1
    setIsDragActive(true)
  }, [])

  const handleOver = useCallback((event: DragLike) => {
    if (disabledRef.current || !event.dataTransfer || !dataTransferHasFiles(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsDragActive(true)
  }, [])

  const handleLeave = useCallback((event: DragLike) => {
    if (disabledRef.current || !event.dataTransfer || !dataTransferHasFiles(event.dataTransfer)) return
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragActive(false)
  }, [])

  const handleDrop = useCallback((event: DragLike) => {
    if (disabledRef.current || !event.dataTransfer || !dataTransferHasFiles(event.dataTransfer)) return
    event.preventDefault()
    dragDepthRef.current = 0
    setIsDragActive(false)

    void dataTransferToComposerAttachments(event.dataTransfer)
      .then((attachments) => {
        if (attachments.length > 0) onAttachmentsRef.current(attachments)
      })
      .catch((error) => {
        onErrorRef.current?.(error)
      })
  }, [])

  // The page zone listens natively on the zone element. The card's own
  // handlers stand down then, or a drop over the card would land twice.
  useEffect(() => {
    if (!zoneElement) return
    const enter = (event: globalThis.DragEvent) => handleEnter(event)
    const over = (event: globalThis.DragEvent) => handleOver(event)
    const leave = (event: globalThis.DragEvent) => handleLeave(event)
    const drop = (event: globalThis.DragEvent) => handleDrop(event)
    zoneElement.addEventListener('dragenter', enter)
    zoneElement.addEventListener('dragover', over)
    zoneElement.addEventListener('dragleave', leave)
    zoneElement.addEventListener('drop', drop)
    return () => {
      zoneElement.removeEventListener('dragenter', enter)
      zoneElement.removeEventListener('dragover', over)
      zoneElement.removeEventListener('dragleave', leave)
      zoneElement.removeEventListener('drop', drop)
    }
  }, [handleDrop, handleEnter, handleLeave, handleOver, zoneElement])

  const dragHandlers = useMemo(() => (zoneElement ? {} : {
    onDragEnter: (event: DragEvent) => handleEnter(event),
    onDragOver: (event: DragEvent) => handleOver(event),
    onDragLeave: (event: DragEvent) => handleLeave(event),
    onDrop: (event: DragEvent) => handleDrop(event),
  }), [handleDrop, handleEnter, handleLeave, handleOver, zoneElement])

  return {
    isDragActive,
    dragHandlers,
    /** Where the overlay belongs: the page zone, or null for the card itself. */
    zoneElement,
  }
}
