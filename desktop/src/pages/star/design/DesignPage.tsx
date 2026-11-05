import { useEffect, useState } from 'react'
import { starPageTabId, takeStarPageParams } from '../../../components/star/starPages'
import { useTabStore } from '../../../stores/tabStore'
import { DesignHome } from './DesignHome'
import { DesignWorkspace } from './DesignWorkspace'

type Opened = { project: string; prompt?: string } | null

const DESIGN_TAB_ID = starPageTabId('design')

function readParams(): Opened {
  // Fresh params from openStarPage first; otherwise the project saved with the
  // tab, which is what a reload (or a remount) brings back.
  const params = takeStarPageParams('design') ??
    useTabStore.getState().tabs.find(tab => tab.sessionId === DESIGN_TAB_ID)?.pageParams ??
    null
  return params?.project ? { project: params.project, ...(params.prompt ? { prompt: params.prompt } : {}) } : null
}

/**
 * STAR Design, a page of its own (not the in-chat creation modes): the home
 * with types, inspiration and design systems, and the workspace with the
 * design agent on the left and the artboard canvas on the right.
 */
export function DesignPage() {
  const [opened, setOpened] = useState<Opened>(readParams)
  useEffect(() => {
    const onParams = (event: Event) => {
      if ((event as CustomEvent<{ id?: string }>).detail?.id !== 'design') return
      const next = readParams()
      if (next) setOpened(next)
    }
    window.addEventListener('star:page-params', onParams)
    return () => window.removeEventListener('star:page-params', onParams)
  }, [])
  // Only the project is kept: the first prompt has been sent by the time a reload comes.
  const openedProject = opened?.project
  useEffect(() => {
    useTabStore.getState().setTabPageParams(DESIGN_TAB_ID, openedProject ? { project: openedProject } : undefined)
  }, [openedProject])
  if (opened) {
    return <DesignWorkspace key={opened.project} projectId={opened.project} initialPrompt={opened.prompt} onBack={() => setOpened(null)} />
  }
  return <DesignHome onOpen={project => setOpened({ project })} />
}
