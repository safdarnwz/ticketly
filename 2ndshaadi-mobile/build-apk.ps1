# Builds the release APK for the live server.
# Usage:  .\build-apk.ps1                      (live server)
#         .\build-apk.ps1 -Api http://192.168.1.5:4000   (test build for your computer)
param([string]$Api = "https://2ndshadi.com")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
flutter pub get
if ($Api.StartsWith("http://")) {
  if (-not (Select-String -Path android\gradle.properties -Pattern "^cleartext=true" -Quiet)) { Add-Content android\gradle.properties "cleartext=true" }
  flutter build apk --release --dart-define=DEV_TOOLS=true --dart-define=API_URL=$Api
} else {
  (Get-Content android\gradle.properties) | Where-Object { $_ -ne "cleartext=true" } | Set-Content android\gradle.properties
  flutter build apk --release --dart-define=API_URL=$Api
}
Write-Host "APK: $PSScriptRoot\build\app\outputs\flutter-apk\app-release.apk"
