$ErrorActionPreference = 'Stop'
$executables = Get-ChildItem release/signed -Filter '*.exe' -Recurse
if ($executables.Count -lt 3) { throw 'Missing signed installer, application, or authentication helper.' }
foreach ($file in $executables) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($signature.Status -ne 'Valid') { throw "Invalid Authenticode signature: $($file.Name)" }
  if ($signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ne $env:WIN_PUBLISHER_NAME) {
    throw "Unexpected publisher: $($file.Name)"
  }
}
Write-Output 'Windows application, installer and helpers have valid publisher signatures.'
