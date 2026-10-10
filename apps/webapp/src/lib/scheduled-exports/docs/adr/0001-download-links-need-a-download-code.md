# Download links need a download code; report share links don't

A download link only lets an approved external recipient download after they enter a download code, sent to their approved address when they open the link. A Projects report share link opens on its token alone. Scheduled exports carry payroll files, full data exports and audit reports, so a forwarded email must not hand anyone a working download. A report share link shows a frozen, deliberately trimmed snapshot to a recipient the sharer picked. There, the convenience of opening the link at once outweighs the risk of a forward. The two are kept different on purpose; don't align them in either direction without revisiting this decision.

## Considered Options

- **Token alone, as for report share links**: rejected. Anyone who receives a forwarded email gets a week of access to payroll data.
- **Token with a download limit**: rejected. It limits how often the file is downloaded, but not who downloads it.
- **A Z8 account for every recipient**: rejected. Tax advisors and payroll bureaus are the main external recipients, and they have no Z8 account.

## Consequences

- Each download needs the recipient to read the approved mailbox. A recipient whose approved address is a shared team mailbox can still forward codes inside that team.
- Sending and checking codes are written to the download log alongside downloads, so an admin can see failed attempts.
