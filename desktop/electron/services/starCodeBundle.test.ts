import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyBundledStarCodeEnv, applyStarAgentExecutableEnv, BUNDLED_STAR_CODE_ENV, bundledStarCodeExecutable, STAR_AGENT_EXECUTABLE_ENV } from './starCodeBundle'

const RESOURCES = path.join('C:', 'Program Files', 'STAR', 'resources')

describe('bundled STAR Code', () => {
  it('is the executable under resources/star-code for each platform', () => {
    expect(bundledStarCodeExecutable(RESOURCES, 'win32')).toBe(path.join(RESOURCES, 'star-code', 'STAR Code.exe'))
    expect(bundledStarCodeExecutable(RESOURCES, 'darwin')).toBe(path.join(RESOURCES, 'star-code', 'STAR Code.app'))
    expect(bundledStarCodeExecutable(RESOURCES, 'linux')).toBe(path.join(RESOURCES, 'star-code', 'star-code'))
  })

  it('hands an installed build its own IDE copy', () => {
    const env: NodeJS.ProcessEnv = {}
    const executable = path.join(RESOURCES, 'star-code', 'STAR Code.exe')
    expect(applyBundledStarCodeEnv(env, { isPackaged: true, resourcesPath: RESOURCES, platform: 'win32', exists: target => target === executable }))
      .toBe(executable)
    expect(env[BUNDLED_STAR_CODE_ENV]).toBe(executable)
  })

  it('sets nothing for a development run or a build that ships without the IDE', () => {
    const dev: NodeJS.ProcessEnv = {}
    expect(applyBundledStarCodeEnv(dev, { isPackaged: false, resourcesPath: RESOURCES, platform: 'win32', exists: () => true })).toBeNull()
    expect(dev).toEqual({})
    const without: NodeJS.ProcessEnv = {}
    expect(applyBundledStarCodeEnv(without, { isPackaged: true, resourcesPath: RESOURCES, platform: 'win32', exists: () => false })).toBeNull()
    expect(without).toEqual({})
  })

  it('tells the IDE where this app is, in an installed build only', () => {
    const installed: NodeJS.ProcessEnv = {}
    const exe = 'C:\\Program Files\\STAR\\STAR.exe'
    expect(applyStarAgentExecutableEnv(installed, { isPackaged: true, execPath: exe })).toBe(exe)
    expect(installed[STAR_AGENT_EXECUTABLE_ENV]).toBe(exe)
    const dev: NodeJS.ProcessEnv = {}
    expect(applyStarAgentExecutableEnv(dev, { isPackaged: false, execPath: 'C:\\node_modules\\electron\\dist\\electron.exe' })).toBeNull()
    expect(dev).toEqual({})
    const explicit: NodeJS.ProcessEnv = { [STAR_AGENT_EXECUTABLE_ENV]: 'D:\\STAR\\STAR.exe' }
    expect(applyStarAgentExecutableEnv(explicit, { isPackaged: true, execPath: exe })).toBe('D:\\STAR\\STAR.exe')
  })

  it('leaves an explicit location alone', () => {
    const env: NodeJS.ProcessEnv = { [BUNDLED_STAR_CODE_ENV]: 'D:\\Tools\\STAR Code\\STAR Code.exe' }
    expect(applyBundledStarCodeEnv(env, { isPackaged: true, resourcesPath: RESOURCES, platform: 'win32', exists: () => true }))
      .toBe('D:\\Tools\\STAR Code\\STAR Code.exe')
    expect(env[BUNDLED_STAR_CODE_ENV]).toBe('D:\\Tools\\STAR Code\\STAR Code.exe')
  })
})
