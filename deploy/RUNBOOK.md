# lore deploy runbook — expandables-lab (10.20.10.52)

Run these steps on the target host. The repo must be committed and pushed
from the dev box first (CI and this runbook both pull from the remote).
The dev-box bootstrap is **already complete** — the repo is committed and
pushed to `origin/master`. Do not re-run it:

```bash
git add -A
git commit -m "lore: M0 monorepo with deploy pipeline"
git remote add origin https://github.com/expandablesai/lore.git
git push -u origin master
```

## 0. Prerequisites (one-time)

- Docker Engine + Compose plugin (`docker info`, `docker compose version`)
- git
- The lore repository pushed to its remote (done: `origin/master`)

Check all three; install what is missing — the lab image ships **without
git**, and possibly without Docker:

```bash
docker info >/dev/null 2>&1 && echo docker-ok || echo docker-MISSING
docker compose version >/dev/null 2>&1 && echo compose-ok || echo compose-MISSING
command -v git || echo git-MISSING
```

```bash
apt-get update && apt-get install -y git
```

Only if Docker reported missing — official packages, Debian 13 (`trixie`):

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian trixie stable" > /etc/apt/sources.list.d/docker.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## 1. Clone

```bash
git clone https://github.com/expandablesai/lore.git /opt/lore
cd /opt/lore
```

## 2. Secrets

```bash
mkdir -p deploy/compose
printf 'POSTGRES_PASSWORD=<strong-random>\n' > deploy/compose/.env
```

`POSTGRES_PASSWORD` feeds both the `db` superuser password and the app's
`DATABASE_URL` (`postgresql://lore:${POSTGRES_PASSWORD}@db:5432/lore`).

## 3. Database volume

The `db` service bind-mounts `/srv/lore/pgdata`; PostgreSQL needs it owned by
its container user (uid 999):

```bash
sudo install -d -o 999 -g 999 /srv/lore/pgdata
```

## 4. Start PostgreSQL 17 + pgvector and wait until healthy

```bash
docker compose -f deploy/compose/docker-compose.yml up -d db
docker compose -f deploy/compose/docker-compose.yml ps   # db → healthy
```

## 5. Provision schema + RLS (one-off containers, same network as db)

```bash
docker compose -f deploy/compose/docker-compose.yml run --rm app pnpm db:migrate
docker compose -f deploy/compose/docker-compose.yml run --rm app pnpm db:apply-rls
```

- `db:migrate` applies `packages/db/migrations` (includes
  `CREATE EXTENSION vector` and the 16-table init batch).
- `db:apply-rls` runs `packages/db/apply-rls.mjs` (roles, SECURITY DEFINER
  function, RLS policies, grants). Run it **once** against the freshly
  migrated database — it is not idempotent.

## 6. Start the app stack

```bash
docker compose -f deploy/compose/docker-compose.yml up -d
docker compose -f deploy/compose/docker-compose.yml ps
```

Services: `db` (no published ports), `app` (API on 3001), `worker`,
`web` (one-shot: copies `apps/web/dist` from the app image into the
`web_dist` volume), `caddy` (80/443: serves the web SPA at `:80` with
SPA fallback and proxies `/api/*` — prefix stripped — to `app:3001`).

## 7. Smoke check

```bash
curl -fsS http://localhost/ >/dev/null && echo web-ok
curl -fsS http://localhost/api/healthz && echo api-ok
docker compose -f deploy/compose/docker-compose.yml exec -T db \
  pg_isready -U lore
```
