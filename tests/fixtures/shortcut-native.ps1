param(
  [Parameter(Mandatory = $true)][ValidateSet('press', 'hold')][string]$Action,
  [Parameter(Mandatory = $true)][ValidateRange(112, 135)][int]$VirtualKey,
  [uint32]$ExpectedProcessId = 0,
  [string]$ReadyFile = ''
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ShiguangShortcutTest {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
  [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr window, int id);
}
'@
if ($Action -eq 'hold') {
  if (-not [ShiguangShortcutTest]::RegisterHotKey([IntPtr]::Zero, 1, 7, $VirtualKey)) { throw 'Test conflict key unavailable.' }
  try {
    [IO.File]::WriteAllText($ReadyFile, 'ready')
    [void][Console]::ReadLine()
  } finally { [void][ShiguangShortcutTest]::UnregisterHotKey([IntPtr]::Zero, 1) }
  exit
}
[uint32]$shiguangForegroundOwner = 0
[void][ShiguangShortcutTest]::GetWindowThreadProcessId([ShiguangShortcutTest]::GetForegroundWindow(), [ref]$shiguangForegroundOwner)
if ($ExpectedProcessId -eq 0 -or $shiguangForegroundOwner -ne $ExpectedProcessId) { throw 'Only an isolated test window may receive test keyboard input.' }
foreach ($shiguangModifier in @(16, 17, 18, 91, 92)) {
  if ([ShiguangShortcutTest]::GetAsyncKeyState($shiguangModifier) -lt 0) { throw 'A physical modifier key is held; test input was not sent.' }
}
try {
  foreach ($shiguangKey in @(17, 18, 16, $VirtualKey)) { [ShiguangShortcutTest]::keybd_event($shiguangKey, 0, 0, [UIntPtr]::Zero) }
} finally {
  foreach ($shiguangKey in @($VirtualKey, 16, 18, 17)) { [ShiguangShortcutTest]::keybd_event($shiguangKey, 0, 2, [UIntPtr]::Zero) }
}
