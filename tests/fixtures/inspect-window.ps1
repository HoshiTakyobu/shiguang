param(
  [Parameter(Mandatory = $true)][uint32]$ExpectedProcessId,
  [long]$WindowHandle = 0,
  [string]$ButtonText = '',
  [string]$Screenshot = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -ReferencedAssemblies System.Drawing @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Drawing;
using System.Drawing.Imaging;
public static class ShiguangWindowTest {
  public delegate bool Callback(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumWindows(Callback callback, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, Callback callback, IntPtr data);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder text, int max);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] public static extern uint GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window, int id);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  public struct Rect { public int left, top, right, bottom; }
  public static string Text(IntPtr window) { var text = new StringBuilder(4096); GetWindowText(window, text, text.Capacity); return text.ToString(); }
  public static string Class(IntPtr window) { var text = new StringBuilder(256); GetClassName(window, text, text.Capacity); return text.ToString(); }
  public static IntPtr[] Owned(uint pid) {
    var result = new List<IntPtr>();
    EnumWindows((window, _) => { uint owner; GetWindowThreadProcessId(window, out owner); if (owner == pid && IsWindowVisible(window)) result.Add(window); return true; }, IntPtr.Zero);
    return result.ToArray();
  }
  public static IntPtr[] Children(IntPtr parent) {
    var result = new List<IntPtr>();
    EnumChildWindows(parent, (window, _) => { result.Add(window); return true; }, IntPtr.Zero);
    return result.ToArray();
  }
  public static void Capture(IntPtr window, string file) {
    Rect rect; GetWindowRect(window, out rect);
    using (var bitmap = new Bitmap(rect.right - rect.left, rect.bottom - rect.top)) {
      using (var graphics = Graphics.FromImage(bitmap)) {
        var dc = graphics.GetHdc(); try { PrintWindow(window, dc, 2); } finally { graphics.ReleaseHdc(dc); }
      }
      bitmap.Save(file, ImageFormat.Png);
    }
  }
}
'@
[IntPtr]$shiguangWindow = [IntPtr]::new($WindowHandle)
if ($WindowHandle -eq 0) {
  $shiguangDeadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    $shiguangDialogs = @([ShiguangWindowTest]::Owned($ExpectedProcessId) | Where-Object { [ShiguangWindowTest]::Class($_) -eq '#32770' })
    if ($shiguangDialogs.Count -gt 0) { $shiguangWindow = $shiguangDialogs[0]; break }
    Start-Sleep -Milliseconds 100
  } while ([DateTime]::UtcNow -lt $shiguangDeadline)
}
[uint32]$shiguangOwner = 0
[void][ShiguangWindowTest]::GetWindowThreadProcessId($shiguangWindow, [ref]$shiguangOwner)
if ($shiguangWindow -eq [IntPtr]::Zero -or $shiguangOwner -ne $ExpectedProcessId) { throw 'Window does not belong to the isolated test process.' }
$shiguangChildren = @([ShiguangWindowTest]::Children($shiguangWindow))
$shiguangDefault = [ShiguangWindowTest]::SendMessage($shiguangWindow, 0x0400, [IntPtr]::Zero, [IntPtr]::Zero).ToInt64() -band 0xffff
$shiguangDefaultText = [ShiguangWindowTest]::Text([ShiguangWindowTest]::GetDlgItem($shiguangWindow, $shiguangDefault))
# TaskDialog's nested buttons need not respond to the classic DM_GETDEFID.
# BS_DEFPUSHBUTTON identifies the default button on these native dialogs.
if (-not $shiguangDefaultText) {
  $shiguangDefaultButton = @($shiguangChildren | Where-Object { [ShiguangWindowTest]::Class($_) -eq 'Button' -and ([ShiguangWindowTest]::GetWindowLong($_, -16) -band 0xf) -eq 1 })
  if ($shiguangDefaultButton.Count -eq 1) { $shiguangDefaultText = [ShiguangWindowTest]::Text($shiguangDefaultButton[0]) }
}
$shiguangInfo = @{
  title = [ShiguangWindowTest]::Text($shiguangWindow)
  class = [ShiguangWindowTest]::Class($shiguangWindow)
  exStyle = [ShiguangWindowTest]::GetWindowLong($shiguangWindow, -20)
  children = @($shiguangChildren | ForEach-Object { [ShiguangWindowTest]::Text($_) })
  defaultText = $shiguangDefaultText
}
if ($Screenshot) { [ShiguangWindowTest]::Capture($shiguangWindow, $Screenshot) }
if ($ButtonText) {
  $shiguangButton = @($shiguangChildren | Where-Object { [ShiguangWindowTest]::Text($_).Replace('&', '') -eq $ButtonText -and [ShiguangWindowTest]::Class($_) -eq 'Button' })
  if ($shiguangButton.Count -ne 1) {
    [void][ShiguangWindowTest]::PostMessage($shiguangWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
    throw ('Expected one matching button. Found: ' + ($shiguangInfo.children -join ', '))
  }
  [void][ShiguangWindowTest]::PostMessage($shiguangButton[0], 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
}
$shiguangInfo | ConvertTo-Json -Compress
