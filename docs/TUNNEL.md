# Public access: the Cloudflare Tunnel

The last unfinished piece of phase D. Everything else about the deployment is
done and verified; this document is the whole remaining gap, written so the last
step is one credential and one command.

## Where it stands (measured, not remembered)

`lore.dushyant.com` and `auth.dushyant.com` are resolved **inside this network
only**. Two separate facts, and the difference matters:

- From the **LAN**, both names answer with the VM's private address
  (`10.20.10.52`) — the router at `10.20.10.1` holds a local override.
- From the **public internet**, both names do not exist: `1.1.1.1` and `8.8.8.8`
  both answer NXDOMAIN. There is no public DNS record, and therefore no public
  path.

Caddy terminates TLS on the VM with its own internal CA
(`deploy/compose/Caddyfile`), Authelia sits in front of the app, and documents
live on the host at `/srv/lore/blobs`. What is missing is the record and the
connector from the public internet to Caddy.

`cloudflared` is already installed on the VM (`/usr/local/bin/cloudflared`); there
is no tunnel yet, and no credential on the box. The compose service exists but is
behind a profile, so it does nothing until a tunnel is configured:

```bash
docker compose --env-file .env -f deploy/compose/docker-compose.yml \
  --profile tunnel up -d cloudflared
```

`./scripts/ops/doctor.sh` reports all of this under **public access**, and asks a
public resolver rather than the box's own — the LAN override is exactly what made
this look finished from the inside.

## The card wall, and three ways past it

The Zero Trust **dashboard** asks some accounts for a payment method before it
will let you create anything, even though tunnels themselves are free. That
prompt is a property of the Zero Trust *product page*, not of tunnels. None of
the routes below opens that page, and one of them needs no account at all.

| Route | Account needed | Hostname | Durable | Evidence |
| --- | --- | --- | --- | --- |
| 1. Quick tunnel — `scripts/ops/tunnel-quick.sh` | none | random `*.trycloudflare.com` | no | **verified on this installation** |
| 2. Named tunnel from `cert.pem` — `scripts/ops/tunnel-local.sh` | Cloudflare login in a browser, no plan | `lore.dushyant.com` | yes | script written, needs the cert |
| 3. Named tunnel from an API token — Route B below | API token (created without a card) | `lore.dushyant.com` | yes | may still hit a billing gate; unverified |

**Route 1 was run against this box and it works end to end.** `cloudflared tunnel
--url https://localhost:443 --http-host-header lore.dushyant.com
--origin-server-name lore.dushyant.com --no-tls-verify` produced
`https://science-tuner-streaming-measure.trycloudflare.com`, and from outside the
LAN:

```
GET /                  -> 302  Location: https://auth.dushyant.com/?rd=https%3A%2F%2Flore.dushyant.com%2Findex.html
GET /api/v1/healthz    -> 401
```

That is Caddy and Authelia answering a request that began on the public internet,
with no Cloudflare account involved — the edge is finished; only the *durable
name* was missing. (The URL is random and dies with the process, so it is a
smoke test, not a deployment.)

**Route 2 is the durable, no-card, no-dashboard answer.** `cloudflared tunnel
login` is an account-level browser authorization, not Zero Trust: it writes
`cert.pem`, and a tunnel created from that is configured by a local file instead
of by the dashboard. The one wrinkle is that the browser callback must reach the
machine running the command, so do it where the browser is:

```powershell
winget install Cloudflare.cloudflared
cloudflared tunnel login          # browser opens; pick dushyant.com
# copies %USERPROFILE%\.cloudflared\cert.pem
```

then copy that single file to `/root/.cloudflared/cert.pem` on the VM and run:

```bash
./scripts/ops/tunnel-local.sh     # creates/updates the tunnel, routes DNS, writes
                                  # deploy/compose/cloudflared/config.yml, starts the connector
```

**Route 3** — if an API token already exists with *Account: Cloudflare Tunnel:
Edit* and *Zone: DNS: Edit*, Route B's commands do the same thing directly. A
token can be created without a card; whether the create call also escapes the
billing gate is the one thing I could not test without one.

**Fallback if all three are refused:** Tailscale Funnel. Free, no card, a stable
`https://<machine>.<tailnet>.ts.net` name — but no custom domain, and it needs a
Tailscale account and auth key:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up                     # browser login or --authkey
tailscale funnel --bg 443        # then enable Funnel + HTTPS in the admin console
```

That trades `lore.dushyant.com` for a working public URL, which is the honest
trade to make if the domain has to wait.



## What "done" looks like

From a network that is **not** the laboratory LAN:

```bash
curl -sI https://lore.dushyant.com            # 302 to https://auth.dushyant.com
curl -s  https://auth.dushyant.com/           # the Authelia portal
curl -s -o /dev/null -w '%{http_code}\n' \
     http://127.0.0.1:3001/healthz            # 200 (unchanged, on the VM)
```

and the doctor's **public access** section reporting a public address and a
running connector.

## Route A — the dashboard (this is the route that asks for a card)

Use it only if your account gets past the payment prompt; Routes 1 and 2 avoid it.

1. **Create the tunnel**: Cloudflare dashboard → Zero Trust → Networks → Tunnels
   → *Create a tunnel* → Cloudflared → name it `lore` → copy the token from the
   install page (the long `eyJ…` string).
2. **Add two public hostnames** to that tunnel:

   | Subdomain | Domain | Service | Origin settings |
   | --- | --- | --- | --- |
   | `lore` | `dushyant.com` | `https://caddy:443` | *No TLS Verify* **on** |
   | `auth` | `dushyant.com` | `https://caddy:443` | *No TLS Verify* **on** |

   Both must point at the same Caddy: the hostname chooses the virtual host, and
   Caddy already serves `lore.dushyant.com` and `auth.dushyant.com`. Verify is off
   because Caddy signs with its own internal CA — the tunnel is the trust edge,
   not the origin.
3. **Nothing to delete in Cloudflare** — there is no public record today, so the
   two `CNAME …cfargotunnel.com` records the dashboard creates are the only ones.
   What *does* need attention is the **LAN override on the router**
   (`10.20.10.1` → `10.20.10.52`): leave it and LAN clients bypass the tunnel and
   keep working; remove it and LAN clients go out through Cloudflare like everyone
   else. Either is defensible, but decide it deliberately — and note that with the
   override in place, `doctor.sh` will keep reporting a private LAN answer beside
   the public one.
4. **Install the token** in `/opt/lore/.env` as `CLOUDFLARE_TUNNEL_TOKEN=…` (the
   compose service reads it) and start the connector:

   ```bash
   docker compose --env-file .env -f deploy/compose/docker-compose.yml \
     --profile tunnel up -d cloudflared
   docker compose --env-file .env -f deploy/compose/docker-compose.yml \
     logs --tail 20 cloudflared        # want: "Registered tunnel connection"
   ```

5. **Verify** with the commands above, then run `./scripts/ops/doctor.sh`.

## Route B — an API token instead of the dashboard

Needs a token with **Account → Cloudflare Tunnel: Edit** and
**Zone → DNS: Edit** for `dushyant.com`. With `cloudflared` on the VM:

```bash
export CLOUDFLARE_API_TOKEN=…        # never echoed, never written to a file
cloudflared tunnel login             # not needed for a token-scoped create
cloudflared tunnel create lore       # writes ~/.cloudflared/<id>.json
cloudflared tunnel route dns lore lore.dushyant.com
cloudflared tunnel route dns lore auth.dushyant.com
cloudflared tunnel run lore          # or install it as a service
```

A locally-managed tunnel keeps its own ingress config; in that case the two
hostnames live in `~/.cloudflared/config.yml` pointing at
`https://caddy:443` with `noTLSVerify: true`, and the compose service is not used.

## Why a tunnel rather than port forwarding

- No inbound ports on the VM, so the LAN does not have to trust the internet.
- Cloudflare terminates public TLS; Caddy's internal CA never has to be trusted
  by a browser.
- One credential to revoke.

## After cutover — things that will look broken if you skip them

- **Authelia redirect loop.** Authelia trusts `X-Forwarded-Proto` and
  `X-Forwarded-Host`; cloudflared sends both. If the portal bounces back to itself,
  check that the request reaches Caddy with those headers intact (the tunnel's
  origin settings) and that `LORE_AUTH_*` in `.env` names the public hostnames.
- **Cookies on the wrong host.** The session cookie is scoped to
  `auth.dushyant.com`; the app redirects there and back. Both names must be on the
  same tunnel for that dance to work.
- **Old `A` records.** See Route A step 3 — the most common way this ends up
  "still not working".
- **Stale LAN habit.** On the LAN the names will now resolve to Cloudflare's
  edge and hairpin back through the tunnel. That is fine, but it means the LAN no
  longer has a direct path that bypasses Authelia; if that matters, add
  `lore.lan.dushyant.com` with an `A` record to `10.20.10.52` for local use.

## Rollback

```bash
docker compose --env-file .env -f deploy/compose/docker-compose.yml \
  --profile tunnel rm -sf cloudflared
```

then re-add the two `A` records to `10.20.10.52` and delete the tunnel in the
dashboard. Nothing in the app or the database changes.
