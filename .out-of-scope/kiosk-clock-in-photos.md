# Kiosk clock-in photos

Z8 kiosks do not take photos of employees when they clock in or out,
at any other kiosk step, or as an optional setting. A kiosk camera is
used only to read a kiosk badge's QR code. It decodes the code on the
device and never saves or uploads an image
(`apps/webapp/src/lib/time-tracking/docs/adr/0013-kiosk-badges-authorize-online-clocking-without-a-pin.md`).

## Why this is out of scope

**The purpose depends on capture the employee cannot refuse.** A photo
at clock-in is meant to stop buddy punching, where one employee clocks
in for another. It only does that if the photo is taken whether or not
the person in front of the kiosk agrees. With consent as the legal
basis, the way Z8 treats position stamps, the person clocking in for
someone else would simply decline, and the photo would prove nothing.

**Capture without consent is the line Z8 has already drawn.** For
position stamps (#766), Z8 rejected an employer switch backed by a
works agreement or legitimate interest. Employees could not opt out,
and that is the employer-monitoring risk Z8 keeps away from
(`apps/webapp/src/lib/time-tracking/docs/adr/0004-position-stamps-require-position-consent.md`).
A photo of a face at every clock event goes further than one
coordinate. It is a technical system that can monitor behaviour under
§ 87(1) no. 6 BetrVG. It also routinely captures other people in the
frame, and Art. 9 GDPR applies the moment anyone adds face matching.
It sits next to
[employee activity monitoring](employee-activity-monitoring.md), which
Z8 also does not offer.

**Kiosks already identify the employee.** A kiosk accepts a clock
command only from an enrolled device, for an active employee at an
assigned location, with that employee's PIN or kiosk badge. ADR 0013
accepted that someone holding a copy of a badge can use it until the
badge is revoked, in exchange for a faster flow. Organizations that
need stronger proof can keep name-and-PIN or revoke and replace a badge
that has been shared. They do not need to photograph everyone.

**It would break a promise to employees.** The badge specification
(#889) tells employees that scanning "does not create photos of people
at the kiosk". An optional photo setting would leave every employee
unsure whether the camera in front of them is only reading a code.

## What is still in scope

- Reading kiosk badges with the kiosk camera, decoded on the device
  with no stored images (ADR 0013).
- NFC fobs and RFID terminals as other ways to identify an employee
  (#1358).

If a request needs a picture of the person at a clock event, it belongs
here. A customer who brings a concrete works agreement and a use that
does not rely on photographing everyone may reopen the question. Treat
that as a new request, not a toggle on this one.

## Prior requests

- #1359: "Kiosks: review optional photo capture at clock-in" (split
  from #889, follow-up of #761)
