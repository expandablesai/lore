<#
.SYNOPSIS
    Makes this workstation reach Lore the way the public internet does (and can
    undo that, for deliberate LAN-direct work).

.DESCRIPTION
    Since 2026-11-08 lore.dushyant.com and auth.dushyant.com are served through the
    Cloudflare Tunnel expandables-lore-prod. A hosts entry pointing either name at
    10.20.10.52 makes the browser talk to Caddy directly, which presents the
    internal-CA certificate and fails with SSL_ERROR_INTERNAL_ERROR_ALERT
    ("Not Secure") - a workstation artifact, not a deployment fault.

    Default: remove any LAN mapping for the two names, then verify the public path.
    -LanDirect: restore the mapping and trust the Caddy internal CA, for when you
    deliberately want to bypass the tunnel and test the origin on the LAN.

    Every change is idempotent, and the hosts file is backed up before it is edited.

.PARAMETER LanDirect
    Point the hostnames at 10.20.10.52 again and trust the edge CA.

.PARAMETER DryRun
    Report what would change without touching the hosts file or the certificate store.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup-lore-edge.ps1

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup-lore-edge.ps1 -LanDirect

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\setup-lore-edge.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [switch]$LanDirect,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$HostsFile = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$CrtPath = Join-Path $PSScriptRoot 'caddy-root.crt'
$Ip = '10.20.10.52'
$Names = @('lore.dushyant.com', 'auth.dushyant.com')
$LanPattern = '^\s*' + [regex]::Escape($Ip) + '\s+(lore|auth)\.dushyant\.com\s*$'

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host "hosts file : $HostsFile"
Write-Host "mode       : $(if ($LanDirect) { 'LAN-direct (origin at ' + $Ip + ')' } else { 'public (Cloudflare Tunnel)' })"

if (-not (Test-Elevated)) {
    Write-Host ''
    Write-Host 'This script must run in an elevated PowerShell.' -ForegroundColor Red
    Write-Host 'Open: Win+X -> Terminal (Admin), then run it again.' -ForegroundColor Yellow
    exit 1
}

# --- hosts entries -----------------------------------------------------------

$current = @(Get-Content -LiteralPath $HostsFile)
$withLan = @($current | Where-Object { $_ -match $LanPattern })

if ($LanDirect) {
    $toAdd = @()
    foreach ($name in $Names) {
        $escaped = [regex]::Escape($name)
        $mapped = @($current | Where-Object {
            $_ -notmatch '^\s*#' -and $_ -match "(?i)(^|\s)$escaped(\s|$)"
        })
        if ($mapped.Count -gt 0) {
            Write-Host "already mapped : $name  ($($mapped[0].Trim()))"
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

    # --- CA certificate (only meaningful when the browser talks to Caddy) -----

    if (-not (Test-Path -LiteralPath $CrtPath)) {
        Write-Host "CA certificate not found at $CrtPath - skipping trust" -ForegroundColor Yellow
    }
    else {
        $cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($CrtPath)
        Write-Host "certificate    : $($cert.Subject)"
        $alreadyTrusted = @(Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Thumbprint -eq $cert.Thumbprint })
        if ($alreadyTrusted.Count -gt 0) {
            Write-Host 'certificate    : already trusted in LocalMachine\Root'
        }
        elseif ($DryRun) {
            Write-Host 'would trust    : LocalMachine\Root'
        }
        else {
            $store = New-Object System.Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine')
            $store.Open('ReadWrite')
            try { $store.Add($cert) } finally { $store.Close() }
            Write-Host 'certificate    : trusted in LocalMachine\Root' -ForegroundColor Green
        }
    }
}
elseif ($withLan.Count -gt 0) {
    # Default mode: the hostnames belong to the tunnel now. A hosts mapping makes
    # the browser reach Caddy's internal certificate and abort.
    if ($DryRun) {
        foreach ($line in $withLan) { Write-Host "would remove   : $($line.Trim())" }
    }
    else {
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $backup = "$HostsFile.bak-$stamp"
        Copy-Item -LiteralPath $HostsFile -Destination $backup -Force
        Write-Host "backup         : $backup"
        $kept = @($current | Where-Object { $_ -notmatch $LanPattern })
        Set-Content -LiteralPath $HostsFile -Value $kept -Encoding Ascii
        foreach ($line in $withLan) { Write-Host "removed        : $($line.Trim())" -ForegroundColor Green }
    }
}
else {
    Write-Host 'no LAN mapping present - this workstation already uses public DNS'
}

# --- verification ------------------------------------------------------------

Write-Host ''
Write-Host '--- verification ---'

$public = Resolve-DnsName -Server 1.1.1.1 -Type A -Name lore.dushyant.com -ErrorAction SilentlyContinue
if ($public) {
    Write-Host ("public DNS     : " + (($public | Where-Object { $_.IPAddress } | ForEach-Object { $_.IPAddress }) -join ', '))
}

$curl = Get-Command curl.exe -ErrorAction SilentlyContinue
foreach ($name in $Names) {
    if ($curl) {
        $code = & $curl.Source -sS --ssl-no-revoke -o NUL -w '%{http_code}' --max-time 10 "https://$name/" 2>$null
        $expected = if ($name -eq 'lore.dushyant.com') { '302 (redirect to Authelia)' } else { '200' }
        Write-Host ("{0,-22} -> HTTP {1}   expected {2}" -f $name, $code, $expected)
    }
    else {
        Write-Host ("{0,-22} -> curl.exe not found, test in the browser" -f $name)
    }
}

Write-Host ''
if ($DryRun) {
    Write-Host 'Dry run finished - nothing was changed.' -ForegroundColor Yellow
}
elseif ($LanDirect) {
    Write-Host 'LAN-direct mode. The browser must trust the edge CA; Firefox keeps its own store.' -ForegroundColor Yellow
}
else {
    Write-Host 'Done. Restart the browser (or close all tabs) so it forgets the old address.' -ForegroundColor Green
}
