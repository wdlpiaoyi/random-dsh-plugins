param(
  [Parameter(Mandatory = $true)][string]$PayloadPath
)

$ErrorActionPreference = 'Stop'

function Read-Payload([string]$path) {
  $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
  return $raw | ConvertFrom-Json
}

function Get-ForegroundProcessName() {
  try {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DshFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
}
'@
    $hwnd = [DshFg]::GetForegroundWindow()
    $procId = [uint32]0
    [void][DshFg]::GetWindowThreadProcessId($hwnd, [ref]$procId)
    if ($procId -eq 0) { return '' }
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($null -eq $proc) { return '' }
    return [string]$proc.ProcessName
  } catch {
    return ''
  }
}

function Ensure-Aumid([string]$aumid, [string]$appName, [string]$launchPath) {
  try {
    $root = 'HKCU:\Software\Classes\AppUserModelId'
    $key = Join-Path $root $aumid
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    if ($appName) { New-ItemProperty -Path $key -Name 'DisplayName' -Value $appName -PropertyType String -Force | Out-Null }
    # Used only to relaunch DSH when a click finds no window. Do not register
    # this as IconUri: the host executable carries DeepSeek branding.
    if ($launchPath) { New-ItemProperty -Path $key -Name 'LaunchPath' -Value $launchPath -PropertyType String -Force | Out-Null }
  } catch {
    # DisplayName is cosmetic; LaunchPath is a best-effort fallback.
  }
}

# Clicking the toast launches this protocol. The handler is a windowless
# wscript shim over focus.ps1. Deliberately never points at a compiled focus.exe:
# an unsigned executable triggers Windows' "unknown publisher" launch prompt on
# this machine, and the click would hang or be blocked.
function Ensure-Activator([string]$uri) {
  try {
    $scheme = ([Uri]$uri).Scheme
    if (-not $scheme) { return $false }
    $launcher = Join-Path $PSScriptRoot 'focus-launch.vbs'
    $focus = Join-Path $PSScriptRoot 'focus.ps1'
    if (-not ((Test-Path $launcher) -and (Test-Path $focus))) { return $false }
    $cmd = 'wscript.exe //nologo "' + $launcher + '" "%1"'

    $root = "HKCU:\Software\Classes\$scheme"
    if (-not (Test-Path $root)) { New-Item -Path $root -Force | Out-Null }
    $protocol = $null
    try { $protocol = (Get-ItemProperty -Path $root -Name 'URL Protocol' -ErrorAction Stop).'URL Protocol' } catch {}
    if ($null -eq $protocol -or [string]$protocol -ne '') {
      New-ItemProperty -Path $root -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
    }
    $cmdKey = Join-Path $root 'shell\open\command'
    if (-not (Test-Path $cmdKey)) { New-Item -Path $cmdKey -Force | Out-Null }
    # Register once, not on every toast: rewriting the key every time was
    # needless HKCU churn and made the leftover uninstall entry harder to spot.
    $current = $null
    try { $current = (Get-ItemProperty -Path $cmdKey -Name '(default)' -ErrorAction Stop).'(default)' } catch {}
    if ([string]$current -ne $cmd) {
      New-ItemProperty -Path $cmdKey -Name '(default)' -Value $cmd -PropertyType String -Force | Out-Null
    }
    return $true
  } catch {
    return $false
  }
}

function New-ToastXml([object]$payload) {
  $title = [string]$payload.title
  $body = [string]$payload.body
  $appName = if ($payload.appName) { [string]$payload.appName } else { 'DSH Win Toast' }
  $silent = [bool]$payload.silent
  $activateUri = if ($payload.activateUri) { [string]$payload.activateUri } else { '' }
  $duration = if ([string]$payload.duration -eq 'long') { 'long' } else { 'short' }

  $escape = [System.Security.SecurityElement]
  $bodyXml = if ($body) { '<text>' + $escape::Escape($body) + '</text>' } else { '' }
  # A non-silent toast deliberately omits <audio>: Windows then plays the
  # system notification sound the user configured for this app. An explicit
  # ms-winsoundevent:Notification.Default is the same sound, just harder to
  # override later, so there is no reason to duplicate it.
  $audioXml = if ($silent) { '<audio silent="true" />' } else { '' }

  # Protocol activation: a click anywhere on the toast runs focus.ps1, which
  # restores and focuses the DSH window and publishes the session id. Without a
  # registered handler the attribute is dropped so the toast still shows.
  $toastAttrs = ' duration="' + $duration + '"'
  if ($activateUri -and (Ensure-Activator $activateUri)) {
    $toastAttrs = ' activationType="protocol" launch="' + $escape::Escape($activateUri) + '"' + $toastAttrs
  }

  $xmlText = @"
<toast$toastAttrs>
  <visual>
    <binding template="ToastGeneric">
      <text>$($escape::Escape($title))</text>
      $bodyXml
      <text placement="attribution">$($escape::Escape($appName))</text>
    </binding>
  </visual>
  $audioXml
</toast>
"@
  return $xmlText
}

try {
  $payload = Read-Payload $PayloadPath
} catch {
  [Console]::Error.WriteLine("payload read failed: $($_.Exception.Message)")
  exit 1
}

if ($payload.skipWhenFocused) {
  $fg = Get-ForegroundProcessName
  $focused = @($payload.focusProcessNames) -contains $fg
  if ($focused) { exit 0 }
}

$title = [string]$payload.title
$body = [string]$payload.body
$appName = if ($payload.appName) { [string]$payload.appName } else { 'DSH Win Toast' }
$aumid = if ($payload.aumid) { [string]$payload.aumid } else { 'Dsh.WinToast' }
$appPath = if ($payload.appPath) { [string]$payload.appPath } else { '' }
$expireSeconds = 0
if ($null -ne $payload.expireSeconds) {
  $parsedExpire = 0
  if ([int]::TryParse([string]$payload.expireSeconds, [ref]$parsedExpire)) {
    if ($parsedExpire -gt 0) { $expireSeconds = $parsedExpire }
  }
}

Ensure-Aumid $aumid $appName $appPath

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

try {
  $xmlText = New-ToastXml $payload
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml($xmlText)
  $toast = New-Object Windows.UI.Notifications.ToastNotification $xml

  # No Tag/Group: this notification is independent from every other one. Windows
  # queues banners and keeps each entry in Action Center until it expires. This
  # is deliberately the simple, documented toast behavior; replacing the banner
  # on screen would require a resident process holding the previous object.
  if ($expireSeconds -gt 0) {
    $toast.ExpirationTime = [DateTimeOffset]::Now.AddSeconds($expireSeconds)
  }

  $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid)
  $notifier.Show($toast)
  exit 0
} catch {
  [Console]::Error.WriteLine("toast failed: $($_.Exception.Message)")
  exit 1
}
