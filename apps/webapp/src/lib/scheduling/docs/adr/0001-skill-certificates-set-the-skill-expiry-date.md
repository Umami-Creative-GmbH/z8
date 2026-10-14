---
status: accepted
---

# Skill certificates set the skill expiry date

A certificate in the personnel file can prove an employee skill, and both carry an expiry date. Two editable dates for one fact drift apart, and two-way sync invites conflicts. We decided that while dated **skill certificates** name an employee skill, the latest expiry date among them is the **skill expiry date**, and nobody edits it on the skill side. Uploading a renewed certificate extends the skill. Only personnel file officers covering certificates for that employee, owners and admins may name a skill, so an employee cannot extend their own skill by uploading a certificate.

## Considered Options

- **The skill's date wins and a skill certificate has no expiry date of its own.** Rejected: officers renew certificates, but managers edit skills. An officer could not extend a skill by filing its renewal.
- **Both dates stay editable and the UI flags a mismatch.** Rejected: two sources of truth, and scheduling would still have to pick one.
- **The employee names the skill on their own upload.** Rejected: the link changes the skill expiry date, so it would let employees extend their own qualifications.

## Consequences

- When the last dated skill certificate is unlinked or purged, the employee skill keeps the date it had, and the skill side can edit it again.
- A skill that requires an expiry date can be named only by a certificate that has one. An undated certificate may name a skill that never expires, and does not change its date.
- Scheduling learns only that a skill certificate is on file. Managers open it only with personnel file access (Personnel File ADR 0001).
