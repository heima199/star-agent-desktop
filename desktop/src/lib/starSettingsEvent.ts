/**
 * Window event that opens the global settings dialog. `openTab(SETTINGS_TAB_ID)`
 * dispatches it on desktop instead of opening a settings tab; StarSettingsHost
 * listens for it. Its own module so stores and tests need not share one.
 */
export const STAR_OPEN_SETTINGS_EVENT = 'star:open-settings'
