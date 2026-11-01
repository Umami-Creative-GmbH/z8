---
status: accepted
---

# A kiosk fob selects the employee; the kiosk PIN still proves

Employees want to tap an NFC card or fob at a kiosk instead of searching for their name (#1358). Unlike a kiosk badge (ADR 0013), a fob carries no Z8 secret: the keyboard-style readers that work on every kiosk platform type only the chip's serial number, which is not secret (access-control systems record it and anyone can type it into the kiosk's keyboard input) and is cheaply cloned onto writable cards. The maintainer decided on 2026-11-01 that a kiosk fob therefore only selects the employee and the employee still enters their kiosk PIN. A fob never authorizes clocking on its own.

## Considered Options

- **Let the fob authorize clocking without a PIN, like a kiosk badge.** Rejected: a serial number is an identifier, not a credential, so anyone who learns or clones one could clock as that employee.
- **Write the kiosk badge secret onto an NFC tag and read it with Web NFC.** Rejected: Web NFC exists only in Chrome for Android on tablets with NFC hardware, no stock keyboard-style reader types a tag's stored text, and the stored text is copied as easily as a printed QR code.

## Consequences

- The fob works with any 13.56 MHz card or fob, including access cards employees already carry, and with any reader that types the serial number. Z8 accepts only hexadecimal serial numbers and never guesses byte order, so one documented reader setup keeps kiosks consistent.
- The kiosk PIN's lockout and lifecycle rules apply unchanged. Because a fob proves nothing, employees register their own fob at a kiosk with their PIN, without an admin. Registration notifies the employee, or their managers for a kiosk-only employee, because it replaces any earlier fob.
- Fob clocking is online only. Offline, the kiosk falls back to name and PIN; this decision does not extend offline kiosk clocking (ADR 0011).
- Turning a fob into proof later would need a new credential and new hardware (for example, cryptographic tags read natively), not a settings change.
