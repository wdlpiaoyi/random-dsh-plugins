param(
  [string]$Tag = "hide-test",
  [string]$Group = "hide-test",
  [string]$Aumid = "Dsh.WinToast"
)
$ErrorActionPreference = "Stop"
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text>hide</text></binding></visual></toast>')
$notification = New-Object Windows.UI.Notifications.ToastNotification $xml
$notification.Tag = $Tag
$notification.Group = $Group
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($Aumid)
try {
  $notifier.Hide($notification)
  Write-Output "HIDE_OK"
} catch {
  Write-Output ("HIDE_FAIL " + $_.Exception.GetType().FullName + ": " + $_.Exception.Message)
}
