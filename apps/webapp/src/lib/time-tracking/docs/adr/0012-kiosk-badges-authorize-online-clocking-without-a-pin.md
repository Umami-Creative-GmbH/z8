---
status: accepted
---

# Kiosk badges authorize online clocking without a PIN

Personal QR badges (#889) should make kiosk clocking faster than selecting a name and entering a PIN. The maintainer decided on 2026-10-17 that a kiosk badge replaces the PIN as the employee's proof at an enrolled kiosk: the employee scans it and then chooses a clock action. Possession of a copy is sufficient until revocation, an accepted trade-off for the shorter flow. The badge grants no account sign-in and does not bypass organization, active-employee or assigned-location checks.

## Considered Options

- **Use the QR only to select an employee, then ask for a PIN.** Rejected for the first version: it retains PIN entry instead of delivering the intended shorter flow.
- **Change clocking state immediately on a scan.** Rejected: a scan can be accidental or repeated. The employee still explicitly chooses clock in, clock out, start break or resume from the actions valid for their state.
- **Accept badge clocking offline immediately.** Deferred: the first version requires a connection so the server can check current badge authorization and revocation. This decision does not extend the offline PIN protocol to badges.

## Consequences

- Name-and-PIN clocking stays available as the fallback, including its existing offline behavior under ADR 0011 and the adopted-organization restriction of ADR 0002.
- Badge authorization must remain valid when the employee submits an action; scanning is identification, not a committed clock command.
- The kiosk keeps its own device identity and the kiosk channel. Clocking still owns both admissions and all work changes; the badge supplies the employee's proof rather than a new way of writing time data.
- Enrollment, replacement, permitted issuers and scan inputs are being scoped separately in the ongoing interview on #889. This decision records only the confirmed authorization, connectivity and explicit-action rules.
