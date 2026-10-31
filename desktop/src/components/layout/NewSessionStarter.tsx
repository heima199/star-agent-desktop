import { CircleX, Eye, Hammer, SearchCode, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTranslation, type TranslationKey } from '../../i18n'
import { useStarStore } from '../../stores/starStore'
import { StarStarter } from '../star/StarStarter'

/** Explicit keys, so a literal-only i18n scan sees every one of them. */
const SUGGESTIONS: ReadonlyArray<{ id: string; icon: LucideIcon; key: TranslationKey }> = [
  { id: 'explain-repo', icon: SearchCode, key: 'empty.suggestion.explainRepo' },
  { id: 'fix-tests', icon: CircleX, key: 'empty.suggestion.fixTests' },
  { id: 'review-changes', icon: Eye, key: 'empty.suggestion.reviewChanges' },
  { id: 'new-feature', icon: Hammer, key: 'empty.suggestion.newFeature' },
]

export type NewSessionStarterProps = {
  /** Puts a suggestion's text into the composer; the caller owns the draft. */
  onSuggestion: (text: string) => void
  /** Composer slot where STAR 创作 prompts arm their mode. */
  createSlot?: string
}

/**
 * What sits under the composer on a blank session: a row of starter prompts.
 * Earlier threads are the sidebar's job; the home page lists none of them.
 */
export function NewSessionStarter({ onSuggestion, createSlot }: NewSessionStarterProps) {
  const t = useTranslation()
  const starMode = useStarStore((s) => s.mode)

  return (
    <div data-testid="new-session-starter" className="flex w-full flex-col items-center">
      {starMode !== 'code' ? (
        <StarStarter mode={starMode} slot={createSlot} onSuggestion={onSuggestion} />
      ) : (
        <div
          role="group"
          aria-label={t('empty.suggestions')}
          className="flex flex-wrap justify-center gap-2"
        >
          {SUGGESTIONS.map(({ id, icon: Icon, key }) => (
            <Button
              key={id}
              variant="secondary"
              size="base"
              icon={<Icon size={14} strokeWidth={1.75} className="text-[var(--color-text-tertiary)]" aria-hidden="true" />}
              onClick={() => onSuggestion(t(key))}
            >
              {t(key)}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
