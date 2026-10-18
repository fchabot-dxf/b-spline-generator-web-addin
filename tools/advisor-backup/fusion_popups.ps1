# Clears Fusion's launch-time modals for a given Fusion pid, each only after verifying it (feedback_bridge_popup_self_ok):
#  1. "Fusion is already open" (734x376)  -> click Launch (fixed offset 424,316 inside the verified rect)
#  2. "FusionMCPBridge"                    -> Enter (= OK)
#  3. Recovered Documents (title Fusion360, 870x630) -> Escape (= Close, never Delete)
# Usage: powershell -File fusion_popups.ps1 [-TimeoutSec 600]
param([int]$TimeoutSec = 600)
Add-Type @'
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class FP { public delegate bool P(IntPtr h, IntPtr l);
[DllImport("user32.dll")] static extern bool EnumWindows(P p, IntPtr l);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
[DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, IntPtr e);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint f, IntPtr e);
public static List<IntPtr> All(){ var r=new List<IntPtr>(); EnumWindows((h,l)=>{ if(IsWindowVisible(h)) r.Add(h); return true;},IntPtr.Zero); return r;}
public static string T(IntPtr h){var t=new StringBuilder(256);GetWindowText(h,t,256);return t.ToString();} }
'@
[FP]::SetProcessDPIAware() | Out-Null
function Info($h) { $p=0; [FP]::GetWindowThreadProcessId($h,[ref]$p)|Out-Null; $r=New-Object FP+RECT; [FP]::GetWindowRect($h,[ref]$r)|Out-Null
  [pscustomobject]@{H=$h; Pid=$p; Title=[FP]::T($h); L=$r.L; T=$r.T; W=$r.R-$r.L; Hh=$r.B-$r.T; Name=(Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName} }
function Front($h) { [FP]::keybd_event(0x12,0,0,[IntPtr]::Zero); [FP]::keybd_event(0x12,0,2,[IntPtr]::Zero); [FP]::SetForegroundWindow($h)|Out-Null; Start-Sleep -Milliseconds 500; return ([FP]::GetForegroundWindow() -eq $h) }
function Key($vk) { [FP]::keybd_event($vk,0,0,[IntPtr]::Zero); [FP]::keybd_event($vk,0,2,[IntPtr]::Zero) }
$done = @{launch=$false; bridge=$false; recovered=$false}; $t0 = Get-Date
while (((Get-Date) - $t0).TotalSeconds -lt $TimeoutSec) {
  foreach ($w in ([FP]::All() | ForEach-Object { Info $_ } | Where-Object { $_.Name -eq 'Fusion360' })) {
    if ($w.Title -eq 'Fusion is already open' -and $w.W -eq 734 -and $w.Hh -eq 376) {
      if (Front $w.H) { [FP]::SetCursorPos($w.L+424,$w.T+316)|Out-Null; [FP]::mouse_event(2,0,0,0,[IntPtr]::Zero); [FP]::mouse_event(4,0,0,0,[IntPtr]::Zero); "launch: clicked Launch (pid $($w.Pid))"; $done.launch=$true; Start-Sleep 3 } }
    elseif ($w.Title -eq 'FusionMCPBridge') {
      if (Front $w.H) { Key 0x0D; Start-Sleep 2; "bridge: Enter (pid $($w.Pid)) gone=$(-not [FP]::IsWindow($w.H))"; $done.bridge=$true } }
    elseif ($w.Title -eq 'Fusion360' -and $w.W -eq 870 -and $w.Hh -eq 630) {
      if (Front $w.H) { Key 0x1B; Start-Sleep 2; "recovered: Escape (pid $($w.Pid)) gone=$(-not [FP]::IsWindowVisible($w.H))"; $done.recovered=$true } }
  }
  if ($done.bridge -and $done.recovered) { "ALL_CLEAR"; exit 0 }
  $main = Get-Process -Name Fusion360 -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'Untitled|Home' }
  if ($done.bridge -and $main -and ((Get-Date) - $t0).TotalSeconds -gt 300) { "CLEAR (no recovered-docs dialog after 5 min)"; exit 0 }
  Start-Sleep -Seconds 5 }
"TIMEOUT: launch=$($done.launch) bridge=$($done.bridge) recovered=$($done.recovered)"; exit 1
