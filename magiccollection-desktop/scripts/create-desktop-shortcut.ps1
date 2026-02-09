param(
  [string]$ShortcutName = "MagicCollection",
  [string]$IconPath = ""
)

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$launcherPath = Join-Path $projectRoot "scripts\start-magiccollection.cmd"
$desktopPath = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktopPath ("{0}.lnk" -f $ShortcutName)

if (-not (Test-Path $launcherPath)) {
  throw "Launcher not found: $launcherPath"
}

if ([string]::IsNullOrWhiteSpace($IconPath)) {
  $IconPath = Join-Path $projectRoot "src-tauri\icons\icon.ico"
}

if (-not (Test-Path $IconPath)) {
  throw "Icon file not found: $IconPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = "Launch MagicCollection (Windows dev workflow)"
$shortcut.IconLocation = "{0},0" -f $IconPath
$shortcut.Save()

Write-Output ("Shortcut created: {0}" -f $shortcutPath)
