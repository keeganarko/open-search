$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force security-results | Out-Null
$report = Join-Path (Resolve-Path security-results) 'runtime-results.json'
if (Test-Path $report) { Remove-Item -LiteralPath $report }
$binary = (Resolve-Path 'release/security-runtime/win-unpacked/Voyager.exe').Path
$evidence = (Resolve-Path security-results).Path
$process = Start-Process -FilePath $binary -ArgumentList @("`"--security-report=$report`"", '--enable-logging', "`"--log-file=$evidence/chromium.log`"") `
  -RedirectStandardOutput "$evidence/stdout.log" -RedirectStandardError "$evidence/stderr.log" -PassThru
if (!$process.WaitForExit(150000)) {
  # Preserve the isolated CI desktop's startup error, if Electron displayed one.
  if ($env:GITHUB_ACTIONS -eq 'true') { try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = [System.Drawing.Bitmap]::new($bounds.Width, $bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bounds.Size)
    $bitmap.Save("$evidence/startup.png")
    $graphics.Dispose(); $bitmap.Dispose()
  } catch { Write-Warning 'Could not capture the isolated test desktop.' } }
  $process.Kill()
  Get-Content "$evidence/stderr.log" -ErrorAction SilentlyContinue | Select-Object -Last 80
  throw 'Packaged security tests timed out.'
}
if (!(Test-Path $report)) { throw 'Packaged browser exited without a security report.' }
$result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
$result.results | Format-Table name, passed, error -AutoSize
if (!$result.passed -or $process.ExitCode -ne 0) { throw 'Packaged security checks failed.' }
