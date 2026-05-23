# Remove Deploy Webhook Design

## Goal

Remove the obsolete `deploy-webhook` application and clean all source-controlled references to it.

## Scope

- Delete the `apps/deploy-webhook` workspace package.
- Delete the deploy-webhook Dockerfile.
- Delete the deploy-webhook image publishing workflow.
- Delete the deploy-webhook workflow verifier script.
- Update workspace lockfile state so `deploy-webhook` is no longer installed or tested.
- Remove source-controlled documentation and planning references to deploy-webhook.
- Update tests that explicitly expect deploy-webhook Docker artifacts.

## Out Of Scope

- Do not edit `.git` internals, generated cache directories, or separate worktrees.
- Do not modify live Kubernetes resources or GitHub webhook settings from this code change.

## Approach

Use a source cleanup rather than replacing deploy-webhook with a stub. The app is no longer needed, so retaining placeholders would keep obsolete maintenance surface and CI paths alive.

## Verification

- Search the source tree for remaining deploy-webhook references after cleanup.
- Run `pnpm install --lockfile-only` if lockfile entries need regeneration.
- Run `pnpm node --test docker/scripts/prepare-target-runtime.test.mjs` for the Docker runtime fixture change.
