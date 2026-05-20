---
name: z8-finish-dev
description: Use when finishing a Z8 development branch, preparing a clean dev workspace, updating lockfiles, building webapp, pushing to origin, creating or merging PRs, or handling GitHub Actions failures after merge.
---

# Z8 Finish Dev

Finish a Z8 development branch end-to-end without skipping verification. The core rule is: do not merge until local webapp build is clean, the branch is pushed, and CI status has been observed and handled.

## When To Use

- The user asks to finish dev, finish a branch, ship current work, open or merge a PR, or make dev clean in the Z8 repo.
- The task mentions lockfiles, `pnpm-lock.yaml`, `build:webapp`, webapp build failures, GitHub Actions, GHA, workflows, PR checks, or merging into `main`.
- The user asks to push to origin, create a PR with `gh`, merge it, and wait for workflows.

Do not use for Kubernetes rollouts or infra deployment refreshes; use `z8-k8s-deployment` for those.

## Required Workflow

1. Inspect state before changing anything: `git status --short`, `git diff --stat`, `git log --oneline -10`, and current branch.
2. Check lockfiles are current with `pnpm install --lockfile-only`. If docker target manifests changed, also consider `pnpm docker:sync:non-web-targets`.
3. Build only the webapp with `pnpm build:webapp`. Do not substitute `pnpm build`, `CI=true pnpm build`, or `pnpm --filter web build`.
4. If the webapp build fails, diagnose the first real error, make the smallest fix, then rerun `pnpm build:webapp`. Repeat until it passes or a Phase/system env secret blocks the build.
5. Before committing, inspect `git status --short`, `git diff`, and `git diff --check`. Stage only intended files; avoid `git add -A` unless every dirty file is confirmed intended for this branch.
6. Commit all intended work so the branch is clean. Do not leave generated lockfile or license data changes unstaged if they belong to the build/package update.
7. Push the branch to origin with upstream tracking if needed.
8. Create or update a PR with `gh pr create`/`gh pr view`. Base branch is `main` unless the user explicitly says otherwise.
9. Before merging, watch PR checks with `gh pr checks <pr> --watch --fail-fast`. Merge into `main` only after local webapp build is clean and PR checks pass or the user explicitly accepts a non-required check. Use non-interactive `gh pr merge` flags.
10. Wait for post-merge workflows on `main`: use `gh run list --branch main --limit 10` to identify run ids, then `gh run watch <run-id> --exit-status`.
11. If GitHub Actions fails, inspect failed logs with `gh run view <run-id> --log-failed`, reproduce the failing command locally when possible, fix the root cause, commit, push, PR/merge again, and watch workflows again.

## Quick Reference

| Goal | Command |
| --- | --- |
| Inspect repo | `git status --short` and `git diff --stat` |
| Check lockfiles | `pnpm install --lockfile-only` |
| Build webapp only | `pnpm build:webapp` |
| Inspect CI failure | `gh run view <run-id> --log-failed` |
| Watch workflow | `gh run watch <run-id> --exit-status` |
| Create PR | `gh pr create --base main --head <branch>` |
| Watch PR checks | `gh pr checks <pr> --watch --fail-fast` |
| Merge PR | `gh pr merge <pr> --merge --delete-branch` |

## Rules

- Use `pnpm`, never `npm` or `bun`.
- Use terminal-friendly `gh` commands; do not use `gh pr view --web` for this workflow.
- Use the Z8 webapp build script: `pnpm build:webapp`.
- Fix build and GHA errors by root cause, not by disabling checks or weakening validation.
- Do not use `git reset --hard`, force-push, amend, or destructive cleanup unless the user explicitly requests it.
- Do not commit secrets. If a command requires unavailable Phase/system env vars, skip that command, state the exact blocker, and do not claim it passed.
- Preserve unrelated user changes. If unrelated dirty files exist, leave them unstaged unless the user explicitly asked to commit all work and they are clearly part of this branch.
- `commit all work` means all intended branch work, not unrelated local edits from another user or agent.

## Example

User: `finish dev and merge it`

Assistant actions:

1. Inspect repo and branch state.
2. Run `pnpm install --lockfile-only`.
3. Run `pnpm build:webapp`; fix and retry until green.
4. Review diff, stage intended files, commit, and verify `git status --short` is clean for intended work.
5. Push to origin, create PR to `main`, merge with `gh pr merge`, then watch `main` workflows.
6. If GHA fails, inspect logs, fix on a branch, repeat PR/merge/watch.

## Common Mistakes

| Mistake | Fix |
| --- | --- |
| Running the full monorepo build first | Run only `pnpm build:webapp` unless a failing workflow requires more. |
| Using the wrong filter name | Use `pnpm build:webapp`; the package is `webapp`, not `web`. |
| Skipping lockfile refresh | Always run `pnpm install --lockfile-only` before the webapp build. |
| Merging and stopping | Watch workflows after merge and handle failures. |
| Merging without PR checks | Run `gh pr checks <pr> --watch --fail-fast` before `gh pr merge`. |
| Fixing CI by guessing | Find the failed run id, then read logs with `gh run view <run-id> --log-failed`. |
| Committing blindly | Inspect status, diff, and staged diff before commit. |
| Staging with `git add -A` by habit | Stage explicit paths unless every dirty file is confirmed intended. |
| Watching without failure status | Use `gh run watch <run-id> --exit-status` so failures stop the workflow. |

## Rationalizations

| Excuse | Reality |
| --- | --- |
| `The user said fast, so skip CI watching` | Fast still means finish; waiting for workflows is part of the requested job. |
| `The build probably passed in CI` | The required local gate is `pnpm build:webapp`; run it and see. |
| `A full build is safer` | The user asked for webapp only; broaden only when a failing workflow demands it. |
| `The lockfile is probably fine` | Package changes require an explicit lockfile check. |
| `Merge now, fix later` | A failed post-merge workflow is still your task to diagnose and fix. |

## Red Flags

- You are about to run `pnpm build` instead of `pnpm build:webapp`.
- You are about to merge before the local webapp build passes.
- You are about to merge before `gh pr checks <pr> --watch --fail-fast` passes.
- You are about to stop after `gh pr merge` without checking workflows.
- You are about to summarize a GHA failure without reading `gh run view <run-id> --log-failed`.
- You are about to open the browser with `gh pr view --web`.
- You are about to use destructive git commands to clean the branch.
- You are about to run `git add -A` with unrelated or unreviewed dirty files present.

If a red flag appears, stop and return to the required workflow.
