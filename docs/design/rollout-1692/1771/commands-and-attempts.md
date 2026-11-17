# Commands and retained attempts

Every pnpm invocation uses the pinned engine and both guards:

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy
pnpm --config.verify-deps-before-run=false --filter webapp typecheck
pnpm --config.verify-deps-before-run=false --filter webapp exec vitest run --project unit --maxWorkers 1 'src/app/[locale]/(app)/settings/employees' src/components/organization src/lib/query/use-employees.test.tsx src/lib/navigation/route-metadata.test.ts src/tolgee/extracted-key-defaults.test.ts src/lib/employee-lifecycle/joining/employee-writers.test.ts --reporter=json --outputFile=../../.tmp/1771/units-current3.json
pnpm --config.verify-deps-before-run=false --filter webapp test:integration --maxWorkers 1 'src/app/api/settings/employees/read/[dataset]/route.integration.test.ts' 'src/app/[locale]/(app)/settings/employees/invitation-draft-personnel-number.integration.test.ts' 'src/lib/employee-lifecycle/current-roster.integration.test.ts' --reporter=json --outputFile=../../.tmp/1771/postgres-final.json
pnpm --config.verify-deps-before-run=false exec react-doctor apps/webapp --verbose --scope changed --base 11cdba0d2bfcc84c31fa1ef0f2acdf04a96300d9 --include-untracked --no-supply-chain --no-telemetry --no-score --no-parallel --max-duration 90
```

Biome selects exactly the eight owned employee source/test paths in `source-pins.json` and, for
standalone lint, the one shared metadata path. Explicit route command:
`--filter webapp exec biome check --config-path=./biome.jsonc --line-width=100 --line-ending=crlf`.
Ordinary command: `--filter webapp exec biome check`. Separate lint: `--filter webapp exec biome lint`.
The shared file's final change is one literal; its inherited explicit formatting differences remain.

On Windows the integration runner uses installed Git Bash through process-local PATH. A private
BASH_ENV function adds only `--config.verify-deps-before-run=false` to nested canonical pnpm calls;
the environment guard is inherited. Runner scripts, database gate/pools, engine pin and store are
unchanged. PG16 migration verification, ownership label and exact-name cleanup remain canonical.

The canonical fixture helper's private invocation copy resolves the original sibling modules to
absolute URLs, sets its own checkout root and adds both pnpm guards. It otherwise runs the supplied
prepare/cleanup implementation and unchanged initial fixture. Runtime values stay private. One
development Next process used those local service settings, normal development mode and public dummy
Turnstile keys. It did not use saved authentication state or a production guard bypass.

## Attempts (not additive acceptance)

| Attempt | Outcome / qualification |
| --- | --- |
| Initial GitHub read | Restricted socket; identical read succeeded with normal sandbox escalation. No tracker writes. |
| Initial pinned-engine invocation | Managed engine-store lock denied; the identical authorized frozen/offline command succeeded elevated at 12.16.1. No fallback install/store/ACL change. |
| `red-heading-01` | Engine lock prevented test execution. |
| `red-heading-02` | Real SiteHeader + route returned two Employees H1s; one other control passed. |
| `red-workspace-03` | Test JSX trailing comma parse error; no product assertion. |
| `red-workspace-04` | Duplicate H1 and category search-reset regressions failed; two controls passed. |
| `green-workspace-05/06` | Agent route-edit parse errors; no product assertions. Corrected before continuing. |
| `green-workspace-07` | Three controls passed; new header action made the old singular button query ambiguous. |
| `green-workspace-08` | Translator mock lacked external `useTolgee`; two controls failed and one unhandled error. |
| `green-workspace-09` | Four assembled controls passed. |
| Dependency comparison 1 | Read-only provenance scan buffer too small; no copy. |
| Dependency comparison 2 | Different established project-root manifests; no copy. |
| Dependency comparison 3 | Supplied established root checkout: 22 exact matches, genuine hash/125 entries, physical stores/158 internal links. Copy permitted. |
| `types-01` | Static typegen passed; main project missing ignored genuine licenses artifact, later projects not reached. |
| `units-01` | 759 passed / two column assertions failed; legacy route suite import failed. Old tests asserted truncation and old SelectItem source shape. |
| `green-workspace-10` | Four assembled controls passed; legacy suite lacked external navigation boundary. |
| `legacy-route-11` | Nine preserved route tests passed with canonical provider bootstrap and external session/navigation boundaries. Existing internal hook mocks remain qualified. |
| `units-02` | 770 / 64 files passed before the nine additional controls; not additive. |
| `types-02`, `types-final` | All three type projects and static typegen passed with the genuine artifact. |
| `postgres-01`, `postgres-final` | Same 39 / three physical files, canonical migration verifier and cleanup pass. JSON repeat provides name/occurrence accounting. |
| `role-green-12` | 23 passed / one ambiguous alert assertion failed due to the real shell alert. Tightened to the actual visible route message. |
| `frozen-owner-red-01` | Immediate dialog query passed before exit settled. Not accepted as pending-dismissal proof. |
| `frozen-owner-red-02` | After 400ms settled transition, real pending invitation panel is absent. Expected-preservation assertion fails. Frozen owner unchanged; no fix authorized here. |
| `red-members-refresh-13` | One route-level Refresh regression failed, remaining 12 passed. |
| `green member refresh` | All 13 public route controls pass after server-snapshot refresh wiring. |
| `units-final`, `units-final2`, `units-current3` | Same 779 / 64 files; later repeats follow identity whitespace/accessibility refinements and the real translation provider. Not additive. |
| `real-translations` | Real provider: 13 route controls pass; the one inherited pending-dismissal preservation assertion still fails. No internal hook/form/query/validation mocks. |
| `final-narrow` | Nonadditive exact-final-metadata/public-route/i18n recheck after removing unrelated shared formatting. |
| Explicit / ordinary formatting | Eight route paths explicit CRLF/100 pass; shared metadata inherited formatting and ordinary formatting remain qualified. Separate nine-file lint passes. |
| Doctor | Initial eight and later exact-source nine-file bounded scans: zero issues; no score or suppressions. |
| Preview | First navigation timeout; second open reaches sign-in; snapshot timeout. Both tabs closed. |
| Isolated Chromium | Socket permission denial / unusable GPU before sign-in. No alternative-harness retry; PID absent. |
| Native inspection | Installed version/guide read; native command denied by PowerShell execution policy. Unpassed. No execution-policy workaround. |
| Next MCP | Own project/routes and empty compilation issues; employee route not visited. No-connected-session error/page metadata are not clean route acceptance. |
| Cleanup | Timestamp parse diagnostic retained; exact final own-PID/listener/container absence independently confirmed. |

Private attempt logs and exact JSON originals remain in the ignored own `.tmp/1771/` directory.
[Attempt hashes](attempts.json) bind retained filenames/bytes without publishing unfiltered logs.
Some early invocation helper versions were edited in place and lack byte-exact source snapshots;
those attempts are explicitly qualified. No public attempt/capture was overwritten to imply success.
