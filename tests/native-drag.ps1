param([int]$StartX, [int]$StartY, [int]$EndX, [int]$EndY)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShiguangPointer {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@

$original = New-Object ShiguangPointer+Point
[ShiguangPointer]::GetCursorPos([ref]$original) | Out-Null
try {
    [ShiguangPointer]::SetCursorPos($StartX, $StartY) | Out-Null
    Start-Sleep -Milliseconds 200
    [ShiguangPointer]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 80
    for ($step = 1; $step -le 10; $step++) {
        [ShiguangPointer]::SetCursorPos([int]($StartX + ($EndX - $StartX) * $step / 10), [int]($StartY + ($EndY - $StartY) * $step / 10)) | Out-Null
        Start-Sleep -Milliseconds 25
    }
    [ShiguangPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 100
} finally {
    [ShiguangPointer]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
    [ShiguangPointer]::SetCursorPos($original.X, $original.Y) | Out-Null
}
