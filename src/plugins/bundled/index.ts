/**
 * Built-in Plugin Initialization
 *
 * Initializes built-in plugins that ship with the CLI and appear in the
 * /plugin UI for users to enable/disable.
 *
 * Not all bundled features should be built-in plugins — use this for
 * features that users should be able to explicitly enable/disable. For
 * features with complex setup or automatic-enabling logic (e.g.
 * claude-in-chrome), use src/skills/bundled/ instead.
 *
 * To add a new built-in plugin:
 * 1. Import registerBuiltinPlugin from '../builtinPlugins.js'
 * 2. Call registerBuiltinPlugin() with the plugin definition here
 */

import { registerStarPlugins } from './star.js'

/**
 * Initialize built-in plugins. Called during CLI startup, and by the desktop
 * server so its plugin listings show the same set.
 */
export function initBuiltinPlugins(): void {
  // STAR 首推插件: drawing, video, research, documents and the capability check.
  registerStarPlugins()
}
