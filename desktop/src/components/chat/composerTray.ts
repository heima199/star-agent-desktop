import { createContext, useContext } from 'react'

/**
 * Set by a host that gives the composer a second strip underneath it (STAR
 * Design's narrow chat column): the project folder and the permission control
 * move off the toolbar into that strip, so the input row keeps its room.
 */
const ComposerTrayContext = createContext(false)

export const ComposerTrayProvider = ComposerTrayContext.Provider

export function useComposerTray(): boolean {
  return useContext(ComposerTrayContext)
}

/**
 * Set by a host that knows what its composer is for (STAR Design's chat:
 * changing the design), so the empty composer says that instead of the
 * general "edit, debug or explain code".
 */
const ComposerPlaceholderContext = createContext<string | null>(null)

export const ComposerPlaceholderProvider = ComposerPlaceholderContext.Provider

export function useComposerHostPlaceholder(): string | null {
  return useContext(ComposerPlaceholderContext)
}
