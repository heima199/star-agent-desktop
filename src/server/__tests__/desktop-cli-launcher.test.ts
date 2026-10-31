import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  buildManagedPathBlock,
  buildWindowsLauncherWrapper,
  DESKTOP_CLI_ALIASES,
  DESKTOP_CLI_NAME,
  ensureDesktopCliLauncherInstalled,
  getDesktopCliCommandName,
  getDesktopCliLauncherPaths,
  PATH_BLOCK_END,
  PATH_BLOCK_START,
  upsertManagedPathBlock,
} from '../services/desktopCliLauncherService.js'

describe('launcher names', () => {
  it('installs star-agent and keeps claude-haha as an alias for existing scripts', () => {
    expect(DESKTOP_CLI_NAME).toBe('star-agent')
    expect(DESKTOP_CLI_ALIASES).toEqual(['claude-haha'])

    const unixBin = join('/home/me', '.local', 'bin')
    expect(getDesktopCliLauncherPaths(unixBin, 'linux')).toEqual([
      join(unixBin, 'star-agent'),
      join(unixBin, 'claude-haha'),
    ])
    expect(getDesktopCliLauncherPaths(unixBin, 'darwin')).toEqual([
      join(unixBin, 'star-agent'),
      join(unixBin, 'claude-haha'),
    ])

    const windowsBin = join('C:\\Users\\me', '.local', 'bin')
    expect(getDesktopCliLauncherPaths(windowsBin, 'win32')).toEqual([
      join(windowsBin, 'star-agent.cmd'),
      join(windowsBin, 'claude-haha.cmd'),
    ])
  })

  it('names the current command in the launcher error', () => {
    const configDir = process.env.CLAUDE_CONFIG_DIR
    delete process.env.CLAUDE_CONFIG_DIR
    try {
      const wrapper = buildWindowsLauncherWrapper('C:\\Apps\\STAR Agent\\claude-sidecar.exe')

      expect(wrapper).toContain('echo star-agent launcher could not find bundled sidecar: %SIDECAR% 1>&2')
      expect(wrapper).not.toContain('claude-haha')
    } finally {
      if (configDir !== undefined) process.env.CLAUDE_CONFIG_DIR = configDir
    }
  })
})

describe('managed PATH block', () => {
  const block = buildManagedPathBlock('zsh', '/home/me/.local/bin', '/home/me')
  const legacyBlock = [
    '# >>> Claude Code Haha PATH >>>',
    'export PATH="$HOME/.local/bin:$PATH"',
    '# <<< Claude Code Haha PATH <<<',
  ].join('\n')

  it('is marked with the product name', () => {
    expect(PATH_BLOCK_START).toBe('# >>> STAR Agent PATH >>>')
    expect(PATH_BLOCK_END).toBe('# <<< STAR Agent PATH <<<')
    expect(block).toBe([PATH_BLOCK_START, 'export PATH="$HOME/.local/bin:$PATH"', PATH_BLOCK_END].join('\n'))
  })

  it('replaces the block a build under the former name wrote, in place', () => {
    const before = `alias ll='ls -l'\n\n${legacyBlock}\nexport EDITOR=vim\n`
    const after = upsertManagedPathBlock(before, block)

    expect(after).toBe(`alias ll='ls -l'\n\n${block}\nexport EDITOR=vim\n`)
    expect(after).not.toContain('Claude Code Haha')
    expect(upsertManagedPathBlock(after, block)).toBe(after)
  })

  it('drops a leftover legacy block when the current one exists', () => {
    const after = upsertManagedPathBlock(`${block}\n${legacyBlock}\n`, block)

    expect(after).toBe(`${block}\n`)
  })

  it('appends the block to a file without one', () => {
    expect(upsertManagedPathBlock('export EDITOR=vim\n', block)).toBe(`export EDITOR=vim\n\n${block}\n`)
    expect(upsertManagedPathBlock('', block)).toBe(`${block}\n`)
  })
})

const isWindows = process.platform === 'win32'
const unixOnly = isWindows ? it.skip : it

const ORIGINAL_HOME = process.env.HOME
const ORIGINAL_USERPROFILE = process.env.USERPROFILE
const ORIGINAL_SHELL = process.env.SHELL
const ORIGINAL_PATH = process.env.PATH
const ORIGINAL_CLAUDE_CLI_PATH = process.env.CLAUDE_CLI_PATH
const ORIGINAL_CLAUDE_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR

describe('ensureDesktopCliLauncherInstalled', () => {
  let tempHome = ''
  let tempSourceDir = ''

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'desktop-cli-home-'))
    tempSourceDir = await mkdtemp(join(tmpdir(), 'desktop-cli-source-'))
    process.env.HOME = tempHome
    process.env.USERPROFILE = tempHome
    process.env.SHELL = '/bin/zsh'
    process.env.PATH = ''
    delete process.env.CLAUDE_CONFIG_DIR
  })

  afterEach(async () => {
    if (ORIGINAL_HOME === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = ORIGINAL_HOME
    }

    if (ORIGINAL_USERPROFILE === undefined) {
      delete process.env.USERPROFILE
    } else {
      process.env.USERPROFILE = ORIGINAL_USERPROFILE
    }

    if (ORIGINAL_SHELL === undefined) {
      delete process.env.SHELL
    } else {
      process.env.SHELL = ORIGINAL_SHELL
    }

    if (ORIGINAL_PATH === undefined) {
      delete process.env.PATH
    } else {
      process.env.PATH = ORIGINAL_PATH
    }

    if (ORIGINAL_CLAUDE_CLI_PATH === undefined) {
      delete process.env.CLAUDE_CLI_PATH
    } else {
      process.env.CLAUDE_CLI_PATH = ORIGINAL_CLAUDE_CLI_PATH
    }

    if (ORIGINAL_CLAUDE_CONFIG_DIR === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = ORIGINAL_CLAUDE_CONFIG_DIR
    }

    await rm(tempHome, { recursive: true, force: true })
    await rm(tempSourceDir, { recursive: true, force: true })
  })

  unixOnly('installs a launcher wrapper in the user bin dir and configures PATH', async () => {
    const sourcePath = join(tempSourceDir, 'claude-sidecar')
    await writeFile(sourcePath, '#!/bin/sh\necho desktop-sidecar\n', 'utf8')
    await chmod(sourcePath, 0o755)
    process.env.CLAUDE_CLI_PATH = sourcePath

    const status = await ensureDesktopCliLauncherInstalled()
    const launcherPath = join(tempHome, '.local', 'bin', 'star-agent')
    const shellConfigPath = join(tempHome, '.zshrc')

    expect(status.supported).toBe(true)
    expect(status.installed).toBe(true)
    expect(status.command).toBe('star-agent')
    expect(status.launcherPath).toBe(launcherPath)
    expect(status.availableInNewTerminals).toBe(true)
    expect(status.needsTerminalRestart).toBe(true)
    expect(status.configTarget).toBe(shellConfigPath)

    const launcher = await readFile(launcherPath, 'utf8')
    expect(launcher).toContain(`SIDECAR='${sourcePath}'`)
    expect(launcher).toContain('cli --app-root "$APP_ROOT" "$@"')
    expect(launcher).toContain('/usr/bin/script -q /dev/null')
    // The former name is the same launcher, so existing scripts keep working.
    expect(await readFile(join(tempHome, '.local', 'bin', 'claude-haha'), 'utf8')).toBe(launcher)
    expect(await readFile(shellConfigPath, 'utf8')).toContain(
      'export PATH="$HOME/.local/bin:$PATH"',
    )
  })

  unixOnly('pins portable config dir in the installed launcher wrapper', async () => {
    const sourcePath = join(tempSourceDir, 'claude-sidecar')
    const portableDir = join(tempHome, 'portable-config')
    await writeFile(sourcePath, '#!/bin/sh\necho desktop-sidecar\n', 'utf8')
    await chmod(sourcePath, 0o755)
    process.env.CLAUDE_CLI_PATH = sourcePath
    process.env.CLAUDE_CONFIG_DIR = portableDir

    await ensureDesktopCliLauncherInstalled()

    for (const name of ['star-agent', 'claude-haha']) {
      const launcher = await readFile(join(tempHome, '.local', 'bin', name), 'utf8')
      expect(launcher).toContain(`export CLAUDE_CONFIG_DIR='${portableDir}'`)
    }
  })

  it('uses a Windows cmd launcher so portable env can be injected', () => {
    expect(getDesktopCliCommandName('win32')).toBe('star-agent.cmd')
    expect(getDesktopCliCommandName('win32', 'claude-haha')).toBe('claude-haha.cmd')
    expect(getDesktopCliCommandName('linux')).toBe('star-agent')

    process.env.CLAUDE_CONFIG_DIR = 'C:\\Portable\\ClaudeConfig'
    const wrapper = buildWindowsLauncherWrapper('C:\\Apps\\cc-haha\\claude-sidecar.exe')

    expect(wrapper).toContain('set "CLAUDE_CONFIG_DIR=C:\\Portable\\ClaudeConfig"')
    expect(wrapper).toContain(
      '"%SIDECAR%" cli --app-root "%APP_ROOT%" %*',
    )
  })

  it('reports unsupported status when the current launcher is not a bundled sidecar', async () => {
    const sourcePath = join(tempSourceDir, 'claude')
    await writeFile(sourcePath, '#!/bin/sh\necho plain-cli\n', 'utf8')
    process.env.CLAUDE_CLI_PATH = sourcePath

    const status = await ensureDesktopCliLauncherInstalled()

    expect(status.supported).toBe(false)
    expect(status.installed).toBe(false)
    expect(status.command).toBe('star-agent')
  })
})
