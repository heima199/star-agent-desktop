import { getStarBrandName } from '../../stores/starBrandStore'
import { useStarCreateStore } from '../../stores/starCreateStore'
import { useStarStore } from '../../stores/starStore'
import { useUIStore } from '../../stores/uiStore'
import {
  buildStarCreateBlock,
  collectStarCreateRefs,
  resolveStarCreateMode,
  starCreateSpec,
  withStarCreateRequest,
  type StarCreateAttachment,
} from '../../lib/starCreateRequest'

export type StarCreateSend =
  /** Nothing armed: send as usual. */
  | { armed: false }
  | { armed: true; ok: true; wrap: (content: string) => string }
  | { armed: true; ok: false }

/**
 * Prepare an outgoing message for the armed creation mode of a composer.
 * Problems the user has to fix (missing reference image, not signed in) are
 * shown as a toast and stop the send; the draft stays as it is.
 */
export function prepareStarCreateSend(slot: string, attachments: readonly StarCreateAttachment[], hasText: boolean): StarCreateSend {
  const armed = useStarCreateStore.getState().slots[slot]
  if (!armed) return { armed: false }
  const toast = useUIStore.getState().addToast
  if (!useStarStore.getState().status?.signedIn) {
    toast({ type: 'info', message: `请先登录 ${getStarBrandName()} 账号再生成（左下角头像 → 登录）` })
    useStarStore.getState().openLogin()
    return { armed: true, ok: false }
  }
  const refs = collectStarCreateRefs(attachments)
  const resolved = resolveStarCreateMode(armed.mode, refs)
  if (!resolved.ok) {
    toast({ type: 'info', message: resolved.message })
    return { armed: true, ok: false }
  }
  if (!hasText && starCreateSpec(resolved.mode).kind !== 'vision') {
    toast({ type: 'info', message: `写一句${starCreateSpec(resolved.mode).kind === 'video' ? '视频' : '画面'}描述再发送` })
    return { armed: true, ok: false }
  }
  if (resolved.notice) toast({ type: 'info', message: `${getStarBrandName()} 创作：${resolved.notice}` })
  const block = buildStarCreateBlock(resolved.mode, armed.params, refs)
  return { armed: true, ok: true, wrap: (content: string) => withStarCreateRequest(content, block) }
}

/** The composer placeholder for the armed mode, if any. */
export function useStarCreatePlaceholder(slot: string): string | null {
  const armed = useStarCreateStore(s => s.slots[slot])
  return armed ? starCreateSpec(armed.mode).placeholder : null
}
