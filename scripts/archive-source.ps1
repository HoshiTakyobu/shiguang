param(
  [Parameter(Mandatory = $true)][string]$SourceDirectory,
  [Parameter(Mandatory = $true)][string]$DestinationPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
# Include hidden files and use ZIP's portable separators for Linux deployment.
$archive = [System.IO.Compression.ZipFile]::Open($DestinationPath, [System.IO.Compression.ZipArchiveMode]::Create)
function Add-SourceDirectory([string]$Directory, [string]$Prefix) {
  foreach ($sourceEntry in Get-ChildItem -LiteralPath $Directory -Force) {
    $entryName = $Prefix + $sourceEntry.Name
    if ($sourceEntry.PSIsContainer) {
      Add-SourceDirectory $sourceEntry.FullName ($entryName + '/')
    } else {
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $archive, $sourceEntry.FullName, $entryName,
        [System.IO.Compression.CompressionLevel]::Optimal
      ) | Out-Null
    }
  }
}
try { Add-SourceDirectory $SourceDirectory '' }
finally { $archive.Dispose() }
