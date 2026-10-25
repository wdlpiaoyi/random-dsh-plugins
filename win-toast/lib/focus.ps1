param([string]$Uri = '')

# Toast click handler: bring the DeepSeek Harness window back to the front and
# publish the session id carried by the activation URI. lib/client.js polls the
# Host route /win-toast/focus and opens that conversation.
#
# Launched by the dshfocus: protocol via wscript (windowless). The URI arrives
# in DSH_FOCUS_URI rather than on the command line, so characters such as
# $(...) are data, never PowerShell source.
$ErrorActionPreference = 'SilentlyContinue'
if (-not $Uri) { $Uri = [string]$env:DSH_FOCUS_URI }

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class DshFocus {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("kernel32.dll")] public static extern int GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra);

  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

  // First visible top-level window of `pid` whose title contains `hint`;
  // falls back to the first visible window of that process when no title
  // matches (or when hint is empty).
  public static IntPtr FindWindow(uint pid, string hint) {
    IntPtr found = IntPtr.Zero;
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      uint windowPid;
      GetWindowThreadProcessId(hWnd, out windowPid);
      if (windowPid != pid) return true;
      if (!IsWindowVisible(hWnd)) return true;
      int length = GetWindowTextLength(hWnd);
      if (length <= 0) return true;
      StringBuilder text = new StringBuilder(length + 1);
      GetWindowText(hWnd, text, text.Capacity);
      string title = text.ToString();
      if (hint != null && hint.Length > 0 && title.IndexOf(hint, StringComparison.OrdinalIgnoreCase) >= 0) {
        found = hWnd;
        return false;
      }
      if (found == IntPtr.Zero) found = hWnd;
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

$tempDir = $env:TEMP
if (-not $tempDir) { $tempDir = [System.IO.Path]::GetTempPath() }
$log = Join-Path $tempDir 'dsh-focus.log'

function Write-Log([string]$text) {
  try { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format 'HH:mm:ss.fff'), $text) -Encoding UTF8 } catch {}
}

function Get-QueryValue([string]$uri, [string]$name) {
  if (-not $uri) { return '' }
  try {
    $parsed = [Uri]$uri
    $query = $parsed.Query
    if (-not $query) { return '' }
    foreach ($pair in $query.TrimStart('?').Split('&')) {
      if (-not $pair) { continue }
      $kv = $pair.Split('=', 2)
      if ($kv.Length -eq 2 -and $kv[0] -eq $name) {
        # URLSearchParams writes spaces as '+'; .NET's UnescapeDataString does
        # not decode that form.
        return ([Uri]::UnescapeDataString($kv[1])).Replace('+', ' ')
      }
    }
  } catch {}
  return ''
}

$sessionId = Get-QueryValue $Uri 'session'
$pidHint = Get-QueryValue $Uri 'pid'
$titleHint = Get-QueryValue $Uri 'title'
$appHint = Get-QueryValue $Uri 'app'
if (-not $appHint) { $appHint = 'DeepSeek Harness' }
if ($titleHint.Length -gt 200) { $titleHint = $titleHint.Substring(0, 200) }

$targetPid = [uint32]0
if ($pidHint -match '^[0-9]{1,10}$') {
  $parsedPid = [uint32]0
  if ([uint32]::TryParse($pidHint, [ref]$parsedPid)) { $targetPid = $parsedPid }
}

# Per-Host request file: concurrent DSH instances each consume only their own
# click. A toast raised by an older build has no pid and keeps the shared name.
$requestFile = if ($targetPid -ne 0) {
  Join-Path $tempDir ("dsh-toast-focus-{0}.json" -f $targetPid)
} else {
  Join-Path $tempDir 'dsh-toast-focus.json'
}

# Publish atomically: rename a completed temp file over the request file, so a
# polling Host never reads a half-written JSON document.
function Publish-FocusRequest([string]$sessionId) {
  if (-not $sessionId) { return }
  try {
    $data = @{
      sessionId = $sessionId
      at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json -Compress
    $tmp = $requestFile + '.tmp'
    [System.IO.File]::WriteAllText($tmp, $data, (New-Object System.Text.UTF8Encoding -ArgumentList $false))
    Move-Item -LiteralPath $tmp -Destination $requestFile -Force
  } catch {}
}

function Find-DshWindow([uint32]$processId, [string]$hint, [string]$processName) {
  if ($processId -ne 0) {
    $direct = [DshFocus]::FindWindow($processId, $hint)
    if ($direct -ne [IntPtr]::Zero) { return $direct }
  }
  # The Host process can be a child with no window of its own; fall back to
  # every DSH process and use the title hint to pick the right window.
  $procs = @(Get-Process -Name $processName -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 })
  foreach ($p in $procs) {
    $found = [DshFocus]::FindWindow([uint32]$p.Id, $hint)
    if ($found -ne [IntPtr]::Zero) { return $found }
  }
  return [IntPtr]::Zero
}

function Get-LaunchPath {
  # The new AUMID stores the host executable under LaunchPath; IconUri is kept
  # as a fallback for registrations written by older builds.
  $candidates = @(
    @{ Path = 'HKCU:\Software\Classes\AppUserModelId\Dsh.WinToast'; Name = 'LaunchPath' },
    @{ Path = 'HKCU:\Software\Classes\AppUserModelId\Dsh.WinToast'; Name = 'IconUri' },
    @{ Path = 'HKCU:\Software\Classes\AppUserModelId\DeepSeek.Harness.Notify'; Name = 'IconUri' }
  )
  foreach ($candidate in $candidates) {
    try {
      $value = (Get-ItemProperty -Path $candidate.Path -Name $candidate.Name -ErrorAction Stop).($candidate.Name)
      if ($value -and (Test-Path -LiteralPath $value)) { return [string]$value }
    } catch {}
  }
  return ''
}

try {
  $hwnd = Find-DshWindow $targetPid $titleHint $appHint

  if ($hwnd -eq [IntPtr]::Zero) {
    Write-Log "no window found, launching app"
    $launchPath = Get-LaunchPath
    if ($launchPath) {
      Start-Process -FilePath $launchPath
      Publish-FocusRequest $sessionId
      exit 0
    }
    exit 1
  }

  if ([DshFocus]::GetForegroundWindow() -eq $hwnd) {
    Write-Log "already foreground"
    Publish-FocusRequest $sessionId
    exit 0
  }
  if ([DshFocus]::IsIconic($hwnd)) { [void][DshFocus]::ShowWindow($hwnd, 9) }

  # Windows rejects a background process stealing focus unless it looks like
  # the user acted: tap Alt, attach to the foreground thread, then set.
  [DshFocus]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
  $fg = [DshFocus]::GetForegroundWindow()
  $procId = [uint32]0
  $fgTid = [DshFocus]::GetWindowThreadProcessId($fg, [ref]$procId)
  $myTid = [uint32][DshFocus]::GetCurrentThreadId()
  $attached = $false
  if ($fgTid -ne 0 -and $fgTid -ne $myTid) { $attached = [DshFocus]::AttachThreadInput($myTid, $fgTid, $true) }
  [void][DshFocus]::BringWindowToTop($hwnd)
  $ok = [DshFocus]::SetForegroundWindow($hwnd)
  if ($attached) { [void][DshFocus]::AttachThreadInput($myTid, $fgTid, $false) }
  [DshFocus]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)

  # Verify; retry the plain call once if the attach route lost the race.
  Start-Sleep -Milliseconds 60
  if ([DshFocus]::GetForegroundWindow() -ne $hwnd) { [void][DshFocus]::SetForegroundWindow($hwnd) }
  $now = [DshFocus]::GetForegroundWindow() -eq $hwnd
  Write-Log ("uri={0} session={1} pid={2} hwnd={3} ok={4} attached={5} nowForeground={6}" -f $Uri, $sessionId, $targetPid, $hwnd, $ok, $attached, $now)
  Publish-FocusRequest $sessionId
  exit 0
} catch {
  Write-Log ("error: " + $_.Exception.Message)
  exit 1
}
