# Corrected #1748 independent bounded review

**Stopped at the first confirmed P1.** No fixes, commits, tracker writes, push/PR/readiness operations or live runtime acceptance occurred. `verifiedCommit` stays null. Review performed directly, without subagents, using the existing Pocock standards/spec flow and relevant React composition/performance and Web Interface Guidelines references. The user-supplied existing claim was honored; no duplicate claim/comment was added.

## Candidate and source identity

- Candidate/checkout HEAD: `2404a1e0404e5079c56e51c290629455f798f9f5`.
- App tree: `21de4ad559b7cfac4e8c168f8f7144f30e6780e5`.
- Original implementation: `6144dbb54f4398436ec6b95ad37ef32fd6ab0ca8`.
- Original provisional merge: `df0fafc4d827969d37482df69cfe2abb92fee599`.
- Dedicated correction: `4cab7a5b594db3bc7e4dfdf56026d25737a2b2f4`; integration `a043fd9af51465e608bb6d00f5568e72f11d8300`.
- Pinned premerge control: `85d6a75b4522e84fc701d0bf98f9dda5a9f8aaf4`.

Both requested checkout pins were verified before investigation. `pins-before.json` and `pins-after.json` record actual source/config/lock byte lengths and SHA256, Git blobs, dependency topology and unchanged checks. The producer receipt's nine raw source hashes differ from this checkout's materialized line endings; all nine Git blob IDs match the producer pins and all working files equal those blobs after CRLF normalization. No source normalization was performed. Raw-byte receipts and normalized identity are explicitly separate.

pnpm 12.16.1 installed 1,823 packages from the offline store with frozen lockfile, physical copy import and `--ignore-scripts`; zero downloads. Both node_modules roots are physical directories; the recorded relevant package links resolve inside this checkout. No root/peer dependencies or runtime were borrowed. Initial restricted version probing printed fallback 12.21.0, and the following attempted install failed at the engine-store lock before package work. The escalated version guard confirmed 12.16.1 before the successful install; no tests or successful install used fallback pnpm. Every package call had both required dependency-verification settings. No lifecycle retry, license generation/copy, suppression or dependency upgrade occurred.

## Spec finding: P1 — conversion-owner refusal is lost on the next failed read

Location: `apps/webapp/src/components/travel-expenses/legacy-draft-conversion.tsx:324`, with retained-data rendering at line 369 (query failure at lines 316–320).

The real assembled `TravelExpenseClaimDetail`, `OrganizationContextProvider`, `QueryClient` and `LegacyDraftConversionPanel` were mounted. Only external session, HTTP, server-action, navigation and translation boundaries were adapted. No internal hooks, query factory, private controller or source-text assertion supplied product proof. The synthetic own draft's detail GET remains successful throughout, isolating the conversion-owner result from the independent claim reader.

1. Conversion read succeeds with an existing report ID: **Open the report** is visible.
2. Invalidating the public `['travel-expenses']` query family returns the canonical conversion-owner error `Unauthorized`: the link disappears and the current-reader refusal appears.
3. Invalidating that same family again returns only a transient service failure: the previous report link **reappears**, alongside the local transient error and Retry. No new successful conversion read or conversion action occurred.

The settled assertion is `reportLinkVisible: false`; the actual value is **true**. The test also waits until fetching settles, verifies exactly three conversion reads, confirms no conversion write or navigation, and retains the successful claim notes and receipt link as independent controls. React Query retains the previous successful report data; a later error replaces the refusal error, so the refusal-only early return no longer protects that data.

This fails the incoming handoff's explicit promise that a canonical owner refusal withdraws the known conversion link and R166's requirement to offer conversion only when currently offered, preserving scope, permission-loss handling and recovery. The correction fixes the analogous detail HTTP cache outcome but leaves the shared conversion cache on the old error-only pattern.

### Controls and inherited/incoming distinction

All five independent controls pass before the final failing objection:

- Available conversion link survives an ordinary transient failure and recovers using the actual Retry button.
- Initial `Unauthorized` and initial `Travel expense claim not found` expose neither the report link nor continuation action, while the independent authorized detail remains visible (two cases).
- The exact pinned baseline conversion module, used by the pinned baseline detail, hides the cached report link after both the canonical refusal and the subsequent transient failure (two cases).

The baseline conversion module is byte-exact Git source. The baseline detail has exactly one test-only import redirection to that module, recorded in `bridges.json`; every other byte is unchanged. It uses the same real provider, QueryClient and synthetic external boundaries as the candidate. The source templates and hashes are preserved, and the temporary bridges have been removed.

**Classification:** inherited Query cache retention, with an incoming presentation regression relative to this baseline: baseline hides the link on every read error, whereas incoming intentionally retains known links during transient errors and consequently revives one after a canonical refusal. This is an incomplete new durable-withdrawal guarantee, not evidence of a new backend authorization vulnerability. Synthetic public-seam acceptance establishes a presentation/cache failure only. No live permission revocation, server assertions, report access, receipt-byte access or cross-organization authority bypass was tested or inferred.

## Fresh results and stop boundary

| Fresh run | Result |
| --- | --- |
| Existing detail + shared consumers + permanent withdrawal | 36/36 passed: 23 + 5 + 8 |
| New independent controls and critical conversion objection | 5 passed / 1 failed |
| Deduplicated review total | **42 distinct cases / 4 physical test files; 41 passed / 1 P1 failed** |

Deduplication is by physical file, full test name and occurrence; `test-multiset.json` retains each case. The 36 existing cases overlap root's 508-case result. No historical worker 124 units/51 PostgreSQL cases, root rerun, or prior review 32-case result is added. The new six are independent review cases; baseline controls do not enlarge the product compatibility claim.

The primary corrected detail sequence `200 → 404 → 503`, its authorized `200 → 503 → 200` control and initial-refusal control pass in this fresh run. All eight permanent withdrawal cases pass, including 401/403/404 recovery via Retry, rejected reads/failed Retry and cache reset. The five shared consumer cases re-test the #1747 pending-session regression in actual history and retained-list consumers, queued activation retirement, later-account refusal suppression and A → B → A retirement. The existing 23 detail cases include Activity/scope arrivals, queued/duplicate continuation and settlement canaries. These are synthetic public-seam checks, not live acceptance.

On the first confirmed P1, broader acceptance stopped. **Not run:** additional repeated-network/transport matrices, new cache-removal/provider/Activity/late-conversion objections beyond existing cases; management/list/history/settlement/i18n/SiteHeader/route-metadata/extracted-default/conversion-domain compatibility selection; canonical disposable PostgreSQL claim-read, conversion, finance-settlement and expense-officer-access; workflow/smoke/main TypeScript; lint; explicit 100-column CRLF and ordinary formatting; installed bounded Doctor 0.9.22 with explicit base 2404a1e04; full artifact JSON/link/image/source/config/timing audit. No default-timeout PostgreSQL retry occurred because no PostgreSQL run occurred. These checks must remain separate from inherited producer results and formatting qualifications. No Next process/typegen, browser, auth login, native session, runtime download, production runtime or custom SQL fixture writes occurred. Main TypeScript/license availability was not evaluated after STOP; no full-main-TS claim is made.

## Standards axis

No separate documented-standard breach was confirmed within the bounded source inspected before STOP. This is **not** a comprehensive standards pass. React composition/performance and current Web Interface Guidelines were consulted; all remaining tooling and UI acceptance were deferred. One confirmed Spec P1; zero separately confirmed Standards findings.

## Preservation, SAFE and release

HEAD/app tree remain exact. Tracked diff and index diff are empty; final porcelain is clean. All 74 files in the original incoming archive directory retain exact Git blob/mode identities. The original report is preserved as a prefix with the prior root correction append; together these are the 75 incoming archive/report paths. This verifies preservation only, not content/link/image acceptance. The 63 protected anchors plus baseline and shared metadata union/deep exclusions are preserved by the unchanged tracked tree; their root acceptance receipts remain inherited. No archive whitespace normalization was attempted.

The prior SAFE index and exactly its 11 allowlisted payloads (103,566 bytes) were read and hash-checked without discrepancy. No private traversal or archived-script execution occurred. `prior-safe-receipt.json` records hashes and byte checks only; it does not reassert historical product results. Prior index SHA256: `649fd83ba7378d7c087466887f7f67159f09d52988e16161825c644b788cc197`; its HANDOFF SHA256: `d7bd4aa8653ab8bd4efe9aebf0c9f3ce91a417e29b4ef4f2987bb958aa55f98b`.

Three exact-owned temporary bridge files were removed only after byte count/SHA256 matched their creation receipts; each is confirmed absent. Own Node/pnpm process count is zero. No Docker services, listeners/servers, browsers, native sessions or downloads were created; no root/peer resource was stopped or changed. Physical dependencies and ignored review evidence remain locally. All foreground commands settled; integration/Git/index/package/runtime ownership is released. No product/report/ledger commit was made; `verifiedCommit` remains null. Root owns correction, independent re-review, remaining checks and fresh live acceptance.

`SAFE-index.json` is the explicit public payload allowlist with absolute paths, bytes and SHA256. Raw runner JSON/stdout remain excluded: `excluded-hash-only.json` contains **hash-only excluded receipts**, not audited public content. Credentials, real user/email identifiers, authstate, private headers/bodies/inventories and private failure images are excluded.
