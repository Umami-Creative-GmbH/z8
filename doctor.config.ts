import type { ReactDoctorConfig } from "react-doctor/api";

export default {
	supplyChain: {
		minScore: 0.46,
	},
	ignore: {
		rules: [
			"react-doctor/nextjs-no-img-element",
			"react-doctor/server-auth-actions",
			"react-doctor/unused-dependency",
			"react-doctor/unused-dev-dependency",
		],
		overrides: [
			{
				// Four table headings belong to different domains (vacation vs invoice drafts).
				// Assignment target selects have different fields, translations and downstream policy controls.
				// Their structural resemblance is incidental, not one shared component contract.
				files: [
					"**/components/settings/vacation/proration-notice.tsx",
					"**/components/settings/vehicle-use/vehicle-use-settings.tsx",
					// API key and audit package tables share a 7-column header shape, not columns or domain.
					"**/components/enterprise/api-key-page-client.tsx",
					"**/components/settings/audit-export/audit-packages-table.tsx",
				],
				rules: ["react-doctor/duplicate-jsx-subtree"],
			},
			{
				// Export categories bound database work to one category at a time; file cleanup bounds
				// storage deletion and its retry bookkeeping to one object at a time.
				files: [
					"**/src/lib/personal-data-export/processor.ts",
					"**/src/lib/personal-data-export/store.ts",
				],
				rules: ["react-doctor/async-await-in-loop"],
			},

			{
				// Server-only mailer modules never participate in client Fast Refresh.
				// They deliberately expose the HTML renderer and subject beside their template.
				files: [
					"**/src/lib/email/templates/billing-email.tsx",
					"**/src/lib/email/templates/scheduled-export-delivery.tsx",
					"**/src/lib/email/templates/security-alert.tsx",
				],
				rules: ["react-doctor/only-export-components"],
			},
			{
				// Tests must round-trip the JSON stored in notification.metadata, including JSON's conversions.
				// structuredClone would not exercise the persisted representation.
				files: ["**/src/lib/notifications/notification-params.test.ts"],
				rules: ["react-doctor/no-json-parse-stringify-clone"],
			},

			{
				// TanStack Form performs client validation and owns submission. Native navigation would bypass it.
				files: [
					"**/components/billable-time/billable-currency-form.tsx",
					"**/components/calendar/work-period-mileage-action.tsx",
				],
				rules: ["react-doctor/no-prevent-default"],
			},
			{
				// Redacted immutable server snapshots have no interactive row state, reordering or filtering.
				// Adding employee identifiers as keys would undermine the review model's privacy boundary.
				files: [
					"**/components/works-council/position-capture-review-section.tsx",
					"**/components/works-council/vehicle-use-review-section.tsx",
				],
				rules: ["react-doctor/no-array-index-as-key"],
			},
			{
				// Decompress one ZIP member at a time to bound transient memory for large payslip batches.
				files: ["**/components/personnel-file/payslip-batch-files.ts"],
				rules: ["react-doctor/async-await-in-loop"],
			},
			{
				// Rate steps shorten/delete a predecessor before inserting a successor; the overlap constraint requires this order.
				files: ["**/src/lib/billable-time/rate-periods.ts"],
				rules: ["react-doctor/async-await-in-loop"],
			},
			{
				// Bulk amendments share ranked organization/owner guards and run after-commit work in order.
				files: ["**/src/lib/billable-time/bulk-billability-work.ts"],
				rules: ["react-doctor/async-await-in-loop"],
			},
			{
				// Job delivery is intentionally bounded to one tenant/reminder at a time. Retention recipient lookups
				// populate a shared cache; a claim precedes each delivery and the result records who was notified.
				files: [
					"**/src/lib/jobs/clocking-reminders.ts",
					"**/src/lib/jobs/driving-details-reminders.ts",
					"**/src/lib/personnel-file/expiry-reminders.ts",
					"**/src/lib/personnel-file/retention-reminders.ts",
					"**/src/lib/scheduling/skill-expiry-reminders.ts",
					"**/src/lib/jobs/driving-licence-retention.ts",
				],
				rules: ["react-doctor/async-await-in-loop"],
			},
			{
				// Deadline materialization opens one FOR UPDATE transaction per window over an unbounded
				// set and must finish before due notices are selected; notices are delivered one at a time.
				// Offline kiosk vehicle-use context is read one employee after another so a large location
				// does not take every pooled connection at once.
				files: [
					"**/src/lib/organization-mfa/delivery.ts",
					"**/src/lib/time-tracking/kiosk/home.ts",
				],
				rules: ["react-doctor/async-await-in-loop"],
			},
			{
				// The MFA revision is read before the credential hash. A password change bumps the revision
				// atomically, so a hash read after the revision snapshot can never be recorded against a
				// newer revision; running them in parallel would reopen that race.
				// The departure-access installer checks out a pooled client only after the SQL file is read,
				// so a read failure cannot leak a connection.
				files: [
					"**/src/lib/organization-mfa/authentication-plugin.ts",
					"**/src/db/install-employee-departure-access.ts",
				],
				rules: ["react-doctor/server-sequential-independent-await"],
			},
			{
				// Server-only PDF renderer, loaded on demand through `await import(...)` by its only consumer,
				// the Node-runtime evidence route handler; @react-pdf/renderer never ships to clients.
				files: ["**/src/lib/organization/driving-licence/evidence-pdf.tsx"],
				rules: ["react-doctor/prefer-dynamic-import"],
			},

			{
				// Legacy storage is guarded against nonempty rows, then dropped immediately after disabling RLS.
				files: ["**/drizzle/0062_better_auth_scim_storage.sql"],
				rules: ["react-doctor/supabase-rls-policy-risk"],
			},
			{
				// TanStack Form array fields are addressed by index (`changes[${index}]`), so the index
				// is the row identity; draft change rows have no other identity until submitted.
				files: [
					"**/components/settings/work-diagnostics/work-proposal-panel.tsx",
				],
				rules: ["react-doctor/no-array-index-as-key"],
			},
			{
				// These awaits run on one PostgreSQL transaction or snapshot connection (`tx`,
				// `transaction`, `reader`). The driver serializes statements on a connection, so
				// Promise.all gains nothing; the order carries lock acquisition (FOR UPDATE,
				// advisory guards), read-your-writes and append-chain predecessors, and a failed
				// statement aborts the transaction for every statement queued behind it.
				files: [
					"**/settings/clockodo-import/actions.ts",
					"**/src/lib/billable-time/settings.ts",
					"**/src/lib/absences/change-request-proposal.ts",
					"**/src/lib/absences/change-request-service.ts",
					"**/src/lib/employment-history/write-terms.ts",
					"**/src/lib/personnel-file/skill-certificate-expiry.ts",
					"**/src/lib/demo/demo-vehicle-use-generator.ts",
					"**/src/lib/personal-data-export/collectors/position-stamps.ts",
					"**/src/lib/time-tracking/period-submissions/submitted-content.ts",
					"**/src/lib/time-tracking/vehicle-use/form-context.ts",
					"**/src/lib/personnel-file/payslip-batch-store.ts",
					"**/src/lib/personnel-file/retention-store.ts",
					"**/src/lib/personnel-file/upload-ledger.ts",
					"**/src/lib/projects/project-from-template.ts",
					"**/src/lib/projects/project-templates.ts",
					"**/src/lib/time-record/migration/backfill.ts",
					"**/src/lib/time-tracking/position-capture/export-positions.ts",
					"**/src/lib/time-tracking/position-capture/resolver.ts",
					"**/absences/mutations.ts",
					"**/time-tracking/actions/clocking.ts",
					"**/src/lib/approvals/delivery/store.ts",
					"**/src/lib/approvals/domain-adapters/absence.adapter.ts",
					"**/src/lib/approvals/domain-adapters/legacy-write-coordinator.ts",
					"**/src/lib/approvals/escalation/legacy-transfer.ts",
					"**/src/lib/approvals/escalation/transfer.ts",
					"**/src/lib/approvals/evidence/store.ts",
					"**/src/lib/approvals/maintenance.ts",
					"**/src/lib/approvals/pilot/readiness.ts",
					"**/src/lib/approvals/server/absence-approvals.ts",
					"**/src/lib/approvals/server/time-correction-work-transaction.ts",
					"**/src/lib/approvals/server/work-period-decision-transaction.ts",
					"**/src/lib/audit-pack/application/audit-pack-orchestrator.ts",
					"**/src/lib/auth/sso-organization-provisioning.ts",
					"**/src/lib/demo/delete-non-admin.ts",
					"**/src/lib/demo/demo-data.service.ts",
					"**/src/lib/demo/demo-work.ts",
					"**/src/lib/demo/employee-generator.ts",
					"**/src/lib/effect/services/billing/billing-configuration.ts",
					"**/src/lib/employee-lifecycle/commands.ts",
					"**/src/lib/employee-lifecycle/locks.ts",
					"**/src/lib/payroll-collection/payroll-work-collection-reader.ts",
					"**/src/lib/rollout/rollback/readiness-reader.ts",
					"**/src/lib/time-tracking/amend-completed-work.ts",
					"**/src/lib/time-tracking/append-assurance-reader.ts",
					"**/src/lib/time-tracking/automatic-break-adjustment.ts",
					"**/src/lib/time-tracking/clocking-core.ts",
					"**/src/lib/time-tracking/clocking/break.ts",
					"**/src/lib/time-tracking/close-active-work.ts",
					"**/src/lib/time-tracking/historical-gap-repair-executor.ts",
					"**/src/lib/time-tracking/historical-work-diagnostics-reader.ts",
					"**/src/lib/time-tracking/historical-work-proposals.ts",
					"**/src/lib/time-tracking/manual-work-transaction.ts",
					"**/src/lib/time-tracking/pilot/readiness-reader.ts",
					"**/src/lib/time-tracking/record-imported-work.ts",
					"**/src/lib/time-tracking/record-manual-work.ts",
					"**/src/lib/time-tracking/split-completed-work.ts",
					"**/src/lib/time-tracking/start-live-work.ts",
					"**/src/lib/time-tracking/time-entry-append.ts",
					"**/src/lib/time-tracking/web-clock-out-transaction.ts",
					"**/src/lib/time-tracking/work-occupancy.ts",
					"**/src/lib/time-tracking/work-transaction/index.ts",
					"**/src/lib/timezone/organization-timezone-change.ts",
					"**/src/lib/timezone/user-timezone-change.ts",
					"**/src/lib/travel-expenses/receipt-upload.ts",
					"**/src/lib/work-balance/rebuild-intents.ts",
					// Driving-licence services run on the caller's `tx` (helpers typed as a select-only
					// database receive it too) under org, advisory, FOR UPDATE and FOR SHARE locks; loops
					// write each row update before its evidence event.
					"**/src/lib/organization/driving-licence/access.ts",
					"**/src/lib/organization/driving-licence/checks.ts",
					"**/src/lib/organization/driving-licence/history.ts",
					"**/src/lib/organization/driving-licence/impediments.ts",
					"**/src/lib/organization/driving-licence/operational.ts",
					"**/src/lib/organization/driving-licence/policy-intervals.ts",
					"**/src/lib/organization/driving-licence/reminders.ts",
					"**/src/lib/organization/driving-licence/retention-state.ts",
					"**/src/lib/organization/driving-licence/retention.ts",
					"**/src/lib/organization/driving-licence/tasks.ts",
					"**/src/lib/organization/driving-licence/verifiers.ts",
					// Organization MFA writes take the user FOR UPDATE and org advisory lock before FOR SHARE
					// session and membership reads; readiness checks short-circuit inside that transaction.
					"**/src/lib/organization-mfa/policy-service.ts",
					"**/src/lib/organization-mfa/store.ts",
					// Vehicle photo attachment locks vehicle then upload; cleanup holds each upload's
					// FOR UPDATE SKIP LOCKED row while deleting its object and recording retry state.
					"**/src/lib/organization/vehicles/vehicle-photos.ts",
					"**/src/lib/jobs/vehicle-photo-cleanup.ts",
					// Work-records pair writer: every statement runs on the sealed work transaction under the
					// coordinator's locks (FOR UPDATE canonical rows, append chain, read-your-writes).
					"**/src/lib/time-tracking/work-records/amend.ts",
					"**/src/lib/time-tracking/work-records/divide.ts",
					"**/src/lib/time-tracking/work-records/pair-writer.ts",
					"**/src/lib/time-tracking/work-records/repair.ts",
					// Kiosk-only employee creation inserts and audits on one tx under the identity lock;
					// clock-out reads break state on the coordinator's tx before closing on it.
					"**/src/lib/time-tracking/kiosk/kiosk-only-employee.ts",
					"**/src/lib/time-tracking/clocking/clocking.ts",
				],
				rules: [
					"react-doctor/async-await-in-loop",
					"react-doctor/async-parallel",
					"react-doctor/server-sequential-independent-await",
				],
			},
			{
				// Ordered side effects outside one transaction: sweep before claim, cancel before
				// claim, count after cleanup, after-commit work in registration order, and one
				// organization, outbox task or split segment at a time so a failure stays isolated.
				files: [
					"**/time-tracking/actions/work-period-split.ts",
					"**/src/lib/approvals/delivery/owner.ts",
					"**/src/lib/jobs/personal-data-export-sweep.ts",
					"**/src/lib/jobs/clocking-reminders.ts",
					"**/src/lib/approvals/delivery/scheduled-job.ts",
					"**/src/lib/approvals/escalation/replacement-delivery.ts",
					"**/src/lib/auth/auth-transaction.ts",
					"**/src/lib/employee-lifecycle/delivery.ts",
					"**/src/lib/jobs/travel-expense-receipt-cleanup.ts",
					"**/src/lib/time-tracking/clocking/follow-ups.ts",
				],
				rules: [
					"react-doctor/async-await-in-loop",
					"react-doctor/server-sequential-independent-await",
				],
			},
		],
	},
	serverAuthFunctionNames: [
		"getAuthContext",
		"getCurrentEmployee",
		"getEmployeeSettingsActorContext",
		"requireAdmin",
		"requireAuth",
		"requireOrgAdminEmployeeSettingsAccess",
		"requirePlatformAdmin",
		"requireSettingsActorEmployeeRecord",
		"requireSystemAdmin",
		"requireUser",
	],
} satisfies ReactDoctorConfig;
