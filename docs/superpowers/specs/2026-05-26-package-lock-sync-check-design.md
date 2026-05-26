# Package Lock Sync Check Design

## Context

The repository uses pnpm 11 with a root workspace lockfile plus generated Docker target package manifests and lockfiles under `docker/targets/{worker,migration,db-seed}`. The root package already exposes `pnpm docker:sync:non-web-targets`, which regenerates the Docker target `package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml` files from the webapp dependency graph and root pnpm settings.

Recent commits include repeated target manifest sync fixes, so the CI check should prevent stale package and lockfile changes from reaching `main` through pull requests.

## Goal

Add a pre-merge GitHub Actions check that verifies all committed package manifests, workspace pnpm config files, and lockfiles are in sync before a pull request can merge.

## Approach

Use a single pull-request workflow that relies on pnpm and the existing Docker target sync command instead of implementing a separate lockfile parser.

The workflow will:

1. Check out the pull request.
2. Install pnpm from the root `packageManager` field.
3. Set up Node with pnpm cache.
4. Run `pnpm install --frozen-lockfile` at the repository root to verify the root workspace packages and root lockfile are consistent.
5. Run `pnpm docker:sync:non-web-targets` to regenerate Docker target manifests, workspace pnpm configs, and target lockfiles.
6. Run `git diff --exit-code` over the known package, lockfile, and pnpm workspace config files to fail if any generated output differs from committed files.

## Trigger

The workflow should run on `pull_request` to `main`. It should use path filters for dependency-related files so unrelated documentation or infrastructure-only pull requests do not pay the dependency install cost.

The path filters should include:

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `apps/**/package.json`
- `packages/**/package.json`
- `docker/targets/**/package.json`
- `docker/targets/**/pnpm-lock.yaml`
- `docker/targets/**/pnpm-workspace.yaml`
- `docker/scripts/**`

## Failure Behavior

If the root lockfile is stale, `pnpm install --frozen-lockfile` fails with pnpm's native error.

If a Docker target manifest, workspace config, or lockfile is stale, the sync command rewrites it and the final `git diff --exit-code` step fails. The workflow should print a short instruction telling contributors to run `pnpm docker:sync:non-web-targets` and commit the generated changes.

## Testing

Validate locally by running:

- `pnpm install --frozen-lockfile`
- `pnpm docker:sync:non-web-targets`
- `git diff --exit-code -- package.json pnpm-lock.yaml pnpm-workspace.yaml docker/targets/worker/package.json docker/targets/worker/pnpm-lock.yaml docker/targets/worker/pnpm-workspace.yaml docker/targets/migration/package.json docker/targets/migration/pnpm-lock.yaml docker/targets/migration/pnpm-workspace.yaml docker/targets/db-seed/package.json docker/targets/db-seed/pnpm-lock.yaml docker/targets/db-seed/pnpm-workspace.yaml`

The final implementation should also inspect `git diff` to confirm only the intended workflow file and this spec changed.
