# Email Provider Environment Switch Design

## Context

Z8 currently supports organization-specific email configuration and a system-level fallback. Organization settings take precedence. The system fallback is hard-coded to try Resend first, then SMTP, then the console transport.

Operators need a system-level environment variable that selects the default provider explicitly so deployments can switch between Resend and SMTP without changing code.

## Goal

Add `EMAIL_PROVIDER=smtp|resend` for the system default email transport.

The switch applies only to system-level email delivery. Organization-specific email provider settings continue to take precedence and are not affected by this variable.

## Behavior

When `EMAIL_PROVIDER=resend`, the system transport only attempts Resend. If Resend is not configured, the system falls back to the existing console transport.

When `EMAIL_PROVIDER=smtp`, the system transport only attempts SMTP. If SMTP is not configured, the system falls back to the existing console transport.

When `EMAIL_PROVIDER` is unset, the existing behavior is preserved: Resend first, SMTP second, console last.

Invalid values are rejected by environment validation.

## Architecture

Add `EMAIL_PROVIDER` to `apps/webapp/src/env.ts` as an optional server environment variable with allowed values `smtp` and `resend`, and include it in `runtimeEnv`.

Update `getSystemTransport()` in `apps/webapp/src/lib/email/email-service.ts` to branch on `process.env.EMAIL_PROVIDER` before using the current implicit fallback order. The cached `systemTransport` behavior remains unchanged.

No database schema changes are required.

## Documentation

Update `deploy/.env.template` to document `EMAIL_PROVIDER` alongside the system email variables. The template should describe strict selection and note that leaving it unset preserves the existing Resend-to-SMTP fallback order.

## Error Handling

Provider initialization continues to use existing transport factory behavior. A selected but incomplete provider returns `null` from its factory and then falls back to the console transport.

Logs should make the selected transport visible through the existing `System email transport initialized` message.

## Testing

Add or update focused tests if existing email service tests are present. The key cases are:

- `EMAIL_PROVIDER=resend` does not attempt SMTP.
- `EMAIL_PROVIDER=smtp` does not attempt Resend.
- Unset `EMAIL_PROVIDER` preserves Resend, SMTP, console fallback order.
- Invalid values fail environment validation through the existing env schema.

Run the relevant package test or typecheck command after implementation.
