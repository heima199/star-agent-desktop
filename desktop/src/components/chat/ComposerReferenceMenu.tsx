import { sessionCollaborationApi, type SessionCandidate } from '@/api/sessionCollaboration'
import { SessionReferenceDetails } from '@/components/chat/SessionReferenceDetails'
import { useTabStore } from '@/stores/tabStore'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, File, FileText, Folder, MessagesSquare, ScrollText, type LucideIcon } from 'lucide-react'
import { ComposerSuggestionRow } from '@/components/chat/ComposerSuggestionRow'
import { rankComposerSuggestions } from '@/components/chat/composerSuggestionSearch'
import { ApiError } from '@/api/client'
import { filesystemApi } from '@/api/filesystem'
import { useTranslation, type TranslationKey } from '@/i18n'
import { useRoomAbove } from '@/hooks/useRoomAbove'
import { safeMentionIcon, type NewComposerMention } from '@/lib/composerMentions'
import { publicAssetPath } from '@/lib/publicAsset'
import type { ComposerReferenceCandidate } from '@/types/composerReference'
import { referenceFallbackIcon, skillSourceLabelKey } from './referencePresentation'
import { COMPOSER_KBD, COMPOSER_MENU_SECTION } from './composerMenuStyles'

type FileEntry = { name: string, path: string, isDirectory: boolean, relativePath?: string }
type Category = 'files' | 'folders' | 'docs' | 'rules' | 'sessions'
type Row = { key: string, label: string, description: string, searchTerms?: string[], contentMatch?: boolean, session?: SessionCandidate, shortId?: string, source?: string, mention?: NewComposerMention, file?: FileEntry, icon?: ReactNode, category?: Category, onSelect?: () => void }
export type ComposerReferenceMenuHandle = { handleKeyDown(event: KeyboardEvent): void }
type Props = {
  id: string
  cwd: string
  filter?: string
  compact?: boolean
  embedded?: boolean
  browseReferences?: boolean
  actions?: Array<{ key: string, label: string, description?: string, icon?: ReactNode, onSelect: () => void }>
  references: ComposerReferenceCandidate[]
  referencesLoading?: boolean
  referencesError?: string | boolean | null
  onSelect(mention: NewComposerMention): void
  onNavigate?(relativePath: string): void
  onActiveChange?(optionId: string | undefined): void
}

/**
 * The kinds of reference the @ menu can be browsed by, in the order its root
 * lists them. Typing inside one searches only that kind.
 */
const CATEGORIES: ReadonlyArray<{ kind: Category, label: TranslationKey, description: TranslationKey, icon: LucideIcon }> = [
  { kind: 'files', label: 'chat.referenceCategoryFiles', description: 'chat.referenceCategoryFilesHint', icon: File },
  { kind: 'folders', label: 'chat.referenceCategoryFolders', description: 'chat.referenceCategoryFoldersHint', icon: Folder },
  { kind: 'docs', label: 'chat.referenceCategoryDocs', description: 'chat.referenceCategoryDocsHint', icon: FileText },
  { kind: 'rules', label: 'chat.referenceCategoryRules', description: 'chat.referenceCategoryRulesHint', icon: ScrollText },
  { kind: 'sessions', label: 'chat.referenceCategorySessions', description: 'chat.referenceCategorySessionsHint', icon: MessagesSquare },
]

/** Rows a category lists at most; past that, typing narrows it. */
const CATEGORY_LIMIT = 50

const DOCUMENT_EXTENSIONS = new Set(['md', 'markdown', 'mdx', 'txt', 'rst', 'pdf', 'doc', 'docx', 'odt', 'rtf', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'key', 'pages', 'numbers'])
/**
 * What 文档 searches for before anything is typed. The search needs a query,
 * and every document has a dot in its name; the shallowest matches come first.
 */
const DOCUMENT_QUERY = '.'

function isDocumentPath(path: string): boolean {
  const name = path.replace(/\\/g, '/').split('/').at(-1) ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 && DOCUMENT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

/** Files that tell the agent how to work: CLAUDE.md and the like, and rules folders. */
const RULE_FILE_NAMES = new Set(['claude.md', 'claude.local.md', 'agents.md', '.cursorrules', '.windsurfrules'])
/**
 * Searches that together find every rule file. They run one after another: the
 * server cancels a folder's running search when the next one starts.
 */
const RULE_QUERIES = ['claude.md', 'agents.md', 'rules']

function isRuleFilePath(path: string): boolean {
  const posix = path.replace(/\\/g, '/').toLowerCase()
  return RULE_FILE_NAMES.has(posix.slice(posix.lastIndexOf('/') + 1)) || /(?:^|\/)\.(?:claude|trae|cursor)\/rules\/[^/]/.test(posix)
}

export function getComposerReferenceOptionId(id: string, index: number): string { return `${id}-option-${index}` }

export const ComposerReferenceMenu = forwardRef<ComposerReferenceMenuHandle, Props>(function ComposerReferenceMenu({
  id, cwd, filter = '', compact = false, embedded = false, browseReferences = false, actions = [], references, referencesLoading = false, referencesError,
  onSelect, onNavigate, onActiveChange,
}, ref) {
  const t = useTranslation()
  const activeSessionId = useTabStore(state => state.activeTabId)
  // The embedded + menu has its own category pages; only the @ menu offers these.
  const showCategories = !browseReferences && !embedded
  const [category, setCategory] = useState<Category | null>(null)
  const activeCategory = showCategories ? category : null
  const listsFiles = activeCategory === 'files' || activeCategory === 'folders' || activeCategory === 'docs'
  const [sessionResult, setSessionResult] = useState<{ query: string, sessions: SessionCandidate[], error?: boolean } | null>(null)
  useEffect(() => {
    if (browseReferences) return
    let active = true
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void sessionCollaborationApi.list(filter, { signal: controller.signal }).then(data => {
        if (active) setSessionResult({ query: filter, sessions: data.sessions })
      }, () => {
        if (active) setSessionResult({ query: filter, sessions: [], error: true })
      })
    }, 150)
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [filter, browseReferences])
  const sessionCandidates = !browseReferences && sessionResult?.query === filter ? sessionResult.sessions : []
  const sessionLoading = !browseReferences && sessionResult?.query !== filter
  const sessionError = !browseReferences && sessionResult?.query === filter && sessionResult.error
  const [manualPath, setManualPath] = useState<{ cwd: string, filter: string, path: string } | null>(null)
  const override = manualPath?.cwd === cwd && manualPath.filter === filter ? manualPath.path : undefined
  const queryKey = `${cwd}\0${filter}\0${override ?? ''}\0${activeCategory ?? ''}`
  const [result, setResult] = useState<{ key: string, entries: FileEntry[], root: string, current: string, error?: 'denied' | 'failed' } | null>(null)
  const [ruleResult, setRuleResult] = useState<{ cwd: string, entries: FileEntry[], failed?: boolean } | null>(null)
  const [selection, setSelection] = useState<{ query: string, key: string } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [roomRef, roomAbove] = useRoomAbove<HTMLDivElement>()
  const rootRef = useRef({ cwd, path: cwd })
  if (rootRef.current.cwd !== cwd) rootRef.current = { cwd, path: cwd }
  const currentResult = !browseReferences && result?.key === queryKey ? result : null
  const directoryQuery = filter.replace(/\\/g, '/').trim()
  const browsingDirectory = directoryQuery.endsWith('/')
  const isSearching = directoryQuery.length > 0 || override !== undefined
  const loading = (isSearching || listsFiles) && !browseReferences && activeCategory !== 'rules' && activeCategory !== 'sessions' && currentResult === null
  const rulesLoading = activeCategory === 'rules' && Boolean(cwd) && ruleResult?.cwd !== cwd

  useEffect(() => {
    if (browseReferences || activeCategory === 'rules' || activeCategory === 'sessions') return
    if (!filter.trim() && override === undefined && !listsFiles) return
    let active = true
    const controller = new AbortController()
    const base = (cwd || rootRef.current.path).replace(/[\\/]+$/, '')
    const path = override ?? (browsingDirectory && base ? `${base}/${directoryQuery.replace(/\/+$/, '')}` : base)
    const search = override || browsingDirectory ? '' : directoryQuery || (activeCategory === 'docs' ? DOCUMENT_QUERY : '')
    const run = () => {
      const request = search ? filesystemApi.search(search, path, { signal: controller.signal }) : filesystemApi.browse(path, { includeFiles: true, signal: controller.signal })
      void request.then(data => {
        if (!active) return
        if (!rootRef.current.path) rootRef.current = { cwd, path: data.currentPath }
        setResult({ key: queryKey, entries: data.entries, current: data.currentPath, root: rootRef.current.path })
      }, error => {
        if (active) setResult({ key: queryKey, entries: [], current: path, root: base, error: error instanceof ApiError && error.status === 403 ? 'denied' : 'failed' })
      })
    }
    const timer = search ? setTimeout(run, 150) : undefined
    if (!search) run()
    return () => { active = false; clearTimeout(timer); controller.abort() }
  }, [cwd, filter, override, queryKey, browseReferences, directoryQuery, browsingDirectory, activeCategory, listsFiles])

  // 规则 lists the project's rule files once, then typing filters them here.
  // Without a project there is nothing to list.
  useEffect(() => {
    if (activeCategory !== 'rules' || !cwd) return
    let active = true
    const controller = new AbortController()
    void (async () => {
      const found = new Map<string, FileEntry>()
      let failed = false
      for (const query of RULE_QUERIES) {
        try {
          const data = await filesystemApi.search(query, cwd, { signal: controller.signal })
          for (const entry of data.entries) {
            if (!entry.isDirectory && isRuleFilePath(entry.path)) found.set(entry.path, entry)
          }
        } catch {
          if (!active) return
          failed = true
        }
      }
      if (active) setRuleResult({ cwd, entries: [...found.values()], ...(failed && found.size === 0 ? { failed } : {}) })
    })()
    return () => { active = false; controller.abort() }
  }, [activeCategory, cwd])

  const openCategory = useCallback((kind: Category) => {
    setCategory(kind)
    setManualPath(null)
  }, [])

  const groups = useMemo(() => {
    const matches = references.filter(() => browseReferences || !browsingDirectory)
    const referenceRow = (item: ComposerReferenceCandidate): Row => ({
      key: `${item.kind}:${item.id}`, label: item.displayName || item.name, description: item.description, searchTerms: [item.name], source: item.source,
      mention: { kind: item.kind, id: item.id, label: item.displayName || item.name, path: item.path ?? '', isDirectory: false, description: item.description, icon: safeMentionIcon(item.icon), modelText: item.modelText },
    })
    const fileRow = (entry: FileEntry): Row => {
      const base = (cwd || currentResult?.root || '').replace(/\\/g, '/').replace(/\/+$/, '')
      const path = entry.path.replace(/\\/g, '/')
      const relative = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : entry.relativePath ?? entry.name
      const name = entry.name.split(/[\\/]/).filter(Boolean).at(-1) ?? entry.name
      return { key: `file:${entry.path}`, label: name, searchTerms: [relative, path], description: relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '', file: { ...entry, relativePath: relative }, mention: { label: entry.isDirectory ? `${name}/` : name, path: entry.path, isDirectory: entry.isDirectory } }
    }
    const files: Row[] = (browseReferences ? [] : currentResult?.entries ?? []).map(fileRow)
    return [
      { kind: 'skills', label: t('chat.referenceSkills'), rows: matches.filter(item => item.kind === 'skill').map(referenceRow) },
      { kind: 'plugins', label: t('chat.referencePlugins'), rows: matches.filter(item => item.kind === 'plugin').map(referenceRow) },
      { kind: 'sessions', label: t('chat.referenceSessions'), rows: sessionCandidates.filter(item => item.sessionId !== activeSessionId).map((item): Row => ({
        key: `session:${item.sessionId}`, label: item.title || item.sessionId, description: `${item.cwd} · ${item.sessionId.slice(0, 8)}`, searchTerms: [item.sessionId, item.title, item.cwd], contentMatch: true, session: item,
        shortId: sessionCandidates.some(other => other.sessionId !== item.sessionId && other.sessionId.slice(0, 8) === item.sessionId.slice(0, 8)) ? item.sessionId : item.sessionId.slice(0, 8),
        mention: { kind: 'session' as const, id: item.sessionId, label: item.title || item.sessionId, description: item.cwd, path: '', isDirectory: false },
      })) },
      { kind: 'files', label: t('chat.referenceFiles'), rows: files },
      { kind: 'rules', label: t('chat.referenceCategoryRules'), rows: activeCategory === 'rules' && ruleResult?.cwd === cwd ? ruleResult.entries.map(fileRow) : [] },
      { kind: 'actions', label: t('chat.references'), rows: actions.map(action => ({ ...action, description: action.description ?? '' })) as Row[] },
    ]
  }, [references, currentResult, cwd, t, actions, browseReferences, browsingDirectory, sessionCandidates, activeSessionId, activeCategory, ruleResult])
  const categoryEntry = CATEGORIES.find(entry => entry.kind === activeCategory)
  const categoryRows = useMemo((): Row[] => {
    if (!activeCategory) return []
    const rowsOf = (kind: string) => groups.find(group => group.kind === kind)?.rows ?? []
    // A listing (nothing typed, or a folder opened) keeps its order; a typed
    // search is ranked like the rest of the menu.
    const listing = !directoryQuery || browsingDirectory || override !== undefined
    const ranked = (rows: Row[]) => listing ? rows.slice(0, CATEGORY_LIMIT) : rankComposerSuggestions(rows, filter, CATEGORY_LIMIT)
    switch (activeCategory) {
      case 'files': return ranked(listing ? rowsOf('files') : rowsOf('files').filter(row => !row.file?.isDirectory))
      case 'folders': return ranked(rowsOf('files').filter(row => row.file?.isDirectory))
      case 'docs': return ranked(rowsOf('files').filter(row => !row.file?.isDirectory && isDocumentPath(row.file?.path ?? '')))
      case 'rules': return directoryQuery ? rankComposerSuggestions(rowsOf('rules'), filter, CATEGORY_LIMIT) : rowsOf('rules').slice(0, CATEGORY_LIMIT)
      case 'sessions': return rowsOf('sessions').slice(0, CATEGORY_LIMIT)
    }
  }, [activeCategory, groups, directoryQuery, browsingDirectory, override, filter])
  const categoryEntryRows = useMemo((): Row[] => showCategories ? CATEGORIES.map(entry => ({
    key: `category:${entry.kind}`, label: t(entry.label), description: t(entry.description), category: entry.kind,
    icon: <entry.icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--color-text-tertiary)]" strokeWidth={1.75} />,
    onSelect: () => openCategory(entry.kind),
  })) : [], [showCategories, t, openCategory])
  const visibleGroups = activeCategory
    ? [{ kind: `category-${activeCategory}`, label: categoryEntry ? t(categoryEntry.label) : '', rows: categoryRows }]
    : isSearching
      ? [{ kind: 'results', label: t('chat.references'), rows: !browseReferences && (override || browsingDirectory)
        ? groups.find(group => group.kind === 'files')!.rows
        : rankComposerSuggestions(groups.flatMap(group => group.rows), filter) }]
      : [
        ...(categoryEntryRows.length ? [{ kind: 'categories', label: t('chat.referenceCategories'), rows: categoryEntryRows }] : []),
        ...groups.filter(group => group.kind !== 'files' && group.kind !== 'rules' && (browseReferences || group.kind !== 'actions')).map(group => ({ ...group, rows: browseReferences ? group.rows : group.rows.slice(0, 3) })),
      ]
  const rows = visibleGroups.flatMap(group => group.rows)
  const selectionKey = queryKey
  const foundIndex = selection?.query === selectionKey ? rows.findIndex(row => row.key === selection.key) : -1
  const activeIndex = rows.length ? Math.max(0, foundIndex) : -1
  const activeOptionId = activeIndex < 0 ? undefined : getComposerReferenceOptionId(id, activeIndex)
  // Inside a category only that category's loading and errors are its business.
  const sessionsShown = !activeCategory || activeCategory === 'sessions'
  const anyLoading = loading || rulesLoading || (referencesLoading && !activeCategory) || (sessionLoading && sessionsShown)
  const fileError = activeCategory === 'rules' ? (ruleResult?.cwd === cwd && ruleResult.failed ? 'failed' : undefined) : currentResult?.error
  const sessionErrorShown = Boolean(sessionError) && sessionsShown
  const referencesErrorShown = Boolean(referencesError) && !activeCategory

  useEffect(() => { onActiveChange?.(activeOptionId) }, [activeOptionId, onActiveChange])
  useEffect(() => {
    if (activeOptionId) listRef.current?.ownerDocument.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeOptionId])
  const highlight = useCallback((row: Row) => setSelection({ query: selectionKey, key: row.key }), [selectionKey])
  const navigate = useCallback((row: Row) => {
    if (row.category) {
      openCategory(row.category)
      return
    }
    if (!row.file?.isDirectory) return
    const relative = `${(row.file.relativePath ?? row.file.name).replace(/\/+$/, '')}/`
    if (onNavigate) onNavigate(relative)
    else setManualPath({ cwd, filter, path: row.file.path })
  }, [cwd, filter, onNavigate, openCategory])
  const select = useCallback((row: Row) => {
    if (row.onSelect) row.onSelect()
    else if (row.mention) onSelect(row.mention)
  }, [onSelect])
  useImperativeHandle(ref, () => ({ handleKeyDown(event) {
    if (event.isComposing || event.keyCode === 229) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (rows.length) highlight(rows[(Math.max(activeIndex, 0) + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length]!)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      if (rows[activeIndex]) select(rows[activeIndex]!)
    } else if (event.key === 'ArrowRight' && (rows[activeIndex]?.file?.isDirectory || rows[activeIndex]?.category)) {
      event.preventDefault()
      navigate(rows[activeIndex]!)
    } else if (event.key === 'ArrowLeft' && activeCategory && !filter) {
      // Nothing typed after @, so the caret has nowhere to go: step back out.
      event.preventDefault()
      setCategory(null)
    }
  } }), [activeIndex, rows, highlight, navigate, select, activeCategory, filter])

  let offset = 0
  return (
    <div ref={embedded ? undefined : roomRef} style={embedded ? undefined : { maxHeight: roomAbove }} className={embedded ? 'flex min-h-0 min-w-0 flex-col' : `absolute bottom-full left-0 w-full z-[var(--z-dropdown)] mb-2 flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] shadow-[var(--shadow-dropdown)] `} onMouseDown={event => event.preventDefault()}>
      <div ref={listRef} id={id} role="listbox" aria-label={categoryEntry ? t(categoryEntry.label) : t('chat.references')} aria-busy={anyLoading} className="min-h-0 min-w-0 max-h-[min(320px,45vh)] overflow-y-auto p-1">
        {categoryEntry ? (
          <div className={`${COMPOSER_MENU_SECTION} flex items-center gap-1`}>
            <button type="button" aria-label={t('chat.referenceCategoryBack')} title={t('chat.referenceCategoryBack')} onClick={() => setCategory(null)}
              className="-ml-1 flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-focus)]">
              <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
            <span>{t(categoryEntry.label)}</span>
          </div>
        ) : null}
        {visibleGroups.map(group => {
          const start = offset
          offset += group.rows.length
          if (!group.rows.length) return null
          return <div key={group.kind} role="group" aria-label={group.label}>
            {!isSearching && !activeCategory ? <div className={COMPOSER_MENU_SECTION}>{group.label}</div> : null}
            {group.rows.map((row, position) => {
              const index = start + position
              const Icon = referenceFallbackIcon(row.file ? (row.file.isDirectory ? 'directory' : 'file') : row.mention?.kind ?? 'skill')
              const sourceLabel = row.file ? null : skillSourceLabelKey(row.source)
              return <ComposerSuggestionRow key={row.key} id={getComposerReferenceOptionId(id, index)}
                label={row.label} description={row.description}
                details={row.session ? <SessionReferenceDetails session={row.session} shortId={row.shortId!} /> : undefined} selected={activeIndex === index}
                onMouseEnter={() => highlight(row)} onClick={event => {
                  if ((event.target as Element).closest('[data-navigate-directory]')) navigate(row)
                  else select(row)
                }}
                icon={row.icon ?? (row.mention?.icon ? <img src={publicAssetPath(row.mention.icon)} alt="" className="h-4 w-4 shrink-0 object-contain" /> : <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--color-text-tertiary)]" strokeWidth={1.75} />)}
                trailing={<>
                  {sourceLabel ? <span className="shrink-0 text-xs text-[var(--color-text-tertiary)]">{t(sourceLabel)}</span> : null}
                  {row.file?.isDirectory ? <span data-navigate-directory title={t('fileSearch.openFolder')} className="-my-1.5 -mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--color-surface-selected)]"><ChevronRight aria-hidden="true" className="h-3.5 w-3.5 text-[var(--color-text-tertiary)]" /></span> : null}
                  {row.category ? <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-tertiary)]" /> : null}
                </>}
              />
            })}
          </div>
        })}
        {anyLoading ? <div role="status" className="px-2 py-2 text-xs text-[var(--color-text-tertiary)]">{t('fileSearch.searching')}</div> : null}
        {fileError ? <div role="alert" className="px-2 py-2 text-xs text-[var(--color-error)]">{t(fileError === 'denied' ? 'fileSearch.accessDenied' : 'fileSearch.loadFailed')}</div> : null}
        {sessionErrorShown ? <div role="alert" className="px-2 py-2 text-xs text-[var(--color-error)]">{t('chat.sessionReferencesLoadFailed')}</div> : null}
        {referencesErrorShown ? <div role="alert" className="px-2 py-2 text-xs text-[var(--color-error)]">{t('chat.referencesLoadFailed')}</div> : null}
        {!rows.length && !anyLoading && !sessionErrorShown && !fileError && !referencesErrorShown ? <div className="px-2 py-3 text-xs text-[var(--color-text-tertiary)]">{t('chat.referencesEmpty')}</div> : null}
      </div>
      {!isSearching && !activeCategory && !embedded ? <div className="border-t border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-tertiary)]">{t('chat.referenceSearchHint')}</div> : null}
      {!compact && !embedded ? <div className="flex items-center gap-1.5 border-t border-[var(--color-border)] px-3 py-2 text-[11px] text-[var(--color-text-tertiary)]"><kbd className={COMPOSER_KBD}>↑↓</kbd><span>{t('fileSearch.navigate')}</span><kbd className={`${COMPOSER_KBD} ml-2`}>Enter / Tab</kbd><span>{t('fileSearch.select')}</span><kbd className={`${COMPOSER_KBD} ml-2`}>→</kbd><span>{t('fileSearch.open')}</span><kbd className={`${COMPOSER_KBD} ml-2`}>Esc</kbd><span>{t('fileSearch.close')}</span></div> : null}
    </div>
  )
})
