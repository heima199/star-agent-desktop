import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STAR_PAGE_TAB_PREFIX, useTabStore } from '../../../stores/tabStore'
import { DesignPage } from './DesignPage'

vi.mock('./DesignWorkspace', () => ({
  DesignWorkspace: ({ projectId, onBack }: { projectId: string; onBack: () => void }) => (
    <div>
      <span data-testid="design-workspace">{projectId}</span>
      <button type="button" onClick={onBack}>back</button>
    </div>
  ),
}))
vi.mock('./DesignHome', () => ({
  DesignHome: ({ onOpen }: { onOpen: (project: string) => void }) => (
    <button type="button" data-testid="design-home" onClick={() => onOpen('proj-new')}>open</button>
  ),
}))

const DESIGN_TAB_ID = `${STAR_PAGE_TAB_PREFIX}design`

function designTab() {
  return useTabStore.getState().tabs.find(tab => tab.sessionId === DESIGN_TAB_ID)
}

describe('DesignPage', () => {
  beforeEach(() => {
    localStorage.clear()
    useTabStore.setState({
      tabs: [{ sessionId: DESIGN_TAB_ID, title: 'Design', type: 'star-page', status: 'idle', pageId: 'design' }],
      activeTabId: DESIGN_TAB_ID,
      closedSessionTabs: [],
    })
  })

  // After a reload no openStarPage params exist; the project saved with the
  // tab is what brings the canvas back instead of the Design home.
  it('reopens the project saved with its tab after a reload', () => {
    useTabStore.setState({
      tabs: [{ sessionId: DESIGN_TAB_ID, title: 'Design', type: 'star-page', status: 'idle', pageId: 'design', pageParams: { project: 'proj-1' } }],
    })

    render(<DesignPage />)

    expect(screen.getByTestId('design-workspace').textContent).toBe('proj-1')
  })

  it('records the open project on its tab and clears it on the way back home', () => {
    render(<DesignPage />)

    act(() => { fireEvent.click(screen.getByTestId('design-home')) })
    expect(designTab()?.pageParams).toEqual({ project: 'proj-new' })

    act(() => { fireEvent.click(screen.getByRole('button', { name: 'back' })) })
    expect(screen.getByTestId('design-home')).toBeTruthy()
    expect(designTab()?.pageParams).toBeUndefined()
  })
})
