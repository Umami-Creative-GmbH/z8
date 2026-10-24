# Absence-pattern SQL scope: fixture evidence

Issue: [#1451](https://github.com/Umami-Creative-GmbH/z8/issues/1451), part of [#1448](https://github.com/Umami-Creative-GmbH/z8/issues/1448).

## Change and structural budget

The production absence-pattern reader now selects absences through an employee subquery constrained by `organizationId`. A manager's subquery also requires their current employee-manager assignment. These predicates execute before the related employee, user, team and category records are returned. The authenticated action derives both organization and manager identity from the current employee; neither is supplied by the browser.

The regression's budget was written and failed before the production change: two authorized absences must retrieve two rows despite 1,000 overlapping absences belonging to another organization. An administrator must retain the established totals. A manager assigned one of those employees must retrieve one row. No numerical route-latency budget is inferred from these results.

The employee relationship remains the tenant owner for legacy absences whose nullable `organization_id` is empty. The supplementary in-memory organization check remains. This change preserves the existing overlap clipping, category, calendar-day, status and amount calculations; it does not rewrite absence or time records. It adds no index or cache. The earlier reader filtered tenant rows before returning aggregates; this evidence does not assert prior browser disclosure.

## Conditions and results

Measured on October 24, 2026 against base commit `39a08d0bb`, on Windows with an AMD Ryzen 9 9950X3D2 (32 logical processors), Node 26.9.0, pnpm 12.14.0, Vitest 5.0.3, and a label-owned Docker PostgreSQL 16.15 fixture. Other agents were active on the host. CPU and database caches were not cleared.

The fixture has two organizations, four synthetic users/employees, one team in the target organization, one managed employee and one unassigned employee. The unrelated organization has 1,000 absences overlapping March 2026. The target organization has two absences, including a legacy null-organization row crossing the start of the range. The calculation range is March 1–31, 2026, UTC. No production data or Phase secrets are used.

| Query condition | Rows returned | Samples | p50 query round trip | p95 query round trip |
| --- | ---: | ---: | ---: | ---: |
| Before SQL tenant scope | 1,002 | 20 | 9.54 ms | 12.21 ms |
| After, administrator | 2 | 20 | 1.17 ms | 1.43 ms |
| After, assigned manager | 1 | 20 | 1.16 ms | 1.30 ms |

The integration adapter logs the actual production SQL. The test executes that SQL against the same fixture to verify the retrieved row count, including its eager relations. With evidence enabled it repeats the query twenty times sequentially, using the same established connection pool, and measures round-trip time with `performance.now()`. Percentiles use the sorted twentieth-sample nearest ranks. These are warm fixture-query measurements, including transfer of relation JSON; they are not fresh browser visits, server-render readiness or isolated database execution time.

Explicit expected administrator totals are two absences, three inclusive calendar days, 1.5 days per absence and a 13.64% rate. The existing category calculation gives two category days. For the manager the expected totals are one absence and two inclusive calendar days. The authenticated action regression removes the manager assignment and verifies the next request has zero absences, then verifies an employee is denied before any absence query.

## Reproduce

From a clone with pnpm dependencies and Docker available:

```sh
Z8_ABSENCE_QUERY_EVIDENCE=1 pnpm --filter webapp test:integration src/lib/analytics/absence-patterns.integration.test.ts --reporter verbose
```

The repository runner owns database creation, migration verification and label-checked cleanup. Without the evidence variable the same suite checks outputs, tenant read isolation, manager visibility and fresh assignment reduction without the extra measurement loop. The retained suite fails rather than skips when the disposable database is unavailable. SQL parameters, credentials, tokens and personal data are not written into the evidence.

## Remaining acceptance gates

The PostgreSQL migration verifier, all three integration cases, eight existing analytics action/date-boundary unit cases and the production `tsconfig.typecheck.json` check pass. The new suite passes Biome. Whole-file Biome checking also reports existing formatting/import-order differences in the legacy service/actions and existing `any` warnings in the analytics types; those unrelated sections are retained. No React component or UI structure changes in this slice.

This document does not supply a CI-mode production build, an authenticated production-mode browser journey, request/RSC/JavaScript bytes, browser LCP/INP, pool wait, concurrent clock readiness or deployed timing evidence. Build and browser checks remain unfulfilled integrated acceptance gates until the #1450 runtime runs against the integration branch. No production latency claim follows from the query measurements above.
