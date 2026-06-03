# Platform Admin Email Diagnostics Design

## Goal

Add a platform-admin-only email delivery test to `/platform-admin/diagnostics` and show whether the system-level email providers are configured in the existing `Platform Configuration` diagnostics card.

## Context

The diagnostics page already collects safe deployment configuration and service health on the server, renders a client refresh island, and exposes platform-admin-protected server actions for manual checks. Email sending already supports system-level Resend and SMTP transports, with organization-specific configuration taking precedence only when an organization ID is supplied.

Platform operators need a simple way to verify that the deployed system can send operational email without exposing provider secrets or tenant-specific settings.

## Scope

In scope:

- Show safe system email provider configuration states in `Platform Configuration`.
- Add an email delivery test section to `/platform-admin/diagnostics`.
- Default the test recipient to the signed-in platform admin email and allow overriding it.
- Send the test through the existing system email fallback path, without an organization ID.
- Keep all behavior behind platform-admin authorization.

Out of scope:

- Managing email provider credentials.
- Testing organization-specific email configurations.
- Adding deliverability analytics or webhook tracking.
- Displaying raw SMTP, Resend, or message content secrets.

## Approach

Use the existing diagnostics architecture: the collector adds read-only configuration rows, and a new diagnostics server action performs the explicit send test. The client adds a compact card below the existing diagnostics sections with an editable recipient field, a send button, pending state, and safe success or failure feedback.

This keeps the diagnostics collector read-only and makes actual email delivery an intentional platform-admin action.

## Platform Configuration Rows

Add two safe rows to the `configuration` array returned by `collectPlatformDiagnostics()`:

- `System Resend`: `healthy` when `RESEND_API_KEY` is present, otherwise `disabled`. The existing Resend transport defaults the from address when `EMAIL_FROM` is absent, so the diagnostics row should not require `EMAIL_FROM`.
- `System SMTP`: `healthy` when required SMTP settings are present: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, and `SMTP_FROM_EMAIL`; otherwise `disabled` or `warning` for incomplete configuration.

The row values should be safe summaries such as `Configured`, `Not configured`, or `Incomplete`. They must not include hostnames, usernames, API keys, passwords, or from addresses unless existing diagnostics conventions explicitly allow non-secret names. Prefer not showing any raw values.

## Email Delivery Test

Add a new `Email Delivery Test` card to `DiagnosticsClient`:

- Recipient input defaults to the current platform admin email supplied by the server-rendered page or initial diagnostics props.
- The input is editable so admins can test another inbox.
- The button label is `Send test email`.
- While pending, disable the input and button and show a spinner.
- On success, show a concise confirmation with the recipient and optional message ID if the email transport returns one.
- On failure, show a generic failure message without exposing transport internals.

The test email should be short and clearly identify itself as a Z8 platform diagnostics message. It should include enough context to recognize the deployment, such as the app URL if already available through safe public configuration, but must not include secrets.

## Server Action

Add a diagnostics server action such as `sendPlatformDiagnosticsTestEmailAction(input)`.

Behavior:

1. Require platform-admin access before validation or sending.
2. Validate the recipient with the existing project validation style, using a strict email schema.
3. Render a small static HTML message for diagnostics.
4. Call the existing email service with no `organizationId`, so it uses only the system fallback transport.
5. Return a serializable success result containing only safe fields, such as recipient and message ID.
6. Return generic error text for client display and log detailed failures server-side if existing action patterns do so.

## Security

- Do not expose raw environment variable values.
- Do not expose SMTP usernames, passwords, hosts, Resend API keys, or provider error details in the client response.
- Require `PlatformAdminService.requirePlatformAdmin()` for the page action.
- Validate the editable recipient field before sending.
- Do not accept or send arbitrary HTML from the client.
- Do not pass an organization ID, so tenant-scoped email configuration is not used.

## Testing

Add or update focused tests for:

- Diagnostics collector reports Resend and SMTP configuration states without secret values.
- The test email action rejects non-platform-admin callers.
- The action rejects invalid recipient emails.
- The action sends a valid test email through the system email path.
- The diagnostics client renders the email test card and handles pending, success, and failure states where existing client test style supports it.

## Acceptance Criteria

- `/platform-admin/diagnostics` shows whether system Resend and system SMTP are configured.
- Platform admins can send a test email to their own email or an override recipient.
- Non-platform admins cannot invoke the email test action.
- Invalid email addresses are rejected before sending.
- No secret values or detailed provider errors appear in diagnostics UI or action responses.
