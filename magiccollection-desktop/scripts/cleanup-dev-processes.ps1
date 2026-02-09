param(
  [string]$ProjectRoot = ""
)

if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
  $ProjectRoot = (Resolve-Path $ProjectRoot).Path
}

$rootLower = $ProjectRoot.ToLowerInvariant()
$debugExePrefix = ((Join-Path $ProjectRoot "src-tauri\target\debug\") -replace '\\+', '\').ToLowerInvariant()

$targets = Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -eq 'app.exe' -and $_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant().StartsWith($debugExePrefix)) -or
  ($_.Name -eq 'node.exe' -and $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($rootLower)) -or
  ($_.Name -eq 'cargo.exe' -and $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($rootLower))
}

$count = 0
foreach ($proc in $targets) {
  try {
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
    $count++
  } catch {
    # Ignore race conditions and access issues for unrelated transient processes.
  }
}

Write-Output ("Stopped dev processes: {0}" -f $count)
