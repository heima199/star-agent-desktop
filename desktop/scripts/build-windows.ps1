[CmdletBinding()]
param(
  # The chip the installer is for: x64 (Intel / AMD) or arm64 (Snapdragon and
  # other Windows-on-ARM machines). Either can be built on an x64 machine.
  [ValidateSet('x64', 'arm64')]
  [string]$Arch = 'x64',
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$BuilderArgs
)

# Builds the PRIVO STAR WORK NSIS installer for one Windows chip:
#   powershell -File ./scripts/build-windows.ps1 -Arch x64
#   powershell -File ./scripts/build-windows.ps1 -Arch arm64
# Output: desktop/build-artifacts/windows-<arch>/PRIVO-STAR-WORK-<version>-win-<arch>.exe
#
# Environment:
#   SKIP_INSTALL=1        Skip root/desktop dependency installation.
#   REBUILD_NATIVE=1      Rebuild Electron native dependencies before packaging
#                         (the only step that needs the Visual Studio C++ tools).
#   SKIP_PACKAGE_SMOKE=1  Skip static package-smoke verification after copying artifacts.
#
# The STAR Code IDE in build-resources/star-code is shipped as staged
# (`bun run stage:star-code`). A Windows STAR Code build is x64; Windows 11 on
# ARM runs it translated.

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktopDir = (Resolve-Path (Join-Path $scriptDir '..')).Path
$repoRoot = (Resolve-Path (Join-Path $desktopDir '..')).Path

$targetTriple = if ($Arch -eq 'arm64') { 'aarch64-pc-windows-msvc' } else { 'x86_64-pc-windows-msvc' }
$hostArch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }
$crossBuild = $Arch -ne $hostArch
$canonicalOutputDir = Join-Path $desktopDir "build-artifacts\windows-$Arch"
$electronOutputDir = Join-Path $desktopDir 'build-artifacts\electron'
$unpackedDirName = if ($Arch -eq 'arm64') { 'win-arm64-unpacked' } else { 'win-unpacked' }
$binariesDir = Join-Path $desktopDir 'src-tauri\binaries'
$step = "build-windows-$Arch"

function Write-Step {
  param([string]$Message)
  Write-Host "[$step] $Message"
}

function Assert-WindowsHost {
  if ($env:OS -ne 'Windows_NT') {
    throw "[$step] This script must run on Windows."
  }
}

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "[$step] Missing required command: $Name"
  }
}

function Invoke-Checked {
  param([string]$What, [scriptblock]$Command)
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "[$step] $What failed (exit $LASTEXITCODE)"
  }
}

# Returns $true when the MSVC environment was imported. Packaging itself needs
# no compiler: the sidecar is compiled by Bun and node-pty ships prebuilds for
# both chips. Only REBUILD_NATIVE=1 compiles native modules.
function Import-VsDevEnvironment {
  param([bool]$Required)
  $vswhere = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
  $installationPath = $null
  if (Test-Path $vswhere) {
    $installationPath = & $vswhere `
      -products * `
      -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
      -property installationPath |
      Select-Object -First 1
  }
  if (-not $installationPath) {
    if ($Required) {
      throw "[$step] REBUILD_NATIVE=1 needs Visual Studio 2022 Build Tools with the Desktop development with C++ workload."
    }
    Write-Step 'Visual C++ build tools not found; continuing (only REBUILD_NATIVE=1 needs them).'
    return $false
  }

  $vsDevCmd = Join-Path $installationPath 'Common7\Tools\VsDevCmd.bat'
  if (-not (Test-Path $vsDevCmd)) {
    if ($Required) { throw "[$step] Could not find VsDevCmd.bat under $installationPath" }
    Write-Step "VsDevCmd.bat not found under $installationPath; continuing without it."
    return $false
  }

  Write-Step "Importing MSVC environment from $vsDevCmd"
  $env:VSCMD_SKIP_SENDTELEMETRY = '1'
  $vsArch = if ($Arch -eq 'arm64') { 'arm64' } else { 'x64' }
  $envDump = & cmd.exe /d /s /c "`"$vsDevCmd`" -arch=$vsArch -host_arch=x64 >nul && set"
  if ($LASTEXITCODE -ne 0) {
    throw "[$step] Failed to initialize Visual Studio build environment (exit $LASTEXITCODE)"
  }

  foreach ($line in $envDump) {
    if ($line -match '^(.*?)=(.*)$') {
      [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
  }
  return $true
}

function Clear-Directory {
  param([string]$Path)
  if (Test-Path $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Test-RipgrepManifest {
  param([string]$Triple)
  $manifest = Join-Path $binariesDir 'ripgrep-manifest.json'
  if (-not (Test-Path -LiteralPath $manifest) -or -not (Test-Path -LiteralPath (Join-Path $binariesDir 'rg.exe'))) { return $false }
  try {
    return ((Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json).targetTriple -eq $Triple)
  } catch {
    return $false
  }
}

Assert-WindowsHost
Assert-Command bun
Assert-Command bunx
[void](Import-VsDevEnvironment -Required ($env:REBUILD_NATIVE -eq '1'))
Write-Step "Target: $targetTriple (host: $hostArch)"

if ($env:SKIP_INSTALL -ne '1') {
  Write-Step 'Installing root dependencies...'
  Push-Location $repoRoot
  try {
    Invoke-Checked 'bun install in repo root' { & bun install }
  } finally {
    Pop-Location
  }

  # --cpu="*": the native addons of both chips (sharp, ngrok); an arm64
  # installer is built on an x64 machine, where a host-only install skips them.
  Write-Step 'Installing desktop dependencies (native addons for every chip)...'
  Push-Location $desktopDir
  try {
    Invoke-Checked 'bun install in desktop' { & bun install --cpu="*" }
  } finally {
    Pop-Location
  }
}

# A cross-chip build replaces the host's sidecar and ripgrep in
# src-tauri/binaries, which the development app runs. Keep them and put them
# back afterwards.
$hostBinariesBackup = $null
if ($crossBuild) {
  $hostBinariesBackup = Join-Path ([IO.Path]::GetTempPath()) ("star-host-binaries-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $hostBinariesBackup | Out-Null
  Get-ChildItem -Path $binariesDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'claude-sidecar-*' -or $_.Name -eq 'rg.exe' -or $_.Name -eq 'ripgrep-manifest.json' } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $hostBinariesBackup -Force }
  Write-Step "Saved the host binaries to $hostBinariesBackup"
}

try {
  Write-Step 'Cleaning stale Electron outputs...'
  Remove-Item -LiteralPath (Join-Path $desktopDir 'dist') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $desktopDir 'electron-dist') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $electronOutputDir -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path (Join-Path $binariesDir 'claude-sidecar-*') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $desktopDir 'tsconfig.tsbuildinfo') -Force -ErrorAction SilentlyContinue

  Push-Location $desktopDir
  try {
    $env:SIDECAR_TARGET_TRIPLE = $targetTriple
    if (-not (Test-RipgrepManifest -Triple $targetTriple)) {
      Write-Step "Fetching ripgrep for $targetTriple..."
      Invoke-Checked 'prepare:ripgrep' { & bun run prepare:ripgrep }
    }

    Write-Step "Building sidecars for $targetTriple..."
    Invoke-Checked 'build:sidecars' { & bun run build:sidecars }

    Write-Step 'Building renderer and Electron main/preload bundles...'
    Invoke-Checked 'renderer build' { & bun run build }
    Invoke-Checked 'Electron build' { & bun run build:electron }

    if ($env:REBUILD_NATIVE -eq '1') {
      Write-Step 'Rebuilding native dependencies for Electron ABI...'
      Invoke-Checked 'electron-builder install-app-deps' { & bunx electron-builder install-app-deps --arch $Arch }
      Invoke-Checked 'prepare:node-pty' { & bun run prepare:node-pty }
    }

    # run-electron-builder.ts adds the STAR update feed when STAR_UPDATE_URL is set.
    $builderCommand = @('run', './scripts/run-electron-builder.ts', '--win', 'nsis', "--$Arch", '--publish', 'never')
    $remainingArgs = @($BuilderArgs)
    if ($remainingArgs.Count -gt 0) {
      $builderCommand += $remainingArgs
    }

    # `bun install --cpu="*"` puts the sharp and ngrok addons of every chip in
    # node_modules, and electron-builder ships whatever is there. The other
    # chips' copies wait outside node_modules while this installer is packed.
    $parkedNatives = Join-Path ([IO.Path]::GetTempPath()) ("star-natives-" + [guid]::NewGuid().ToString('N'))
    $parked = @()
    foreach ($chip in @('x64', 'arm64', 'ia32') | Where-Object { $_ -ne $Arch }) {
      foreach ($relative in @("@img\sharp-win32-$chip", "@ngrok\ngrok-win32-$chip-msvc")) {
        $installed = Join-Path $desktopDir "node_modules\$relative"
        if (-not (Test-Path -LiteralPath $installed)) { continue }
        $parking = Join-Path $parkedNatives $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $parking) | Out-Null
        Move-Item -LiteralPath $installed -Destination $parking
        $parked += $relative
      }
    }
    if ($parked.Count -gt 0) { Write-Step "Leaving out of this installer: $($parked -join ', ')" }

    Write-Step 'Packaging Electron app...'
    try {
      Invoke-Checked 'electron-builder' { & bun @builderCommand }
    } finally {
      foreach ($relative in $parked) {
        Move-Item -LiteralPath (Join-Path $parkedNatives $relative) -Destination (Join-Path $desktopDir "node_modules\$relative")
      }
      Remove-Item -LiteralPath $parkedNatives -Recurse -Force -ErrorAction SilentlyContinue
    }
  } finally {
    Pop-Location
  }

  Clear-Directory -Path $canonicalOutputDir

  Get-ChildItem -Path $electronOutputDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '\.(exe|blockmap|yml)$' } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $canonicalOutputDir $_.Name) -Force }

  $winUnpackedDir = Join-Path $electronOutputDir $unpackedDirName
  if (Test-Path $winUnpackedDir) {
    Copy-Item -LiteralPath $winUnpackedDir -Destination (Join-Path $canonicalOutputDir $unpackedDirName) -Recurse -Force
  } else {
    Write-Step "Warning: $unpackedDirName was not found under $electronOutputDir; package-smoke will fail if it is required."
  }

  Set-Content -Path (Join-Path $canonicalOutputDir 'BUILD_INFO.txt') -Value @"
Target triple: $targetTriple
Builder output: $electronOutputDir
Canonical output: $canonicalOutputDir
Built at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')
"@ -Encoding UTF8
} finally {
  if ($hostBinariesBackup) {
    Remove-Item -Path (Join-Path $binariesDir 'claude-sidecar-*') -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $hostBinariesBackup -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $binariesDir -Force }
    Remove-Item -LiteralPath $hostBinariesBackup -Recurse -Force -ErrorAction SilentlyContinue
    Write-Step 'Put the host sidecar and ripgrep back in src-tauri/binaries.'
  }
}

if ($env:SKIP_PACKAGE_SMOKE -eq '1') {
  Write-Step 'Skipping package-smoke because SKIP_PACKAGE_SMOKE=1.'
} else {
  Write-Step 'Running package-smoke against canonical Windows artifacts...'
  Push-Location $repoRoot
  try {
    Invoke-Checked 'package-smoke' { & bun run test:package-smoke --platform windows --arch $Arch --package-kind release --artifacts-dir "desktop/build-artifacts/windows-$Arch" }
  } finally {
    Pop-Location
  }
}

Write-Step 'Build finished.'
Write-Step "Canonical output: $canonicalOutputDir"
