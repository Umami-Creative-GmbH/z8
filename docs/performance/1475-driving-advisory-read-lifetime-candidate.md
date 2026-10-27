# Conditional driving advisory read lifetime candidate

This is an isolated proposal from b31a311428e5aae86738a263d14f5d6af852a670. It has not been applied to Original4b or HEAD05cd, merged into Root, built, or used for a benchmark. Applying identical production hunks to BOTH comparison builds requires the user's decision after review. No cancellation classification, fixture wait, prerequisite or gate changes are proposed.

## Problem demonstrated and actual-run limit

A rendered test with the real React/TanStack Query component, real QueryClient and a pending mocked fetch reproduces one abort when the advisory unmounts under the existing code. The proposed code produces zero aborts, lets that same request finish and caches it under its existing key. It starts no second request.

The b31 run's UNKNOWN driving-status GET remains UNKNOWN. Its record does not identify the actual cancellation caller. The unmount reproduction demonstrates a concrete app-lifecycle mechanism, not that this mechanism caused that recorded abort or that this candidate resolves full mixed feasibility.

## Minimal production change

`DrivingAuthorizationAdvisory` stops consuming TanStack's query-context signal. Its existing status loader accepts an optional signal; callers that provide one still receive the same fetch behavior. This query therefore permits an already-started read to finish when its observer leaves. No shared abort helper or new controller is introduced.

The component is shared by BOTH clock UIs and the planning panel's selected-employee advisory. The lifetime change applies to all three. The query still starts only when the component is mounted with both organization/user guards. Its key still includes organization, user and employee/self. Endpoint parameters, same-origin credentials, no-store, server organization/permission checks, status meanings, refresh interval60s, retry=false, refetch button, error rendering and clock-button independence are unchanged. Employee-list cancellation is unchanged.

An observer moved outside the panel would introduce a wider mount/query lifetime or require additional coordination to preserve deferred starts. The small signal opt-out retains the existing starts and UI placement. It does let a started read consume network/server work after unmount, including a replaced refetch's old network request; those costs remain measured, not removed. TanStack still discards a replaced query attempt's late result, and identity changes keep finishing old reads under their old keys. There is no new clock wait or requirement to finish this advisory before submitting a command.

## Verification and decision boundary

The existing rendered suite covers pending/suspended/error warnings without blocking Clock In, feature-off invisibility, organization/user isolation and planner access. Added real QueryClient tests cover pending-read unmount, deferred mount/identity starts, late old organization/user or employee results, and replacement-refetch ordering. Fetch is mocked; no HTTP, browser, database or app service was run. Timekeeping references were read; UTC/offset storage, business time calculations and clock writes are untouched.

A cached React Doctor0.9.14 changed-file scan examined the three source/test files and reported no issues, with telemetry/score and supply-chain network checks disabled. No tool or project dependency was installed and no health score is claimed.

The reviewed production diff is confined to the signal consumer and the loader parameter type. Tests and this proposal are the other changes. If approved, BOTH builds need fresh actual CI/build/manifest/registry/source qualification before future captures. Existing profiles, old failed runs, numerical acceptance and C13 prerequisites are not requalified by these tests.
