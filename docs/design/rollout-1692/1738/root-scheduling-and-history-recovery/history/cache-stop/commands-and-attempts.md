# Commands, attempts and reproduction

Working directory for every command was the granted root. No subagents.
All pnpm invocations set `pnpm_config_verify_deps_before_run=false` and used
`--config.verify-deps-before-run=false`. Normal escalation supplied engine-store
access; no command/provider/package fallback or lock relocation was used.

The literal main selection, with `NAME` substituted separately for each retained
output (`public-01`, `public-02`, `public-03`, `public-04`, `public-cache-01`,
`public-cache-02`), was:

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false --filter webapp exec vitest run --project unit --maxWorkers 2 'src/test/.tmp/1739-independent-correction-checks/directory-public.test.tsx' 'src/test/.tmp/1739-independent-correction-checks/history-public.test.tsx' 'src/components/calendar/calendar-controls.test.tsx' 'src/components/time-tracking/weekly-summary-cards.test.tsx' --reporter=json --outputFile=../../.tmp/1739-independent-correction-checks/NAME.json *> .tmp/1739-independent-correction-checks/NAME.log
exit $LASTEXITCODE
```

Focused confirmation (exit 1, expected blocker reproduced):

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false --filter webapp exec vitest run --project unit --maxWorkers 1 'src/test/.tmp/1739-independent-correction-checks/directory-public.test.tsx' --testNamePattern 'reauthorizes history when a relationship is narrowed' --reporter=json --outputFile=../../.tmp/1739-independent-correction-checks/cache-repro-01.json *> .tmp/1739-independent-correction-checks/cache-repro-01.log
exit $LASTEXITCODE
```

Version receipt (exit 0; 12.16.1):

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false --version *> .tmp/1739-independent-correction-checks/pnpm-version.log
exit $LASTEXITCODE
```

Audit/setup commands were `node .tmp/1739-independent-correction-checks/audit.mjs
start`, `node .tmp/1739-independent-correction-checks/prepare-tests.mjs` before
each test revision, `node .tmp/1739-independent-correction-checks/cleanup-bridges.mjs`,
`node .tmp/1739-independent-correction-checks/audit.mjs finish`, and `node
.tmp/1739-independent-correction-checks/summarize.mjs`. All returned 0.
Read-only Git/PowerShell source/report reads and diffs established pins, source
review and inherited evidence. They did not mutate Git or tracked files.

## Retained failures and qualifications

- Initial PowerShell execution of `& ./.tmp/1739-independent-correction-checks/public-01.ps1`
  failed before pnpm: script execution disabled (`PSSecurityException`). The script
  was then supplied literally to the normal shell tool; no host execution policy
  was changed. Its error remains in the tool transcript, not a separate raw file.
- First literal pnpm attempt failed opening the engine-store operation lock
  (`ERR_PNPM_STORE_DIR_OPEN_OPERATION_LOCK`, access denied). Retained as
  `public-01-sandbox-lock-failure.log`. Same command then ran using the approved
  normal escalation; no automatic approval rejection occurred.
- `public-01`: 20 pass/2 fail. Held canonical reread displays the loading region,
  not a disabled Retry button. Initial Activity adapter was not subscribed.
- `public-02`: 20 pass/2 fail. Same-batch synthetic `fireEvent` clicks caused two
  RSC refresh callbacks; native discrete `userEvent.dblClick` was used thereafter.
  This is not represented as a demonstrated native duplicate defect. The intended
  session subscription replacement had silently missed CRLF source text.
- `public-03`: 21 pass/1 fail, remaining Activity adapter mismatch. Preparation
  subsequently normalized CRLF and asserts adapter replacement succeeded.
- `public-04`: 22/22 pass. Real provider context, session subscription, recovery,
  native double-click, history, scope/Activity and compatibility controls pass.
- `public-cache-01`: 22 pass/1 fail. New cache case's safe receipt initially used
  `getAllByRole('alert')` although zero history alerts is an observed outcome.
  It threw before its final blocker assertion. Corrected to nonthrowing query.
- `public-cache-02`: 22 pass/1 fail. Genuine blocker assertion: pre-narrowing
  record visible on reopen; same mounted forced reread control shows refusal.
- `cache-repro-01`: same blocker independently repeats in a new Vitest process,
  1 executed/1 failed, 8 intentionally deselected. Receipts match exactly.
- Initial read commands included stale hook/provider path guesses and PowerShell
  wildcard handling failures; corrected with discovered paths and LiteralPath.
  These remain transcript-only read failures, not product findings.
- Vite's existing config-loader warning remains in successful/failed test logs;
  it was not suppressed. No empty overall runtime diagnostic claim is made.

Final executable test source is archived. Earlier harness revisions were replaced
within this new ignored namespace; their raw JSON failures/logs remain, but exact
preparation snapshots for every earlier revision were not retained. Do not label
the final archived source as the bytes executed for those earlier attempts.

For root replay, copy the final archived tests into a **new root-owned ignored
namespace**, adapt only the receipt output path, create hash-guarded test bridges,
then use the focused command with the new bridge/output namespace. Preserve this
sealed archive. Source corrections belong to root; never overlay historical
tracked source to manufacture comparison evidence.
