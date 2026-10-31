#!/usr/bin/env bash
#
# LORE restore — replay a backup from scripts/ops/backup.sh.
#
#   ./scripts/ops/restore.sh --into lore_restore            # newest backup, drill
#   ./scripts/ops/restore.sh --into lore --force           # replace the live one
#   ./scripts/ops/restore.sh --into lore_restore --from /srv/lore/backups/<stamp>
#
# Restoring *over* the live database is refused without --force, and even then
# the counts are printed before and after so it is obvious what happened. The
# intended use is a drill into a throwaway database: the only backup that works
# is one that has been restored at least once on the machine that needs it.
set -euo pipefail

REPO=${REPO:-/opt/lore}
COMPOSE_FILE=${COMPOSE_FILE:-deploy/compose/docker-compose.yml}
BACKUP_DIR=${BACKUP_DIR:-/srv/lore/backups}
BLOBS_DIR=${BLOBS_DIR:-/srv/lore/blobs}

TARGET=""
FROM=""
FORCE=0
BLOBS_TO=""

usage() {
  sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --into) TARGET=${2:-}; shift 2 ;;
    --from) FROM=${2:-}; shift 2 ;;
    --blobs-to) BLOBS_TO=${2:-}; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1" >&2; usage ;;
  esac
done

[ -n "$TARGET" ] || { echo "--into <database> is required" >&2; usage; }
case "$TARGET" in
  *[!a-z0-9_]*) echo "--into must be a plain lowercase identifier, got \"$TARGET\"" >&2; exit 2 ;;
esac

cd "$REPO"
COMPOSE=(docker compose --env-file "$REPO/.env" -f "$COMPOSE_FILE")
LIVE=$("${COMPOSE[@]}" exec -T db sh -lc 'echo $POSTGRES_DB' | tr -d '\r')
LIVE=${LIVE:-lore}
DB_USER=$("${COMPOSE[@]}" exec -T db sh -lc 'echo $POSTGRES_USER' | tr -d '\r')
DB_USER=${DB_USER:-lore}

if [ -z "$FROM" ]; then
  FROM=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -1)
fi
[ -n "$FROM" ] && [ -f "$FROM/db.dump" ] || { echo "no backup found (looked in ${FROM:-$BACKUP_DIR})" >&2; exit 2; }

if [ "$TARGET" = "$LIVE" ] && [ "$FORCE" -ne 1 ]; then
  cat >&2 <<EOF
refusing to restore over the live database "$LIVE".

Restore into a throwaway database first and compare:
  ./scripts/ops/restore.sh --into lore_restore --from $FROM

If you really mean to replace production, say so:
  ./scripts/ops/restore.sh --into $LIVE --force
EOF
  exit 2
fi

counts() { # counts <database>
  "${COMPOSE[@]}" exec -T db psql -U "$DB_USER" -d "$1" -tAc "
    select 'documents', count(*) from documents
    union all select 'chunks', count(*) from chunks
    union all select 'embeddings', count(*) from embeddings
    union all select 'users', count(*) from users
    union all select 'org_llm_keys', count(*) from org_llm_keys" 2>/dev/null | tr -d '\r' | paste -sd' ' -
}

echo "restoring $(basename "$FROM") into $TARGET"
[ -f "$FROM/manifest.txt" ] && sed 's/^/  /' "$FROM/manifest.txt"

if [ "$TARGET" = "$LIVE" ] && [ "$FORCE" -eq 1 ]; then
  echo "  before: $(counts "$LIVE")"
fi

exists=$("${COMPOSE[@]}" exec -T db psql -U "$DB_USER" -d postgres -tAc \
  "select 1 from pg_database where datname = '$TARGET'" | tr -d '\r')
if [ "$exists" != "1" ]; then
  echo "creating database $TARGET"
  "${COMPOSE[@]}" exec -T db psql -U "$DB_USER" -d postgres -c "create database $TARGET" >/dev/null
fi

# A database restored from a dump of *this* server already carries the schema;
# --clean --if-exists makes the replay idempotent either way.
"${COMPOSE[@]}" exec -T db pg_restore -U "$DB_USER" -d "$TARGET" --clean --if-exists --no-owner \
  < "$FROM/db.dump" 2>&1 | grep -vE '^(pg_restore: )?(warning|notice)' || true

echo "  after:  $(counts "$TARGET")"

if [ -n "$BLOBS_TO" ]; then
  echo "extracting blobs into $BLOBS_TO"
  mkdir -p "$BLOBS_TO"
  tar -C "$BLOBS_TO" -xzf "$FROM/blobs.tar.gz"
fi

cat <<EOF

restored. Next, on the restored database:
  - point an API at it (DATABASE_URL) or run: pnpm db:migrate
  - verify the vectors still recall: \`select vector_norm(vec) from embeddings limit 1\`
  - compare the counts above with manifest.txt; a shortfall means the dump was cut
EOF
