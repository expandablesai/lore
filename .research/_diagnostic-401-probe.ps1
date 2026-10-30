$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
$url = "https://chatgpt.com/backend-api/codex/alpha/search"

function Get-AccountId([string]$tok) {
  $p = $tok.Split('.')[1].Replace('-', '+').Replace('_', '/')
  switch ($p.Length % 4) { 2 { $p += '==' } 3 { $p += '=' } }
  $j = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
  return $j.'https://api.openai.com/auth'.chatgpt_account_id
}

$body = @{
  model  = "gpt-5.6-sol"
  input  = @(@{ type = "message"; role = "user"; content = @(@{ type = "input_text"; text = "harness diagnostic ping" }) })
  commands = @{ search_query = @(@{ q = "harness diagnostic ping" }) }
  settings = @{ search_context_size = "low"; allowed_callers = @("direct"); external_web_access = $false }
  max_output_tokens = 16
} | ConvertTo-Json -Depth 10 -Compress

function Test-Token([string]$label, [string]$tok) {
  Write-Output "===== $label"
  if (-not $tok) { Write-Output "  no token"; return }
  try {
    $acc = Get-AccountId $tok
    $r = Invoke-WebRequest -Uri $url -Method POST -TimeoutSec 60 -UseBasicParsing -Body $body -ContentType "application/json" -Headers @{
      authorization     = "Bearer $tok"
      "chatgpt-account-id" = $acc
      accept            = "application/json"
      originator        = "deepseek-harness"
      "User-Agent"      = $ua
    }
    Write-Output "  HTTP $($r.StatusCode)"
    Write-Output ("  body: " + $r.Content.Substring(0, [Math]::Min(400, $r.Content.Length)))
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      Write-Output "  HTTP $([int]$resp.StatusCode)"
      try {
        $sr = New-Object IO.StreamReader($resp.GetResponseStream())
        $txt = $sr.ReadToEnd()
        Write-Output ("  body: " + $txt.Substring(0, [Math]::Min(400, $txt.Length)))
      } catch { Write-Output "  body unreadable" }
    } else {
      Write-Output "  ERR: $($_.Exception.Message)"
    }
  }
}

$dsh = (Get-Content (Join-Path $env:USERPROFILE ".dsh\.openai-codex-auth.json") -Raw | ConvertFrom-Json).credential
Test-Token "dsh credential store (~/.dsh/.openai-codex-auth.json), iat 2026-10-23" $dsh.access

$codexAuth = Get-Content (Join-Path $env:USERPROFILE ".codex\auth.json") -Raw | ConvertFrom-Json
Test-Token "official codex CLI (~/.codex/auth.json), last_refresh 2026-10-27" $codexAuth.tokens.access_token
