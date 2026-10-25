[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
$appId = "Dsh.WinToast"
$history = [Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($appId)
Write-Output ("TOTAL=" + @($history).Count)
foreach ($toast in $history) {
    Write-Output ("TAG=[" + $toast.Tag + "] GROUP=[" + $toast.Group + "]")
    Write-Output $toast.Content.GetXml()
}
