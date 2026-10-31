import { useEffect, useState } from 'react'
import { takeStarPageParams } from '../../../components/star/starPages'
import { DesignHome } from './DesignHome'
import { DesignWorkspace } from './DesignWorkspace'

type Opened = { project: string; prompt?: string } | null

function readParams(): Opened {
  const params = takeStarPageParams('design')
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
  if (opened) {
    return <DesignWorkspace key={opened.project} projectId={opened.project} initialPrompt={opened.prompt} onBack={() => setOpened(null)} />
  }
  return <DesignHome onOpen={project => setOpened({ project })} />
}
