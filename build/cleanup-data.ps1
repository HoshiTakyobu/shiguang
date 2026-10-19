param([Parameter(Mandatory = $true)][string]$AppDataDirectory)
$ErrorActionPreference = 'Stop'
$shiguangFolderName = [string][char]0x62fe + [char]0x5149
$shiguangExpected = [IO.Path]::GetFullPath((Join-Path $env:APPDATA $shiguangFolderName)).TrimEnd('\')
$shiguangRoot = [IO.Path]::GetFullPath($AppDataDirectory).TrimEnd('\')
if (-not [string]::Equals($shiguangRoot, $shiguangExpected, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected Shiguang data directory.' }
if (-not (Test-Path -LiteralPath $shiguangRoot)) { exit 0 }
if ((Get-Item -LiteralPath $shiguangRoot -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing to follow a redirected data root.' }

# Resolve the current data location before deleting preferences. Never remove a
# custom folder itself: it may also contain the user's unrelated documents.
$shiguangCustom = $null
foreach ($shiguangSettingsName in @('settings.json', 'settings.json.bak')) {
  try {
    $shiguangSettings = Get-Content -LiteralPath (Join-Path $shiguangRoot $shiguangSettingsName) -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($shiguangSettings.version -eq 1 -and [IO.Path]::IsPathRooted($shiguangSettings.dataDirectory)) {
      $shiguangCustom = [IO.Path]::GetFullPath($shiguangSettings.dataDirectory).TrimEnd('\')
      break
    }
  } catch { }
}
if ($shiguangCustom -and -not [string]::Equals($shiguangCustom, $shiguangRoot, [StringComparison]::OrdinalIgnoreCase)) {
  foreach ($shiguangRecordName in @('worklog.json', 'worklog.json.bak', 'worklog.json.tmp')) {
    $shiguangRecord = Join-Path $shiguangCustom $shiguangRecordName
    if (Test-Path -LiteralPath $shiguangRecord -PathType Leaf) { Remove-Item -LiteralPath $shiguangRecord -Force }
  }
}

function Remove-ShiguangDataTree([string]$shiguangTarget) {
  $shiguangAbsolute = [IO.Path]::GetFullPath($shiguangTarget)
  if (-not [string]::Equals($shiguangAbsolute, $shiguangRoot, [StringComparison]::OrdinalIgnoreCase) -and -not $shiguangAbsolute.StartsWith($shiguangRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup target escaped the data directory.' }
  $shiguangItem = Get-Item -LiteralPath $shiguangAbsolute -Force
  if ($shiguangItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    # Delete the link itself without traversing its target.
    $shiguangItem.Delete()
  } elseif ($shiguangItem.PSIsContainer) {
    foreach ($shiguangChild in Get-ChildItem -LiteralPath $shiguangAbsolute -Force) { Remove-ShiguangDataTree $shiguangChild.FullName }
    Remove-Item -LiteralPath $shiguangAbsolute -Force
  } else { Remove-Item -LiteralPath $shiguangAbsolute -Force }
}
Remove-ShiguangDataTree $shiguangRoot
