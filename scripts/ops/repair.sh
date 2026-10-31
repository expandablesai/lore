#!/usr/bin/env bash
#
# LORE repair — fix the two inconsistencies the doctor can only report.
#
#   ./scripts/ops/repair.sh                 # dry run: say what would change
#   ./scripts/ops/repair.sh --apply         # do it
#   ./scripts/ops/repair.sh --apply --stale-space
#
# Two things go wrong in a long-lived installation, and neither is visible to a
# reader until recall quietly returns nothing:
#
#   orphan vectors   a chunk was deleted without its vector, so the vector sits
#                    in the table pointing at nothing
#   stale space      a document was indexed while the org used one embedding
#                    model, and the org has since moved to another — its chunks
#                    are in a vector space no query will ever embed into, so the
#                    document is unretrievable even though it says "indexed"
#
# The stale-space repair re-processes the document through the product's own
# reprocess endpoint rather than writing vectors here, so the vectors come from
# exactly the code path a normal upload takes.
set -uo pipefail

REPO=${REPO:-/opt/lore}
COMPOSE_FILE=${COMPOSE_FILE:-deploy/compose/docker-compose.yml}
APPLY=0
DO_ORPHANS=0
DO_STALE=0
API=http://127.0.0.1:3001

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --orphan-vectors) DO_ORPHANS=1; shift ;;
    --stale-space) DO_STALE=1; shift ;;
    -h|--help) sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ "$DO_ORPHANS" -eq 0 ] && [ "$DO_STALE" -eq 0 ] && { DO_ORPHANS=1; DO_STALE=1; }

cd "$REPO" || { echo "no repo at $REPO"; exit 2; }
COMPOSE=(docker compose --env-file "$REPO/.env" -f "$COMPOSE_FILE")
DB_NAME=$("${COMPOSE[@]}" exec -T db sh -lc 'echo $POSTGRES_DB' | tr -d '\r')
DB_USER=$("${COMPOSE[@]}" exec -T db sh -lc 'echo $POSTGRES_USER' | tr -d '\r')
DB_NAME=${DB_NAME:-lore}
DB_USER=${DB_USER:-lore}

sql() { "${COMPOSE[@]}" exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc "$1" | tr -d '\r'; }
run() { # run <statement> — only when --apply
  if [ "$APPLY" -eq 1 ]; then sql "$1"; else echo "would run: $1"; fi
}

CHANGED=0

# ── orphan vectors ───────────────────────────────────────────────────────────
if [ "$DO_ORPHANS" -eq 1 ]; then
  echo "== orphan vectors"
  orphans=$(sql "select count(*) from embeddings e
                  where e.entity_type = 'chunk'
                    and not exists (select 1 from chunks c where c.id = e.entity_id)")
  if [ "${orphans:-0}" -eq 0 ]; then
    echo "   none — every vector belongs to a chunk"
  else
    echo "   $orphans vector(s) point at a chunk that no longer exists"
    if [ "$APPLY" -eq 1 ]; then
      run "delete from embeddings e where e.entity_type = 'chunk'
             and not exists (select 1 from chunks c where c.id = e.entity_id)"
      echo "   deleted"
    fi
    CHANGED=$((CHANGED + 1))
  fi
fi

# ── documents stranded in an old vector space ────────────────────────────────
if [ "$DO_STALE" -eq 1 ]; then
  echo "== documents indexed in a vector space the org no longer uses"
  # The org's space is whatever most of its vectors are in; anything else cannot
  # be compared with a query embedded today.
  stranded=$(sql "
    with space as (
      select c.org_id, e.model, count(*) as n
        from embeddings e join chunks c on c.id = e.entity_id
       where e.entity_type = 'chunk'
       group by c.org_id, e.model
    ), dominant as (
      select distinct on (org_id) org_id, model
        from space order by org_id, n desc
    )
    select d.id || '  ' || d.org_id || '  ' || d.filename || '  [' || e.model || ']'
      from documents d
      join chunks c on c.document_id = d.id
      join embeddings e on e.entity_type = 'chunk' and e.entity_id = c.id
      join dominant dm on dm.org_id = d.org_id
     where e.model <> dm.model
     group by d.id, d.org_id, d.filename, e.model
     order by d.filename")

  if [ -z "$stranded" ]; then
    echo "   none — every document is in its org's current space"
  else
    printf '%s\n' "$stranded" | sed 's/^/   /'
    count=$(printf '%s\n' "$stranded" | wc -l | tr -d ' ')
    echo "   $count document(s) cannot be retrieved by a query embedded today"
    if [ "$APPLY" -eq 1 ]; then
      # Mint a short-lived session so the reprocess goes through the real route,
      # then revoke it. The token is never printed.
      user=$(sql "select owner_user_id from documents where id = '$(printf '%s\n' "$stranded" | head -1 | awk '{print $1}')'")
      user=${user:-$(sql "select id from users order by created_at limit 1")}
      token=$(head -c 32 /dev/urandom | base64 -w0 | tr '+/' '-_' | tr -d '=')
      hash=$(printf %s "$token" | sha256sum | awk '{print $1}')
      sql "insert into sessions (user_id, token_hash, expires_at)
           values ('$user', '$hash', now() + interval '30 minutes')" >/dev/null

      while read -r id rest; do
        [ -z "$id" ] && continue
        code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/documents/$id/reprocess" \
          -H "Authorization: Bearer $token")
        echo "   reprocess $id -> HTTP $code"
      done <<< "$(printf '%s\n' "$stranded" | awk '{print $1}')"

      sql "delete from sessions where token_hash = '$hash'" >/dev/null
      echo "   requeued; the worker re-embeds them in the org's current space"
    fi
    CHANGED=$((CHANGED + 1))
  fi
fi

echo
if [ "$CHANGED" -eq 0 ]; then
  echo "nothing to repair"
elif [ "$APPLY" -eq 1 ]; then
  echo "repaired. Re-run scripts/ops/doctor.sh to confirm."
else
  echo "dry run — nothing changed. Add --apply to repair."
fi
