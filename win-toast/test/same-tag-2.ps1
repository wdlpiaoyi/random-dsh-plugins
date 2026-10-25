$ErrorActionPreference = "Stop"
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null

$appId = "Dsh.WinToast"
$tag = "same-tag-test"
$group = "same-tag-test"
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)

try {
    [Windows.UI.Notifications.ToastNotificationManager]::History.Remove($tag, $group)
} catch {
}

function New-TestToast([string]$title, [string]$body) {
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

$stampA = Get-Date -Format "HH:mm:ss"
$toastA = New-TestToast "SAME-TAG A" ("Shown at " + $stampA + ". This banner should stay for 10 seconds, then B appears.")
$notifier.Show($toastA)
Write-Output ("SHOWED_A at " + $stampA)

Start-Sleep -Seconds 10

$stampB = Get-Date -Format "HH:mm:ss"
$toastB = New-TestToast "SAME-TAG B" ("Shown at " + $stampB + ". Same Tag and Group as A.")
$notifier.Show($toastB)
Write-Output ("SHOWED_B at " + $stampB)

Start-Sleep -Seconds 5

$history = [Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($appId)
Write-Output ("HISTORY_COUNT=" + @($history).Count)
$history | ForEach-Object { Write-Output ("HISTORY tag=[" + $_.Tag + "] group=[" + $_.Group + "]") }
