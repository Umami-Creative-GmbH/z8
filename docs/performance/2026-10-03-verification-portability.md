# Verification portability follow-up

Issue: [#563](https://github.com/Umami-Creative-GmbH/z8/issues/563), native child of navigation spec #557. Branch `ai/563-verification-portability`, based on `dev` commit `8bfee1c6b` after PR #562 merged. This follow-up repairs verification portability; it does not establish production navigation latency.

## Repairs

- Native source analysis exports its existing lexical filename conversion and batch consumers use the same virtual identity. Original filename metadata, ownership/tenant checks, collision rejection, diagnostics and native callback lifetime remain unchanged.
- Unit setup provides a separate imported Temporal Now view. Active fake test time is read afresh; real Now delegates with original precision and receiver. Constructors, other exports, global Temporal and the unit database refusal guard remain intact. Eager setup initialization prevents a late original import from capturing Vitest's fake global.
- The confirmed fixture batch normalizes test-read line endings/path separators and uses deterministic platform fixtures. Production dictionaries, SQL/migrations, generated schemas, clock logic and permissions remain unchanged.

## Verification record

Task 1 commit `b12e37faa`: six red lookup cases became green; helper57/57 and tenant1/1 passed; bounded approval286/290 left four platform fixture failures. Scoped Biome and all configured typechecks passed; task review approved.

Task 2 commit `7455a3a62`: 12 native/fallback clock-view regressions and 33 clock/business/database-guard cases passed. The 17-suite run passed254/256, with only locale whitespace and current-hour submission fixture failures assigned to the fixture batch. Scoped Biome and all configured typechecks passed; task review approved.

Task 3 commit `0a1afdecb`: all 540 tests across the 11 assigned files passed. Final bounded scanner-restoration and source-guard checks also passed; in-memory forbidden Radix and global Temporal controls failed as intended. All configured typechecks and scoped lint/import checks passed. Task review approved with no blocking findings. Scoped full Biome retains seven inherited formatter diagnostics and 14 inherited warnings; its baseline had eight errors and the same 14 warnings. Windows directory-junction rejection/exclusion is verified; Windows privileged file symlinks use a narrowly targeted test adapter, and POSIX execution is unverified.

Full unit inventory at source HEAD `0a1afdecb`: **12,996 passed, 3 failed, 33 skipped** across 1,156 files (1,149 passed, three failed, four skipped), exit 1, 223.40 seconds. Command: `pnpm exec vitest run --project unit --maxWorkers 4 --reporter=default --reporter=json`, using the launcher environment below. All three failures were the unchanged 5,000 ms timeout: chart fallback loading, concurrent Telegram digest delivery, and the time-tracking server-action surface import.

A bounded rerun of those three files with `--maxWorkers 1` retained assertions and timeout limits: **14 passed, one failed**. Chart and Telegram passed; the server-action import still timed out. Of the 134 earlier failed assertion names, 133 did not recur and the server-action case remained. The earlier inventory predates the merged dev base, so this comparison describes names rather than attributing every change to this branch. The full suite is not green.

The diagnostic-only `--testTimeout 30000` run passed all three server-action surface tests; its real cold import took 6,855 ms. This demonstrates completion beyond the normal deadline in that run, without identifying a particular slow dependency. The attempted environment-scrub preparation used an incorrect relative path and failed before removing variables; inherited application-environment absence was not established. No credential values were acquired or logged, no actions were invoked, and the unit database refusal hooks remained active.

Task 4 commit `90f26fa51` moves the identical real namespace import to collection setup, matching the existing canonical action test and retaining all assertions and ordinary timeout limits. The normal-budget single-file run passed **3/3**; the three earlier timeout files together passed **15/15** with one worker. Scoped Biome and all configured typechecks passed. Collection setup still incurs the real import cost.

Post-repair full validation at `a627399f8` (same source as `90f26fa51`) passed: **12,999 passed, zero failed, 33 skipped** across 1,156 files (1,152 passed, four skipped), exit 0, 383.10 seconds. Command: `pnpm exec vitest run --project unit --maxWorkers 2 --reporter=default --reporter=json`, using the same launcher environment and unchanged default timeout limits/assertions. JSON reports `success: true` and zero failed assertions. This final-tree run supersedes the earlier failing validation result; it establishes success at two workers, not repeatable timing at four workers or production performance.

All four task reviews approved. The final whole-follow-up review of `8bfee1c6b..a627399f8` approved the code with no new findings, preserving the inherited tooling debt and platform/runtime limits. Its report was written while the post-repair full run was pending; the controller resolved that pending evidence item using the completed successful log and JSON. Final record changes after review are documentation only. The branch remains local pending the user's delivery choice.

## Launcher environment and limits

Node subprocesses cannot launch the installed PowerShell pnpm shim directly. A task-local PATH entry for the existing native pnpm executable resolves this without changing the repository or persistent environment. Four rollout CLI tests additionally fail during tsx account-information startup inside the execution sandbox; the same bounded suite outside the sandbox passes15/15. Both timezone child-process suites also pass with the native executable available. Final unit inventory uses that verified environment while retaining the unit database guard; no Phase credentials are acquired.

Clock regressions run on Node26 with native Temporal and explicit fallback constructors; a Node24/native-absent application run is unverified. Authenticated Next/browser navigation measurements remain pending operator-provided fixture configuration because Phase variables are unavailable to agents. The repository-wide historical Biome debt is outside this targeted repair; scoped checks may match existing CRLF checkout line endings. The inherited Vite native-config compatibility warning remains recorded.

## Rulings made during execution

1. Execute the bounded follow-up under the user's targeted repair request and continuation, with the preserved subagent-driven workflow, without another approval round. The diagnoses were within that scope. If wrong, the follow-up may need revision or reversion because the user intended another review first.
2. Add the confirmed platform fixture batch: CRLF/path assertions, real junction and EACCES fixtures, and locale/current-hour test inputs. The read-only probes isolated these causes while preserving guards. If wrong, the extra test edits cost review or reversion; business behavior and expectations remain intact.
3. Add one test-arrangement repair by moving the real server-action import to collection setup. The import settled in 6,855 ms and the canonical action test uses this arrangement. If wrong, collection can remain slow or hang and the one-file arrangement must be reverted. No application latency improvement is claimed.
4. Run one post-repair full validation with two workers and unchanged assertions/default timeouts. Task 4 changed the failing fixture after the earlier inventory and two contention timeouts remained unverified in a full run. This overrides the initial single-inventory plan to resolve that concrete gap. If wrong, it costs another bounded suite run and does not establish production performance.
