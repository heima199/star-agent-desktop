import { describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSandboxedTestEnvironment } from './test-environment'

describe('Windows installer recovery prerequisites', () => {
  test('does not compile native path helpers at install time', () => {
    const recoveryHelper = readFileSync(
      'desktop/build/recover-legacy-install-data.ps1',
      'utf8',
    )

    expect(recoveryHelper).not.toContain('Add-Type')
    expect(recoveryHelper).toContain('function Assert-NoReparsePointInPath')
    expect(recoveryHelper).toContain('$rootAttributes = [IO.File]::GetAttributes($current)')
    expect(recoveryHelper).toContain(
      'contains a reparse point and cannot be recovered safely',
    )
    expect(recoveryHelper).toContain('function Get-CanonicalPathIdentity')
    expect(recoveryHelper).toContain('System32\\mountvol.exe')
    expect(recoveryHelper).toContain('SUBST aliases cannot be recovered safely')
    expect(recoveryHelper).toContain('Possible 8.3 path alias cannot be proven safe')
    expect(recoveryHelper).toContain('Alternate path alias cannot be recovered safely')
    expect(recoveryHelper).toContain('Get-ChildItem -LiteralPath $current -Force')
    expect(recoveryHelper).toContain("([string]$_.Name).Equals($segment")
    expect(recoveryHelper).toContain("Join-Path $testRoot 'project~notes'")
    expect(recoveryHelper).toContain("Join-Path $testRoot 'MISSIN~1'")
    expect(recoveryHelper).not.toContain("'PROGRA~1'")
    expect(recoveryHelper).toContain('possible 8.3 alias did not fail closed')
    expect(recoveryHelper).toContain('legal long directory name containing a tilde')
    expect(recoveryHelper).toContain('extended volume alias did not fail closed')
    expect(recoveryHelper).toContain('SUBST alias did not fail closed')
  })

  test('skips PowerShell only for a proven default per-user installation', () => {
    const installerHook = readFileSync('desktop/build/installer.nsh', 'utf8')
    const fastPathStart = installerHook.indexOf(
      'Function CcHahaCanSkipLegacyRecovery',
    )
    const recoveryCall = installerHook.indexOf(
      'UAC_AsUser_Call Function CcHahaRecoverLegacy',
    )

    expect(fastPathStart).toBeGreaterThan(-1)
    expect(fastPathStart).toBeLessThan(recoveryCall)
    expect(installerHook).toMatch(
      /Function CcHahaCanSkipLegacyRecovery[\s\S]*\$8 != "trusted-user"/,
    )
    expect(installerHook).toMatch(
      /StrCpy \$8 "trusted-user"[\s\S]*UAC_IsAdmin[\s\S]*StrCpy \$8 "untrusted-elevated"[\s\S]*UAC_IsInnerInstance[\s\S]*StrCpy \$8 "trusted-uac-outer"[\s\S]*Call CcHahaCanSkipLegacyRecovery/,
    )
    expect(installerHook).toContain(
      '$ccHahaPerUserInstallLocation == ""',
    )
    expect(installerHook).toContain(
      '$ccHahaPerMachineInstallLocation != ""',
    )
    expect(installerHook).toContain(
      '$ccHahaPerMachineUninstallString != ""',
    )
    expect(installerHook).toContain(
      'StrCmp $ccHahaPerUserInstallLocation $INSTDIR',
    )
    expect(installerHook).toContain('ReadEnvStr $R0 CLAUDE_CONFIG_DIR')
    expect(installerHook).toContain(
      'IfFileExists "$ccHahaPerUserInstallLocation\\CLAUDE_CONFIG_DIR\\*.*"',
    )
    // The fast path needs a default (or absent) app-mode.json in the current
    // userData folder and in both folder names builds before the rename used.
    const fastPath = installerHook.slice(fastPathStart, installerHook.indexOf('FunctionEnd', fastPathStart))
    for (const folder of ['${STAR_AGENT_USER_DATA_DIR_NAME}', 'claude-code-desktop', 'Claude Code Haha']) {
      expect(fastPath).toContain(`Push "$R1\\${folder}\\app-mode.json"\n  Call CcHahaModeFileIsDefault\n  Pop $R2\n  StrCmp $R2 "1" 0 cc_haha_skip_recovery_done`)
    }
    expect(installerHook).toContain('FileOpen $R2 "$R0" r')
    expect(installerHook).toContain('StrCmp $R3 \'  "mode": "default",$\\n\'')
    expect(installerHook).toContain('StrCmp $R3 \'  "portable_dir": null$\\n\'')
    expect(installerHook).toContain('FileClose $R2')
    expect(installerHook).toMatch(
      /Call CcHahaCanSkipLegacyRecovery[\s\S]*No legacy data candidates found for the registered per-user installation[\s\S]*UAC_AsUser_Call Function CcHahaRecoverLegacy/,
    )
  })

  test.skipIf(process.platform !== 'win32')('skips recovery only when every userData folder name holds default mode, in native NSIS', () => {
    const compiler = process.env.CC_HAHA_TEST_MAKENSIS ?? path.join(
      process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache', 'nsis',
      'nsis-3.0.4.1-nsis-3.0.4.1', 'Bin', 'makensis.exe',
    )
    const templates = process.env.CC_HAHA_TEST_NSIS_TEMPLATES
      ?? path.resolve('desktop/node_modules/app-builder-lib/templates/nsis')
    if (!existsSync(compiler) || !existsSync(path.join(templates, 'include/getProcessInfo.nsh'))) {
      throw new Error('Native NSIS regression requires electron-builder dependencies and its cached compiler, or CC_HAHA_TEST_MAKENSIS/CC_HAHA_TEST_NSIS_TEMPLATES')
    }
    const root = mkdtempSync(path.join(tmpdir(), 'cc-haha-nsis-mode-'))
    try {
      const env = createSandboxedTestEnvironment(path.join(root, 'home'))
      const installDir = path.join(root, 'install')
      mkdirSync(installDir, { recursive: true })
      const defaultMode = '{\n  "mode": "default",\n  "portable_dir": null\n}'
      const portableMode = '{\n  "mode": "portable",\n  "portable_dir": "D:\\\\data"\n}'
      const cases: Array<{ name: string, files: Record<string, string>, skip: string }> = [
        { name: 'fresh', files: {}, skip: '1' },
        { name: 'current-default', files: { 'STAR Agent': defaultMode }, skip: '1' },
        { name: 'all-default', files: { 'STAR Agent': defaultMode, 'claude-code-desktop': defaultMode, 'Claude Code Haha': defaultMode }, skip: '1' },
        { name: 'current-portable', files: { 'STAR Agent': portableMode }, skip: '0' },
        { name: 'package-name-portable', files: { 'claude-code-desktop': portableMode }, skip: '0' },
        { name: 'product-name-portable', files: { 'STAR Agent': defaultMode, 'Claude Code Haha': portableMode }, skip: '0' },
        { name: 'crlf-default', files: { 'claude-code-desktop': defaultMode.replace(/\n/g, '\r\n') }, skip: '0' },
      ]
      for (const fixture of cases) {
        for (const [folder, content] of Object.entries(fixture.files)) {
          mkdirSync(path.join(root, fixture.name, folder), { recursive: true })
          writeFileSync(path.join(root, fixture.name, folder, 'app-mode.json'), content)
        }
      }
      const journal = path.join(root, 'journal.log')
      const executable = path.join(root, 'mode-check.exe')
      const script = String.raw`
Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "Isolated installer mode-file regression"
OutFile "${executable}"
!addincludedir "${templates}\include"
!define APP_GUID "cc-haha-nsis-test-no-user-state"
!define UNINSTALL_APP_KEY "cc-haha-nsis-test-no-user-state"
!define APP_FILENAME "isolated-test"
!define PRODUCT_FILENAME "isolated-test"
!define BUILD_RESOURCES_DIR "${path.resolve('desktop/build')}"
!include "${path.resolve('desktop/build/installer.nsh')}"
Var journalHandle
Section
  System::Call 'kernel32::SetEnvironmentVariable(t "CLAUDE_CONFIG_DIR", p 0) i .r0'
  StrCpy $8 "trusted-user"
  StrCpy $INSTDIR "${installDir}"
  StrCpy $ccHahaPerUserInstallLocation "${installDir}"
  StrCpy $ccHahaPerMachineInstallLocation ""
  StrCpy $ccHahaPerMachineUninstallString ""
  FileOpen $journalHandle "${journal}" w
${cases.map(fixture => `  System::Call 'kernel32::SetEnvironmentVariable(t "APPDATA", t "${path.join(root, fixture.name)}") i .r0'
  Call CcHahaCanSkipLegacyRecovery
  Pop $1
  FileWrite $journalHandle "${fixture.name}=$1$\\n"`).join('\n')}
  FileClose $journalHandle
SectionEnd
`
      const source = path.join(root, 'mode-check.nsi')
      writeFileSync(source, script)
      const compile = spawnSync(compiler, ['/V2', source], { env, encoding: 'utf8', timeout: 15_000 })
      expect(compile.error, compile.stderr || compile.stdout).toBeUndefined()
      expect(compile.status, compile.stderr || compile.stdout).toBe(0)
      const run = spawnSync(executable, ['/S'], { env, timeout: 10_000, windowsHide: true })
      expect(run.error).toBeUndefined()
      expect(run.status).toBe(0)
      expect(readFileSync(journal, 'utf8').trim().split(/\r?\n/)).toEqual(
        cases.map(fixture => `${fixture.name}=${fixture.skip}`),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)

  test('reads the userData folder the upgraded app will use, under its current or former name', () => {
    const installerHook = readFileSync('desktop/build/installer.nsh', 'utf8')
    const recoveryHelper = readFileSync('desktop/build/recover-legacy-install-data.ps1', 'utf8')
    const installerSmoke = readFileSync('desktop/scripts/windows-installer-smoke.ps1', 'utf8')
    const desktopPackage = JSON.parse(readFileSync('desktop/package.json', 'utf8')) as { productName?: string }

    // Electron names userData after the top-level productName.
    expect(installerHook).toContain(`!define /ifndef STAR_AGENT_USER_DATA_DIR_NAME "${desktopPackage.productName}"`)
    expect(installerHook).toContain(
      '-UserDataDir "$2\\${STAR_AGENT_USER_DATA_DIR_NAME}" -RecoveryRoot "$3\\${STAR_AGENT_USER_DATA_DIR_NAME} Data\\Recovered" -ProcessName "${PRODUCT_FILENAME}.exe"',
    )
    expect(installerHook).not.toMatch(/DetailPrint[^\n]*Claude Code Haha/)
    expect(installerHook).not.toMatch(/MessageBox[^\n]*Claude Code Haha/)

    // Same folder names, same order, as electron/services/userDataLocation.ts.
    expect(recoveryHelper).toContain("[string[]]$LegacyUserDataDirNames = @('claude-code-desktop', 'Claude Code Haha')")
    expect(recoveryHelper).toContain("[string]$ProcessName = 'STAR Agent.exe'")
    expect(recoveryHelper).toContain("[string[]]$LegacyProcessNames = @('Claude Code Haha.exe')")
    expect(recoveryHelper).toMatch(/\$effectiveUserDataDir = Resolve-UserDataDir -UserDataDir \$UserDataDir -LegacyNames \$LegacyUserDataDirNames[\s\S]*-UserDataDir \$effectiveUserDataDir/)
    expect(recoveryHelper).toContain('the former product-name userData folder was not used before the app adopts it')
    expect(recoveryHelper).toContain('an empty current userData folder hid the package-name folder the app adopts first')

    expect(installerSmoke).toContain("(Join-Path $UserDataRoot 'STAR Agent')")
    expect(installerSmoke).toContain("$legacyUserData = Join-Path $legacyAppData 'claude-code-desktop'")
    expect(installerSmoke).toContain('Invoke-LegacyRecoveryDiagnostic -UserDataRoot $legacyAppData')
  })

  test('keeps no-CLR default and portable upgrade cases in Windows smoke', () => {
    const installerSmoke = readFileSync(
      'desktop/scripts/windows-installer-smoke.ps1',
      'utf8',
    )

    expect(installerSmoke).toContain("$env:COMPLUS_Version = 'v0.0.0-test-invalid-clr'")
    expect(installerSmoke).toContain('Test-IsProcessElevated')
    expect(installerSmoke).toContain('Elevated default-mode reinstall without CLR')
    expect(installerSmoke).toMatch(
      /Elevated default-mode reinstall without CLR' -ExpectedExitCode 20/,
    )
    expect(installerSmoke).toContain('Trusted-user default-mode reinstall without CLR')
    expect(installerSmoke).toContain('Portable reinstall without CLR')
    expect(installerSmoke).toMatch(
      /Portable reinstall without CLR' -ExpectedExitCode 20/,
    )
    expect(installerSmoke).toContain('Invoke-ProcessExpectFailure')
    expect(installerSmoke).toContain('must-survive-failed-upgrade')
  })
})
