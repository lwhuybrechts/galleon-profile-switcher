' Launches focus-switcher.js without showing a console window.
' Used by Task Scheduler to run the script silently on startup.
Dim scriptDir, nodePath
scriptDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "node """ & scriptDir & "focus-switcher.js""", 0, False
