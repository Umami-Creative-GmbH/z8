---
status: accepted
---

# A break in progress is recorded on the server

A break is one command that closes live work at the break's start and resumes it at the command's instant, so until now a manual break in progress existed only on the device that started it; the Windows companion keeps its "On break" label locally (#780). A kiosk cannot work that way: an employee may start a break at one kiosk and resume it at another, and the who-is-in board must show who is on break. We decided that a break in progress is Time Tracking state recorded with the employee's live work (#761). Resuming sends the existing break command with the recorded start; ending the day while on break clocks out at the break's start. Both admissions support it, as Clocking owns both (ADR 0002).

## Considered Options

- **Start break is a clock-out, resume is a clock-in.** Rejected: the board could not tell a break from leaving, and every break would run the clock-out follow-ups, including the compliance check, in the middle of the day.
- **Device-local break state, as in #780.** Rejected: it breaks as soon as one location has two kiosks.

## Consequences

- Until a break in progress ends, the live work it interrupts keeps counting in the day total; resuming or ending the day removes the break interval.
- Web, mobile and desktop may adopt the same state later; #780 does not have to.
- Every writer that closes live work (web or kiosk clock-out, on-behalf clock-out, automatic clock-out, departure clock-out) ends it at the open break's start and clears the break in progress, so a break never counts as work. A forgotten break needs no limit of its own: the automatic clock-out ends it the same way.
