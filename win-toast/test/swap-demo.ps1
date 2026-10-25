$ErrorActionPreference = "Stop"
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null

$appId = "Dsh.WinToast"
$group = "swap-demo"
$run = Get-Date -Format "HHmmss"
$tagA = "swap-a-$run"
$tagB = "swap-b-$run"
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)

function New-TestToast([string]$title, [string]$body, [string]$tag, [string]$group) {
    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $escapedTitle = [System.Security.SecurityElement]::Escape($title)
    $escapedBody = [System.Security.SecurityElement]::Escape($body)
    $xml.LoadXml("<toast duration=`"long`"><visual><binding template=`"ToastGeneric`"><text>$escapedTitle</text><text>$escapedBody</text></binding></visual></toast>")
    $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
    $toast.Tag = $tag
    $toast.Group = $group
    $toast.ExpirationTime = [DateTimeOffset]::Now.AddSeconds(300)
    return $toast
}

$toastA = New-TestToast "SWAP A" "A is visible. It should disappear after 4 seconds, then B appears." $tagA $group
$notifier.Show($toastA)
Write-Output ("SHOW_A tag=" + $tagA)

Start-Sleep -Seconds 4

try {
    $notifier.Hide($toastA)
    Write-Output "HID_A"
} catch {
    Write-Output ("HIDE_A_FAIL " + $_.Exception.Message)
}

$restored = New-TestToast "SWAP A" "A is visible. It should disappear after 4 seconds, then B appears." $tagA $group
$restored.SuppressPopup = $true
$notifier.Show($restored)
Write-Output ("READD_A_SILENT tag=" + $tagA)

Start-Sleep -Milliseconds 300

$toastB = New-TestToast "SWAP B" "B is visible. Old A should remain in Notification Center." $tagB $group
$notifier.Show($toastB)
Write-Output ("SHOW_B tag=" + $tagB)

Start-Sleep -Seconds 4

$history = [Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($appId)
Write-Output ("HISTORY_COUNT=" + @($history).Count)
foreach ($toast in $history) {
    if ($toast.Group -eq $group) {
        Write-Output ("HISTORY tag=[" + $toast.Tag + "] group=[" + $toast.Group + "]")
    }
}
