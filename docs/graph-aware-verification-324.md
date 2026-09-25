# Graph-aware verification and audit assurance (#324 / T59)

## Delivery and activation status

Verification and audit-pack consumers now resolve append lineage with the same
compatibility rules as fresh-append admission (#273). They no longer use
creation-time adjacency or follow stored IDs only. This is the bounded
"graph-aware diagnostics/audit disclosure" correction that
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145)
allows to ship before activation. It reads evidence only. It writes no history, and it
neither activates admission nor starts a continuation.

References: [#324](https://github.com/Umami-Creative-GmbH/z8/issues/324),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the
[#262 resolution](https://github.com/Umami-Creative-GmbH/z8/issues/262#issuecomment-5654495073)
§1, §7 and §8.

## One assurance module, four separate claims

`lib/time-tracking/append-assurance.ts` assesses one organization/employee scope.
The input is every retained entry, the append position and whether scoped work
exists. `append-assurance-reader.ts` loads that input in one read-only
repeatable-read snapshot, so a concurrent append cannot look like an interruption.

| Claim | Meaning | Never implies |
| --- | --- | --- |
| Hash reproducibility | Per entry: `reproduced`, `not_reproduced`, or `input_unavailable`. A hash that does not reproduce may be in another format; the format is not guessed and the entry is not verified. | Row identity, organization, creator, creation time, captures, notes, or replacement links. |
| Predecessor identity | Per entry, `link`: `root`, `stored` (explicit ID agreeing with `previousHash`), `derived` (read-only unique hash match), or `unresolved`. Original `stored` fields are kept as recorded. | That a derived link was ever written. |
| Lineage | `empty`, `single` (root and tip), or `review_required` with the #262 issues (forks, islands, holes, cycles, cross-scope, ambiguous duplicates). Scoped work without entries is `history_without_entries`. | Continuity. |
| Continuity | From the append position: `not_adopted`, `established` (provenance: admission, anchor ID/hash, admitted count and time, tip, and the post-anchor entry IDs), or `interrupted` (tip missing or changed, count change, broken post-anchor path, or a successor off the anchor or post-anchor path). | Verified history before the anchor. |

`resolveAppendLinks` in `append-lineage.ts` is the shared per-entry resolver.
`classifyAppendLineage` (admission) and the assurance module both use it.

The **assurance scope** combines the claims:

- `whole_history`: the lineage is single (or genuinely empty) and no recorded
  position is interrupted.
- `post_anchor`: continuity is established but earlier history no longer verifies.
  This adds `history_before_anchor_unverified` with the anchor ID. It is never
  presented as genesis-to-tip.
- `none`: everything else, including stored evidence that forms one lineage after an
  unexplained write interrupted the position.

Limitations are explicit codes. `hash_commits_event_fields_only`,
`original_actor_and_capture_unproven` and `payroll_readiness_not_assessed` always
apply when entries exist. The conditional codes are `derived_links`,
`hash_not_reproduced`, `hash_input_unavailable`, `duplicate_hashes` (disclosed, not a
failure), `no_continuity_position`, `continuity_interrupted`,
`history_before_anchor_unverified` and `lineage_unresolved`.

## Verification endpoints

- `POST /api/time-entries/verify` returns `{ diagnostics, assurance }`. Record-level
  reports (IDs, candidates, discrepancies, provenance) go to operators: callers who
  can manage **that** employee's time entries through a CASL subject check, or org
  admins verifying themselves. Every role self-manages its own entries, so an
  employee or manager verifying their own history gets `summarizeAppendAssurance`:
  statuses, scope, limitation codes and counts, with no identities.
- The target check is now subject-scoped. Before this change, the route used a
  string-level `can("manage", "TimeEntry")`, so a manager could verify any employee in
  the organization, not just direct reports. `GET` uses the same subject check.
- `GET /api/time-entries/verify` still returns the digest, now labeled
  `claim: "change_digest"`. It is computed in ID order and no longer depends on
  creation time.
- `GET /api/time-entries/:id` keeps its hash fields and adds
  `claim: "hash_reproducibility"` plus its limitations.
- The creation-time `validateChain` and `validateChainDetailed` helpers are removed.

## Audit packs

- Expansion runs in one evidence snapshot. It assesses every employee whose entries
  the pack includes. It follows the **resolved** append predecessor (stored or
  derived) plus the correction links (`replacesEntryId`/`supersededById`), and loads
  more employees only when a correction link reaches another employee's entry.
  A stored `previousEntryId` that does not resolve in the employee's scope is
  preserved but not followed. Missing correction evidence still fails the pack with
  `lineage_broken`.
- `evidence/entries.json` and `views/entries.csv` keep the original stored fields.
  They add `employeeId`, `type`, `hash { stored, previousHash, status }` and
  `appendLink { resolution, predecessorId }`.
- New `evidence/append-assurance.json` holds one record per assessed employee:
  claims, issues, continuity provenance and limitations. Per-entry detail is left
  out; `entries.json` carries the included entries.
- `meta/scope.json.appendAssurance` and `audit_pack_artifact.append_assurance`
  (migration `0081`, nullable for older packs) record the scope counts and the
  union of limitation codes. The audit-pack card shows "Limited lineage assurance
  for N of M employees", "Lineage verified from stored evidence for M employees", or
  "Lineage assurance not recorded" for older packs.
- Lifecycle: the column lives on the existing artifact row, which cascades with its
  request and organization. There is no new lifecycle to clean up.

## Payroll

Append assurance is not a payroll input. `getPayrollReadiness` reads canonical work
records only. The PostgreSQL suite shows that an injected fork (an append defect)
leaves the readiness result identical. The `payroll_readiness_not_assessed` code
states this in every report.

## Verification

### PostgreSQL (2026-09-25)

Suite: `apps/webapp/src/lib/time-tracking/append-assurance.integration.test.ts`. It is
registered in `scripts/run-approval-workflow-repository-integration.sh` and in the CI
`integration-tests` job. It runs the real verify route (membership/SSO/principal/CASL
from the database), the real `clockIn` action with append admission, the real
audit-pack job (`processAuditPack`) and `getPayrollReadiness`. Only the session,
headers, billing provisioning, notifications, Next cache and the audit-export
signing/S3 boundary are replaced.

Verified (8 tests, fresh label-owned PostgreSQL 16 container, full migration chain):

- Mixed graph and hash families: hash-only and explicit links, a provider-format hash,
  a cross-organization predecessor ID and a hole. The operator gets derived/stored
  labels, unchanged stored fields, the `not_reproduced` entry and the issue set. The
  foreign-organization row is never loaded.
- An employee verifying their own history gets the summary with no entry IDs.
- Authorization: a manager gets 403 for a non-report and record-level output for a
  direct report. An employee gets 403 for a peer. A manager or employee verifying
  themselves gets the summary. An owner verifying themselves gets record-level
  output. Another organization's employee returns 404.
- Duplicate hashes are disclosed. A hash-only link into two equal-hash rows stays
  `ambiguous_predecessor` with both candidates.
- After a real admitted clock-in on a hash-only lineage, continuity is `established`
  with anchor, admitted count and post-anchor entry, and the scope is `whole_history`.
  Changing a hashed field before the anchor narrows the scope to `post_anchor`. A
  bypassing write after the tip interrupts continuity, and the scope becomes `none`.
- An audit pack includes an out-of-range predecessor reached only through a derived
  link. It does not follow a cross-employee stored ID. It writes
  `append-assurance.json` for both employees and records the same summary in
  `scope.json` and on the artifact. A missing correction target fails the pack with
  `lineage_broken` and stores no artifact.
- Payroll readiness is identical before and after an injected fork.

Mutation check: following the raw `previousEntryId` again in the closure, and going
back to the string-level CASL check, each failed its test.

### Database-free

- `append-assurance.test.ts`: the claim and scope matrix (16 tests), including input
  order independence.
- `audit-pack/domain/__tests__`: resolved-link closure, evidence labeling, pack
  records and summary, and the CSV columns.
- `audit-pack-generator-card.test.tsx`: the three disclosure states.
- Existing lineage, hash-compatibility and demo tests were ported from the removed
  creation-time validators.

## Remaining activation blockers

This slice closes on implementation (see #264 decision, 2026-09-25). Activation
items move to #327/#329/#331:

- Authorized continuation (#323) will add a continuation admission kind. The
  assurance module already reports continuity from any recorded anchor, so it must
  keep presenting pre-continuation history as a limitation. Verify this once
  #323 persists continuations.
- Record-level historical diagnostics UI and broader operator surfacing (#319).
  This slice exposes the API and the pack disclosure only.
- All-writer participation (#327). Until then, legacy writers interrupt continuity
  in adopted scopes, and the verifier reports that honestly.
- Measuring the O(history) snapshot read for large employees and packs belongs in the
  #329 pilot.
