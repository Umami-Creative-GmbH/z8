---
status: accepted
---

# The work transaction coordinator owns the acquisition order, and a wrong order fails in production

Every writer of time data takes its guards in one rank order (adoption gate, approval write gate, organization configuration, user configuration/access, employee coordination, source identity, rows). That order was once enforced only by a comment. Twelve coordinators spelled it out by hand, and the departure path took it backwards. We decided that one coordinator module takes every guard for a declared scope, including scope routing, restart on scope change and sealing. Writers supply only their routing and their operation; the rank primitives are not part of their interface. Guards that are still taken outside a work transaction record themselves in a per-transaction ledger, and taking a lower rank after a higher one, or upgrading a shared guard to exclusive, throws in every environment, not only in tests.

## Considered Options

- **Keep the primitives public and add a lint or test-only assertion.** Rejected: the inversion that shipped (departure) was in a path no test exercised against activation. An order check that runs only in tests misses exactly those paths.
- **A ranked ledger alone, with coordinators still hand-written.** Rejected: it catches violations but leaves the twelve copies of the routing, restart and retry sequence where bugs have landed.

## Consequences

- A mistake in the order refuses a live write (for example a clock-out) instead of risking a deadlock or an adoption interleaving. This is the same fail-closed stance the codebase takes for uncoordinated writers in adopted organizations.
- Raw-SQL guard takers outside the coordinator (the legacy manual replay, and the policy clock-out terminal break fallback) are invisible to the ledger. They are listed as known limits until they retire.
