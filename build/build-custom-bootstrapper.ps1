param(
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$packageJsonPath = Join-Path $root "package.json"
$packageJson = Get-Content $packageJsonPath -Raw | ConvertFrom-Json
$releaseVersion = [string]$packageJson.version

if ($releaseVersion -notmatch '^\d+\.\d+\.\d+(\.\d+)?$') {
  $releaseVersion = "1.0.0"
}

$releaseVersionParts = $releaseVersion.Split('.')
$releaseVersion4 = if ($releaseVersionParts.Count -eq 4) {
  $releaseVersion
} else {
  "$releaseVersion.0"
}

$project = Join-Path $root "build\ApexInstaller\ApexInstaller.csproj"
$distDir = Join-Path $root "dist"
$payloadSourceDir = Join-Path $distDir "win-unpacked"
$publishDir = Join-Path $distDir "_apex-bootstrapper"
$payloadDir = Join-Path $root "build\ApexInstaller\Payload"
$payloadZip = Join-Path $payloadDir "payload.zip"

if (-not (Test-Path $payloadSourceDir)) {
  throw "No win-unpacked payload found in dist. Run npm run build:desktop:dir first."
}

$payloadExe = Join-Path $payloadSourceDir "Apex Files.exe"
if (-not (Test-Path $payloadExe)) {
  throw "Missing Apex Files.exe in $payloadSourceDir"
}

if (Test-Path $payloadDir) {
  Remove-Item -Recurse -Force $payloadDir
}
New-Item -ItemType Directory -Force $payloadDir | Out-Null
Compress-Archive -Path (Join-Path $payloadSourceDir "*") -DestinationPath $payloadZip -CompressionLevel Optimal -Force

if (Test-Path $publishDir) {
  Remove-Item -Recurse -Force $publishDir
}
New-Item -ItemType Directory -Force $publishDir | Out-Null

dotnet publish $project `
  -c $Configuration `
  -r win-x64 `
  -p:PublishSingleFile=true `
  -p:SelfContained=false `
  -p:IncludeNativeLibrariesForSelfExtract=false `
  -p:DebugSymbols=false `
  -p:DebugType=None `
  -p:PublishTrimmed=false `
  -p:Version=$releaseVersion `
  -p:AssemblyVersion=$releaseVersion4 `
  -p:FileVersion=$releaseVersion4 `
  -p:InformationalVersion=$releaseVersion `
  -p:Company="Apex Files" `
  -p:Product="Apex Files Installer" `
  -p:Copyright="Copyright (c) Apex Files" `
  -o $publishDir

if ($LASTEXITCODE -ne 0) {
  throw "dotnet publish failed with exit code $LASTEXITCODE"
}

$bootstrapperExe = Join-Path $publishDir "ApexInstaller.exe"
if (-not (Test-Path $bootstrapperExe)) {
  throw "Bootstrapper executable not found at $bootstrapperExe"
}

$finalExe = Join-Path $distDir "Apex-Files-installer.exe"
if (Test-Path $finalExe) {
  Remove-Item $finalExe -Force
}

Get-ChildItem $distDir -File -Filter "Apex-Files-installer*.exe*" -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -ne $finalExe } |
  Remove-Item -Force -ErrorAction SilentlyContinue

Move-Item $bootstrapperExe $finalExe -Force

if (Test-Path $publishDir) {
  Remove-Item -Recurse -Force $publishDir
}

Write-Host "Custom Apex installer built:"
Write-Host " - $finalExe"
Write-Host " - embedded payload: $payloadZip"
