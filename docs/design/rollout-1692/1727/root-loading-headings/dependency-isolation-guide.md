# pnpm 12 worktree dependency guard

Read-only preparation, 2026-11-15. No pnpm, Node, repository scripts, installers, services, or runtime checks were executed for this note. The incident used pnpm 12.16.1; PATH's global package.json currently says 12.18.0. Findings below use primary documentation, not a claimed execution test of either binary.

## Why an innocent command can install

`verifyDepsBeforeRun` defaults to `install`; `run` and `exec` can automatically install when dependencies look stale. `false` disables the check. An automatic install failure can produce a warning and still run the requested command, so a successful fixture command does not establish a successful dependency repair. [pnpm build settings](https://pnpm.io/settings/build#verifydepsbeforerun)

`pnpm node ...` can fall through run/exec too: pnpm's own CI disables verification before `pn node -v` for this reason. File reads with Get-Content/Get-Item/rg do not invoke that pnpm mechanism. [pnpm CI source](https://github.com/pnpm/pnpm/blob/main/.github/workflows/test.yml)

CLI wins over `pnpm_config_*` / `PNPM_CONFIG_*` environment, which wins over workspace configuration. Use `pnpm_config_verify_deps_before_run=false`, not `npm_config_verify_deps_before_run`. Non-auth pnpm settings belong in YAML, not `.npmrc`. [configuration](https://pnpm.io/configuring#environment-variables)

The exact `--config.verify-deps-before-run=false` spelling is supported: pnpm documents `--config.<setting>=false`, and the pnpm tracker records this exact override. Put it before `node`, `run`, or `exec` to keep it a pnpm option. Arguments after the executed command belong to that command. [CLI syntax](https://pnpm.io/pnpm-cli#boolean-flags), [pnpm issue #16322](https://github.com/pnpm/pnpm/issues/16322), [exec argument handling](https://pnpm.io/cli/exec#options)

## Repeatable setup for a new implementation worktree

1. Use an explicit absolute own worktree as each tool's working directory. Verify Get-Location and the workspace manifest before commands; check for inherited workspace/modules/virtual-store redirection. Do not assume a shell's previous location. `-C` can explicitly select a directory. [CLI directory selection](https://pnpm.io/pnpm-cli#-c-path---dir-path)
2. Before the FIRST pnpm invocation in every new shell/launcher, set `$env:pnpm_config_verify_deps_before_run = 'false'`. Preserve it in descendant process environments and also pass the CLI false flag on each pnpm command. A process variable does not persist into unrelated future tool shells; wrappers replacing `env` must carry it explicitly. Node children normally inherit `process.env`. [Node child processes](https://nodejs.org/api/child_process.html#child_processspawncommand-args-options)
3. Never borrow another worktree's entire `node_modules` or `apps/webapp/node_modules` using junctions/symlinks. Those directories, their parents inside the checkout, and the workspace's `.pnpm` store must be owned physical directories (or absent before installation). Expected individual pnpm package links are normal; their targets must stay in this worktree. pnpm documents that the default project virtual store cannot be shared between unrelated projects. [node_modules layout](https://pnpm.io/settings/node-modules#virtualstoredir)
4. Record the approved lock SHA256 and source/config baseline. For this rollout the approved lock hash is `2A254A9E5731E431B5032D1B918688F5663CE837B08207E147E1808A71BB3799`. With no other installer/Next using this checkout, perform ONE local install:

```powershell
$env:pnpm_config_verify_deps_before_run = 'false'
pnpm --config.verify-deps-before-run=false --config.verify-store-integrity=true install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy
```

`copy` copies package files from the store; it does not remove pnpm's internal package links. `offline` fails on missing store content, and `frozen-lockfile` fails if lock changes are needed. `ignore-scripts` skips project/dependency lifecycle scripts, but does not disable pnpmfile hooks. Do not silently retry with scripts/network/lock changes. [copy behavior](https://pnpm.io/settings/node-modules#packageimportmethod), [install options](https://pnpm.io/cli/install), [script boundary](https://pnpm.io/settings/build#ignorescripts)

5. Recheck the lock/config baseline and topology before runtime commands. Examples: `pnpm --config.verify-deps-before-run=false node scripts/performance/fixture.mjs prepare <OWN-TEMP>` and `pnpm --config.verify-deps-before-run=false exec <tool>`. Keep Next's normal local hermetic root. The #1829 external-root attempt failed React compiler-plugin resolution; the local copy install succeeded. Do not introduce a broad shared-root resolver workaround.

## Current incident and verification boundary

The child deliberately borrowed dependency-directory junctions; its unguarded pnpm fixture command then installed through them and relinked 158 root package junctions (5 root, 153 app) into the child. Selected root manifests stayed unchanged; deeper postinstall changes remain unproven. This differs from manually editing root config/package files, for which the incident record reports no deliberate change. Root's subsequent quarantine and own rebuild are intentional repair mutations.

Root has preserved both physical dependency directories under its verified `.tmp/1727-root-checks/dependency-quarantine-GUID` backup and recorded `.tmp/1727-root-checks/dependency-rebuild.json`. The frozen/offline/copy install above was already running when this note was prepared. Do not touch the backup, start a second installer, or infer its result from this note.

After that install finishes, scope checks to: recorded exit/log; approved lock and manifest/config hashes; physical root/app directories and local virtual store; all 158 recorded affected links plus Next/React/Vitest/compiler-plugin package resolution from apps/webapp; then one guarded local Next launch and the failing route/fixture smoke check. Record actual runtime outcomes and retain rollback evidence. Broaden checks only for a concrete new failure.

`verifyStoreIntegrity=true` checks cached store content against store metadata before import and helps find corruption. It is not a pre-incident comparison or security certification. A copy install separates new files from shared hardlinks; `ignore-scripts` prevents new lifecycle execution during that install. Neither proves what earlier postinstalls changed elsewhere, and side-effects caches can contain prior build output. Without prehashes, do not claim byte-pristine dependencies or an exhaustive earlier delta. [store integrity](https://pnpm.io/settings/store#verifystoreintegrity), [side-effects caching](https://pnpm.io/settings/build#sideeffectscache)

Incident evidence: `X:/t3-code/worktrees/z8/t3-394c4cda-6b16d8d73f89b377/docs/design/rollout-1692/1832/dependency-incident.md` and companion `dependency-links-incident.json` / `dependency-manifests-incident.json`.