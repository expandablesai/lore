#!/usr/bin/env bash
#
# LORE recall benchmark — does the compiled context beat a flat top-6?
#
#   ./scripts/ops/bench-recall.sh
#   GOLDEN=scripts/ops/golden-questions.tsv ./scripts/ops/bench-recall.sh
#
# Every question in the golden set has one document that should answer it. The
# inspector (`GET /recall/context`) returns two rankings for that question:
#
#   naive     the flat top-6 by cosine distance, no per-document cap
#   compiled  what /chat actually sends: 24 candidates, at most 2 passages per
#             document, 6 passages, plus the reader's own facts
#
# and this prints where the expected document lands in each. Because both lists
# come from the same `selectContext` the answers are built with, the numbers
# describe the product rather than a reprint of it.
#
# Labels are hand-written and therefore only as good as the person who wrote
# them: a "miss" means the expected document did not appear, which is a fact
# about the label as much as about retrieval. Treat a changed number as a signal
# to look, not as a verdict.
set -euo pipefail

REPO=${REPO:-/opt/lore}
COMPOSE_FILE=${COMPOSE_FILE:-deploy/compose/docker-compose.yml}
GOLDEN=${GOLDEN:-$REPO/scripts/ops/golden-questions.tsv}

[ -f "$GOLDEN" ] || { echo "no golden set at $GOLDEN" >&2; exit 2; }

cd "$REPO"
COMPOSE=(docker compose --env-file "$REPO/.env" -f "$COMPOSE_FILE")
DB_NAME=$("${COMPOSE[@]}" exec -T db sh -lc 'echo $POSTGRES_DB' | tr -d '\r')
DB_USER=$("${COMPOSE[@]}" exec -T db sh -lc 'echo $POSTGRES_USER' | tr -d '\r')
DB_NAME=${DB_NAME:-lore}
DB_USER=${DB_USER:-lore}

# The user whose documents these are: the endpoint works in the caller's org and
# a session for the wrong person silently benchmarks an empty workspace.
USER_ID=${USER_ID:-$("${COMPOSE[@]}" exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc \
  "select uploaded_by from documents where uploaded_by is not null
    group by uploaded_by order by count(*) desc limit 1" | tr -d '\r')}
[ -n "$USER_ID" ] || { echo "no documents in $DB_NAME — nothing to benchmark" >&2; exit 2; }

# A read-only endpoint still needs a session. Mint one, use it, revoke it; the
# token is never printed and never stored outside this process.
TOKEN=$(head -c 32 /dev/urandom | base64 -w0 | tr '+/' '-_' | tr -d '=')
HASH=$(printf %s "$TOKEN" | sha256sum | awk '{print $1}')
"${COMPOSE[@]}" exec -T db psql -U "$DB_USER" -d "$DB_NAME" -q -c \
  "insert into sessions (user_id, token_hash, expires_at)
   values ('$USER_ID', '$HASH', now() + interval '30 minutes')" >/dev/null
trap '"${COMPOSE[@]}" exec -T db psql -U "$DB_USER" -d "$DB_NAME" -q -c \
  "delete from sessions where token_hash = '"'"'$HASH'"'"'" >/dev/null 2>&1 || true' EXIT

echo "LORE recall benchmark — $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Scoring the same golden set at a different cap is how a tuning decision gets
# made on evidence, so the sweep runs this script against itself with the cap
# passed through to the inspector. `/chat` never sees these numbers; they exist
# only here.
if [ "${SWEEP:-0}" = "1" ]; then
  echo "sweeping the per-document cap (everything else at its shipped value)"
  echo
  printf '%-14s %-38s %s\n' "perDocument" "rank (hit@1 / MRR)" "evidence diversity"
  for per_doc in 1 2 3 4 6 8; do
    line=$(SWEEP=0 SUMMARY_ONLY=1 PER_DOC="$per_doc" bash "$0" 2>/dev/null |
      grep -E '^(naive|compiled|diversity)' | tr '\n' '|')
    ranks=$(printf '%s' "$line" | tr '|' '\n' | grep '^compiled' | sed 's/^compiled *//')
    div=$(printf '%s' "$line" | tr '|' '\n' | grep '^diversity' | sed 's/^diversity *//')
    printf '%-14s %-38s %s\n' "$per_doc" "$ranks" "$div"
  done
  exit 0
fi

echo "golden set: $GOLDEN ($(grep -cvE '^\s*(#|$)' "$GOLDEN") questions)"
echo

GOLDEN_TEXT=$(grep -vE '^\s*(#|$)' "$GOLDEN") TOKEN="$TOKEN" \
  "${COMPOSE[@]}" exec -T \
    -e GOLDEN_TEXT -e TOKEN app node - <<'JS'
const base = "http://127.0.0.1:3001";
const token = process.env.TOKEN;
const summaryOnly = process.env.SUMMARY_ONLY === "1";
const overrides = new URLSearchParams();
for (const [param, value] of [
  ["limit", process.env.LIMIT],
  ["perDocument", process.env.PER_DOC],
  ["candidates", process.env.CAND],
]) {
  if (value) overrides.set(param, value);
}
const extra = overrides.toString() ? `&${overrides}` : "";
const lines = (process.env.GOLDEN_TEXT || "").split("\n").map((l) => l.trimEnd()).filter(Boolean);

const metric = (rows, doc) => {
  const index = (rows || []).findIndex((row) => row.filename === doc);
  return index < 0 ? null : index + 1;
};

/** How many distinct documents the six passages come from. */
const spread = (rows) => new Set((rows || []).map((row) => row.filename)).size;

const pad = (text, width) => String(text).padEnd(width).slice(0, width);
const rank = (value) => (value === null ? "miss" : `#${value}`);

(async () => {
  const results = [];
  for (const line of lines) {
    const [question, doc] = line.split("\t");
    if (!question || !doc) continue;
    const url = `${base}/recall/context?q=${encodeURIComponent(question)}${extra}`;
    let body;
    try {
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    } catch (error) {
      console.log(`  ERROR  ${question} — ${error.message}`);
      continue;
    }
    results.push({
      question,
      doc,
      model: body.model,
      naive: metric(body.naive, doc),
      compiled: metric(body.selected, doc),
      candidates: body.candidateCount,
      dropped: (body.dropped || []).length,
      naiveDocs: spread(body.naive),
      compiledDocs: spread(body.selected),
    });
  }

  if (!summaryOnly) {
    console.log(`${pad("question", 46)} ${pad("expected", 22)} cand drop  docs  naive compiled`);
    console.log("-".repeat(46 + 1 + 22 + 1 + 4 + 1 + 4 + 1 + 5 + 1 + 6 + 1 + 9));
    for (const r of results) {
      const flag = r.compiled === r.naive ? "" : r.compiled !== null && (r.naive === null || r.compiled < r.naive) ? " +" : " -";
      console.log(
        `${pad(r.question, 46)} ${pad(r.doc, 22)} ${pad(r.candidates, 4)} ${pad(r.dropped, 4)} ${pad(`${r.naiveDocs}/${r.compiledDocs}`, 5)} ` +
          `${pad(rank(r.naive), 6)} ${pad(rank(r.compiled), 9)}${flag}`,
      );
    }
    console.log();
  }

  const summarise = (key, label) => {
    const hits = (n) => results.filter((r) => r[key] !== null && r[key] <= n).length;
    const mrr = results.reduce((sum, r) => sum + (r[key] === null ? 0 : 1 / r[key]), 0) / (results.length || 1);
    console.log(
      `${label.padEnd(10)} hit@1 ${hits(1)}/${results.length}   hit@3 ${hits(3)}/${results.length}   ` +
        `hit@6 ${hits(6)}/${results.length}   MRR ${mrr.toFixed(3)}`,
    );
  };

  console.log();
  summarise("naive", "naive");
  summarise("compiled", "compiled");

  const better = results.filter((r) => r.compiled !== null && (r.naive === null || r.compiled < r.naive)).length;
  const worse = results.filter((r) => r.compiled === null || (r.naive !== null && r.compiled > r.naive)).length;
  const dropped = results.reduce((sum, r) => sum + r.dropped, 0);
  const avg = (key) => (results.reduce((sum, r) => sum + r[key], 0) / (results.length || 1)).toFixed(1);
  console.log();
  console.log(
    `diversity: distinct documents among the passages — naive ${avg("naiveDocs")}, compiled ${avg("compiledDocs")} (of 6 possible)`,
  );
  console.log(`compiled ranks the expected document better on ${better} question(s), worse on ${worse}.`);
  if (dropped === 0) {
    console.log("the per-document cap dropped nothing — no document here crowds the top-6 out.");
  } else {
    console.log(
      `the per-document cap dropped ${dropped} passage(s) across the golden set; the diversity line above is what that buys.`,
    );
  }
  const models = [...new Set(results.map((r) => r.model))];
  console.log(`embedding model(s) used: ${models.join(", ") || "(none)"}`);
})();
JS
