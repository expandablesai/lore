#!/usr/bin/env bash
#
# A public tunnel with no account, no plan and no payment method.
#
#   ./scripts/ops/tunnel-quick.sh             # prints a https://<name>.trycloudflare.com URL
#   PUBLIC_HOST=auth.dushyant.com ./scripts/ops/tunnel-quick.sh
#
# What this proves and what it is not:
#
# * It proves the *edge* is ready — Caddy and Authelia answer a request that
#   started on the public internet. Verified against this installation: the
#   quick-tunnel URL returned `302` to `https://auth.dushyant.com/?rd=…` and
#   `/api/v1/healthz` returned `401`, which is exactly what the LAN edge does.
# * The URL is random and dies with the process. It is a demonstration and a
#   smoke test, not a deployment: nothing durable should point at it.
#
# The durable equivalents are in docs/TUNNEL.md — a named tunnel from a cert.pem
# (`tunnel-local.sh`, no Zero Trust dashboard) or from an API token.
set -euo pipefail

PUBLIC_HOST=${PUBLIC_HOST:-lore.dushyant.com}
ORIGIN=${ORIGIN:-https://localhost:443}
LOG=${LOG:-/tmp/lore-quick-tunnel.log}
BIN=${CLOUDFLARED:-cloudflared}

command -v "$BIN" >/dev/null || { echo "cloudflared is not installed" >&2; exit 2; }

echo "opening a quick tunnel to $ORIGIN as $PUBLIC_HOST"
: > "$LOG"
"$BIN" tunnel --no-autoupdate --no-tls-verify \
  --url "$ORIGIN" \
  --http-host-header "$PUBLIC_HOST" \
  --origin-server-name "$PUBLIC_HOST" > "$LOG" 2>&1 &
PID=$!

# The URL appears within a few seconds; give it twenty and then say so rather
# than hanging silently.
for _ in $(seq 1 20); do
  url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$url" ] && break
  sleep 1
done

if [ -z "${url:-}" ]; then
  echo "no URL after 20s — see $LOG" >&2
  kill "$PID" 2>/dev/null || true
  exit 1
fi

cat <<EOF

  public URL : $url
  origin     : $ORIGIN (Host: $PUBLIC_HOST)
  process    : $PID (log: $LOG)

  expect: 302 to https://auth.dushyant.com/ for /, and 401 for /api/v1/healthz —

  This URL is random and stops when this process does. Ctrl-C to close it, or:
    kill $PID
EOF

wait "$PID"
