# Bounded claim withdrawal and continuation evidence

The bounded flow now has evidence for reading an owned legacy travel claim, refusing a missing receipt without a partial conversion graph, converting a valid draft, and opening and reloading the resulting report with its retained evidence. Corrected public tests cover withdrawal across refusal and later outage. The focused browser generation adds actual report-link navigation and report reload, and observes both component names through CDP DOM fiber ancestry before conversion. It does not establish successful retired completion or live authorization races.

This is an evidence publication for issue #1748, route R166. The frozen root is `3a3c1243147d92213ffde7ffe423e3da67ecd011`, app tree `1f82885d26e402a0d01556ea7005adba092e9cff`, branch `ai/1692-app-wide-ui-refresh`. These identify the evidence source; later documentation commits are valid. `verifiedCommit` remains null. The issue remains open and the PR remains draft. Root owns the staged Git blob audit, commits, bounded handoff decision and subsequent fresh #1747 merger work. This publication makes no readiness decision.

## Reading the evidence

- [Root claim dispositions](claim-dispositions.json) explain why old runtime ID 42 is unsupported and ID 16 is narrowed, and keep focused IDs 13, 14 and 28 unpassed.
- [Detail STOP](detail-stop/HANDOFF.md), [conversion STOP](conversion-stop/REPORT.md), and the exact [detail](root-checks/detail-correction.json) and [conversion](root-checks/conversion-correction.json) correction receipts preserve the earlier reds and attempts.
- [Independent review](independent/REPORT.md), [its native intake](intake-audits/independent.json), and [root recheck](root-checks/independent-recheck.json) explain corrected-source test accounting.
- [Runtime generation A](runtime/HANDOFF.md), [native intake](intake-audits/runtime.md), [focused generation B](focused/HANDOFF.md), and [focused intake](intake-audits/focused.json) distinguish producer observations from intake checks.
- [Payload index](payload-index.json), [source pins](source-pins.json), [file index](file-index.json), [publication seal](publication-seal.json), and [verification results](verification-results.json) describe bytes and publication validation. The [appendix text](report-appendix.txt) is the exact appended report suffix.

## What changed and what did not

The original detail P1 sequence, 200 to 404 to 503, exposed an incomplete new withdrawal guarantee over inherited evidence retention. It was not a live authorization bypass. The conversion P1 sequence, available to canonical Unauthorized to outage, was an incoming presentation regression relative to baseline, also not a live authorization bypass. Detail was corrected in `4cab7a5b594db3bc7e4dfdf56026d25737a2b2f4`, integrated by `a043fd9af51465e608bb6d00f5568e72f11d8300`. The shared correction was `4a6eaaa2f3f2ee5ac25055b0fdc11722028b3186`, integrated by `c696178cac11641eff69ce0cd3045204eb91059a`. Canonical reads, authority, conversion and settlement remain unchanged. The STOP reports and failed harness attempts are immutable historical evidence; none were rerun or relabeled by publication.

## Independent corrected-source review

The fresh independent review froze `16a914f4a4e9ef022552ff53d938b2c1f883517f` and the same app tree. Its 545 unit identities across 48 physical files comprise root's 518 plus 27 independent/control identities, including three baseline controls. Its 51 canonical PostgreSQL cases span four files at default timeouts. Root's earlier 518 and full three type checks are separate results. In the isolated review, main TypeScript was qualified by missing ignored `licenses.json`; no license was copied or repaired. Type generation, workflow and smoke types, lint and Doctor passed. Ordinary formatting findings on two owned files and two shared metadata files remain recorded; explicit owned formatting passed. There is no blanket archive whitespace or lint pass.

These tests assemble the actual organization provider, QueryClient, header Refresh where applicable, history and list consumers. They exercise public test controls rather than live authority races. The 61 SAFE payloads total 761,942 bytes. The original report and evidence path audit covered 75 paths; 18 original worker PNGs remain historical and are not copied here. Native intake decoded them historically, without a new visual review. Seven of eight historical capture hashes reconcile. The conversion after-capture predates final lifetime handling. Two large-font images are duplicates; crops and development overlays limit comparisons. Earlier bailed harness runs reported zero pending while each actual case array had three pending; those attempts are retained and add no coverage.

## Runtime generation A and root dispositions

The producer declares 140 PASS records: 46 runtime, 88 database readback/preservation, and six source/resource checks. These are not 140 accepted independent passes. Native intake identifies old ID 42's both-React-name claim as unsupported/stale: the approved readback contains only `TravelExpenseClaimDetail`. Old ID 16 establishes the correct route/claim reload, not an actual report opening. [Root dispositions](claim-dispositions.json) preserve both original ledger rows and qualify their meaning.

The producer download receipt states a completed 68-byte, 1 by 1 PNG, SHA-256 `6b1048f8a6d40bac0b2954c18fefa40c4ea7a96120fc2e54b7317c0e43c2bbec`. Its bytes are excluded and were not freshly decoded by intake or publication. Producer readbacks record a real missing-object refusal with zero partial graph, one valid report/item/receipt/provenance graph, and a local EUR 1.25 reimbursement leaving EUR 119.25. No external money moved. Actual other-employee and foreign-organization reads returned 404. Non-authentication 503 Retry controls were synthetic. Preference reload, keyboard behavior, bounded layouts and connected Next diagnostics have receipts; no broad production acceptance follows.

Original rows, foreign data and timekeeping preservation are comparisons of producer digest receipts, not fresh database reruns. The initial seed error printed synthetic row identifiers, with no credential exposure reported; SAFE excludes raw inputs and logs. Current cropped captures are not matched historical recaptures. Generation A initially left late held retirement, pending partial-approval/intermediate-only fallback, held duplicate conversion, axe, exhaustive races and report-editor reload unproved.

## Focused generation B

The focused ledger has 29 PASS records out of 32. IDs 13 (pre-release route commitment), 14 (successful retired completion), and 28 (main axe acceptance) remain UNPASSED. Native CLI React-extension acceptance is also unproved, a method limitation outside those three counted rows. No tool was installed.

Fresh CDP DOM fiber ancestry actually listed both `TravelExpenseClaimDetail` and `LegacyDraftConversionPanel` before conversion. This was not the native React extension. The actual Open the report link click, report arrival and report-page reload retained provenance, the original-draft link, multiline notes, receipt, EUR 42.80 and expense date. This proves neither editor save nor submit. These new observations close evidence gaps without rewriting generation A IDs 42 or 16.

Two fresh seeded business drafts produced two canonical graphs. Only four expected graph tables changed, each by two. Original row sets and six actual timekeeping digests compare unchanged in the producer snapshots. All 29 foreign travel tables were empty both before and after: these are qualified empty controls, not populated foreign preservation. There was no new money action. Earlier wrong readback keys/date comparisons remain recorded harness failures.

One genuine successful server response was held after persistence. Pending state, an actual Back click, unmodified release, and finished rather than cancelled delivery were observed; the final URL stayed on the list. This supports the bounded end state only. The combined pre-release wait timed out because it wrongly required notes to disappear everywhere while the legitimate destination list retains them. There is no separate pre-release URL or lifetime-cleanup receipt. Successful retired completion and ordering remain unproved. One initial raw seed exception file was overwritten; only its bounded classification survives. Its missing bytes were not reconstructed. Current captures retain development overlays/header loading, and the list crop clips a few title pixels.

## Scope, cleanup and remaining work

Runtime assertions, readbacks, preservation predicates, inherited/root test cases and reruns are separate measures. They are not one combined coverage count. Both runtime generations ran zero new unit cases, PostgreSQL suites or builds. Each generation's producer cleanup records removal of three exact services and zero owned processes, profiles, contexts and ports. Native intakes qualify these as historical cleanup/source-preservation receipts, rather than fresh OS inventories. Both runtime leases are released with ownership false and zero resources. Producer preservation reports retain 18,587 tracked files, the index, 125 license entries, lockfile and 158 root/app dependency links unchanged. Publication independently checks its initial/final index hash and the 14 source pins; it makes no unchecked application-configuration claim.

Full production generation, Tolgee/catalogs, providers, devices, true zoom, exhaustive live authority combinations, the global 157-node review and final user review remain unpassed. Root readiness is not delegated.

## Byte identity and portable verification

All 172 payloads are exact copies, totaling 2,297,645 bytes: 11 detail STOP, 21 conversion STOP, 61 independent, 34 runtime, 36 focused, six native intake audits and three curated root receipts. The five source input indexes are copied exactly under `input-indexes/`. The exact input contract is [preserved](input-contract.json). Only those explicit inputs are read; excluded-hash-only metadata does not authorize following its targets. Private inputs, authentication state, raw headers/bodies, failure images, original 18 worker images and downloaded receipt bytes are excluded.

The 14 source clones are text snapshots from frozen `git show`, not active code. Raw clone SHA-256, size and Git blob SHA-1 match the frozen contract. A Git blob ID is computed from `blob <byte length>`, a NUL byte, and the raw clone bytes. Only `--current-source` compares current materialized TS/TSX files after replacing CRLF with LF. No payload, input index, clone or archived JSON is normalized. Future legitimate source drift, including additive heading changes, may fail current-source mode without invalidating this archive.

The new archive-local `.gitattributes` disables text conversion for this directory only. Root must still inspect staged Git blobs. `file-index.json` hashes every archive file except itself and `publication-seal.json`; the seal hashes the file index and principal indices. This avoids self-hash cycles. The seal is an integrity inventory, not a signature or a verified integration commit.

From the repository root, use the already installed pinned pnpm 12.16.1 with both dependency-verification guards:

```powershell
$env:pnpm_config_verify_deps_before_run = 'false'
pnpm --config.verify-deps-before-run=false exec node docs/design/rollout-1692/1748/root-withdrawal-and-continuation/verify.cjs
pnpm --config.verify-deps-before-run=false exec node docs/design/rollout-1692/1748/root-withdrawal-and-continuation/verify.cjs --current-source
```

The default verifier needs only Node built-ins and archive files; it does not require Git, a build, dependencies or current repository source. It checks all indexed bytes, source clone identities, pins, seal, semantic counts/dispositions, JSON and new archive Markdown links. Current-source mode additionally reads the 14 current files. Neither mode checks current HEAD equality. The verifier only reads files and writes stdout/stderr; it has no network, subprocess, archived imports, evaluation or file writes. Original historical scripts and tests are evidence and must not be executed as part of verification.
