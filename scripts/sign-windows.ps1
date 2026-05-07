# Signs a Windows binary with Azure Trusted Signing.
# No-op when TRUSTED_SIGNING_ENABLED is not 'true' so local dev builds work without Azure credentials.
# Tauri invokes this for every binary it bundles via bundle.windows.signCommand.

param([Parameter(Mandatory)][string]$FilePath)

$ErrorActionPreference = 'Stop'

if ($env:TRUSTED_SIGNING_ENABLED -ne 'true') {
    Write-Host "[sign-windows] Signing disabled (TRUSTED_SIGNING_ENABLED != 'true'). Skipping $FilePath"
    exit 0
}

foreach ($var in 'TRUSTED_SIGNING_DLIB','TRUSTED_SIGNING_METADATA') {
    if (-not (Get-Item "Env:$var" -ErrorAction SilentlyContinue)) {
        Write-Error "[sign-windows] $var is not set"
    }
}

$signtool = $env:SIGNTOOL_PATH
if (-not $signtool) { $signtool = 'signtool.exe' }

& $signtool sign `
    /v `
    /fd SHA256 `
    /tr http://timestamp.acs.microsoft.com `
    /td SHA256 `
    /dlib $env:TRUSTED_SIGNING_DLIB `
    /dmdf $env:TRUSTED_SIGNING_METADATA `
    $FilePath

if ($LASTEXITCODE -ne 0) {
    Write-Error "[sign-windows] signtool failed with exit code $LASTEXITCODE for $FilePath"
}
