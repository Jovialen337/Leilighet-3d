<!-- PS-REPORT:BEGIN v1 (managed by Prosjekt-Sentral/reporting/install.sh; edits between these markers are overwritten) -->
## Prosjektsentral reporting

This repo reports its work to Prosjektsentral, Daniel's dashboard. Do it yourself; never ask Daniel to copy links.

- Hub: artifact `https://claude.ai/artifact/D4yuK39f5r3HGXLyBTe2jR` (database via the `ArtifactData` tool). Full protocol: database doc `meta/protocol`.
- Project: `p_leilighet` (use this ID; it wins over repo and name matching)
- When: before you finish a turn that did meaningful work (plan, code change, evaluation, decision). Report after your last commit and push. No reports for chit-chat.

PS-REPORT v1 in three tool calls:

1. In parallel: `list` `projects` (limit 1000) and `query` `items` where `externalId == <externalId>`.
   - externalId on the web: `https://claude.ai/code/${CLAUDE_CODE_REMOTE_SESSION_ID/#cse_/session_}`; locally (no such variable): `code:<owner>/<repo>#<branch>`.
   - itemId: `code_session_…` on the web, else `code_<owner>-<repo>-<branch>` (only `A-Za-z0-9_.~-`).
2. Match: the project ID above → `project.repo == <owner>/<repo>` → exactly one project whose name or alias is a whole word in the title or repo. No match → inbox.
3. One `batch`, pinning every doc you read with `if_version`:
   - item: update `{status, lastReportAt, updatedAt}` if found, else set `items/<itemId>` `{projectId, type:"code", surface:"code", title, url, externalId, status, note:"", source:"auto", repo, createdAt, updatedAt, lastReportAt}`;
   - set `activity/a_<ms>_<4 random>` `{projectId, itemId, surface:"code", summary, phaseAfter, nextAfter, at, source:"report"}`;
   - update the project `{phase, lastActivityAt, lastReportAt, updatedAt}`, plus `next` unless `nextEditedAt` > `lastReportAt` (Daniel's edit wins), plus optional `status: "venter"` when the next step needs Daniel.
   - No match: set `inbox/<itemId>` `{status:"ny", surface:"code", title, url, externalId, repo, suggestedProjectId, confidence, reason, at, createdAt, source:"report", report:{summary, phaseAfter, nextAfter, itemStatus}}`.
   - Version conflict: re-read and redo once; if it fails again, write the inbox doc. Never drop a report.

Values: phase `plan|bygg|evaluer|fiks|ferdig`; item status `apen|pagar|venter|ferdig`; `summary` = 1–2 plain Norwegian sentences; `nextAfter` = one concrete next step in Norwegian. Times (`at`, `createdAt`, `updatedAt`, `lastReportAt`, `lastActivityAt`) are numbers in ms (`Date.now()`), never date strings.

Report on your own; there is no Stop hook in this repo.
<!-- PS-REPORT:END -->
