function Get-Field($obj, $name) {
  if ($null -eq $obj) { return $null }
  if ($obj.PSObject.Properties.Name -contains $name) { return $obj.$name }
  return $null
}

function Show-Tok([string]$path) {
  Write-Output "===== $path"
  if (-not (Test-Path $path)) { Write-Output "  (missing)"; return }
  $j = Get-Content $path -Raw | ConvertFrom-Json
  Write-Output ("  top-level keys: " + (($j.PSObject.Properties.Name) -join ", "))
  $at = Get-Field $j 'access_token'
  if (-not $at) { $at = Get-Field $j 'accessToken' }
  if (-not $at) { $at = Get-Field (Get-Field $j 'tokens') 'access_token' }
  if (-not $at) { Write-Output "  no access token field found"; return }
  $parts = $at.Split('.')
  Write-Output "  token segments: $($parts.Count) (len=$($at.Length))"
  if ($parts.Count -ge 2) {
    $p = $parts[1].Replace('-', '+').Replace('_', '/')
    switch ($p.Length % 4) { 2 { $p += '==' } 3 { $p += '=' } }
    try {
      $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
      $expU = Get-Field $payload 'exp'
      $iatU = Get-Field $payload 'iat'
      if ($expU) {
        $exp = [DateTimeOffset]::FromUnixTimeSeconds([int64]$expU).ToLocalTime()
        Write-Output ("  expires: " + $exp.ToString('yyyy-MM-dd HH:mm:ss zzz'))
        $delta = ((Get-Date) - $exp.LocalDateTime).TotalHours
        Write-Output ("  now    : " + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))
        Write-Output ("  status : EXPIRED for {0} h" -f [math]::Round($delta, 2))
      }
      if ($iatU) { Write-Output ("  issued : " + [DateTimeOffset]::FromUnixTimeSeconds([int64]$iatU).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss zzz')) }
      $ident = Get-Field $payload 'email'
      if (-not $ident) { $ident = Get-Field $payload 'sub' }
      Write-Output ("  identity claim: " + $ident)
      $claims = @($payload.PSObject.Properties.Name | Where-Object { $_ -notin @('exp', 'iat', 'sub', 'aud', 'iss', 'email') })
      Write-Output ("  other claims: " + ($claims -join ', '))
    } catch { Write-Output "  decode failed: $($_.Exception.Message)" }
  }
  foreach ($k in @('refresh_token', 'id_token')) {
    $has = [bool](Get-Field $j $k)
    if (-not $has) { $has = [bool](Get-Field (Get-Field $j 'tokens') $k) }
    Write-Output ("  has ${k}: $has")
  }
  foreach ($k in @('last_refresh', 'expires_at', 'expiresAt', 'account_id', 'OPENAI_API_KEY')) {
    $v = Get-Field $j $k
    if ($null -ne $v) { Write-Output ("  ${k}: " + $v) }
  }
}

Show-Tok (Join-Path $env:USERPROFILE ".codex\auth.json")
Show-Tok (Join-Path $env:USERPROFILE ".dsh\.openai-codex-auth.json")
