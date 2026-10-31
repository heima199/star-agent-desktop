import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { Loader2 } from 'lucide-react'
import type { StarLegalDocument } from '@/api/star'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { starLegalDocDateOf } from './starLoginForm'

/**
 * Tags a published document keeps: layout only. Links, images, forms, styles
 * and scripts are dropped (a link keeps its text), so a document can neither
 * leave the app nor load anything.
 */
const LEGAL_ALLOWED_TAGS = [
  'p', 'br', 'div', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small', 'sub', 'sup', 'blockquote', 'pre', 'code', 'hr',
  'table', 'caption', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'figure', 'figcaption',
]
const LEGAL_ALLOWED_ATTR = ['colspan', 'rowspan']

/** The console's markup reduced to layout tags, with no attribute that could style, link or run anything. */
export function sanitizeStarLegalHtml(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: LEGAL_ALLOWED_TAGS, ALLOWED_ATTR: LEGAL_ALLOWED_ATTR })
}

/** loading: the list is still on its way; failed: it could not be read; ready: `doc` is what the console published (null = none). */
export type StarLegalDialogState = 'loading' | 'failed' | 'ready'

type StarLegalDialogProps = {
  /** 用户协议 / 隐私政策: the dialog's title while there is no document. */
  title: string
  doc: StarLegalDocument | null
  state: StarLegalDialogState
  onClose: () => void
}

/** 用户协议 / 隐私政策 read inside the app: sanitized `bodyHtml`, else the plain `body`; 「暂未发布」 when the console has none. */
export function StarLegalDialog({ title, doc, state, onClose }: StarLegalDialogProps) {
  const html = useMemo(() => (doc?.bodyHtml ? sanitizeStarLegalHtml(doc.bodyHtml) : ''), [doc?.bodyHtml])
  const date = doc ? starLegalDocDateOf(doc.updatedAt) : ''
  return (
    <Modal
      open
      onClose={onClose}
      title={doc?.title || title}
      width={680}
      typography="interface"
      footer={<Button size="md" onClick={onClose}>我知道了</Button>}
    >
      <div data-testid="star-legal-dialog">
        {doc ? (
          <>
            {date ? <div className="mb-3 text-[12px] text-[var(--color-text-tertiary)]">{date}</div> : null}
            {html
              ? <div className="star-legal-body" dangerouslySetInnerHTML={{ __html: html }} />
              : <div className="star-legal-body whitespace-pre-wrap">{doc.body}</div>}
          </>
        ) : (
          <div className="flex min-h-[160px] items-center justify-center gap-2 text-[13px] text-[var(--color-text-tertiary)]">
            {state === 'loading' ? <Loader2 size={14} strokeWidth={1.75} className="animate-spin" aria-hidden="true" /> : null}
            {state === 'loading' ? '加载中…' : state === 'failed' ? '暂时无法读取，请检查网络后重试' : '暂未发布'}
          </div>
        )}
      </div>
    </Modal>
  )
}
