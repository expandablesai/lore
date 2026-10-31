# Operations runbook

How to look after a deployed LORE installation: the same three scripts the
doctor, the backup and the restore drill use, and what to do when each check
goes red.

All of them run **on the host that runs the stack**, from the repository
(`/opt/lore` by default) with `docker compose`. They change nothing unless told
to; `doctor.sh` never changes anything at all.

```bash
./scripts/ops/doctor.sh                  # read-only health report
./scripts/ops/backup.sh                  # one directory per run, checksummed
./scripts/ops/restore.sh --into lore_restore   # drill into a throwaway database
./scripts/ops/repair.sh                  # dry run; add --apply
```

## The doctor

`doctor.sh` answers one question: **is this installation telling readers
something untrue?** Everything that would make a document claim something the
system cannot deliver is a `FAIL` and the exit code is 1, so it can be wired into
a timer or a monitoring check.

What it checks:

| Section | Failure it catches |
| --- | --- |
| stack | a service that is not running (except `web`, which is a one-shot dist copier and is *supposed* to exit) |
| api | `/healthz` and `/readyz` not answering 200 |
| database | unreachable database; missing pgvector; migrations applied ≠ migrations on disk; how many RLS policies are installed (warns at zero) |
| key material | `LORE_ENCRYPTION_KEY` missing; **the key fingerprint changed** (which makes every stored provider key unreadable); provider keys whose ciphertext is not `iv:tag:ciphertext` |
| embedding space | one org holding vectors from two models; zero vectors; orphan vectors; chunks with no vector |
| documents | a document that says `indexed` but has no chunks; an extraction stuck over 15 minutes; the most recent failures with their reasons |
| blobs | a document whose file is not on the disk |
| backups | no backup directory, or a newest backup older than a week |
| disk | a mount at 80% (warn) or 90% (fail) |
| console | Caddy has no `/srv/assets`, so the console cannot load |
| lock | the design/feature lock is violated (skipped when the host has no node) |

The encryption-key fingerprint is remembered in
`/var/lib/lore/doctor-key-fingerprint` on first run. It is a 16-character hash of
the key, never the key: the point is to notice rotation, which is silent and
permanent. **What the doctor cannot prove is that the key actually decrypts.**
Ciphertext shape is checked, not a decryption, because decrypting every key means
running the API's own code path against production. The honest test of that is
`POST /orgs/:id/llm-keys/:keyId/test` on a key you care about.

## The backup

One directory per run under `/srv/lore/backups/<UTC stamp>/`:

```
db.dump         pg_dump -Fc, replayable with pg_restore
db.toc          pg_restore --list of that dump — the proof it can be read
blobs.tar.gz    the uploaded files, which the database only names
manifest.txt    row counts, blob count, git commit, and sha256 of both files
```

`KEEP=7` directories are retained (oldest pruned). `BACKUP_DIR=/mnt/nas/lore`
moves it off the machine — worth doing, because a backup on the same disk as the
database survives neither a disk failure nor a bad migration.

Verify a run without trusting it:

```bash
cd /srv/lore/backups/<stamp>
grep -E '  (db\.dump|blobs\.tar\.gz)$' manifest.txt | sha256sum -c -
```

A **restore drill** is the only proof. Do it after every schema change, and
monthly besides:

```bash
./scripts/ops/restore.sh --into lore_restore
# counts printed must equal manifest.txt
```

`restore.sh` refuses to overwrite the live database without `--force`, because
the failure mode of getting that wrong is indistinguishable from losing the
product.

## The repair

Two inconsistencies can only be *reported* by the doctor, so `repair.sh` fixes
them:

- **orphan vectors** — a chunk was deleted without its vector. They are deleted.
- **stale space** — a document was indexed while the org used one embedding
  model, and the org has since moved to another. Its chunks live in a vector
  space no query will ever embed into, so the document is unretrievable while
  still claiming `indexed`. The repair re-processes each affected document
  **through the product's own reprocess endpoint**, so the new vectors come from
  exactly the code path a normal upload takes. It mints a 30-minute session for
  the document's owner, uses it, and deletes it; the token is never printed.

Dry run first — it always prints what it would do.

```bash
./scripts/ops/repair.sh                # what would change
./scripts/ops/repair.sh --apply        # do it
```

## Deploying a change

```bash
cd /opt/lore
git fetch --all && git reset --hard origin/master
docker compose --env-file .env -f deploy/compose/docker-compose.yml build app
docker compose --env-file .env -f deploy/compose/docker-compose.yml up -d --force-recreate app worker
```

- Build `app`, not `web`: `app`, `worker` and `web` share one image
  (`ghcr.io/expandyne/lore:latest`), and `web` is a one-shot container that
  copies the built console into the `web_dist` volume and exits — `Exited (0)` is
  normal, not a crash.
- If only the console changed, re-create `web` and then `caddy` so it picks up
  the new mount contents.
- After any deploy: `./scripts/ops/doctor.sh`.

## When something goes red

**A document is stuck in `extracting`.** No action. The worker reaper runs at
startup and every 60 s; it fails the row with a reason within a minute. If it
does not, the worker is not running — `docker compose logs worker`.

**`GET /chat` returns "no active LLM key for this org".** The org has no enabled
chat key. `POST /orgs/:id/llm-keys` with an enabled key, or enable an existing one
with `PATCH /orgs/:id/llm-keys/:keyId`.

**Ingestion fails with "no active key can embed with X".** The org's vectors are
in a space that no enabled key can reproduce. LORE refuses to mix spaces on
purpose: re-enable a key using that model, or use `repair.sh --stale-space` once a
key for the new model exists.

**The doctor says the encryption key changed.** Do not restart anything else, and
do not "fix" it by regenerating again. Every stored provider key was encrypted
with the old value and is now unreadable; they all have to be re-entered. Restore
`LORE_ENCRYPTION_KEY` from wherever it was recorded — that is the whole reason
the fingerprint is checked.

**The console is blank after a deploy.** Check `doctor.sh`'s console section. If
Caddy has assets, the page is cached; hard-reload. If it has none,
`docker compose up -d --force-recreate web` and check the `web` container log.

**Disk is filling.** The largest consumers are `/srv/lore/blobs` (uploads, kept
per document retention) and the docker volumes. Prune old backups deliberately
rather than deleting the newest.

## What the doctor deliberately does not do

- It does not fix anything. A doctor that edits production cannot be trusted to
  diagnose it; repairs are a separate, visible act.
- It does not prove decryption (see above), and it does not test upstream
  providers — that is the key-test endpoint's job, and it costs a real call.
- It does not check the design/feature lock unless node is installed; that check
  belongs in CI, where node is guaranteed.
