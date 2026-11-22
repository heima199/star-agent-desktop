import { expect, it } from 'vitest'
import { workspaceBrowserErrorText } from './browserErrorText'

const invoke = (channel: string, reason: string) =>
  new Error(`Error invoking remote method 'desktop:workspace-browser:${channel}': Error: ${reason}`)

it('names a rejected host call by its reason, not by the channel it travelled on', () => {
  expect(workspaceBrowserErrorText(invoke('capture', 'Workspace browser page not found'))).toBe('Workspace browser page not found')
})

it('reduces a failed load to the code the load event reports', () => {
  expect(workspaceBrowserErrorText(invoke('navigate', "ERR_CONNECTION_REFUSED (-102) loading 'https://a.test/'"))).toBe('ERR_CONNECTION_REFUSED')
  expect(workspaceBrowserErrorText(new Error("ERR_NAME_NOT_RESOLVED (-105) loading 'https://b.test/'"))).toBe('ERR_NAME_NOT_RESOLVED')
})

it('shows a reason that is already plain as it is', () => {
  expect(workspaceBrowserErrorText(new Error('navigation denied'))).toBe('navigation denied')
  expect(workspaceBrowserErrorText('plain text')).toBe('plain text')
})
