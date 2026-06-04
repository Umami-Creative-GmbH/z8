# SMTP Diagnostics Overrides and IP Mode Design

## Goal

Add temporary SMTP overrides to `/platform-admin/diagnostics` so platform admins can test a complete SMTP configuration without changing environment variables or tenant settings. Extend the app-wide SMTP stack with an IP-family mode so system SMTP, organization SMTP, and diagnostics SMTP tests can use automatic address selection, IPv4 only, or IPv6 only.

## Context

The diagnostics page already has a platform-admin-only Email Delivery Test that sends through the system email path and allows overriding the recipient. The email stack supports system SMTP from environment variables and organization-specific SMTP configuration from `organization_email_config`, with SMTP passwords stored in Vault. `SmtpTransport` currently builds a nodemailer transport from host, port, TLS, STARTTLS, username, password, and sender settings.

Operators need to test SMTP credentials and connection settings quickly, including DNS/address-family issues, without deploying new environment variables or persisting temporary secrets. Organizations that use their own SMTP provider need the same IP-family control for production sends.

## Scope

In scope:

- Add a temporary SMTP override mode to the existing platform diagnostics Email Delivery Test.
- Force SMTP-only delivery when temporary SMTP overrides are used.
- Add shared SMTP IP mode values: `auto`, `ipv4`, and `ipv6`.
- Add a system-level `SMTP_IP_MODE` environment variable with default `auto`.
- Add an organization-level `smtp_ip_mode` setting stored in `organization_email_config`, default `auto`.
- Expose the organization SMTP IP mode in the existing organization email settings form.
- Wire system SMTP, organization SMTP, and diagnostics temporary SMTP through the same transport-level option.

Out of scope:

- Persisting platform diagnostics temporary SMTP overrides.
- Showing existing SMTP environment values in diagnostics.
- Testing organization-specific SMTP settings from the platform diagnostics page.
- Adding Resend IP-family controls.
- Changing tenant scoping or email template behavior.

## Recommended Approach

Use a shared `SmtpIpMode` concept at the transport boundary. Each SMTP configuration source maps into that enum:

- System SMTP reads `SMTP_IP_MODE` from env and defaults to `auto`.
- Organization SMTP reads `smtp_ip_mode` from the database and defaults old rows to `auto`.
- Diagnostics override input includes `ipMode` and defaults the UI to `auto`.

This avoids diagnostics-only behavior and ensures the diagnostics override exercises the same transport capability production SMTP uses.

## Diagnostics UI

Extend the existing Email Delivery Test card with a blank temporary SMTP override section. The recipient field remains as it is today.

Temporary SMTP override fields:

- SMTP host
- SMTP port
- SMTP username
- SMTP password
- From email
- Optional from name
- Secure TLS boolean
- Require STARTTLS boolean
- IP mode: Auto, IPv4 only, IPv6 only

All temporary SMTP override fields are blank by default except booleans and IP mode, which default to the current app defaults: secure true, require TLS true, and IP mode auto. The UI must not prefill system SMTP host, username, from address, or any secret.

If any temporary SMTP override text field is entered or any override control differs from its default, the send action treats the request as a temporary SMTP test. In that mode, the action requires the full SMTP override set: host, port, username, password, from email, secure, require TLS, and IP mode. From name remains optional.

## Diagnostics Server Action

Update `sendPlatformDiagnosticsTestEmailAction()` to accept an optional temporary SMTP override object.

Behavior:

1. Require platform-admin access before validation or sending.
2. Validate the recipient email.
3. If no SMTP override is provided, preserve the current system email path behavior.
4. If an SMTP override is provided, validate the full SMTP override set.
5. Construct a one-off `SmtpTransport` from the submitted override values.
6. Send the diagnostics message through that temporary transport only.
7. Do not pass an organization ID.
8. Do not fall back to Resend, console, env SMTP, or tenant SMTP when temporary SMTP is used.
9. Return only safe fields such as recipient and message ID.
10. Return generic client errors for delivery failures.

Detailed SMTP provider errors may be logged server-side following existing logging patterns, but the client response must not include hostnames, usernames, passwords, provider diagnostics, or other submitted SMTP values.

## App-Wide SMTP IP Mode

Define a shared IP mode type with these values:

- `auto`: preserve Node/nodemailer default address selection.
- `ipv4`: force IPv4 resolution/connection behavior for SMTP.
- `ipv6`: force IPv6 resolution/connection behavior for SMTP.

`SmtpTransportConfig` gains `ipMode?: SmtpIpMode`. `SmtpTransport` maps the value into nodemailer-compatible connection options. `auto` should omit the forcing option so existing behavior remains unchanged.

System SMTP:

- Add `SMTP_IP_MODE` to env validation as `auto | ipv4 | ipv6`, optional.
- `createSystemSmtpTransport()` passes `env.SMTP_IP_MODE ?? "auto"` into `SmtpTransport`.
- Existing deployments without `SMTP_IP_MODE` continue to behave as auto.

Organization SMTP:

- Add `smtp_ip_mode` to `organization_email_config` with default `auto`.
- Update schema exports and add a Drizzle migration.
- Include `smtpIpMode` in email config action input and output types.
- Save `smtpIpMode` only for SMTP configs; clear it or default it when using Resend.
- When creating organization SMTP transports, pass `config.smtpIpMode ?? "auto"` into `SmtpTransport`.

Organization settings UI:

- Add an IP mode control inside the existing SMTP Configuration section.
- Default to `Auto` for new and existing configs.
- Options are `Auto`, `IPv4 only`, and `IPv6 only`.
- Keep the control near the host/port/TLS fields because it affects connection behavior.

## Data Migration

Add a new nullable/defaulted text column to `organization_email_config`:

- Column: `smtp_ip_mode`
- Values: `auto`, `ipv4`, `ipv6`
- Default: `auto`

Existing rows should read as `auto` after migration. The implementation can enforce valid values in application validation. A database check constraint is optional if consistent with current migration style.

## Security

- Temporary diagnostics SMTP settings are never persisted.
- Temporary SMTP passwords are not logged, returned, or shown after submission.
- Diagnostics inputs remain platform-admin-only.
- Organization SMTP settings remain organization-scoped through existing settings access helpers.
- Tenant data access must continue to filter by `organizationId` and use existing authorization helpers.
- Invalid IP mode values are rejected server-side.
- Diagnostics SMTP override failures return a generic message such as `Failed to send test email.`

## Error Handling

Diagnostics:

- Validation errors identify missing or invalid fields without echoing secrets.
- Delivery failures return a generic failure message.
- Success shows the recipient and optional message ID.

Organization settings:

- Invalid `smtpIpMode` values are rejected on save.
- Existing test email behavior remains unchanged, except SMTP sends use the saved IP mode.

System SMTP:

- Invalid `SMTP_IP_MODE` values fail env validation consistently with other enum env vars.
- Missing `SMTP_IP_MODE` defaults to auto.

## Testing

Add or update focused tests for:

- `SmtpTransport` maps `auto`, `ipv4`, and `ipv6` to the expected nodemailer options.
- `createSystemSmtpTransport()` passes `SMTP_IP_MODE` and defaults to `auto` when unset.
- Organization email config actions read, save, and return `smtpIpMode` without touching secrets.
- Organization SMTP transport creation passes saved `smtpIpMode` to `SmtpTransport`.
- Organization settings UI renders the IP mode control and submits selected values.
- Diagnostics client renders blank temporary SMTP override fields with IP mode defaulted to auto.
- Diagnostics action preserves current system email behavior when no override is provided.
- Diagnostics action forces temporary SMTP-only delivery when override input is provided.
- Diagnostics action rejects incomplete override input and invalid IP mode values.
- Diagnostics action does not leak host, username, password, or provider errors in client responses.

## Acceptance Criteria

- Platform admins can send a diagnostics test email with a complete temporary SMTP override.
- Temporary SMTP diagnostics tests use SMTP only and never silently fall back to Resend, console, env SMTP, or tenant SMTP.
- Temporary SMTP override fields are blank by default and are not persisted.
- System SMTP supports `SMTP_IP_MODE=auto|ipv4|ipv6`, defaulting to `auto`.
- Organization SMTP settings expose and persist Auto, IPv4 only, and IPv6 only.
- Existing system and organization SMTP behavior remains unchanged unless IP mode is explicitly changed.
- No SMTP secrets or detailed provider errors are exposed in diagnostics UI or action responses.
