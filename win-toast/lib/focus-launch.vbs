' DSH Win Toast click shim.
' Runs focus.ps1 without a console window flash, then exits.
'
' The activation URI is passed through the PROCESS environment, not spliced
' into a PowerShell command line. A URI containing $(...) or quotes is data and
' can never become PowerShell source.
Option Explicit

Dim shell, dir, env, args
If WScript.Arguments.Count = 0 Then
  WScript.Quit 0
End If
args = WScript.Arguments(0)

Set shell = CreateObject("WScript.Shell")
Set env = shell.Environment("PROCESS")
env("DSH_FOCUS_URI") = args

dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
shell.Run "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "focus.ps1""", 0, False
WScript.Quit 0
