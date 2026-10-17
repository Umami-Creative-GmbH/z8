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

Each new action rechecks current badge authorization. Revocation after identification but before action submission refuses that action. Losing the connection does not create an offline badge command. A failure known to have recorded nothing offers the separate PIN flow where available; a lost response after submission instead follows the uncertain-outcome recovery below.

An effective departure permanently revokes the badge at its cutoff, using the existing departure model rather than the time a delayed worker happens to run. Scheduling a future departure does not revoke the badge early. Rehire requires a newly issued badge and never restores an old badge or its copies. PIN fallback and its existing lifecycle rules remain separate.

## Uncertain outcomes

If an action's response is lost, the kiosk shows that it is checking whether the action was recorded and retains the operation identity. While the outcome is unknown, it does not offer a duplicate action. After reconnecting, it resolves that submitted operation: if committed, show the recorded result; if the server confirms it recorded nothing, require a fresh explicit action. It must never silently execute an uncommitted action later. This recovery is distinct from queuing new badge clock commands offline.

Outcome recovery must remain organization- and kiosk-scoped and must not execute a new action as a side effect of checking. Revoking a badge after a committed action does not undo that work or justify reporting that nothing was recorded. The implementation must support recovery in both Clocking admissions; the existing frozen-command lookup is not a general online kiosk lookup.

## Camera activation and images

The employee taps Scan badge to open the camera. Stop camera scanning after a successful scan, cancellation or inactivity timeout. QR decoding happens on the device; camera images are never saved or uploaded. An enabled keyboard-style scanner remains ready only on the home screen.

Camera permission is allowed specifically for kiosk documents, preserving the site's existing restriction elsewhere. Device and browser verification remains an implementation check, including denied permissions, unavailable cameras and the PIN fallback.
