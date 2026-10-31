import { lazy, Suspense, useState } from 'react'
import { Share2 } from 'lucide-react'

import { Button } from '@/components/ui/Button'

// Loaded on first use: the dialog brings html2canvas and the PDF and QR encoders with it.
const StarShareDialog = lazy(() => import('./StarShareDialog').then((module) => ({ default: module.StarShareDialog })))

/** 「分享」 in the title bar: shares the conversation on screen. */
export function StarShareButton({ sessionId }: { sessionId: string }) {
  // Pinned when the dialog opens, so a tab switch underneath cannot swap the conversation mid-export.
  const [openFor, setOpenFor] = useState<string | null>(null)
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        title="分享对话"
        data-testid="star-share-button"
        icon={<Share2 size={13} strokeWidth={1.75} aria-hidden="true" />}
        onClick={() => setOpenFor(sessionId)}
      >
        分享
      </Button>
      {openFor ? (
        <Suspense fallback={null}>
          <StarShareDialog open sessionId={openFor} onClose={() => setOpenFor(null)} />
        </Suspense>
      ) : null}
    </>
  )
}
