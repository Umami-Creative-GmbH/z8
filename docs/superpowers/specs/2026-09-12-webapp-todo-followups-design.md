# Webapp TODO follow-ups: focused corrections

## Decision

The user selected the focused correction rather than an interactive OAuth test.
The work covers OAuth configuration readiness, scheduled-payroll requester
attribution, and obsolete platform approval-resolution notification stubs.

## Evidence

- `testSocialOAuthConfigAction` writes a successful test status without contacting
  a provider. The management UI interprets that status as `Working`. Its only
  current callers found in the webapp are tests.
- `PayrollExportExecutor` uses `payrollConfigId` or the payroll configuration's
  creator as `requestedById`. The job schema requires an employee ID; the schedule
  creator is a user ID already passed through the orchestrator.
- The four platform resolution trigger functions are log-only stubs with no
  webapp callers. The central notification service already delivers domain
  approval outcomes through Teams, Telegram, Discord, and Slack.

## OAuth configuration readiness

Replace the fake test action with an explicitly named configuration-check action,
protected by the existing enterprise organization-admin authorization helper.
Load the exact configuration by both configuration ID and active organization ID.

Check the locally verifiable requirements: a nonblank client ID, available
organization-specific credentials, and required Apple provider fields/private key
when applicable. Use organization Vault paths directly; global credential fallback
must not make an incomplete organization configuration pass. Return a structured
readiness result that explicitly identifies the check as configuration validation,
with provider authentication still unverified. Inactive configurations must be
reported as inactive rather than ready for sign-in.

This check must not write `lastTestSuccess: true` or claim that provider
authentication succeeded. Missing configuration, incomplete credentials, and
credential-store failures receive clear, sanitized results without exposing
secrets or lower-level Vault errors.

The management UI must stop treating historical test flags as proof that OAuth is
working. Display configuration/activation information with explicit unverified
authentication wording. Preserve existing database fields for compatibility;
historical values are not trustworthy evidence of a completed provider test.
Follow existing Tolgee translation patterns for changed copy.

## Payroll requester attribution

Resolve the schedule's `createdBy` user ID to an employee using both `userId` and
`organizationId`, matching the data-export executor's existing approach. Pass
that employee ID to `createExportJob`. A missing creator or organization-scoped
employee produces a failed execution result before job creation.

Payroll configuration IDs remain configuration references only. Do not fall back
to another configuration owner's identity. Date-range calculations and export
delivery retain their existing contracts.

## Approval-resolution notifications

Verify repository-wide references before removing the four unused resolution
functions and their barrel exports. Keep active new-request notification triggers.

Exercise the existing central notification route for approved and rejected
outcomes across all four platforms. Regression coverage must establish that
notification preferences and platform availability govern dispatch, payloads carry
the correct organization and recipient, and provider failures do not reverse an
approval decision. Preserve existing final-decision behavior; intermediate stages
must not introduce additional requester messages.

## Verification

- OAuth: authorized organization forwarding, cross-organization/missing records,
  complete and incomplete credentials, inactive configurations, Apple requirements,
  sanitized credential-store failures, and absence of false test-success writes.
- Payroll: valid employee attribution, another organization's employee excluded,
  missing employee/creator rejected, and config/user IDs never used as employee IDs.
- Notifications: central approved/rejected dispatch, disabled preferences/platforms,
  provider failure handling, and removal of stale references.
- Run targeted Vitest suites with pnpm, then applicable type/lint and React checks.
  Use mocked database/Vault/provider boundaries for local regression tests. Live
  service verification requires Phase-managed credentials unavailable to agents
  and must be listed as unverified if unavailable.

## Implementation boundaries

Keep each correction independently testable. Reuse existing organization-scoped
helpers and notification adapters. No new notification delivery mechanism or OAuth
authorization flow is required. Preserve concurrent work and do not commit unless
the user explicitly requests it.
