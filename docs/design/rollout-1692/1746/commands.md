# R164 check commands

All commands ran in this worktree. Every shell set:

```powershell
$env:pnpm_config_verify_deps_before_run='false'
```

The dependency setup command (first sandbox attempt failed at the C: lock; same
command then succeeded with normal reviewed escalation):

```powershell
pnpm --config.verify-deps-before-run=false --config.verify-store-integrity=true install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy
```

Final selected unit command, 10 files / 156 unique tests:

```powershell
pnpm --config.verify-deps-before-run=false --dir apps/webapp exec vitest run --project unit 'src/app/[locale]/(app)/today' src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts src/lib/manager-daily-briefing/__tests__/logic.test.ts src/lib/navigation/route-metadata.test.ts src/components/dashboard/manager-today-widget.test.tsx 'src/app/api/approvals/inbox/[id]/approve/route.test.ts' 'src/app/api/approvals/inbox/[id]/reject/route.test.ts' src/tolgee/extracted-key-defaults.test.ts
```

Final PostgreSQL command, 3 files / 12 unique tests:

```powershell
pnpm --config.verify-deps-before-run=false node .tmp/1746/checks.mjs vitest run --project integration 'src/app/[locale]/(app)/today/actions.integration.test.ts' src/lib/manager-daily-briefing/__tests__/approvals-source.integration.test.ts src/lib/manager-daily-briefing/__tests__/shifts-source.integration.test.ts
```

The ignored `checks.mjs` first verifies this fixture's loopback DB name, exact
three container names and labels. It passes only its generated runtime to the
integration process, spawns the pnpm executable directly and applies the same
verification guard. It does not read Phase or borrow another runtime.

Each complete type project was rerun at source commit c48870f6784bf070d4ee20b30da76b5039425c91:

```powershell
pnpm --config.verify-deps-before-run=false --dir apps/webapp exec tsc --project tsconfig.typecheck.json --noEmit --incremental false
pnpm --config.verify-deps-before-run=false --dir apps/webapp exec tsc --project tsconfig.workflow-contracts.json --noEmit --incremental false
pnpm --config.verify-deps-before-run=false --dir apps/webapp exec tsc --project tsconfig.smoke.json --noEmit --incremental false
```

Final bounded Doctor command (0 errors, 2 unsuppressed warnings; no numeric score claim):

```powershell
pnpm --config.verify-deps-before-run=false exec react-doctor apps/webapp --scope changed --base 16443982de929de4f885a6cfb6de5b377374cb3e --no-telemetry --no-supply-chain --verbose
```

The earlier accidental command omitted `--scope changed`; it scanned 7059 files.
Its whole-project score is not the final diff result. Intermediate proper scans
used `--include-untracked` before the source commit. No suppressions were added.

Scoped formatting/lint used the same 19-file selection throughout:

```powershell
$selection1746=@('src/app/[locale]/(app)/today','src/lib/navigation/route-metadata.ts','src/lib/navigation/route-metadata.test.ts','src/lib/manager-daily-briefing/types.ts','src/lib/manager-daily-briefing/get-manager-daily-briefing.ts','src/lib/manager-daily-briefing/__tests__/get-manager-daily-briefing.test.ts')
pnpm --config.verify-deps-before-run=false --dir apps/webapp exec biome check --line-width=100 --line-ending=crlf @selection1746
pnpm --config.verify-deps-before-run=false --dir apps/webapp exec biome lint @selection1746
pnpm --config.verify-deps-before-run=false --dir apps/webapp exec biome check @selection1746
```

First two exit 0. Ordinary check exits 1 with 19 formatter errors; no clean ordinary
check is claimed. `git diff --check` passed. Working bytes and git blob IDs are
separately recorded in evidence.json to avoid hiding checkout line endings.

Next MCP used `POST http://localhost:64396/_next/mcp`, JSON-RPC `tools/list` and
`tools/call` for `get_compilation_issues`, `get_errors`, `get_page_metadata`.
SSE `data:` JSON was inspected; exact probe boundaries are in the report.

Native Chromium used the installed 0.39.1 executable, unique session
`today1746-native`, `--args '--disable-notifications' --enable react-devtools`,
without `--restore`. It read generated credentials privately via stdin into a
normal development sign-in request with the public dummy Turnstile token.
Neither credentials nor session/cookie state are part of these artifacts.

Service preparation and final cleanup:

```powershell
pnpm --config.verify-deps-before-run=false node scripts/performance/fixture.mjs prepare .tmp/1746/fixture
pnpm --config.verify-deps-before-run=false node .tmp/1746/dev.mjs dev . .tmp/1746/fixture
# Close only today1746-native; stop only manifest/path/creation/listener-verified Next tree.
pnpm --config.verify-deps-before-run=false node scripts/performance/fixture.mjs cleanup .tmp/1746/fixture
```

The generic guarded dev/stop patterns were copied from the specifically permitted
root files; no root manifest, private pointer or credentials were copied. Exact
removed services and process IDs are in cleanup.json. Private raw logs and
manifests stay ignored locally; physical dependencies and .next were retained.
