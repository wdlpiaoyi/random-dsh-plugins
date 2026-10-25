param([Parameter(Mandatory = $true)][string]$Path)

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace DshCapture {
  public static class Dpi {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  }
}
'@
[void][DshCapture.Dpi]::SetProcessDPIAware()
Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
