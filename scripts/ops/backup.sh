#!/usr/bin/env bash
#
# LORE backup — one directory per run, holding the database, the blobs, and
# enough metadata to prove the copy is usable.
#
#   ./scripts/ops/backup.sh                 # into /srv/lore/backups/<UTC stamp>/
#   KEEP=14 BACKUP_DIR=/mnt/nas/lore ./scripts/ops/backup.sh
#
# The dump is read back with `pg_restore --list` before the run is called
# successful: a backup nobody has opened is a file, not a backup. Restore it with
# scripts/ops/restore.sh.
set -euo pipefail

REPO=${REPO:-/opt/lore}
COMPOSE_FILE=${COMPOSE_FILE:-deploy/compose/docker-compose.yml}
BACKUP_DIR=${BACKUP_DIR:-/srv/lore/backups}
BLOBS_DIR=${BLOBS_DIR:-/srv/lore/blobs}
KEEP=${KEEP:-7}

STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
DEST="$BACKUP_DIR/$STAMP"

cd "$REPO"
COMPOSE=(docker compose --env-file "$REPO/.env" -f "$COMPOSE_FILE")
DB_NAME=$("${COMPOSE[@]}" exec -T db sh -lc 'echo $POSTGRES_DB' | tr -d '\r')
DB_USER=$("${COMPOSE[@]}" exec -T db sh -lc 'echo $POSTGRES_USER' | tr -d '\r')
DB_NAME=${DB_NAME:-lore}
DB_USER=${DB_USER:-lore}

sql() {
  "${COMPOSE[@]}" exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1" | tr -d '\r'
}

umask 077
mkdir -p "$DEST"
echo "backing up $DB_NAME to $DEST"

# 1. the database, in the format pg_restore can replay selectively
"${COMPOSE[@]}" exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc --no-owner > "$DEST/db.dump"

# 2. the blobs, which the database only names
if [ -d "$BLOBS_DIR" ]; then
  tar -C "$BLOBS_DIR" -czf "$DEST/blobs.tar.gz" .
else
  : > "$DEST/blobs.tar.gz"
fi

# 3. prove the dump can be read before declaring success
"${COMPOSE[@]}" exec -T db pg_restore --list < "$DEST/db.dump" > "$DEST/db.toc"
if [ ! -s "$DEST/db.toc" ]; then
  echo "the dump could not be read back — not keeping it" >&2
  rm -rf "$DEST"
  exit 1
fi

# 4. what was in it, so a restore can be compared rather than hoped about
{
  echo "taken_at=$STAMP"
  echo "git_commit=$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "database=$DB_NAME"
  echo "documents=$(sql 'select count(*) from documents')"
  echo "chunks=$(sql 'select count(*) from chunks')"
  echo "embeddings=$(sql 'select count(*) from embeddings')"
  echo "chats=$(sql 'select count(*) from chats')"
  echo "chat_messages=$(sql 'select count(*) from chat_messages')"
  echo "orgs=$(sql 'select count(*) from orgs')"
  echo "users=$(sql 'select count(*) from users')"
  echo "assertions=$(sql 'select count(*) from assertions')"
  echo "org_llm_keys=$(sql 'select count(*) from org_llm_keys')"
  echo "schema_migrations=$(sql 'select count(*) from drizzle.__drizzle_migrations')"
  echo "blob_files=$(find "$BLOBS_DIR" -maxdepth 1 -type f 2>/dev/null | wc -l | tr -d ' ')"
  echo "blob_bytes=$(du -sb "$BLOBS_DIR" 2>/dev/null | cut -f1)"
} > "$DEST/manifest.txt"

sha256sum "$DEST/db.dump" "$DEST/blobs.tar.gz" | sed 's|  .*/|  |' >> "$DEST/manifest.txt"
echo "dump $(du -h "$DEST/db.dump" | cut -f1), blobs $(du -h "$DEST/blobs.tar.gz" | cut -f1)"

# 5. retention, newest first
if [ "$KEEP" -gt 0 ]; then
  ls -1dt "$BACKUP_DIR"/*/ 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
    echo "pruning $(basename "$old")"
    rm -rf "$old"
  done
fi

# 6. the newest run must survive the pruning
[ -f "$DEST/db.dump" ] || { echo "backup directory vanished after pruning" >&2; exit 1; }
echo "ok — $(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ') backup(s) kept in $BACKUP_DIR"
