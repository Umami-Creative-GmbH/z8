---
name: z8-quick-edit
description: Use when the user explicitly asks for z8-quick-edit, quick edit mode, dangerously quick edits, hotfix-style direct patches, or to skip planning and process-heavy workflows for a narrow code or docs change in the Z8 repo.
---

# Z8 Quick Edit

Make the smallest requested edit directly. The user is intentionally accepting process risk; do not convert a narrow quick-edit request into brainstorming, planning, worktree setup, TDD, systematic debugging, design review, or broad refactoring.

This skill changes workflow, not instruction priority: preserve unrelated work, avoid destructive commands, and do not expose secrets.

## When To Use

- The user says `z8-quick-edit`, `quick edit`, `dangerously edit`, `hotfix`, `just patch it`, or equivalent.
- The requested change is narrow enough to do with targeted search/read plus one or a few patches.
- The user explicitly says they know the risk or asks not to use Obra/superpowers process workflows.

Do not use for irreversible operations, broad features, auth/security-sensitive changes, database migrations, infrastructure changes, or anything that needs tenant/RBAC reasoning.

## Core Rule

Load this skill, then stop loading additional process skills unless the user explicitly asks or a higher-priority instruction requires it.

Quick edit means:

- No brainstorming.
- No written plan or spec.
- No worktree setup.
- No TDD unless the user asks for tests.
- No systematic debugging unless the user asks to diagnose a bug.
- No React/design/accessibility review unless the user asks for review.
- No broad cleanup or refactor.
- No todo list unless the user asks or the request has multiple independent edits that need tracking.

## Quick Reference

| Situation | Action |
| --- | --- |
| Exact file and edit given | Read the file, patch exactly, stop. |
| Exact text but file unknown | Search narrowly, patch only matching target, stop. |
| Multiple matches | Patch only if the intended match is clear; otherwise ask one short question. |
| Tests forbidden | Do not run tests; mention they were intentionally skipped. |
| Formatter clearly needed | Run only the narrow formatter for touched files. |
| Risk appears larger than stated | Ask one short question or report the blocker. |

## Workflow

1. Confirm the request is a narrow quick edit.
2. Search or read the minimum files needed.
3. Apply the smallest patch with `apply_patch`.
4. Run no verification unless the user asked, the edit requires generated output, or a narrow cheap check is necessary and not forbidden.
5. Final response: changed files and any intentionally skipped verification.

## Example

User: `z8-quick-edit: in apps/web/src/foo.tsx change the label from Save to Submit. No plan, no tests.`

Assistant actions:

1. Read `apps/web/src/foo.tsx`.
2. Patch only `Save` to `Submit` at the intended label.
3. Final: `Updated apps/web/src/foo.tsx. Tests skipped per quick-edit request.`

## Mistakes

| Mistake | Fix |
| --- | --- |
| Loading brainstorming because behavior changes | Do the direct edit; the user selected quick-edit risk. |
| Creating a plan to be safe | Skip it unless the request is no longer narrow. |
| Starting a worktree | Edit the current workspace; preserve unrelated changes. |
| Running broad tests after tests were forbidden | Do not run them; state they were skipped. |
| Refactoring nearby code | Patch only what was requested. |
| Ignoring safety boundaries | Quick edit is not permission for destructive commands or secret exposure. |

## Red Flags

- You are about to say `first I will brainstorm`.
- You are about to create a spec, plan, or todo for one edit.
- You are about to load another Obra/superpowers process skill solely from habit.
- You are expanding the requested patch into cleanup.
- You are asking a question even though the target edit is clear.

If a red flag appears, stop and make the direct minimal edit.
