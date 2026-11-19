# Exact validation commands

Working directory for these commands:
`X:/t3-code/worktrees/z8/t3-65663d62-4b7f54e41e3ad2a0`.
Every pnpm launcher sets the environment guard and passes the CLI guard before
`node` / `exec`. Child fixture/test commands carry both guards too. Commands do not
use root/peer dependency directories, `.env`, Phase, saved browser state or credentials
on command lines. `<OWN_PRIVATE>` is the generated private-pointer destination,
deliberately not published.

```powershell
$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false --config.verify-store-integrity=true install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy
pnpm --config.verify-deps-before-run=false node scripts/performance/team-directory-fixture.mjs prepare <OWN_PRIVATE>
pnpm --config.verify-deps-before-run=false node .tmp/1739-checks/dev.mjs dev (Get-Location).Path <OWN_PRIVATE>
pnpm --config.verify-deps-before-run=false node .tmp/1739-checks/login-final.mjs small-manager
pnpm --config.verify-deps-before-run=false node .tmp/1739-checks/final-setup.mjs
pnpm --config.verify-deps-before-run=false node .tmp/1739-checks/runtime-final.mjs
pnpm --config.verify-deps-before-run=false node .tmp/1739-checks/mcp.mjs
```

Native binary selected from the user-supplied 0.39.1 installation:
`C:/Users/KaiHentschel/AppData/Local/pnpm/global/v11/bf86bf49b40726ed136d2d0acb80e5862fa90fc3a766ffc0e05622cbe6aa30a8/node_modules/agent-browser/bin/agent-browser-win32-x64.exe`.
Final browser uses `--namespace z8-1739 --session z8-1739-final --enable react-devtools`.
The earlier transient session was `z8-1739-transient`. No restore/state/profile flags
or restore environment variables were set. Driver artifacts contain exact browser
argument arrays; login code goes only through private stdin and prints an acknowledgement.

```powershell
git merge --no-edit 58ea18603a936d102f0625e3303f4c05689a9961
pnpm --config.verify-deps-before-run=false -C apps/webapp exec vitest run --project unit 'src/app/[locale]/(app)/team/actions.test.ts' 'src/app/[locale]/(app)/team/team-time-balance.test.ts' 'src/app/[locale]/(app)/team/team-members-list.test.tsx' 'src/app/[locale]/(app)/team/team-directory.test.tsx' src/lib/navigation/route-metadata.test.ts src/components/ui/page-header.test.tsx src/components/ui/table.test.tsx src/tolgee/extracted-key-defaults.test.ts --reporter=json --outputFile=../../.tmp/1739-checks/unit-results.json
pnpm --config.verify-deps-before-run=false node .tmp/1739-checks/check.mjs integration 'src/app/[locale]/(app)/team/former-employees.integration.test.ts'
pnpm --config.verify-deps-before-run=false -C apps/webapp exec next typegen
pnpm --config.verify-deps-before-run=false -C apps/webapp exec tsc --project tsconfig.typecheck.json --noEmit --incremental false
pnpm --config.verify-deps-before-run=false -C apps/webapp exec tsc --project tsconfig.workflow-contracts.json --noEmit --incremental false
pnpm --config.verify-deps-before-run=false -C apps/webapp exec tsc --project tsconfig.smoke.json --noEmit --incremental false
pnpm --config.verify-deps-before-run=false exec react-doctor apps/webapp --scope changed --base 58ea18603a936d102f0625e3303f4c05689a9961 --include-untracked --no-supply-chain --no-score --no-respect-inline-disables --verbose --json
pnpm --config.verify-deps-before-run=false node .tmp/1739-checks/check.mjs build
```

`check.mjs integration` launches the literal child argument array
`['--config.verify-deps-before-run=false','exec','vitest','run','--project','integration','src/app/[locale]/(app)/team/former-employees.integration.test.ts']`
from `apps/webapp`, with only allowlisted system variables and the owned generated
fixture environment, including the pnpm environment guard. Its build branch uses
`CI=true` and
`['--config.verify-deps-before-run=false','exec','next','build','--experimental-build-mode','compile']`.
License generation uses exact cached `license-report@6.8.6` via its real `index.js`,
`--only=prod --output=json --config license-report-config.json`, from this app's own
installed dependency graph. It writes only this checkout's ignored artifact.

```powershell
$files1739=@('src/app/[locale]/(app)/team/page.tsx','src/app/[locale]/(app)/team/team-directory.tsx','src/app/[locale]/(app)/team/team-directory-feedback.tsx','src/app/[locale]/(app)/team/team-directory-records.tsx','src/app/[locale]/(app)/team/team-directory.test.tsx','src/app/[locale]/(app)/team/team-members-list.tsx','src/app/[locale]/(app)/team/team-members-list.test.tsx','src/lib/navigation/route-metadata.ts','src/lib/navigation/route-metadata.test.ts')
pnpm --config.verify-deps-before-run=false -C apps/webapp exec biome check --line-width=100 --line-ending=crlf @files1739
pnpm --config.verify-deps-before-run=false -C apps/webapp exec biome check @files1739
pnpm --config.verify-deps-before-run=false -C apps/webapp exec biome check --formatter-enabled=false @files1739
pnpm --config.verify-deps-before-run=false node --check scripts/performance/team-directory-fixture.mjs
pnpm --config.verify-deps-before-run=false node scripts/performance/team-directory-fixture.mjs cleanup <OWN_PRIVATE>
pnpm --config.verify-deps-before-run=false node docs/design/rollout-1692/1739/verify-evidence.mjs
```

Counts: final unit selection **84 / 8 files**, PostgreSQL **6 / 1 file**. The three
type projects are independent checks, not test assertions. Repeated red/green/race,
formatter, Doctor, runtime and fixture runs are not additive. An earlier unit command
also named a nonexistent history-button test path; it discovered no extra suite and
was not counted. History behavior is covered by the real assembled list tests and
runtime reads. Earlier 82/83 totals predate the final added page regressions.
