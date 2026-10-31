import { starApi, starErrorText, type DesignProject } from '@/api/star'
import { openStarPage } from '../../../components/star/starPages'
import { useStarStore } from '../../../stores/starStore'
import { useUIStore } from '../../../stores/uiStore'

/**
 * Whether a message can go to the design agent now. Its models come with the
 * STAR account: signed out, this opens the sign-in and says no, and the
 * message waits where it was typed. A status not loaded yet (right after
 * start) is asked for first; one the local server cannot give passes, and the
 * chat says what went wrong.
 */
export async function canMessageDesignAgent(): Promise<boolean> {
  const store = useStarStore.getState()
  const status = store.status ?? await store.refreshStatus()
  if (!status || status.signedIn) return true
  useStarStore.getState().openLogin()
  return false
}

export type DesignKind = {
  id: string
  label: string
  width: number
  height: number
  art: 'free' | 'poster' | 'social' | 'info' | 'deck' | 'long' | 'set' | 'vector' | 'web'
  hint: string
}

/** The artboard presets of STAR Design; `id` is stored as the project kind. */
export const DESIGN_KINDS: DesignKind[] = [
  { id: 'custom', label: '自由创作', width: 1440, height: 1024, art: 'free', hint: '任意尺寸，自由排版' },
  { id: 'poster', label: '海报', width: 1080, height: 1440, art: 'poster', hint: '3:4 竖版海报' },
  { id: 'social', label: '社交媒体', width: 1080, height: 1350, art: 'social', hint: '小红书 / 朋友圈 4:5' },
  { id: 'card', label: '信息图', width: 1080, height: 1920, art: 'info', hint: '数据与知识卡片' },
  { id: 'ppt', label: '演示文稿', width: 1920, height: 1080, art: 'deck', hint: '16:9，每页一个画板' },
  { id: 'long-poster', label: '长图海报', width: 1080, height: 4000, art: 'long', hint: '高度随内容增长' },
  { id: 'set', label: '套图', width: 1080, height: 1440, art: 'set', hint: '同一风格的多张图' },
  { id: 'vector', label: '矢量图', width: 1024, height: 1024, art: 'vector', hint: 'SVG 图标、插画、Logo' },
  { id: 'web', label: '网页', width: 1440, height: 2400, art: 'web', hint: '落地页 / 活动页' },
]

export function designKind(id: string): DesignKind {
  return DESIGN_KINDS.find(kind => kind.id === id) ?? DESIGN_KINDS[0]!
}

/** Line illustrations of the artboard types (no bitmaps), drawn in the text color the chip sets. */
export function KindArt({ art, active = false }: { art: DesignKind['art']; active?: boolean }) {
  const stroke = 'currentColor'
  const fill = active ? 'color-mix(in srgb, currentColor 16%, transparent)' : 'rgba(127,127,127,0.12)'
  const common = { fill: 'none', stroke, strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 72 44" className="h-full w-full" aria-hidden="true">
      {art === 'free' ? (<>
        <rect x="8" y="6" width="40" height="32" rx="3" {...common} fill={fill} />
        <path d="M28 16 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" fill={stroke} stroke="none" />
        <path d="M54 12h10M54 18h8M56 30 l4 6 1-3 3-1z" {...common} />
      </>) : null}
      {art === 'poster' ? (<>
        <rect x="22" y="4" width="28" height="36" rx="2.5" {...common} fill={fill} />
        <rect x="26" y="9" width="20" height="14" rx="1.5" {...common} /><path d="M27 21 l6-6 4 4 3-3 5 5" {...common} />
        <path d="M26 28h16M26 32h11" {...common} />
      </>) : null}
      {art === 'social' ? (<>
        <rect x="24" y="3" width="24" height="38" rx="4" {...common} fill={fill} />
        <circle cx="30" cy="10" r="2" {...common} /><path d="M34 10h9" {...common} />
        <rect x="27" y="15" width="18" height="14" rx="2" {...common} /><circle cx="36" cy="22" r="3" {...common} />
        <path d="M28 34h12" {...common} />
      </>) : null}
      {art === 'info' ? (<>
        <rect x="10" y="5" width="52" height="34" rx="3" {...common} fill={fill} />
        {[18, 28, 38, 48].map(cx => <circle key={cx} cx={cx} cy="13" r="3" {...common} />)}
        {[17, 25, 33, 41, 49].map((x, i) => <path key={x} d={`M${x} 34v-${[8, 13, 6, 11, 4][i]}`} {...common} strokeWidth={3} />)}
      </>) : null}
      {art === 'deck' ? (<>
        <rect x="8" y="7" width="56" height="30" rx="3" {...common} fill={fill} />
        <rect x="13" y="12" width="20" height="14" rx="2" {...common} /><path d="M21 16 l5 3 -5 3z" fill={stroke} stroke="none" />
        <path d="M38 14h20M38 19h14" {...common} /><rect x="38" y="23" width="20" height="9" rx="1.5" {...common} />
      </>) : null}
      {art === 'long' ? (<>
        <rect x="28" y="2" width="16" height="40" rx="2" {...common} fill={fill} />
        <path d="M31 7h10M31 12h8M31 18h10M31 23h6M31 29h10M31 34h8" {...common} />
      </>) : null}
      {art === 'set' ? (<>
        <rect x="14" y="10" width="20" height="26" rx="2" {...common} fill={fill} />
        <rect x="26" y="7" width="20" height="26" rx="2" {...common} fill={fill} />
        <rect x="38" y="4" width="20" height="26" rx="2" {...common} fill={fill} />
        <path d="M42 12h12M42 16h8" {...common} />
      </>) : null}
      {art === 'vector' ? (<>
        <path d="M18 34 C 22 10, 50 10, 54 34" {...common} />
        <rect x="15" y="31" width="6" height="6" {...common} fill={fill} /><rect x="51" y="31" width="6" height="6" {...common} fill={fill} />
        <circle cx="36" cy="16" r="3" fill={stroke} stroke="none" /><path d="M36 16 L22 8 M36 16 L50 8" {...common} strokeDasharray="2 2" />
      </>) : null}
      {art === 'web' ? (<>
        <rect x="10" y="5" width="52" height="34" rx="3" {...common} fill={fill} />
        <path d="M10 11h52" {...common} /><circle cx="14" cy="8" r="0.8" fill={stroke} /><circle cx="17" cy="8" r="0.8" fill={stroke} />
        <path d="M18 18h22M18 23h14" {...common} /><rect x="44" y="16" width="12" height="10" rx="1.5" {...common} />
        <rect x="18" y="29" width="10" height="5" rx="1" {...common} />
      </>) : null}
    </svg>
  )
}

/** Creates a project and opens it in the Design workspace; `prompt` becomes the first message. */
export async function startDesignProject(input: {
  title?: string
  kind: string
  width?: number
  height?: number
  style?: string
  templateId?: string
  systemId?: string
  skillId?: string
  prompt?: string
}): Promise<DesignProject | null> {
  // A description is the agent's first message; it waits for the sign-in
  // instead of opening a project whose first reply is "Not logged in".
  if (input.prompt && !(await canMessageDesignAgent())) return null
  const kind = designKind(input.kind)
  const title = (input.title || input.prompt || kind.label).replace(/\s+/g, ' ').trim().slice(0, 40) || kind.label
  try {
    const { project } = await starApi.createDesignProject({
      title,
      kind: kind.id,
      width: input.width ?? kind.width,
      height: input.height ?? kind.height,
      ...(input.style ? { style: input.style } : {}),
      ...(input.templateId ? { templateId: input.templateId } : {}),
      ...(input.systemId ? { systemId: input.systemId } : {}),
      ...(input.skillId ? { skillId: input.skillId } : {}),
    })
    openStarPage('design', { project: project.id, ...(input.prompt ? { prompt: input.prompt } : {}) })
    return project
  } catch (error) {
    useUIStore.getState().addToast({ type: 'error', message: starErrorText(error) })
    return null
  }
}
