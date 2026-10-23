param(
  [Parameter(Mandatory = $true)][long]$WindowHandle,
  [Parameter(Mandatory = $true)][uint32]$ExpectedProcessId,
  [Parameter(Mandatory = $true)][ValidateSet('query', 'end')][string]$Notification
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ShiguangSessionTest {
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
# Only the explicitly identified isolated test window can receive this message.
# This never broadcasts to other applications or requests an OS shutdown.
if ($WindowHandle -le 0) { throw 'A specific test window is required.' }
[uint32]$shiguangOwner = 0
[void][ShiguangSessionTest]::GetWindowThreadProcessId([IntPtr]$WindowHandle, [ref]$shiguangOwner)
if ($shiguangOwner -ne $ExpectedProcessId) { throw 'Window does not belong to the isolated test process.' }
[uint32]$shiguangMessage = if ($Notification -eq 'query') { 0x0011 } else { 0x0016 }
[UIntPtr]$shiguangResult = [UIntPtr]::Zero
[void][ShiguangSessionTest]::SendMessageTimeout([IntPtr]$WindowHandle, $shiguangMessage, [UIntPtr]::new([uint32]1), [IntPtr]::Zero, 2, 10000, [ref]$shiguangResult)
