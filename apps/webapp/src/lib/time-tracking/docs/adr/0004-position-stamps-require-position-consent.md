---
status: accepted
---

# Position stamps require the employee's position consent

Field teams and their customers want proof of where work was done, so an employee's own clock commands may carry a position stamp (#766). This reverses the 2026-05-08 quick clock-in work-location design, which ruled geolocation out. We decided that a position stamp is captured only while the organization has switched capture on for that employee and the employee's own position consent, given against the current position notice, is active. The employee may withdraw at any time, which deletes their existing stamps. A clock command is never refused or delayed for want of a position, and nothing records why a stamp is missing, so that refusing cannot be singled out.

## Considered Options

- **An employer switch alone, backed by a works agreement or legitimate interest.** Rejected: employees could not opt out, which is the employer-monitoring risk the market-comparison tracker (#758) keeps Z8 away from, and it contradicts Z8's compliance positioning. Organizations still need their own works agreement where § 87(1) no. 6 BetrVG applies; Z8 records consent, not that agreement.
- **Let each organization choose consent or an employer switch.** Rejected for the same reason, and because it doubles the rules every reader of a stamp must follow.

## Consequences

- Consent is the only legal basis, so withdrawal deletes the employee's existing stamps, while switching capture off or a lapsed notice version keeps them until their purge date.
- A stamp captured offline is kept only if consent is still active, for the current notice version, and capture is still switched on when the clock command arrives; otherwise the clock event is accepted without it.
- Position stamps never enter payroll, GoBD audit, works-council or analytics exports, so the retention purge is never defeated by an archive.
