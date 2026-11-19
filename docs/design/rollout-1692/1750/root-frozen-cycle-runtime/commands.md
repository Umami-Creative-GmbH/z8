# R168 focused live verification commands

Verify the source pins and a clean index before starting.

```powershell
git rev-parse HEAD 'HEAD^{tree}' 'HEAD:apps/webapp/src' 'HEAD^'
git -c core.excludesFile= status --porcelain=v1 --untracked-files=all
pnpm.cmd --version
$env:pnpm_config_verify_deps_before_run = 'false'
$env:npm_config_verify_deps_before_run = 'false'
pnpm.cmd --config.verifyDepsBeforeRun=false install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy
```

Use labeled loopback services from the local PostgreSQL 16, Valkey 9 and RustFS images with pull disabled. Pass generated service values via the process environment. Run the following from the webapp with the guarded disposable database environment and a private output directory.

```powershell
pnpm.cmd --config.verifyDepsBeforeRun=false exec tsx scripts/verify-approval-migration-recovery.ts
pnpm.cmd --config.verifyDepsBeforeRun=false exec tsx scripts/performance-fixture.ts --write-private-manifest <private-fixture-manifest>
pnpm.cmd --config.verifyDepsBeforeRun=false run i18n:metadata
node node_modules/next/dist/bin/next dev --turbopack --hostname 127.0.0.1 --port <owned-app-port>
```

Use separately named ephemeral browser sessions. Wait for the public verification widget, pass synthetic credentials to the public form interactions through batch stdin, and leave session restore off. Submit and withdraw from the owner workspace. Use its real history link for explicit cycle 1 and compare settled text in the submitted expenses and totals regions. Hash bytes with SHA-256 in same-origin browser fetches to the rendered receipt URL. Use the separately seeded outsider to confirm the unavailable view and protected receipt 404. Use the public reviewer inbox to approve the second cycle and the public report form to reopen it.

Call tools/list, get_routes, get_page_metadata, get_errors and get_compilation_issues on the connected Next dev MCP endpoint. Verify the active App Router report page and explicit cycle. The licenses page compile diagnostic remains qualified by the missing generated license file.

Close each exact named browser session, verify its profile and daemon are gone, stop the guarded Next process tree, remove each identity- and label-checked container with attached anonymous volumes, and confirm the four owned ports have no listeners. Remove only the exact temporary fixture files and the Next output created during this run.
