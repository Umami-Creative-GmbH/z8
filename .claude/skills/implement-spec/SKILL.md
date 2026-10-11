---
name: implement-spec
description: "Implement the result of /to-spec and /to-tickets in code."
disable-model-invocation: true
---

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The issue tracker should have been provided to you. If not, tell the user to run `/setup-matt-pocock-skills`.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency.

## Steps

1. Read the spec and tickets to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration.

3. Create the integration branch. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge in step 5 (a branch with no commits ahead of main can't open one), marked as closing the spec and tickets.

4. Use **implementer subagents** to implement each ticket, each in its own worktree on its own branch. Each implementer subagent:
   - confirms its worktree is based on the integration branch before starting, and resets onto it if not;
   - calls the Skill tool with `tdd` to build the ticket;
   - merges the integration branch tip into its own branch before reporting done

5. Once an **implementer subagent** completes, merge its work to the integration branch with a **merger subagent**.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

7. Once all tickets are complete, call the Skill tool with `code-review` on the integration branch. Fix all issues raised by the code review in a single **implementer subagent**.

8. If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch.

9. Clean up every worktree this run created: implementer and merger worktrees, plus any baseline worktree you added for test comparisons. Do this as soon as the PR is ready or the integration branch is reported. Open user decisions don't block it. Leave the session's own worktree alone. For each worktree whose branch tip is on `origin/<integration branch>`:
   - `git worktree remove --force <path>`
   - If the folder still exists, run `Remove-Item -LiteralPath "<path>" -Recurse -Force` in PowerShell 7. On Windows, `git worktree remove` deletes the files but leaves pnpm's `node_modules` junctions and the folders that hold them. `Remove-Item` removes junctions without following them. Use the plain path: the permission guard blocks `rmdir /s` and `\\?\` paths.
   - Delete the local branch. Remote implementer branches stay until the PR merges.

   Then run `git worktree prune`. The step is done when `git worktree list` shows none of the run's worktrees and none of their folders remain under `.claude/worktrees`. If a folder can't be removed, list its exact path in the PR body or final report for the user.
