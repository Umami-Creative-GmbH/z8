# Platform-admin approval deletion

## Approved design

Add a Force delete approval card to Platform Admin → Settings. It accepts organization ID and approval ID and invokes the same transactional lifecycle cleanup as the maintenance CLI. Show a pending state, field validation, localized errors, and a durable success summary of removed request/workflow/chain IDs.

Use TanStack Form and existing accessible form/card components. Follow the existing settings typography, spacing, and neutral surfaces, with a destructive submit button. Support English and German catalogs with statically extractable fallback text for other locales.

## Server boundary

The server action calls the existing `requirePlatformAdmin` before validating input or accessing tenant records. Revalidate both fields on the server. The cleanup continues to scope every query and mutation to the supplied organization, supports both approval stores, and preserves source records and statuses.

Move the cleanup module from `scripts` into `src/lib/approvals/maintenance.ts`. Expose an in-transaction entry point and retain the transaction-owning wrapper for the CLI. The admin action owns a single transaction containing cleanup and insertion into `platform_admin_audit_log`, with authenticated actor ID, target approval ID, organization ID, and deleted IDs. Audit failure rolls back cleanup. Return safe error codes rather than raw database errors.

Update the approval write-owner map and its existing expectations to the shared module path. Do not broaden the allowed operations.

## Verification scope

The user explicitly requested no tests or database operations. Review the implementation and diff only; do not run unit tests, browser checks, builds, or database-backed commands. Do not commit or push this extension without a new request.
