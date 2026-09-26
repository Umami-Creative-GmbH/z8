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
				// Legacy storage is guarded against nonempty rows, then dropped immediately after disabling RLS.
				files: ["**/drizzle/0062_better_auth_scim_storage.sql"],
				rules: ["react-doctor/supabase-rls-policy-risk"],
			},
			{
				// TanStack Form array fields are addressed by index (`changes[${index}]`), so the index
				// is the row identity; draft change rows have no other identity until submitted.
				files: ["**/components/settings/work-diagnostics/work-proposal-panel.tsx"],
				rules: ["react-doctor/no-array-index-as-key"],
			},
			{
				// These awaits run on one PostgreSQL transaction or snapshot connection (`tx`,
				// `transaction`, `reader`). The driver serializes statements on a connection, so
				// Promise.all gains nothing; the order carries lock acquisition (FOR UPDATE,
				// advisory guards), read-your-writes and append-chain predecessors, and a failed
				// statement aborts the transaction for every statement queued behind it.
				files: [
					"**/absences/mutations.ts",
					"**/time-tracking/actions/clocking.ts",
					"**/src/lib/approvals/delivery/store.ts",
					"**/src/lib/approvals/escalation/legacy-transfer.ts",
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
					"**/src/lib/payroll-collection/payroll-work-collection-reader.ts",
					"**/src/lib/rollout/rollback/readiness-reader.ts",
					"**/src/lib/time-tracking/amend-completed-work.ts",
					"**/src/lib/time-tracking/append-assurance-reader.ts",
					"**/src/lib/time-tracking/automatic-break-adjustment.ts",
					"**/src/lib/time-tracking/clocking-core.ts",
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
					"**/src/lib/timezone/organization-timezone-change.ts",
					"**/src/lib/timezone/user-timezone-change.ts",
					"**/src/lib/travel-expenses/receipt-upload.ts",
					"**/src/lib/work-balance/rebuild-intents.ts",
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
				// organization (or split segment) at a time so a failure stays isolated.
				files: [
					"**/time-tracking/actions/work-period-split.ts",
					"**/src/lib/approvals/delivery/owner.ts",
					"**/src/lib/approvals/delivery/scheduled-job.ts",
					"**/src/lib/approvals/escalation/replacement-delivery.ts",
					"**/src/lib/auth/auth-transaction.ts",
					"**/src/lib/jobs/travel-expense-receipt-cleanup.ts",
				],
				rules: ["react-doctor/async-await-in-loop", "react-doctor/server-sequential-independent-await"],
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
