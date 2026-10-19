$ErrorActionPreference = 'Stop'
$shiguangMutex = $null
$shiguangOwned = $false
try {
  $shiguangMutex = [System.Threading.Mutex]::new($false, $env:SHIGUANG_MUTEX_NAME)
  try { $shiguangOwned = $shiguangMutex.WaitOne(0) }
  catch [System.Threading.AbandonedMutexException] { $shiguangOwned = $true }
  if (-not $shiguangOwned) { [Console]::WriteLine('busy'); exit 0 }
  [Console]::WriteLine('acquired')
  [Console]::Out.Flush()
  # The parent owns this pipe. EOF also releases the mutex after a crash.
  [Console]::ReadLine() | Out-Null
} catch [System.UnauthorizedAccessException] {
  # Another Windows account owns the machine-wide instance.
  [Console]::WriteLine('busy')
} catch {
  [Console]::WriteLine('error')
  exit 1
} finally {
  if ($shiguangOwned) { $shiguangMutex.ReleaseMutex() }
  if ($null -ne $shiguangMutex) { $shiguangMutex.Dispose() }
}
