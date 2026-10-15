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
- Raw-SQL guard takers outside the coordinator (the legacy manual replay) are invisible to the ledger. They are listed as known limits until they retire.
- Three Approvals finalizers change completed work outside the coordinator when no owner's work transaction is open: the ordinary work-period approval, the time-correction finalizer (#1227) and the policy clock-out terminal break (#492, #1221). They take the employee locks through one named entry of the work transaction module, `holdFinalizerEmployeeLocks`. It records the employee key in the transaction's ledger, but takes the terminal-break/work-balance ownership key (rank 6) unrecorded. Recording it would refuse an approval transaction that finalizes several employees' work as soon as it takes the next employee's key (rank 5). Until those transactions run per employee, an inversion against that ownership key deadlocks instead of throwing.
