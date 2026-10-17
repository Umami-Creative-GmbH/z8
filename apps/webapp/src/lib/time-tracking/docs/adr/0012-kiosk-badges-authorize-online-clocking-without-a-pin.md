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

## Badge lifecycle and scan inputs

Owners, admins and the employee's direct manager may issue, replace and revoke kiosk badges, matching kiosk PIN management permissions. Employees receive their badge from these people; the first version has no employee self-service issuance.

An employee has at most one active badge, without scheduled expiry. Replacement immediately invalidates every copy of the old badge. Losing or revoking a badge does not disable the employee's separate PIN fallback.

The first version supports tablet-camera scanning and attached scanners that enter QR contents as keyboard input in the kiosk browser interface. Native mobile-shell scanning is outside #889. Camera access must be enabled specifically for kiosks and supported devices verified; existing receipt-photo capture does not establish live QR scanning support.

## Delivery and per-kiosk control

Issuance produces a printable PDF containing the employee's name, organization and QR code. The PDF is available only during issuance. A saved PDF may be reprinted; losing the saved file requires replacement, invalidating every copy of the previous badge. Initial issuance is per employee; bulk issuance is deferred.

Owners and admins explicitly enable QR scanning per kiosk; it is off by default. Camera and keyboard-style scanner input are configured separately. Scans are accepted only on the kiosk home screen, and camera scanning pauses during an employee's turn. Name-and-PIN remains available.

## Authorization changes and departure

Each action rechecks current badge authorization. Revocation after identification but before action submission refuses that action. Losing the connection does not create an offline badge command: explain the failure and offer the separate PIN flow where available. A lost response after submission must not be interpreted as proof that no work was recorded.

An effective departure permanently revokes the badge at its cutoff, using the existing departure model rather than the time a delayed worker happens to run. Scheduling a future departure does not revoke the badge early. Rehire requires a newly issued badge and never restores an old badge or its copies. PIN fallback and its existing lifecycle rules remain separate.
