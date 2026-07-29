# Manager Eligibility Query Concurrency

## Goal

Resolve the two `react-doctor/server-sequential-independent-await` warnings in manager eligibility database reads without changing eligibility, authorization, or organization-scoping behavior.

## Design

In both `getEligibleManagerIdsForRequester` and `getPrimaryEligibleManagerIdForRequester`, start the organization employee read, requester manager-link read, and team-eligibility read together in one `Promise.all`. Keep the existing query predicates and downstream resolver inputs unchanged.

The team-eligibility helper continues to run its membership and team reads concurrently and preserves its existing fallback for deployments where the team schema is not migrated.

## Tests

Replace the test that requires the employee read to resolve first with concurrency coverage. Deferred query promises will prove that manager-link and team reads start before the employee promise resolves. Cover both warned functions so each regression is observable before changing production code.

Run the focused manager eligibility tests, webapp typechecking, and React Doctor with `--verbose --scope changed`. The two sequential-await warnings must disappear and the React Doctor score must not regress.

## Non-Goals

- Change manager eligibility rules or resolver precedence.
- Change organization filters or permission boundaries.
- Refactor unrelated approval queries.
- Suppress or disable the React Doctor rule.
