<#
.SYNOPSIS
    Points the Lore hostnames at the lab VM and trusts the edge CA certificate.

.DESCRIPTION
    Run this from an elevated PowerShell. It edits the Windows hosts file so that
    lore.dushyant.com and auth.dushyant.com resolve to the VM, then installs the
    Caddy internal CA into LocalMachine\Root so the browser stops warning.

    Every change is idempotent and the hosts file is backed up first.

.PARAMETER DryRun
    Report what would change without touching the hosts file or the certificate store.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup-lore-edge.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup-lore-edge.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$HostsFile = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$CrtPath = Join-Path $PSScriptRoot 'caddy-root.crt'
$Ip = '10.20.10.52'
$Names = @('lore.dushyant.com', 'auth.dushyant.com')

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host "hosts file : $HostsFile"
Write-Host "CA file    : $CrtPath"

if (-not (Test-Elevated)) {
    Write-Host ''
    Write-Host 'This script must run in an elevated PowerShell.' -ForegroundColor Red
    Write-Host 'Open: Win+X -> Terminal (Admin), then run it again.' -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path -LiteralPath $CrtPath)) {
    Write-Host "CA certificate not found at $CrtPath" -ForegroundColor Red
    exit 1
}

# --- hosts entries -----------------------------------------------------------

$current = @(Get-Content -LiteralPath $HostsFile)
$toAdd = @()
foreach ($name in $Names) {
    $escaped = [regex]::Escape($name)
    $matches_ = @($current | Where-Object {
        $_ -notmatch '^\s*#' -and $_ -match "(?i)(^|\s)$escaped(\s|$)"
    })
    if ($matches_.Count -gt 0) {
        Write-Host "already mapped : $name  ($($matches_[0].Trim()))"
    }
    else {
        $toAdd += "$Ip`t$name"
    }
}

if ($toAdd.Count -gt 0) {
    if ($DryRun) {
        foreach ($line in $toAdd) { Write-Host "would add      : $line" }
    }
    else {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backup = "$HostsFile.bak-$stamp"
        Copy-Item -LiteralPath $HostsFile -Destination $backup -Force
        Write-Host "backup         : $backup"
        foreach ($line in $toAdd) {
            Add-Content -LiteralPath $HostsFile -Value $line -Encoding Ascii
            Write-Host "added          : $line" -ForegroundColor Green
        }
    }
}
else {
    Write-Host 'hosts already configured, nothing to add'
}

# --- CA certificate ----------------------------------------------------------

$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CrtPath)
Write-Host "certificate    : $($cert.Subject)"
Write-Host "thumbprint     : $($cert.Thumbprint)"

$alreadyTrusted = @(
    Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
)
if ($alreadyTrusted.Count -gt 0) {
    Write-Host 'certificate    : already trusted in LocalMachine\Root'
}
elseif ($DryRun) {
    Write-Host 'would trust    : LocalMachine\Root'
}
else {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
    $store.Open('ReadWrite')
    try {
        $store.Add($cert)
    }
    finally {
        $store.Close()
    }
    Write-Host 'certificate    : trusted in LocalMachine\Root' -ForegroundColor Green
}

# --- verification ------------------------------------------------------------

Write-Host ''
Write-Host '--- verification ---'

Get-Content -LiteralPath $HostsFile | Where-Object { $_ -match 'dushyant\.com' } | ForEach-Object {
    Write-Host "hosts: $($_.Trim())"
}

$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
foreach ($name in $Names) {
    if ($curl) {
        # --ssl-no-revoke: the lab CA publishes no revocation list, and Windows'
        # schannel refuses to complete the handshake without one (CRYPT_E_NO_REVOCATION_CHECK).
        # Browsers soft-fail on missing revocation info, so this only affects curl.
        $code = & $curl.Source -sS --ssl-no-revoke -o NUL -w '%{http_code}' --max-time 10 "https://$name/"
        $expected = if ($name -eq 'lore.dushyant.com') { '302 (redirect to Authelia)' } else { '200' }
        Write-Host ("{0,-22} -> HTTP {1}   expected {2}" -f $name, $code, $expected)
    }
    else {
        Write-Host ("{0,-22} -> curl.exe not found, test in the browser" -f $name)
    }
}

$probe = & $curl.Source -sS --ssl-no-revoke -o NUL -w '%{http_code}' --max-time 10 'https://lore.dushyant.com/' 2>$null
if ($curl -and $probe -eq '000') {
    Write-Host ''
    Write-Host 'The hostnames did not answer. Check that the VM is reachable on 443:' -ForegroundColor Yellow
    Write-Host '  Test-NetConnection 10.20.10.52 -Port 443' -ForegroundColor Yellow
}

Write-Host ''
if ($DryRun) {
    Write-Host 'Dry run finished - nothing was changed.' -ForegroundColor Yellow
}
else {
    Write-Host 'Done. Open https://lore.dushyant.com and sign in.' -ForegroundColor Green
}
