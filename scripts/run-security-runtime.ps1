$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force security-results | Out-Null
$report = Join-Path (Resolve-Path security-results) 'runtime-results.json'
if (Test-Path $report) { Remove-Item -LiteralPath $report }
$binary = (Resolve-Path 'release/security-runtime/win-unpacked/Voyager.exe').Path
$process = Start-Process -FilePath $binary -ArgumentList @("`"--security-report=$report`"") -PassThru
if (!$process.WaitForExit(150000)) { $process.Kill(); throw 'Packaged security tests timed out.' }
if (!(Test-Path $report)) { throw 'Packaged browser exited without a security report.' }
$result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
$result.results | Format-Table name, passed, error -AutoSize
if (!$result.passed -or $process.ExitCode -ne 0) { throw 'Packaged security checks failed.' }
