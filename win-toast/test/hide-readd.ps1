$ErrorActionPreference = "Stop"
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Dsh.WinToast")
$xmlA = New-Object Windows.Data.Xml.Dom.XmlDocument
$xmlA.LoadXml('<toast duration="long"><visual><binding template="ToastGeneric"><text>READD-A</text><text>This banner should be hidden at 2s</text></binding></visual></toast>')
$toastA = New-Object Windows.UI.Notifications.ToastNotification $xmlA
$toastA.Tag = "readd-a"
$toastA.Group = "readd-a"
$toastA.ExpirationTime = [DateTimeOffset]::Now.AddSeconds(300)
$notifier.Show($toastA)
Write-Output "SHOWED_A"
Start-Sleep -Seconds 2
$notifier.Hide($toastA)
Write-Output "HID_A"
$restored = New-Object Windows.UI.Notifications.ToastNotification $xmlA
$restored.Tag = "readd-a"
$restored.Group = "readd-a"
$restored.SuppressPopup = $true
$notifier.Show($restored)
Write-Output "RESTORED_A_SILENT"
Start-Sleep -Milliseconds 300
$xmlC = New-Object Windows.Data.Xml.Dom.XmlDocument
$xmlC.LoadXml('<toast duration="long"><visual><binding template="ToastGeneric"><text>READD-C</text><text>Only this banner should be visible</text></binding></visual></toast>')
$toastC = New-Object Windows.UI.Notifications.ToastNotification $xmlC
$toastC.Tag = "readd-c"
$toastC.Group = "readd-c"
$toastC.ExpirationTime = [DateTimeOffset]::Now.AddSeconds(300)
$notifier.Show($toastC)
Write-Output "SHOWED_C"
Start-Sleep -Seconds 1
$history = [Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory("Dsh.WinToast")
Write-Output ("HISTORY_COUNT=" + @($history).Count)
$history | ForEach-Object { Write-Output ("HISTORY tag=[" + $_.Tag + "] group=[" + $_.Group + "]") }
Start-Sleep -Seconds 2
