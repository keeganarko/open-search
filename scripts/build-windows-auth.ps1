$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installation) { throw 'Install Visual Studio C++ tools and the Windows SDK to build Windows Hello support.' }
$dev = Join-Path $installation 'Common7\Tools\Launch-VsDevShell.ps1'
& $dev -Arch amd64 -HostArch amd64 -SkipAutomaticLocation
New-Item -ItemType Directory -Force resources/native | Out-Null
& cl.exe /nologo /std:c++20 /EHsc /O2 /guard:cf native/windows-auth.cpp /Fe:resources/native/voyager-auth.exe /Fo:resources/native/voyager-auth.obj /link windowsapp.lib user32.lib /DYNAMICBASE /NXCOMPAT /CETCOMPAT
if ($LASTEXITCODE -ne 0) { throw 'Windows Hello helper compilation failed.' }
