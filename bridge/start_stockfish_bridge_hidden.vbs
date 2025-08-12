Set WshShell = CreateObject("WScript.Shell")
scriptDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
cmd = "cmd /c """ & scriptDir & "\start_stockfish_bridge.cmd"""

' 0 = hide window, False = don't wait
WshShell.Run cmd, 0, False

