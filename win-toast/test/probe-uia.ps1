Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$deadline = (Get-Date).AddSeconds(8)
$found = $false
while ((Get-Date) -lt $deadline) {
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "UIA-PROBE-A")
  $el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
  if ($el) {
    Write-Output ("FOUND name=" + $el.Current.Name + " class=" + $el.Current.ClassName + " pid=" + $el.Current.ProcessId)
    $found = $true
    break
  }
  Start-Sleep -Milliseconds 500
}
if (-not $found) {
  Write-Output "NOT_FOUND"
  $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($c in $children) {
    $n = $c.Current.Name
    if ($n -and $n.Length -gt 0 -and $n.Length -lt 60) {
      Write-Output ("TOP name=[" + $n + "] class=" + $c.Current.ClassName + " pid=" + $c.Current.ProcessId)
    }
  }
}
