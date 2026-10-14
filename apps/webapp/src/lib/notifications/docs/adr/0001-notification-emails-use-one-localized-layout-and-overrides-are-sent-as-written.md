# Notification emails use one localized layout; email overrides are sent as written

A notification's email is its translated title and message, plus optional detail rows and a button, rendered in one shared layout in the recipient language. The per-type absence, time-correction and team templates are no longer the default. Only emails with no notification behind them keep a template of their own: verification, password reset, invitation, export ready/failed and organization deletion. The security alert keeps its own template too, although the password-changed and two-factor notifications send it (#1180). Each of those is translated. An organization's email override still wins and is sent exactly as written to every recipient. Translating 18 per-type templates would multiply copy for little gain, and the code already preferred the generic layout whenever a notification had translation keys. Overrides are single-language because translating them is a separate feature.

## Considered Options

- **Translate every per-type template**: rejected. About 18 templates of copy to keep in step with each notification's own text, and notification types without a template would still have no email.
- **Drop overrides of the retired templates**: rejected. It would silently discard customizations organizations already made.
- **Overrides per language**: deferred. It needs editor and storage changes, and nobody has asked for it.

## Consequences

- Notifications that can be overridden keep supplying the `{{variables}}` their override uses, even though the default layout no longer needs them.
- An organization with an override sends it in one language to everyone. The email-template editor says so.
- Emails that bypassed notifications (absence pending/approved/rejected, time correction pending) now go only through the notification email channel. They honour the recipient's email preferences and the organization's mail transport.
