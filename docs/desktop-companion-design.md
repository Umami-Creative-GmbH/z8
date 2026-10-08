# Windows clocking companion

Status: shared understanding confirmed by the user on 2026-10-08; implementation tracked in #780. This document records intended behavior, not completed implementation or release readiness.

## Purpose and audience

Finish the existing desktop app as a focused clocking companion for employees using their own computers. Windows is the first release platform. Use a controlled customer pilot before broad distribution. Support hosted Z8 and customer-hosted Z8 over trusted HTTPS.

The webapp owns corrections, reports, approvals and broader workforce workflows. The companion opens the relevant webapp context for those tasks. Keep time records in the existing Time Tracking context rather than introducing a desktop-specific source of truth.

## Agreed daily workflows

- Clock in and clock out, showing the current work state and elapsed live work.
- Start Break ends live work at the employee's click. Resume starts new live work at the next click. End Day while on break ends break mode without another clock-out.
- Show On break distinctly from Not clocked in. A break state does not imply server-confirmed live work.
- Show the day total using the employee's timekeeping context, including completed work and elapsed live work. Pending offline work must be distinguishable from confirmed server work.
- Select work location. Support applicable project and work-category selection under existing server eligibility rules. The investigation has not established an organization setting that requires these selections; do not invent one.
- Support organization switching and links to corrections and reports in the selected organization.
- Provide German and English, using the employee's Z8 language preference where available.

## Offline and recovery

Reliable offline clocking is a release requirement. Pilot eligibility requires a server and organization that negotiate durable clock-in/out and supported retrospective break capabilities. Explain incompatible or inactive server configurations and the administrator action required; do not silently promise offline functionality through a legacy transport.

Capture each clock command durably before sending, with its original identity, event instant, device timezone and full endpoint/account/organization/employee context. A lost response is uncertain until lookup confirms the outcome. Resend the same command identity and bytes only as allowed by the existing protocol. A queued clock-out targets the intended work, not whatever happens to be live at later synchronization.

Show saved-on-device, syncing, confirmed, paused and needs-review outcomes clearly. Preserve unresolved evidence across restart, logout, server changes and upgrades. Never clear a queue as a recovery shortcut. Uncertain legacy records require authorized, evidence-based recovery; the current login does not establish ownership. Review and corrections remain webapp workflows.

Offline clocking begins only after the same account, organization and server have connected successfully and negotiated the required capabilities. Switching these contexts requires connectivity. The existing fresh-submission window is seven elapsed days; older unsent actions retain their evidence and require reviewed correction rather than unlimited automatic replay.

Pilot organizations must already qualify through the shared timekeeping adoption process. This desktop scope does not authorize activating an unready organization. Installations blocked by identity-less legacy records require authorized recovery before enrollment; the new frozen-command recovery controls do not resolve those records.

Current production activation is unverified. September 25 delivery notes describe outstanding server activation and installed-client gates; their historical production statements do not establish today's deployment status.

## Desktop behavior

Use the system tray as the primary desktop presence. Closing the window hides it; explicit Quit exits. Launch at Windows sign-in is opt-in. Restore saved topmost/startup preferences and show operation failures.

Idle prompts are opt-in with an adjustable threshold and a ten-minute default. Prompt after return, show the proposed interval, and require explicit confirmation that it was a break. Lack of input is not proof of a break. An idle-confirmed retrospective break is distinct from a manual break in progress.

The On break label is companion state bound to its account, organization, employee and server. Server-confirmed live work takes precedence: if work starts on another device, show that work and end the local break mode. Resume must not create duplicate work. This scope does not introduce a shared break-state model across web, mobile and desktop.

Sleep, hibernate, a changed device clock, missing timezone evidence or live work changed elsewhere must never fabricate a break. Use the existing evidence rules and direct uncertain intervals to reviewed correction.

## Authentication and release requirements

Use browser-based Z8 sign-in, binding each attempt to its original server and validating the callback. Store credentials using Windows credential protection. Expired sessions must request sign-in visibly without losing saved work. Isolate account, organization and server caches; show the confirmed organization and meaningful switching errors.

Provide signed Windows installers and an in-app update check. Notify the employee when an update is available; restarting is user-controlled. Updates must preserve pending actions, receipts and recovery evidence and be compatible with the saved-command store. Signing and publication require the organization's release credentials and ownership; these are deployment prerequisites, not something this document supplies.

## Release evidence to obtain

The acceptance bar is a running installed Windows application, not just passing library tests. Verify the following against an eligible hosted organization and a representative customer-hosted installation, using disposable records or an approved pilot organization.

| Scenario | Required outcome |
| --- | --- |
| Offline clock-in, break, resume and clock-out | Original actions survive restart and synchronize in order without duplicates. |
| Server commits but response is lost | Lookup establishes the original result; no duplicate work is created. |
| Another device changes live work | Desktop refreshes authoritative status; saved actions never target unrelated work. |
| Logout or organization/server switch with saved actions | Actions retain their original ownership and cannot be sent under the new context. |
| Session expires while work is pending | Sign-in is requested, saved work remains, and the UI does not mislabel authorization failure as an internet outage. |
| Start Break, restart, then Resume or End Day | Break state is understandable; no extra clock-out or invented resumed work occurs. |
| Sleep/hibernate or device-clock change during inactivity | No unconfirmed or unsupported break is written. |
| Update or rollback with unresolved commands | Commands and evidence remain readable; clocking and recovery follow store compatibility rules. |
| Midnight, DST and travel | UTC durations and per-event offsets remain correct; the day total follows the employee's day boundaries. |
| Install/uninstall and browser sign-in callback | Signed installation works, callback returns to the correct attempt, and credential persistence is verified. Uninstall behavior must warn before removing unresolved evidence. |
| Window close, tray reopen, startup and Quit | Lifecycle matches the documented behavior; sync is not silently terminated by window close. |
| Keyboard-only use, screen reader and both themes | Core clocking and recovery actions remain accessible and clearly labelled in German and English. |
| Legacy retained records | Authorized recovery preserves evidence and does not infer ownership from the current login. A blocked installation is excluded from the pilot until recovery. |

## Existing evidence and unresolved delivery work

Source investigation found existing Tauri/Rust/React clocking, PKCE browser login, work location, organization switching, frozen offline commands and retrospective idle breaks. It also found gaps in credential persistence, visible authentication errors, organization cache isolation, tray lifecycle/settings, legacy recovery, day totals, explicit manual breaks, updater configuration and release packaging.

Read the existing contracts before changing these paths:

- [Timekeeping](refs/timekeeping.md)
- [Time Tracking language](../apps/webapp/src/lib/time-tracking/CONTEXT.md)
- [Durable desktop commands](desktop-clock-commands-280.md)
- [Retrospective atomic breaks](desktop-break-close-resume-281.md)

No implementation, test result, signing, production activation or pilot completion is asserted by this scope document. Reconcile existing tickets, dependencies and assignees before claiming implementation work. Keep the implementation on a dedicated feature branch.
