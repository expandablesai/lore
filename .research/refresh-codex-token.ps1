$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$store = Join-Path $env:USERPROFILE ".dsh\.openai-codex-auth.json"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "$store.bak-$stamp"
Copy-Item $store $backup -Force
Write-Output "backup: $backup"

$j = Get-Content $store -Raw | ConvertFrom-Json
$cred = $j.credential

function Claims([string]$tok) {
  try {
    $p = $tok.Split('.')[1].Replace('-', '+').Replace('_', '/')
    switch ($p.Length % 4) { 2 { $p += '==' } 3 { $p += '=' } }
    return [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
  } catch { return $null }
}

$body = "grant_type=refresh_token&refresh_token=" + [uri]::EscapeDataString($cred.refresh) + "&client_id=app_EMoamEEZ73f0CkXaXp7hrann"
try {
  $r = Invoke-WebRequest -Uri "https://auth.openai.com/oauth/token" -Method POST -TimeoutSec 60 -UseBasicParsing -Body $body -ContentType "application/x-www-form-urlencoded" -Headers @{ "User-Agent" = "Mozilla/5.0" }
  $tok = $r.Content | ConvertFrom-Json
  Write-Output "REFRESH OK http=$($r.StatusCode) expires_in=$($tok.expires_in) has_refresh=$([bool]$tok.refresh_token) has_id=$([bool]$tok.id_token)"
} catch {
  $resp = $_.Exception.Response
  if ($resp) { Write-Output "REFRESH FAILED http=$([int]$resp.StatusCode)" } else { Write-Output "REFRESH ERROR: $($_.Exception.Message)" }
  exit 1
}

$acl = Claims $tok.access_token
$auth = $acl.'https://api.openai.com/auth'
$idc = Claims $tok.id_token
$email = if ($idc -and $idc.email) { $idc.email } elseif ($cred.email) { $cred.email } else { "" }

$new = [ordered]@{
  version    = 1
  credential = [ordered]@{
    type      = "oauth"
    access    = $tok.access_token
    refresh   = $tok.refresh_token
    expires   = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() + ([int64]$tok.expires_in * 1000))
    accountId = $auth.chatgpt_account_id
    idToken   = $tok.id_token
    email     = $email
  }
}
$json = $new | ConvertTo-Json -Depth 6 -Compress
[IO.File]::WriteAllText($store, $json, (New-Object Text.UTF8Encoding($false)))
Write-Output "written: store size=$((Get-Item $store).Length) accountId=$($auth.chatgpt_account_id) email=$email"

$exp = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$new.credential.expires).ToLocalTime()
Write-Output "new access token expires: $($exp.ToString('yyyy-MM-dd HH:mm:ss zzz'))"

# --- verify against the codex search endpoint ---
$url = "https://chatgpt.com/backend-api/codex/alpha/search"
$req = @{
  model    = "gpt-5.6-sol"
  input    = @(@{ type = "message"; role = "user"; content = @(@{ type = "input_text"; text = "ping" }) })
  commands = @{ search_query = @(@{ q = "ping" }) }
  settings = @{ search_context_size = "low"; allowed_callers = @("direct"); external_web_access = $false }
  max_output_tokens = 16
} | ConvertTo-Json -Depth 10 -Compress
try {
  $v = Invoke-WebRequest -Uri $url -Method POST -TimeoutSec 60 -UseBasicParsing -Body $req -ContentType "application/json" -Headers @{
    authorization        = "Bearer $($tok.access_token)"
    "chatgpt-account-id" = $auth.chatgpt_account_id
    accept               = "application/json"
    originator           = "deepseek-harness"
  }
  Write-Output "VERIFY http=$($v.StatusCode)"
  Write-Output ("  body: " + $v.Content.Substring(0, [Math]::Min(200, $v.Content.Length)))
} catch {
  $resp = $_.Exception.Response
  if ($resp) { Write-Output "VERIFY http=$([int]$resp.StatusCode)" } else { Write-Output "VERIFY ERROR: $($_.Exception.Message)" }
}
