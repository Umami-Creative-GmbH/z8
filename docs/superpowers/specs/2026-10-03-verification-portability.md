# Verification portability follow-up

The user authorized repairing targeted test/tool portability issues after the four navigation optimizations, and confirmed continuation after PR #562 merged into dev. Issue #563 tracks this follow-up. It does not reopen the original performance design or authorize delivery, production mutations, credentials, or broader feature changes.

Make native TypeScript batch lookups use the same existing virtual source identities as source creation. Preserve original filename metadata, ownership and tenant checks, malformed-source diagnostics, alias-collision rejection, and callback/snapshot lifetime rules.

Make unit-test imports of temporal-polyfill observe active fake test time on native Temporal runtimes. Only replace the imported module's Now view. Preserve real Now behavior outside fake clocks, Temporal constructor identities and all other exports, requested/default zones, fresh clock reads, global Temporal, unit database refusal guards, and restoration between cases. No production clock changes or weaker assertions.

Use pnpm and existing dependencies. No generated schema edits, translation edits, bulk formatting, timekeeping changes, tenant permission changes, runtime credentials or production interactions. Add meaningful behavioral regressions, verify affected suites and typechecks, and collect one final full unit inventory. Remaining failures are diagnosed and reported with causes; a narrower green gate is not a claim that the repository is green.
