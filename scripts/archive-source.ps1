param(
  [Parameter(Mandatory = $true)][string]$SourceDirectory,
  [Parameter(Mandatory = $true)][string]$DestinationPath
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
# ZipFile includes hidden directories such as .github and .gitignore.
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $SourceDirectory, $DestinationPath,
  [System.IO.Compression.CompressionLevel]::Optimal, $false
)
