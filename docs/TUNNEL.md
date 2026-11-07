# Public access: the Cloudflare Tunnel

**Status: live since 2026-11-08.** `lore.dushyant.com` and `auth.dushyant.com`
are served through the tunnel `expandables-lore-prod`
(`be67f848-f6b7-4f50-8cac-dbc1b1481092`), verified through the Cloudflare edge
(`302` to Authelia, `401` on `/api/v1/healthz`, `200` on the portal), with the
doctor reporting `29 passed, 0 warnings, 0 failed`.

What follows is how it was built and what it cost to get right — kept because the
next deployment will meet the same four traps.

## Where it stood before the cutover (measured, not remembered)

- From the **LAN**, both names answered with the VM's private address
  (`10.20.10.52`) — because this workstation's hosts file mapped them there
  (`deploy/setup-lore-edge.ps1`, written when the console was LAN-only). The router
  was blamed for it at the time; later measurement showed the router answering the
  public Cloudflare addresses.
- From the **public internet**, both names did not exist: `1.1.1.1` and `8.8.8.8`
  both answered NXDOMAIN. No public record, therefore no public path.

The hosts mapping is the reason "it works here" was never evidence. `doctor.sh`
now asks a public resolver on purpose, and the public path must be tested with
the edge pinned:

```bash
curl --resolve lore.dushyant.com:443:188.114.96.5 https://lore.dushyant.com/
```

## What a working connector needs

- `cloudflared` in compose behind `--profile tunnel`, with
  `CLOUDFLARE_TUNNEL_TOKEN` in `.env` (600, root-owned).
- Both public hostnames → `https://caddy:443` (the compose service name, because
  the connector joins the same network), **No TLS Verify**, and
  **Origin Server Name = the hostname itself** — Caddy selects the site by SNI
  and holds a per-hostname internal certificate.
- Routes match **top to bottom**, and the "Add route" dialog keeps the previous
  subdomain, which is how `lore` once ended up with no route (404) while `auth`
  appeared twice.


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
   What *does* need attention is any **hosts entry on the workstation** mapping the
   names to `10.20.10.52`: with it in place the browser talks to Caddy directly,
   sees the internal certificate and fails with `SSL_ERROR_INTERNAL_ERROR_ALERT`
   ("Not Secure") while `curl --resolve …` proves the edge is fine.
   `deploy/setup-lore-edge.ps1` removes such entries by default and offers
   `-LanDirect` for deliberate origin testing (CA trust included).
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
- **Stale LAN habit.** With the hosts entry removed, LAN clients resolve to
  Cloudflare's edge and hairpin back through the tunnel; the LAN no longer has a
  direct path that bypasses Authelia. If that matters, add
  `lore.lan.dushyant.com` with an `A` record to `10.20.10.52`, or run
  `setup-lore-edge.ps1 -LanDirect` (which also trusts the edge CA).

## Rollback

```bash
docker compose --env-file .env -f deploy/compose/docker-compose.yml \
  --profile tunnel rm -sf cloudflared
```

then re-add the two `A` records to `10.20.10.52` and delete the tunnel in the
dashboard. Nothing in the app or the database changes.
