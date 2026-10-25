$ErrorActionPreference = "Stop"
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast duration="long"><visual><binding template="ToastGeneric"><text>HIDE-INPROC</text><text>Should hide after 3 seconds</text></binding></visual></toast>')
$notification = New-Object Windows.UI.Notifications.ToastNotification $xml
$notification.Tag = "hide-inproc"
$notification.Group = "hide-inproc"
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Dsh.WinToast")
$notifier.Show($notification)
Start-Sleep -Seconds 3
try {
  $notifier.Hide($notification)
  Write-Output "HIDE_OK"
} catch {
  Write-Output ("HIDE_FAIL " + $_.Exception.Message)
}
Start-Sleep -Seconds 2
