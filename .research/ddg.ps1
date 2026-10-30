param(
  [Parameter(Mandatory = $true)][string]$Query,
  [int]$Max = 8
)
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
$u = "https://html.duckduckgo.com/html/?q=" + [uri]::EscapeDataString($Query)

function Clean([string]$s) {
  if (-not $s) { return "" }
  $s = [regex]::Replace($s, '<[^>]+>', '')
  $s = [System.Net.WebUtility]::HtmlDecode($s)
  $s = [regex]::Replace($s, '\s+', ' ').Trim()
  return $s
}

try {
  $r = Invoke-WebRequest -Uri $u -TimeoutSec 40 -UseBasicParsing -Headers @{ "User-Agent" = $ua; "Accept-Language" = "en-US,en;q=0.9" }
} catch {
  Write-Output "SEARCH_ERROR: $($_.Exception.Message)"
  exit 0
}

$html = $r.Content
$blocks = [regex]::Matches($html, '(?s)<div class="result results_links results_links_deep web-result[^"]*">(.*?)</div>\s*</div>\s*</div>')
if ($blocks.Count -eq 0) {
  $blocks = [regex]::Matches($html, '(?s)<div class="result[^"]*">(.*?)</div>\s*</div>')
}
$i = 0
foreach ($b in $blocks) {
  if ($i -ge $Max) { break }
  $t = $b.Groups[1].Value
  $m = [regex]::Match($t, '(?s)class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>')
  if (-not $m.Success) { continue }
  $href = $m.Groups[1].Value
  if ($href -match 'uddg=([^&]+)') { $href = [uri]::UnescapeDataString($Matches[1]) }
  $title = Clean $m.Groups[2].Value
  $sm = [regex]::Match($t, '(?s)class="result__snippet"[^>]*>(.*?)</a>')
  $snip = if ($sm.Success) { Clean $sm.Groups[1].Value } else { "" }
  $i++
  Write-Output ("[{0}] {1}`n    {2}`n    {3}" -f $i, $title, $href, $snip)
}
if ($i -eq 0) { Write-Output "NO_PARSED_RESULTS (len=$($html.Length))" }
