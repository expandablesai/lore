param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Name,
  [int]$MaxChars = 4000
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
$dir = Join-Path $PSScriptRoot "pages"
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }

try {
  $r = Invoke-WebRequest -Uri $Url -TimeoutSec 60 -UseBasicParsing -Headers @{ "User-Agent" = $ua; "Accept-Language" = "en-US,en;q=0.9" }
} catch {
  Write-Output "FETCH_ERROR $Url :: $($_.Exception.Message)"
  exit 0
}

$html = $r.Content
Set-Content -Path (Join-Path $dir "$Name.html") -Value $html -Encoding UTF8

$t = $html
$t = [regex]::Replace($t, '(?is)<script.*?</script>', ' ')
$t = [regex]::Replace($t, '(?is)<style.*?</style>', ' ')
$t = [regex]::Replace($t, '(?is)<noscript.*?</noscript>', ' ')
$t = [regex]::Replace($t, '(?i)<(br|/p|/div|/li|/h[1-6]|/tr)>', "`n")
$t = [regex]::Replace($t, '<[^>]+>', ' ')
$t = [System.Net.WebUtility]::HtmlDecode($t)
$t = [regex]::Replace($t, '[ \t]+', ' ')
$t = [regex]::Replace($t, '\n\s*\n+', "`n")
$t = $t.Trim()
Set-Content -Path (Join-Path $dir "$Name.txt") -Value $t -Encoding UTF8
Write-Output "OK $Name status=$($r.StatusCode) chars=$($t.Length) file=$dir\$Name.txt"
Write-Output "-----"
Write-Output $t.Substring(0, [Math]::Min($MaxChars, $t.Length))
