[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$BuilderArgs
)

# Windows x64 installer. Kept for existing callers; the build itself, for
# either chip, is ./build-windows.ps1 (-Arch x64 | arm64).
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build-windows.ps1') -Arch x64 @BuilderArgs
exit $LASTEXITCODE
