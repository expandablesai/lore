#!/usr/bin/env bash
#
# LORE doctor — a read-only health report for a deployed installation.
#
#   ./scripts/ops/doctor.sh            # on the host that runs the stack
#   REPO=/opt/lore ./scripts/ops/doctor.sh
#
# Every line is PASS, WARN or FAIL. Anything that would make the product lie to
# a reader is a FAIL and the exit code is 1: a document that says "indexed" with
# no chunks, vectors that cannot be compared, a blob the database references but
# the disk does not have, a migration on disk that the database never ran.
#
# It changes nothing. There is no --fix, on purpose: a doctor that edits
# production is a doctor you cannot trust to diagnose it.
set -uo pipefail

REPO=${REPO:-/opt/lore}
COMPOSE_FILE=${COMPOSE_FILE:-deploy/compose/docker-compose.yml}
BACKUP_DIR=${BACKUP_DIR:-/srv/lore/backups}
BLOBS_DIR=${BLOBS_DIR:-/srv/lore/blobs}
KEEP_FINGERPRINT=${KEEP_FINGERPRINT:-/var/lib/lore/doctor-key-fingerprint}

PASS=0
WARN=0
FAIL=0

if [ -t 1 ]; then C_G=$'\033[32m'; C_Y=$'\033[33m'; C_R=$'\033[31m'; C_D=$'\033[2m'; C_0=$'\033[0m'
else C_G=""; C_Y=""; C_R=""; C_D=""; C_0=""; fi

section() { printf '\n%s== %s%s\n' "$C_0" "$*" "$C_0"; }
ok()      { printf '  %sPASS%s  %s\n' "$C_G" "$C_0" "$*"; PASS=$((PASS + 1)); }
warn()    { printf '  %sWARN%s  %s\n' "$C_Y" "$C_0" "$*"; WARN=$((WARN + 1)); }
bad()     { printf '  %sFAIL%s  %s\n' "$C_R" "$C_0" "$*"; FAIL=$((FAIL + 1)); }
note()    { printf '  %s      %s%s\n' "$C_D" "$*" "$C_0"; }

cd "$REPO" || { echo "no repo at $REPO"; exit 2; }
COMPOSE=(docker compose --env-file "$REPO/.env" -f "$COMPOSE_FILE")

DB_NAME=$("${COMPOSE[@]}" exec -T db sh -lc 'echo $POSTGRES_DB' 2>/dev/null | tr -d '\r')
DB_USER=$("${COMPOSE[@]}" exec -T db sh -lc 'echo $POSTGRES_USER' 2>/dev/null | tr -d '\r')
DB_NAME=${DB_NAME:-lore}
DB_USER=${DB_USER:-lore}

# One scalar out of the live database.
sql() {
  "${COMPOSE[@]}" exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1" 2>/dev/null | tr -d '\r'
}

printf 'LORE doctor — %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── the stack ────────────────────────────────────────────────────────────────
section "stack"
for service in db app worker caddy authelia; do
  state=$("${COMPOSE[@]}" ps -a --format '{{.Service}} {{.State}}' 2>/dev/null |
    awk -v s="$service" '$1 == s {print $2}')
  case "$state" in
    running) ok "$service is running" ;;
    exited)
      if [ "$service" = "web" ]; then ok "web has exited (it is a one-shot dist copier)"
      else bad "$service is stopped — \`docker compose up -d $service\`" ; fi ;;
    "") bad "$service is not defined in $COMPOSE_FILE" ;;
    *) bad "$service is $state" ;;
  esac
done

# ── the API answers ──────────────────────────────────────────────────────────
section "api"
probe() { # probe <path> <expected-fragment>
  local body
  body=$("${COMPOSE[@]}" exec -T app node -e '
    const [path] = process.argv.slice(1);
    fetch("http://127.0.0.1:3001" + path)
      .then((r) => r.text().then((t) => console.log(r.status + " " + t)))
      .catch((e) => console.log("000 " + e.message));
  ' "$1" 2>/dev/null | tr -d '\r')
  case "$body" in
    "200 "*) ok "GET $1 answers 200" ;;
    *) bad "GET $1 answered: ${body:-no response}" ;;
  esac
}
probe /healthz
probe /readyz

# ── the database ─────────────────────────────────────────────────────────────
section "database"
if [ -n "$(sql 'select 1')" ]; then ok "PostgreSQL reachable as $DB_USER/$DB_NAME"; else
  bad "cannot connect to the database as $DB_USER/$DB_NAME"
fi

vector_version=$(sql "select extversion from pg_extension where extname = 'vector'")
if [ -n "$vector_version" ]; then ok "pgvector $vector_version installed"
else bad "pgvector is not installed — nothing can be recalled"; fi

applied=$(sql 'select count(*) from drizzle.__drizzle_migrations')
on_disk=$(find packages/db/migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
if [ "$applied" = "$on_disk" ]; then ok "migrations applied: $applied of $on_disk on disk"
else bad "migrations applied $applied but $on_disk on disk — run pnpm db:migrate"; fi

rls=$(sql "select count(*) from pg_policies where schemaname = 'public'")
if [ "${rls:-0}" -gt 0 ]; then ok "row-level security: $rls policies"
else warn "no RLS policies — tenant isolation depends on the app's WHERE clauses alone"; fi

# ── key material ─────────────────────────────────────────────────────────────
section "key material"
if grep -qE '^LORE_ENCRYPTION_KEY=.+' "$REPO/.env" 2>/dev/null; then
  ok "LORE_ENCRYPTION_KEY is set"
else
  bad "LORE_ENCRYPTION_KEY is missing from $REPO/.env — no stored key can be read"
fi

# The key is immutable: regenerating it turns every stored provider key into
# noise. Remember its fingerprint and shout if it ever moves. The value itself is
# never printed or written.
if grep -qE '^LORE_ENCRYPTION_KEY=.+' "$REPO/.env" 2>/dev/null; then
  current=$(grep -E '^LORE_ENCRYPTION_KEY=' "$REPO/.env" | head -1 |
    sed 's/^LORE_ENCRYPTION_KEY=//' | tr -d '"'"'"'\r' | sha256sum | cut -c1-16)
  if [ -f "$KEEP_FINGERPRINT" ]; then
    remembered=$(cat "$KEEP_FINGERPRINT")
    if [ "$current" = "$remembered" ]; then ok "encryption key fingerprint unchanged ($current)"
    else bad "LORE_ENCRYPTION_KEY CHANGED (was $remembered, now $current) — every encrypted provider key is now unreadable"; fi
  else
    mkdir -p "$(dirname "$KEEP_FINGERPRINT")" 2>/dev/null
    printf '%s\n' "$current" > "$KEEP_FINGERPRINT" 2>/dev/null &&
      ok "encryption key fingerprint recorded for future runs ($current)" ||
      warn "could not record the encryption key fingerprint at $KEEP_FINGERPRINT"
  fi
fi

keys_total=$(sql 'select count(*) from org_llm_keys')
keys_enabled=$(sql 'select count(*) from org_llm_keys where enabled')
keys_malformed=$(sql "select count(*) from org_llm_keys where api_key_enc is null or api_key_enc !~ '^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'")
if [ "${keys_malformed:-0}" -eq 0 ]; then
  ok "provider keys: $keys_total stored, $keys_enabled enabled, all ciphertext well formed"
else
  bad "$keys_malformed provider key(s) are not in iv:tag:ciphertext form — they cannot be decrypted"
fi

# ── the embedding space ──────────────────────────────────────────────────────
section "embedding space"
# What matters is one space *per org*: two orgs may legitimately use different
# models, but inside one org a second model produces vectors no query can be
# compared with.
mixed=$(sql "select count(*) from (
               select c.org_id from embeddings e join chunks c on c.id = e.entity_id
                where e.entity_type = 'chunk'
                group by c.org_id having count(distinct e.model) > 1) s")
if [ "${mixed:-0}" -eq 0 ]; then ok "every org indexes in a single vector space"
else warn "$mixed org(s) hold vectors from more than one model — recall mixes incomparable vectors"; fi

while read -r line; do [ -n "$line" ] && note "$line"; done < <(
  sql "select e.model || ': ' || count(*) || ' vector(s)' from embeddings e group by e.model order by 2 desc" 2>/dev/null | head -5
)

zero=$(sql 'select count(*) from embeddings where vector_norm(vec) = 0' 2>/dev/null)
if [ -z "$zero" ]; then
  zero=$(sql "select count(*) from embeddings where vec = array_fill(0::real, array[3072])" 2>/dev/null)
fi
if [ "${zero:-0}" -eq 0 ]; then ok "no zero vectors (a zero vector can never rank)"
else warn "$zero zero vector(s) — they occupy storage and can never be retrieved"
fi

orphan_vectors=$(sql "select count(*) from embeddings e where e.entity_type = 'chunk' and not exists (select 1 from chunks c where c.id = e.entity_id)")
if [ "${orphan_vectors:-0}" -eq 0 ]; then ok "every vector belongs to a chunk"
else warn "$orphan_vectors orphan vector(s) — their chunk was deleted without the derived rows"; fi

chunks_without_vectors=$(sql 'select count(*) from chunks c where not exists (select 1 from embeddings e where e.entity_type = '\''chunk'\'' and e.entity_id = c.id)')
if [ "${chunks_without_vectors:-0}" -eq 0 ]; then ok "every chunk has a vector"
else bad "$chunks_without_vectors chunk(s) have no vector — they will never be recalled"; fi

# ── documents ────────────────────────────────────────────────────────────────
section "documents"
total=$(sql 'select count(*) from documents')
indexed=$(sql "select count(*) from documents where status = 'indexed'")
failed=$(sql "select count(*) from documents where status = 'failed'")
extracting=$(sql "select count(*) from documents where status = 'extracting'")
queued=$(sql "select count(*) from documents where status = 'queued'")
note "total $total — indexed $indexed, failed $failed, extracting $extracting, queued $queued"

empty=$(sql "select count(*) from documents d where d.status = 'indexed' and not exists (select 1 from chunks c where c.document_id = d.id)")
if [ "${empty:-0}" -eq 0 ]; then ok "no document claims 'indexed' with nothing extracted"
else bad "$empty document(s) are 'indexed' with zero chunks — the claim is a lie"; fi

stale=$(sql "select count(*) from documents where status = 'extracting' and created_at < now() - interval '15 minutes'")
if [ "${stale:-0}" -eq 0 ]; then ok "no extraction has been stuck for more than 15 minutes"
else bad "$stale extraction(s) stuck over 15 minutes — the worker reaper is not running"; fi

if [ "${failed:-0}" -gt 0 ]; then
  note "most recent failures:"
  sql "select filename || ' — ' || coalesce(error, '(no reason recorded)') from documents where status = 'failed' order by created_at desc limit 3" |
    while read -r line; do note "  $line"; done
fi

# ── blobs ────────────────────────────────────────────────────────────────────
section "blobs"
if [ -d "$BLOBS_DIR" ]; then
  files=$(find "$BLOBS_DIR" -maxdepth 1 -type f | wc -l | tr -d ' ')
  referenced=$(sql "select count(*) from documents where storage_key <> ''")
  missing=0
  while read -r key; do
    [ -z "$key" ] && continue
    [ -f "$BLOBS_DIR/$key" ] || missing=$((missing + 1))
  done < <(sql 'select storage_key from documents')
  if [ "$missing" -eq 0 ]; then ok "$referenced document(s) all have their file on disk ($files file(s) stored)"
  else bad "$missing document(s) reference a blob that is not on disk — they can never be reprocessed"; fi
  note "blob directory: $(du -sh "$BLOBS_DIR" 2>/dev/null | cut -f1)"
else
  warn "no blob directory at $BLOBS_DIR (empty installation, or the mount is missing)"
fi

# ── backups ──────────────────────────────────────────────────────────────────
section "backups"
if [ -d "$BACKUP_DIR" ]; then
  count=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
  latest=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)
  if [ "$count" -eq 0 ]; then
    warn "no backups in $BACKUP_DIR — run scripts/ops/backup.sh"
  else
    age_days=$(( ($(date +%s) - $(stat -c %Y "$latest")) / 86400 ))
    if [ "$age_days" -le 7 ]; then ok "$count backup(s), newest $(basename "$latest") ($age_days day(s) old)"
    else warn "newest backup is $age_days days old — run scripts/ops/backup.sh"; fi
  fi
else
  warn "no backup directory at $BACKUP_DIR — run scripts/ops/backup.sh"
fi

# ── disk ─────────────────────────────────────────────────────────────────────
section "disk"
for mount in / /srv /var/lib/docker; do
  [ -d "$mount" ] || continue
  used=$(df -P "$mount" 2>/dev/null | awk 'NR == 2 {sub(/%/, "", $5); print $5}')
  [ -z "$used" ] && continue
  if [ "$used" -ge 90 ]; then bad "$mount is ${used}% full"
  elif [ "$used" -ge 80 ]; then warn "$mount is ${used}% full"
  else ok "$mount is ${used}% full"; fi
done

# ── what the browser is served ───────────────────────────────────────────────
section "console"
assets=$("${COMPOSE[@]}" exec -T caddy sh -lc 'ls /srv/assets 2>/dev/null | wc -l' 2>/dev/null | tr -d '\r')
if [ "${assets:-0}" -gt 0 ]; then ok "the web bundle is published ($assets asset(s))"
else bad "Caddy has no /srv/assets — the console will not load (rebuild the web container)"; fi

# ── the lock ─────────────────────────────────────────────────────────────────
section "lock"
if command -v node >/dev/null 2>&1; then
  if node scripts/lock.mjs >/dev/null 2>&1; then ok "the design and feature lock is intact"
  else bad "the lock is violated — run \`node scripts/lock.mjs\` for the detail"; fi
else
  note "node is not installed on this host — lock check skipped (run it in CI)"
fi

# ── the verdict ──────────────────────────────────────────────────────────────
printf '\n%d passed, %d warning(s), %d failed\n' "$PASS" "$WARN" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  printf '%sThis installation is telling readers something untrue — see the FAIL lines.%s\n' "$C_R" "$C_0"
  exit 1
fi
printf '%sEverything the doctor can see agrees with what the product claims.%s\n' "$C_G" "$C_0"
