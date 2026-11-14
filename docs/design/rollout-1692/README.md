# App-wide UI refresh integration

Spec: [#1692](https://github.com/Umami-Creative-GmbH/z8/issues/1692). Integration branch: `ai/1692-app-wide-ui-refresh`. Review: [PR #1854](https://github.com/Umami-Creative-GmbH/z8/pull/1854), targeting `dev`.

## Scheduling contract

[integration.json](integration.json) tracks all 157 implementation/readiness tickets and 159 blocker edges from the approved [publication index](../2026-11-14-webapp-ui-ux-publication.md). The four organizational groups are tracking containers, outside the implementation frontier. The 19 aliases remain owned by their destination tickets.

GitHub issues remain **open pending final user review**. Open status therefore does not determine this rollout's frontier. A dependency is satisfied when its `verifiedCommit` is an ancestor of the current integration tip and its evidence supports the required handoff. A ticket implementation commit alone is insufficient: merge it, run the relevant integration checks, and record the verified integration SHA and evidence. Preserve unresolved acceptance checks explicitly; do not label an unverified handoff complete.

Each implementer uses a fresh context and a dedicated T3 worktree based on this integration branch. Before reporting, merge the latest integration tip into the ticket branch. A fresh merger agent then integrates the ticket. Record ticket-specific capability maps, checks, handoffs and limitations in `<issue>.md`. Do not overwrite another ticket's work. Final review covers the whole integration branch.

## Baseline reconciliation

Initial merge `c0a9590349f2d6042fe20c7e4fd2d2be5e21f14f` contains freshly fetched `origin/dev` at `2dd336ccf` and `origin/docs/1692-app-wide-ui-ux-spec` at `2d121072a`. Git merged both histories without conflicts.

The included #1689 baseline consists of `c1d7e96e7`, `73182bad5`, `4012ed50c` and `f4a2acd80`. All four commits and both merge parents are ancestors. All 82 baseline paths remain byte-identical to `f4a2acd80`; every concurrent dev path remains unchanged from `2dd336ccf`. The baseline and concurrent dev changed-path sets do not intersect. `git diff --check 2dd336ccf c0a959034` passes.

This satisfies F1's requirement that the approved baseline be present in its implementation base. #1689 remains open, with the reconciliation recorded on GitHub. Its [prior runtime evidence](../2026-11-14-refresh-verification.md) is inherited evidence, not a rerun of this rollout's acceptance checks.

## Current work

- F1 #1693: integrated at `b31c497bb48c873153b731ea9f7b62c8c3e0e2fe`; merged component checks passed. The required browser/fixture demonstration is still pending, so `verifiedCommit` remains null and dependent tickets stay gated. See [consumer inventory and interfaces](1693.md).
- R023 #1822 (`/init`): integrated and verified at `984436c44a2c44bbe99e22fb23c4dbb108534e83`; remains open pending final review. See [capabilities and evidence](1822.md).
- F2/F3 and all remaining pages: await their verified prerequisites in `integration.json`.

## Verification

- Initial merge: ancestry, byte-preservation and whitespace checks passed as described above.
- F1 integration merge `b31c497bb`: **26 suites, 192 tests passed**, combining its documented 25-suite selection with the `/init` component suite, using two workers. Parent/implementation ancestry and whitespace checks passed; #1822 and prior integration records remained byte-identical. Implementer also passed full types, changed-file lint and React Doctor. Browser/fixture acceptance is being completed separately before releasing the F1 dependency; optimized compilation/types succeeded, while full static generation timed out and is not passed.
- #1822 integration merge `984436c44`: **8 suites, 62 tests passed** for init, activation, callback, SSO, security and translation behavior. Both parents and required base verified; the merged tree exactly matches the completed ticket tree. `git diff --check` passed. Implementer additionally passed full webapp types, focused lint, React Doctor and disposable runtime checks with four roles. Live identity providers/MFA/store devices, physical safe-area/zoom checks, remote catalog synchronization and full production build remain explicitly limited in [the ticket report](1822.md).
- Fresh baseline component/consumer tests at `c0a959034`: **79 suites, 724 tests passed**, exit 0. Selection: dashboard and time-tracking component directories; section cards; app search/sidebar; main/team/user/secondary navigation; site header and timezone control; sidebar feedback/primitive; clock summary synchronization/offline clock; app layout content/shell/composition; time-tracking region data/composition. This is a fresh expanded selection, not a reconstruction of the historical 76-suite command.
- Dependencies: locked packages installed from the offline pnpm store. The Windows `@posthog/cli` postinstall failed in `Expand-Archive`; rerunning with `--ignore-scripts` completed dependency links. This does not establish that the PostHog release CLI works.
- Full production static generation and Tolgee synchronization remain outstanding from the baseline. Prior compile-mode success is not a completed full build.
- No merge into `dev`, issue closure or deployment is authorized. The PR remains draft while implementation is in progress.
