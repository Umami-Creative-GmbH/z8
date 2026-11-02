# Third-party time terminals

Z8 does not accept clock events from third-party time terminals: the
wall-mounted RFID devices from time-recording vendors that run their
own firmware, authenticate as themselves and buffer punches while
offline. Z8 has no vendor cloud API connector, no endpoint for
terminals to push punches to, and no polling or file-drop import for
them. Employees clock at a Z8 kiosk, which is an enrolled browser
device (`apps/webapp/src/lib/time-tracking/docs/adr/0006-kiosk-only-employees-are-users-with-reserved-undeliverable-emails.md`).

## Why this is out of scope

**A terminal punch is a bare tap.** A vendor terminal usually reports
"this badge number was tapped at this time" and nothing else. Z8 would
have to infer clock in or clock out from the employee's current state.
ADR 0013 rejected exactly that: a scan can be accidental or repeated,
so the employee always chooses the action
(`apps/webapp/src/lib/time-tracking/docs/adr/0013-kiosk-badges-authorize-online-clocking-without-a-pin.md`).

**The badge number proves nothing.** Terminals identify people by the
chip serial number or a vendor badge number. ADR 0014 decided that a
serial number is an identifier, not a credential: it is not secret
and writable cards clone it cheaply, so at a Z8 kiosk it only selects
the employee and the kiosk PIN still proves who is clocking
(`apps/webapp/src/lib/time-tracking/docs/adr/0014-a-kiosk-fob-selects-the-employee-and-the-kiosk-pin-still-proves.md`).
A terminal punch would write work on the strength of that serial
number alone.

**Buffered punches skip the checks Z8 makes on arrival.** Terminals
store punches offline and send them hours or days later. Z8 accepts
offline kiosk clocking only from kiosks switched to offline mode in
adopted organizations, and checks the kiosk PIN when the frozen
command reaches Z8
(`apps/webapp/src/lib/time-tracking/docs/adr/0011-an-offline-kiosk-pin-is-checked-only-when-it-reaches-z8.md`).
Badge and fob clocking are online only, so that revocation and
departure apply at the moment of the action. A buffered terminal punch
has no PIN to check and can arrive after its credential was revoked or
its employee left.

**Every vendor is a different integration.** There is no common
protocol. Each vendor has its own cloud API, push format, polling
interface or export file, each needs its own device authentication and
badge enrollment, and each needs the vendor's hardware to verify. A
generic "connect your terminal" feature would be a family of adapters
built without a customer to test them against.

**Kiosk fobs already cover the card.** An organization that wants
employees to tap a card can register those cards, including access
cards employees already carry, as kiosk fobs and read them at a Z8
kiosk with a USB reader that types the serial number (#1358). That
keeps the explicit action, the PIN proof and the online authorization
checks.

## What is still in scope

- Kiosk fobs: any 13.56 MHz card or fob read at a Z8 kiosk, selecting
  the employee before the kiosk PIN (ADR 0014).
- Kiosk badges, kiosk PINs and offline kiosk clocking as decided in
  ADRs 0011 and 0013.

A customer who already runs terminals from a named vendor, with a
model, a protocol and hardware access for verification, may bring that
as a new request. It must still answer the points above: how the
terminal authenticates, how a tap becomes an explicit action, and how
delayed punches meet revocation and departure. Treat it as a new
request for that vendor, not a reopening of a generic terminal
integration.

## Prior requests

- #1495: "Kiosks: scope third-party RFID time terminal integration"
  (split from #1358)
