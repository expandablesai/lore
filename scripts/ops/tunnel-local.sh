#!/usr/bin/env bash
#
# A durable named tunnel for the real hostnames, without the Zero Trust dashboard.
#
#   ./scripts/ops/tunnel-local.sh
#   TUNNEL_NAME=lore TUNNEL_HOSTS="lore.dushyant.com auth.dushyant.com" ./scripts/ops/tunnel-local.sh
#
# Why this path exists: the Zero Trust *dashboard* asks some accounts for a
# payment method before it will let you create anything, even though tunnels are
# free. `cloudflared tunnel login` authenticates the CLI against the account
# itself (a browser page at dash.cloudflare.com — no Zero Trust, no plan), and
# the tunnel it creates is managed by a local config file rather than by the
# dashboard. Nothing here opens the Zero Trust product.
#
# What you need first: ~/.cloudflared/cert.pem. Get it by running
# `cloudflared tunnel login` on any machine you have a browser on, then copying
# that file to /root/.cloudflared/cert.pem on this host. The browser callback has
# to reach the machine running the command, which is why the VM cannot do it
# alone.
set -euo pipefail

REPO=${REPO:-/opt/lore}
COMPOSE_FILE=${COMPOSE_FILE:-deploy/compose/docker-compose.yml}
CF_HOME=${CLOUDFLARED_HOME:-$HOME/.cloudflared}
TUNNEL_NAME=${TUNNEL_NAME:-lore}
TUNNEL_HOSTS=${TUNNEL_HOSTS:-"lore.dushyant.com auth.dushyant.com"}
ORIGIN=${ORIGIN:-https://caddy:443}
BIN=${CLOUDFLARED:-cloudflared}

cd "$REPO"
[ -f "$CF_HOME/cert.pem" ] || {
  cat >&2 <<EOF
no certificate at $CF_HOME/cert.pem

Run this on a machine with a browser (Windows is fine):
  cloudflared tunnel login
then copy the file it writes to this host:
  %USERPROFILE%\.cloudflared\cert.pem  ->  /root/.cloudflared/cert.pem

No Zero Trust dashboard is involved, and no payment method is needed.
EOF
  exit 2
}

# Reuse the tunnel if it already exists, so this can be re-run safely.
if "$BIN" tunnel list 2>/dev/null | awk '{print $1}' | grep -qx "$TUNNEL_NAME"; then
  echo "reusing tunnel $TUNNEL_NAME"
else
  echo "creating tunnel $TUNNEL_NAME"
  "$BIN" tunnel create "$TUNNEL_NAME"
fi

TUNNEL_ID=$("$BIN" tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$1 == n {print $2}' | head -1)
[ -n "$TUNNEL_ID" ] || { echo "could not read the tunnel id" >&2; exit 1; }
echo "tunnel id: $TUNNEL_ID"

# DNS: a proxied CNAME to <id>.cfargotunnel.com for each hostname.
for host in $TUNNEL_HOSTS; do
  echo "routing $host -> $TUNNEL_ID"
  "$BIN" tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$host" || {
    echo "  (route dns failed for $host — add a proxied CNAME to $TUNNEL_ID.cfargotunnel.com by hand)" >&2
  }
done

# The connector runs inside compose, where the origin is the caddy service and
# Caddy's certificate is signed by its own CA.
DIR="$REPO/deploy/compose/cloudflared"
mkdir -p "$DIR"
cp "$CF_HOME/$TUNNEL_ID.json" "$DIR/$TUNNEL_ID.json" 2>/dev/null || {
  echo "missing $CF_HOME/$TUNNEL_ID.json — was the tunnel created on this host?" >&2
  exit 1
}
{
  echo "tunnel: $TUNNEL_ID"
  echo "credentials-file: /etc/cloudflared/$TUNNEL_ID.json"
  echo "no-autoupdate: true"
  echo "ingress:"
  for host in $TUNNEL_HOSTS; do
    printf '  - hostname: %s\n    service: %s\n    originRequest:\n      noTLSVerify: true\n' "$host" "$ORIGIN"
  done
  echo "  - service: http_status:404"
} > "$DIR/config.yml"

echo "wrote $DIR/config.yml"

"${COMPOSE:-docker compose}" --env-file .env -f "$COMPOSE_FILE" \
  --profile tunnel up -d cloudflared-local
sleep 8
"${COMPOSE:-docker compose}" --env-file .env -f "$COMPOSE_FILE" logs --tail 15 cloudflared-local 2>&1 |
  grep -iE 'registered tunnel connection|error' || true

cat <<EOF

done. Verify from outside the LAN:
  curl -sI https://${TUNNEL_HOSTS%% *}      # 302 to the auth host
  ./scripts/ops/doctor.sh                   # public access should read PASS

Rollback:
  docker compose --env-file .env -f $COMPOSE_FILE --profile tunnel rm -sf cloudflared-local
  cloudflared tunnel delete $TUNNEL_NAME
EOF
