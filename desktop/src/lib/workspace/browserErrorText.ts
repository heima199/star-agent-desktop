/**
 * What a rejected host call has to say, as text for the tab's own error view.
 *
 * Electron prefixes a rejected `invoke` with the channel it travelled on, and a
 * failed load arrives as its code plus the address it was loading. The view
 * names the address itself, and the same failure reported as a load event
 * carries the bare code, so both are reduced to that.
 */
export function workspaceBrowserErrorText(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error))
    .replace(/^Error invoking remote method '[^']*': /, '')
    .replace(/^(?:Error: )+/, '')
  const failedLoad = /^(ERR_[A-Z0-9_]+) \(-?\d+\) loading '/.exec(text)
  return failedLoad ? failedLoad[1]! : text
}
