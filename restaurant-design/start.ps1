param(
  [string]$Workspace = '',
  [ValidateRange(0, 65535)][int]$Port = 0
)

$ErrorActionPreference = 'Stop'
$restaurantRepository = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($Workspace)) {
  $Workspace = Join-Path $restaurantRepository '.artifacts\restaurant-design'
}
$restaurantWorkspace = [System.IO.Path]::GetFullPath($Workspace)
$restaurantPatch = Join-Path $restaurantWorkspace 'cordis.yml'
if (-not (Test-Path -LiteralPath $restaurantPatch)) {
  throw 'Prepare the restaurant workspace with restaurant-design/setup.ts first.'
}
$restaurantArguments = @('--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'web', '--patch', $restaurantPatch)
foreach ($restaurantExtraPatch in @('shared-model.patch.yml', 'browser.patch.yml')) {
  $restaurantExtraPath = Join-Path $restaurantWorkspace $restaurantExtraPatch
  if (Test-Path -LiteralPath $restaurantExtraPath) {
    $restaurantArguments += @('--patch', $restaurantExtraPath)
  }
}
$restaurantArguments += @('--', '--no-open', '--port', [string]$Port)
$restaurantOldDshHome = $env:DSH_HOME
$restaurantOldAgentsHome = $env:DSH_AGENTS_HOME
Push-Location -LiteralPath $restaurantRepository
try {
  $env:DSH_HOME = Join-Path $restaurantWorkspace 'home'
  $env:DSH_AGENTS_HOME = Join-Path $restaurantWorkspace 'agents'
  & node @restaurantArguments
  if ($LASTEXITCODE -ne 0) { throw "Restaurant Harness exited with status $LASTEXITCODE" }
}
finally {
  $env:DSH_HOME = $restaurantOldDshHome
  $env:DSH_AGENTS_HOME = $restaurantOldAgentsHome
  Pop-Location
}
