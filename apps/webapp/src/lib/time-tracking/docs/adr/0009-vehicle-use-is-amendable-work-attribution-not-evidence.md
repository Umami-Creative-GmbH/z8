---
status: accepted
---

# Vehicle use is amendable work attribution, not evidence

Drivers and field staff record which vehicle they drove during a work period and its odometer readings (#807). Unlike a position stamp (ADR 0004), which is device-captured evidence that is never edited, vehicle use is typed in by the employee and odometer readings are often mistyped. We decided that vehicle use is part of work attribution: it is corrected under the same change policy as work location, frozen by a closed month, and sends a period submission back when it changes. An employee with vehicle use expected is asked on every clock command and their work is flagged as driving details missing, but a clock command is never refused or delayed for want of a vehicle or reading.

## Considered Options

- **Fixed evidence, like a position stamp.** Rejected: a typo in a reading could never be fixed, and corrected readings would need a second, parallel record.
- **Refusing a clock-out without readings when vehicle use is expected.** Rejected: it would block recording working time over a secondary detail, and automatic, departure and on-behalf clock-outs can never supply a reading.

## Consequences

- Because readings stay editable, vehicle use is not a tamper-proof tax logbook (Fahrtenbuch). Z8 says so in its docs and settings and records no trip purpose or business partner.
- Vehicle use is an ordinary employment record entered by the employee, so it needs no consent and follows normal retention, unlike position stamps.
