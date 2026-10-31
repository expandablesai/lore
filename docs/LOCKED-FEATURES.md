# Locked features

Frozen on **2026-11-01** at the owner's request: *"lock the current design system
until i ask for a change — current features should also be locked and saved in
your database and must be persistent."*

This file is the human ledger of everything LORE already does. `lore.lock.json`
holds the machine copy of the same contract, and `node scripts/lock.mjs`
(`pnpm lock:check`) fails when the surface drifts away from it:

- a **locked** row may never lose its test, its route or its screen;
- a **new** row must be added with the test that proves it — the checker
  refuses any row that names no test file, or names one that does not exist;
- a change to the frozen design system is a separate, sanctioned act (see
  [`LOCKED-DESIGN.md`](./LOCKED-DESIGN.md)).

A row is a promise to the reader, not a description of code. "Guarantee" says
what must stay true; "Proof" is the test that fails if it stops being true.

## Identity and access

| Feature id | Guarantee | Proof |
| --- | --- | --- |
| `signup-login-session` | An account can be created, signed into, and held across reloads; logout revokes the session server-side | `apps/api/src/routes/auth.test.ts`, `apps/web/src/lib/auth.test.tsx`, `apps/web/src/lib/session.test.ts` |
| `login-screen` | Sign-in and sign-up share one screen, and a rejected credential shows the server's own message | `apps/web/src/views/Login.test.tsx` |
| `password-change` | Changing the password requires the current one, holds the signup floor, ejects every other session, and is refused when the confirmation does not match | `apps/api/src/routes/m9.test.ts`, `apps/web/src/views/Profile.test.tsx` |
| `org-membership` | Organizations and their members are listed, a member can be added when the caller may manage the org, and a viewer never sees the form | `apps/web/src/views/Members.test.tsx`, `apps/api/src/routes/m1.test.ts` |
| `tenant-isolation` | An id in a request body or path never widens what the caller may touch — no cross-org read, write or delete, no self-promotion | `apps/api/src/routes/m7.test.ts` |
| `role-ceiling` | A role is only ever granted at or below the granter's rank, and `superadmin` cannot be minted through the member API | `apps/api/src/routes/m7.test.ts` |

## Memory

| Feature id | Guarantee | Proof |
| --- | --- | --- |
| `assertion-ledger` | Assertions are hash-chained, an unconfirmed event never claims trust, and forgetting a document cascades to everything derived from it | `apps/api/src/routes/m2.test.ts` |
| `memory-recall` | A query recalls org assertions with their trust and provenance, and the embedder used is the one the stored vectors live in | `apps/api/src/routes/m2.test.ts`, `apps/web/src/views/Memory.test.tsx` |
| `memory-write` | A `subject / predicate / object` triple can be remembered and is validated before it is stored | `apps/web/src/views/Memory.test.tsx` |
| `memory-forget` | An assertion can be forgotten from the recall results, scoped to the org | `apps/web/src/views/Memory.test.tsx` |
| `note-capture` | Pasted text becomes a markdown note, and the receipt reports what was indexed with its timestamps and who saved it | `apps/web/src/views/Capture.test.tsx` |
| `ingestion-pipeline` | Upload is deduped, chunked, embedded in one transaction, and reprocessable; a document never reports `indexed` with zero vectors | `apps/api/src/routes/m3.test.ts` |
| `document-library` | Documents list with status, a failure explains itself, and several files of mixed type upload in one batch without one rejection stopping the rest | `apps/web/src/views/Documents.test.tsx` |
| `document-detail` | A document shows its metadata and its extracted chunks | `apps/web/src/views/DocumentDetail.test.tsx` |

## Conversation

| Feature id | Guarantee | Proof |
| --- | --- | --- |
| `chat-turn` | A question becomes a conversation on first use, appends on later turns, and answers from stored memory and documents | `apps/api/src/routes/m5.test.ts` |
| `chat-history` | A conversation is scoped to its owner, listed, renameable, deletable | `apps/api/src/routes/m5.test.ts` |
| `chat-composer` | Enter sends, Shift+Enter writes a new line, and the Enter that commits an IME candidate never sends | `apps/web/src/views/Chat.test.tsx` |
| `chat-images` | Image documents are attached only when the question asks for them, and never leak into the text context | `apps/web/src/views/Chat.test.tsx` |
| `memory-across-chats` | What the reader says in one conversation — their name, where they live, what they prefer — is a durable fact available in the next conversation | `apps/api/src/routes/m10.test.ts` |
| `message-metadata` | Every message carries when it was said, and one click copies it | `apps/web/src/lib/time.test.ts` |

## Model access

| Feature id | Guarantee | Proof |
| --- | --- | --- |
| `llm-keys` | A provider key is encrypted at rest, tested before use, switchable off without revocation, and its plaintext is org-scoped | `apps/api/src/routes/m4.test.ts`, `apps/web/src/views/LlmKeys.test.tsx` |
| `provider-dispatch` | OpenAI-shaped, Anthropic-shaped, Ollama, and custom providers each speak their own dialect; a chat-only provider never receives an embedding call | `apps/api/src/routes/m4.test.ts` |
| `answer-language` | The interface language reaches the model, so an answer arrives in the language the reader reads | `apps/api/src/routes/m8.test.ts` |

## Console

| Feature id | Guarantee | Proof |
| --- | --- | --- |
| `interface-language` | The interface follows the browser by default, the profile choice overrides it, and an untranslated sentence stays readable in English | `apps/web/src/lib/i18n.test.tsx`, `apps/api/src/routes/m8.test.ts` |
| `appearance` | Light, dark and system are a palette swap on one document attribute; the choice is remembered locally and pushed to the profile | `apps/web/src/lib/theme.test.tsx`, `apps/web/src/views/Profile.test.tsx` |
| `viewport-shell` | The console owns the viewport: the header and the sidebar never scroll away, only the content column moves | `apps/web/src/Shell.test.tsx` |
| `dashboard` | The dashboard greets the reader and lists their organizations, and says so when they cannot be loaded | `apps/web/src/views/Dashboard.test.tsx` |
| `profile` | A picture uploads, appearance writes through, and the password panel sits with the rest of the profile | `apps/web/src/views/Profile.test.tsx` |
| `api-client` | Every call roots at the same-origin `/api` base, carries the bearer token, and surfaces the server's error message | `apps/web/src/lib/api.test.ts` |

## Operations

| Feature id | Guarantee | Proof |
| --- | --- | --- |
| `health-probes` | Liveness and readiness answer independently of tenant data | `apps/api/src/routes/auth.test.ts` |
| `encryption-at-rest` | Key material and stored secrets need the configured key present to be written, and an immutable key per installation | `apps/api/src/routes/m2.test.ts` |
| `chunking` | Text is chunked with overlap and a hard cut, so an oversized run never produces an oversized chunk | `packages/core/src/chunking.test.ts` |

## How to change a locked feature

1. Change the code and the test that proves the promise.
2. Run `pnpm lock:check` — it will name exactly what drifted.
3. If the owner sanctioned the change, record it:
   `node scripts/lock.mjs update --reason "planned: <what and why>"`.
4. Commit the lock file **with** the change, so the ledger and the code move
   together. A lock update without a code change, or a code change without a
   lock update, is a mistake.
