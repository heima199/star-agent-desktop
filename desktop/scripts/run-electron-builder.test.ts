import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { electronBuilderArgs } from './run-electron-builder'

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('electron-builder runner', () => {
  it('passes arguments through and adds the STAR feed only when configured', () => {
    expect(electronBuilderArgs(['--dir', '--publish', 'never'], {})).toEqual(['--dir', '--publish', 'never'])
    expect(electronBuilderArgs(['--publish', 'never'], { STAR_UPDATE_URL: 'https://updates.example.com/star-agent' })).toEqual([
      '--publish',
      'never',
      '-c.publish.provider=generic',
      '-c.publish.url=https://updates.example.com/star-agent',
    ])
  })

  it('is what the packaging scripts run', () => {
    const pkg = JSON.parse(readFileSync(path.join(desktopDir, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    for (const script of ['electron:package', 'electron:package:dir']) {
      expect(pkg.scripts[script]).toContain('bun run ./scripts/run-electron-builder.ts')
      expect(pkg.scripts[script]).not.toContain('electron-builder/out/cli/cli.js')
    }
    const windowsBuild = readFileSync(path.join(desktopDir, 'scripts', 'build-windows.ps1'), 'utf8')
    expect(windowsBuild).toContain("'./scripts/run-electron-builder.ts'")
    expect(windowsBuild).not.toMatch(/bunx @args/)
  })

  // 多芯片安装包: one installer per chip, each from the same script.
  it('builds the Windows installer for both chips and the Mac app for both chips', () => {
    const pkg = JSON.parse(readFileSync(path.join(desktopDir, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    expect(pkg.scripts['build:windows-x64']).toContain('build-windows-x64.ps1')
    expect(pkg.scripts['build:windows-arm64']).toContain('build-windows.ps1 -Arch arm64')
    expect(pkg.scripts['build:macos-arm64']).toBe('bash ./scripts/build-macos-arm64.sh')
    expect(pkg.scripts['build:macos-x64']).toBe('MAC_ARCH=x64 bash ./scripts/build-macos-arm64.sh')

    const windowsBuild = readFileSync(path.join(desktopDir, 'scripts', 'build-windows.ps1'), 'utf8')
    expect(windowsBuild).toContain("[ValidateSet('x64', 'arm64')]")
    expect(windowsBuild).toContain('"--$Arch"')
    expect(windowsBuild).toContain("'win-arm64-unpacked'")
    // An arm64 package needs the arm64 sharp and ngrok addons installed on an x64 machine.
    expect(windowsBuild).toContain('bun install --cpu="*"')
    expect(readFileSync(path.join(desktopDir, 'scripts', 'build-windows-x64.ps1'), 'utf8')).toContain("build-windows.ps1') -Arch x64")

    const macBuild = readFileSync(path.join(desktopDir, 'scripts', 'build-macos-arm64.sh'), 'utf8')
    expect(macBuild).toContain('MAC_ARCH="${MAC_ARCH:-arm64}"')
    expect(macBuild).toContain('TARGET_TRIPLE="x86_64-apple-darwin"')
    expect(macBuild).toContain('"--${MAC_ARCH}" --publish never')
    expect(macBuild).toContain('--arch "${MAC_ARCH}"')
  })
  // Without them an installed app cannot sign in or ask the console for its
  // name. The sidecar cannot read inside app.asar, hence unpacked.
  it('ships the STAR product settings unpacked, where the sidecar reads them', () => {
    const pkg = JSON.parse(readFileSync(path.join(desktopDir, 'package.json'), 'utf8')) as { build: { files: string[]; asarUnpack: string[] } }
    expect(pkg.build.files).toContain('star-product.json')
    expect(pkg.build.asarUnpack).toContain('star-product.json')
  })
})
