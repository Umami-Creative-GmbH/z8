---
status: accepted
---

# Clocking owns both admissions; callers never see admission

Every clock command (clock in, clock out, break, on-behalf clock-out, departure clock-out) goes through one Clocking module, which reads the organization's admission itself and runs the legacy or the append writer. Adapters (web, bots, v2 frozen commands, on-behalf, the legacy desktop route, departure) never branch on admission. We decided this even though append is the long-term path: every production organization is still on `legacy`, no plan retires it, and the clocking bugs we keep fixing (such as the missing occupancy check in #327) sit in the per-entry-point copies of the legacy and append branches. An append-only module would have deepened code no production traffic runs.

## Considered Options

- **Append-only module, legacy left in the entry points until retirement.** Rejected: the invariants (occupancy, billing, holiday, canonical work record, replay) would still drift across six entry points for as long as legacy lives, and nothing schedules its end.
- **Retire legacy first, then deepen.** Rejected: there is no retirement plan, and the pilot (#448) activates append one organization at a time.

## Consequences

- The one place admission shows through is a capability refusal: frozen clock commands are refused in legacy organizations (`frozen_not_accepted`, mapped to v2 `not_adopted`), because the legacy writer keeps no receipts to replay a delayed command.
- Retiring legacy later means deleting the module's internal legacy writer, not touching adapters.
