# Builds a minimal but valid .docx (mammoth reads it) and verifies the full
# ingest -> embed -> retrieve -> answer path against the deployed stack.
$ErrorActionPreference = "Stop"
$api = "http://10.20.10.52:3001"

$docPath = Join-Path $env:TEMP "lore-probe.docx"
$paragraphs = @(
  "THE QUIET HOUR - scene 12",
  "Detective Ada Okafor, badge 4417, works out of Precinct 12.",
  "She drives a decommissioned ambulance painted matte black.",
  "The informant known as Sparrow demands payment in used vinyl records.",
  "The drop happens every second Thursday behind the Ostrander cannery."
)

$documentXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
$(($paragraphs | ForEach-Object { "<w:p><w:r><w:t>$_</w:t></w:r></w:p>" }) -join "")
</w:body></w:document>
"@

$contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'

$rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'

if (Test-Path $docPath) { Remove-Item $docPath }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($docPath, "Create")
function Add-Entry($archive, $name, $text) {
  $entry = $archive.CreateEntry($name)
  $stream = $entry.Open()
  $writer = New-Object System.IO.StreamWriter($stream, (New-Object System.Text.UTF8Encoding($false)))
  $writer.Write($text)
  $writer.Dispose()
  $stream.Dispose()
}
Add-Entry $zip "[Content_Types].xml" $contentTypes
Add-Entry $zip "_rels/.rels" $rels
Add-Entry $zip "word/document.xml" $documentXml
$zip.Dispose()
Write-Output "docx: $docPath ($((Get-Item $docPath).Length) bytes)"

# ── probe org ────────────────────────────────────────────────────────────────
$suffix = -join ((48..57) + (97..122) | Get-Random -Count 6 | ForEach-Object { [char]$_ })
$signup = Invoke-RestMethod -Method Post -Uri "$api/auth/signup" -ContentType "application/json" -Body (@{
  email = "split-$suffix@lore.test"; password = "probe-password-1"; displayName = "Split Probe"; orgName = "Split Probe $suffix"
} | ConvertTo-Json)
$token = $signup.token
$orgId = $signup.user.orgId
$auth = @{ authorization = "Bearer $token" }
Write-Output "org: $orgId"

# Key 2 (created first, so it is NOT the newest): the real embedder.
$embedder = Invoke-RestMethod -Method Post -Uri "$api/orgs/$orgId/llm-keys" -Headers $auth -ContentType "application/json" -Body (@{
  label = "local-embedder"; provider = "ollama"; apiKey = "ollama-local"
  baseUrl = "http://10.20.10.52:11434/v1"; chatModel = "llama3.1"
  embedModel = "nomic-embed-text"; embedDim = 768
} | ConvertTo-Json)
Write-Output "key1 (embedder):   $($embedder.id)"
Start-Sleep -Seconds 1

# Key 1 (created last, so it IS the newest and answers chat) but cannot embed —
# mirrors a hosted chat provider that serves no /v1/embeddings endpoint.
$chatOnly = Invoke-RestMethod -Method Post -Uri "$api/orgs/$orgId/llm-keys" -Headers $auth -ContentType "application/json" -Body (@{
  label = "chat-only"; provider = "ollama"; apiKey = "ollama-local"
  baseUrl = "http://10.20.10.52:11434/v1"; chatModel = "llama3.1"
  embedModel = "definitely-not-installed:latest"; embedDim = 768
} | ConvertTo-Json)
Write-Output "key2 (chat-only):  $($chatOnly.id)"

# ── upload + wait for indexing ───────────────────────────────────────────────
$upload = curl.exe -s -m 120 -H "Authorization: Bearer $token" -F "file=@$docPath;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" "$api/documents/upload" | ConvertFrom-Json
$docId = $upload.id
Write-Output "upload: $($upload.status) $docId"

$deadline = (Get-Date).AddSeconds(180)
do {
  Start-Sleep -Seconds 3
  $detail = Invoke-RestMethod -Uri "$api/documents/$docId" -Headers $auth
  $status = $detail.document.status
} while ($status -in @("queued", "extracting") -and (Get-Date) -lt $deadline)

Write-Output "index status: $status"
Write-Output "chunks: $($detail.chunks.Count)  error: $($detail.document.error)"
if ($status -ne "indexed") { throw "ingestion did not reach indexed" }

# ── grounded answer ──────────────────────────────────────────────────────────
$question = "What badge number does Detective Okafor have, and what does Sparrow want to be paid in?"
$chat = Invoke-RestMethod -Method Post -Uri "$api/chat" -Headers $auth -ContentType "application/json" -Body (@{
  messages = @(@{ role = "user"; content = $question })
} | ConvertTo-Json -Depth 5)
Write-Output "Q: $question"
Write-Output "A: $($chat.message.content)"
Write-Output "---"
Write-Output "grounded-4417: $($chat.message.content -match '4417')"
Write-Output "grounded-vinyl: $($chat.message.content -match 'vinyl')"
