---
status: accepted
---

# An offline kiosk PIN is checked only when it reaches Z8

Offline kiosk clocking (#885) needs the kiosk PIN proven without a connection. A kiosk is a shared tablet that anyone at the location can pick up, and a kiosk PIN has only 4–6 digits, so any verifier kept on the device gives the PINs of everyone at its location away within minutes to whoever takes it, and the lockout cannot slow that down. We decided that an offline kiosk keeps nothing that can check a PIN. It seals the entered PIN so that only Z8 can read it, keeps it with the frozen clock command, and Z8 checks it against the employee's current kiosk PIN when the command arrives, exactly as an online attempt. The kiosk tells the employee the clocking is not confirmed until then, and a command refused on arrival is reported to the employee, or to their managers when they have no sign-in, and listed for owners and admins in the kiosk's settings.

## Considered Options

- **Kiosk PIN hashes on the device.** Rejected: a stolen kiosk yields every PIN at its location by brute force.
- **A short check value per employee on the device, to catch typos at once.** Rejected: a check strong enough to catch typos narrows a 4-digit PIN to a few dozen candidates for whoever holds the device.

## Consequences

- The lockout is replayed in the order attempts happened, not applied as it stands on arrival: five failures, online or offline, lock the employee for 15 minutes from the fifth, and a queued attempt inside that window is refused even with the right PIN. Failed attempts are therefore kept with their instants, not only counted. Each kiosk still applies its own attempt limit while offline.
- A command is authorized as things stand when it arrives: the kiosk active, the employee assigned to its location and the PIN their current one. A PIN reset during an outage refuses commands made with the old PIN; old PINs are never kept to check back-dated commands.
- Every command a kiosk queued is refused when the kiosk was revoked, or its token rotated, while it was offline, whatever instant it claims, because nothing such a device says can be trusted.
- Offline kiosk clocking sends frozen clock commands, so it is offered only in adopted organizations (ADR 0002).
