# Platform-admin approval deletion implementation plan

**Goal:** Expose approval force deletion by organization and approval ID to authenticated platform administrators.

**Architecture:** Share maintenance SQL between the CLI and a guarded server action, with atomic admin auditing. Render a focused TanStack Form card on the existing settings page.

## Tasks

- [x] Move `scripts/approval-maintenance.ts` to `src/lib/approvals/maintenance.ts`; preserve the CLI transaction wrapper and expose `deleteApprovalInTransaction`.
- [x] Update the CLI import, exact approval write-owner maps, and their existing expectations.
- [x] Add `settings/approval-maintenance-actions.ts`, enforcing `requirePlatformAdmin`, validating organization/approval IDs, and recording deleted IDs in an audit entry within the cleanup transaction.
- [x] Add `settings/approval-maintenance-card.tsx` using TanStack Form, shared accessibility primitives, pending-state controls, localized errors, and a removed-ID summary.
- [x] Mount the card on the settings page and add English/German catalog entries.
- [x] Update `docs/refs/approval-maintenance.md` with the platform-admin workflow and audit semantics.
- [x] Review the diff and source changes without running tests or database operations, as requested.
