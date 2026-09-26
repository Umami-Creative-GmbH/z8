/**
 * #328 / T63 and #330 / T65 runtime evidence: the approval card pilot readiness
 * report (absence, expense and time kinds).
 *
 * Local contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The runner creates, migrates, verifies, and removes a label-owned PostgreSQL 16 database.
 *
 * Absences are submitted through the real canonical submission caller, so
 * their workflow, outbox intents and submitted revisions are the ones
 * production writes. Controls, bots and delivery rows are seeded the way the
 * documented operator SQL and the delivery owner write them. Only the
 * request/session, billing guard, e-mail and notification fan-out, calendar
 * queue, work-balance marking and the post-commit delivery kick are replaced.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
}));

vi.mock("@/db", async () => {
	const { Pool } = await import("pg");
	const { drizzle } = await import("drizzle-orm/node-postgres");
	const authSchema = await import("@/db/auth-schema");
	const schema = await import("@/db/schema");
	const { configurePostgresUtcTypes, withUtcPostgresSession } = await import("@/db/postgres-utc");
	configurePostgresUtcTypes();
	const pool = new Pool(
		withUtcPostgresSession({
			connectionString:
				process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL ??
				"postgresql://unconfigured@127.0.0.1:1/unconfigured",
			max: 10,
		}),
	);
	const db = drizzle({ client: pool, schema: { ...authSchema, ...schema } });
	return { ...authSchema, ...schema, db, pool };
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidatePath: vi.fn(),
	revalidateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", () => ({
	requireBillingForMutation: async () => ({ canAccess: true }),
	isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
}));

vi.mock("@/lib/email/email-service", () => ({
	sendEmail: async () => ({ success: true }),
}));

vi.mock("@/lib/email/render", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/email/render")>();
	return {
		...original,
		renderAbsenceRequestSubmitted: async () => "<p>submitted</p>",
		renderAbsenceRequestPendingApproval: async () => "<p>pending</p>",
		renderAbsenceRequestApproved: async () => "<p>approved</p>",
		renderAbsenceRequestRejected: async () => "<p>rejected</p>",
	};
});

vi.mock("@/lib/notifications/triggers", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/notifications/triggers")>();
	const ignore = async () => undefined;
	return {
		...original,
		onAbsenceRequestSubmitted: ignore,
		onAbsenceRequestPendingApproval: ignore,
		onAbsenceRequestApproved: ignore,
		onAbsenceRequestRejected: ignore,
		onApprovedAbsenceCancelledByEmployee: ignore,
	};
});

vi.mock("@/lib/queue", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/queue")>()),
	addCalendarSyncJob: async () => undefined,
}));

vi.mock("@/lib/work-balance/service", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/work-balance/service")>()),
	markEmployeeWorkBalanceDirty: async () => undefined,
}));

vi.mock("@/lib/approvals/delivery/kick", () => ({
	kickApprovalDelivery: () => undefined,
}));

const { requestAbsenceEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { assessApprovalPilotReadiness } = await import("./readiness");

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration = resolveApprovalWorkflowRepositoryTestConfiguration({
	databaseUrl,
	required: integrationRequired,
	sentinel: testSentinel,
});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid approval workflow repository test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration =
	integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`Pilot readiness PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

const ids = {
	organization: "t328-pilot-org",
	otherOrganization: "t328-other-org",
	requesterUser: "t328-requester-user",
	managerUser: "t328-manager-user",
	requester: "e3280000-0000-4000-8000-000000000001",
	manager: "e3280000-0000-4000-8000-000000000002",
	managerLink: "e3281000-0000-4000-8000-000000000001",
	category: "e3282000-0000-4000-8000-000000000001",
} as const;

const SEEDED_AT = new Date("2026-07-01T00:00:00Z");

const TIME_KINDS = ["manual_time_submission", "policy_clock_out", "time_correction"] as const;

describeIntegration("Approval card pilot readiness (PostgreSQL)", () => {
	const admin = new Pool({ connectionString: databaseUrl, max: 2 });

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.otherOrganization],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [
			[ids.requesterUser, ids.managerUser],
		]);
	}

	/** People and an absence category, without any approval control. */
	async function seedOrganization() {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T328 pilot', $1, $2)`,
			[ids.organization, SEEDED_AT],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at) values
			 ($1, 'Avery Requester', 't328-requester@example.test', $3, $3),
			 ($2, 'Morgan Manager', 't328-manager@example.test', $3, $3)`,
			[ids.requesterUser, ids.managerUser, SEEDED_AT],
		);
		await admin.query(
			`insert into member (id, organization_id, user_id, role, status, created_at)
			 select 't328-member-' || user_id, $1, user_id, 'member', 'approved', $2
			 from unnest($3::text[]) as user_id`,
			[ids.organization, SEEDED_AT, [ids.requesterUser, ids.managerUser]],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at) values
			 ($1, $2, $5, 'employee', $6), ($3, $4, $5, 'manager', $6)`,
			[ids.requester, ids.requesterUser, ids.manager, ids.managerUser, ids.organization, SEEDED_AT],
		);
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values ($1, $2, $3, true, $4, $5, $5)`,
			[ids.managerLink, ids.requester, ids.manager, ids.managerUser, SEEDED_AT],
		);
		await admin.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, counts_against_vacation,
			  is_active, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', true, true, true, $3)`,
			[ids.category, ids.organization, SEEDED_AT],
		);
	}

	/** The documented pre-activation gates for canonical absence cards (#290). */
	async function prepareAbsence(options: { capture?: boolean } = {}) {
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'absence', 'canonical', 'canonical', $2, $2)`,
			[ids.organization, SEEDED_AT],
		);
		if (options.capture ?? true) await enableCapture("absence");
		await admin.query(
			`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
			 values ($1, 'absence', 'telegram', 'actionable')`,
			[ids.organization],
		);
		await admin.query(
			`insert into telegram_bot_config
			 (organization_id, bot_token, bot_username, webhook_secret, setup_status,
			  enable_approvals, enable_escalations, updated_at)
			 values ($1, 'vault:managed', 't328_bot', 't328-secret', 'active', true, false, $2)`,
			[ids.organization, SEEDED_AT],
		);
		await admin.query(
			`insert into slack_workspace_config
			 (organization_id, slack_team_id, slack_team_name, bot_access_token, setup_status,
			  enable_approvals, updated_at)
			 values ($1, 'T328', 'T328 workspace', 'vault:managed', 'active', true, $2)`,
			[ids.organization, SEEDED_AT],
		);
	}

	/**
	 * The documented #325 gates for canonical time cards on Telegram (#330),
	 * with a Slack workspace for the review-only summary.
	 */
	async function prepareTime(options: { mode?: string } = {}) {
		for (const kind of TIME_KINDS) {
			await admin.query(
				`insert into approval_workflow_rollout
				 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
				 values ($1, $2, $3, $4, $5, $5)`,
				[
					ids.organization,
					kind,
					options.mode ?? "canonical",
					options.mode === "legacy" ? "legacy" : "canonical",
					SEEDED_AT,
				],
			);
			await enableCapture(kind);
			await admin.query(
				`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
				 values ($1, $2, 'telegram', 'actionable')`,
				[ids.organization, kind],
			);
		}
		await admin.query(
			`insert into telegram_bot_config
			 (organization_id, bot_token, bot_username, webhook_secret, setup_status,
			  enable_approvals, enable_escalations, updated_at)
			 values ($1, 'vault:managed', 't328_bot', 't328-secret', 'active', true, false, $2)
			 on conflict do nothing`,
			[ids.organization, SEEDED_AT],
		);
		await admin.query(
			`insert into slack_workspace_config
			 (organization_id, slack_team_id, slack_team_name, bot_access_token, setup_status,
			  enable_approvals, updated_at)
			 values ($1, 'T328', 'T328 workspace', 'vault:managed', 'active', true, $2)
			 on conflict do nothing`,
			[ids.organization, SEEDED_AT],
		);
	}

	async function enableCapture(workflowType: string) {
		await admin.query(
			`insert into approval_evidence_control (organization_id, workflow_type, mode)
			 values ($1, $2, 'capture')`,
			[ids.organization, workflowType],
		);
	}

	/** Submits a canonical absence through the real caller as the requester. */
	async function submitAbsence(startDate: string, endDate = startDate) {
		harness.userId = ids.requesterUser;
		harness.organizationId = ids.organization;
		const result = await requestAbsenceEffect({
			categoryId: ids.category,
			startDate,
			endDate,
			startPeriod: "full_day",
			endPeriod: "full_day",
			durationKind: "full_day",
		});
		harness.userId = null;
		if (!result.success) throw new Error(`Submission failed: ${result.error}`);
		return result.data.absenceId;
	}

	async function activateDelivery(workflowType: string, provider: string) {
		await admin.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider)
			 values ($1, $2, $3)`,
			[ids.organization, workflowType, provider],
		);
	}

	/** The documented #296 gates for legacy expense cards on Telegram. */
	async function prepareExpense() {
		await enableCapture("travel_expense");
		await admin.query(
			`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
			 values ($1, 'travel_expense', 'telegram', 'actionable')`,
			[ids.organization],
		);
		await admin.query(
			`insert into telegram_bot_config
			 (organization_id, bot_token, bot_username, webhook_secret, setup_status,
			  enable_approvals, enable_escalations, updated_at)
			 values ($1, 'vault:managed', 't328_bot', 't328-secret', 'active', true, false, $2)
			 on conflict do nothing`,
			[ids.organization, SEEDED_AT],
		);
	}

	/**
	 * A submitted legacy expense claim and its pending request, as the legacy
	 * submission owner leaves them; `intent` adds the lifecycle intent it writes
	 * while the kind has a delivery control.
	 */
	async function submittedClaim(options: { intent?: boolean } = {}) {
		const {
			rows: [claim],
		} = await admin.query<{ id: string }>(
			`insert into travel_expense_claim
			 (organization_id, employee_id, approver_id, type, status, trip_start, trip_end,
			  original_currency, original_amount, calculated_currency, calculated_amount,
			  submitted_at, created_by, updated_at)
			 values ($1, $2, $3, 'receipt', 'submitted', '2026-10-01', '2026-10-02',
			  'EUR', 42.50, 'EUR', 42.50, now(), $4, now())
			 returning id`,
			[ids.organization, ids.requester, ids.manager, ids.requesterUser],
		);
		const {
			rows: [request],
		} = await admin.query<{ id: string }>(
			`insert into approval_request
			 (organization_id, entity_type, entity_id, requested_by, approver_id, status, updated_at)
			 values ($1, 'travel_expense_claim', $2, $3, $4, 'pending', now())
			 returning id`,
			[ids.organization, claim?.id, ids.requester, ids.manager],
		);
		if (options.intent) {
			await admin.query(
				`insert into approval_delivery_intent
				 (organization_id, workflow_type, source_type, source_id, legacy_approval_request_id, event)
				 values ($1, 'travel_expense', 'travel_expense_claim', $2, $3, 'submitted')`,
				[ids.organization, claim?.id, request?.id],
			);
		}
		return claim?.id;
	}

	function combination(
		report: Awaited<ReturnType<typeof assessApprovalPilotReadiness>>,
		workflowType: string,
		provider: string,
	) {
		const found = report.combinations.find(
			(entry) => entry.workflowType === workflowType && entry.provider === provider,
		);
		if (!found) throw new Error(`Missing combination ${workflowType}/${provider}`);
		return found;
	}

	function report(
		readiness: Awaited<ReturnType<typeof assessApprovalPilotReadiness>>,
		workflowType: string,
	) {
		const found = readiness.kinds.find((entry) => entry.workflowType === workflowType);
		if (!found) throw new Error(`Missing kind ${workflowType}`);
		return found;
	}

	const codes = (findings: ReadonlyArray<{ code: string }>) =>
		findings.map((finding) => finding.code).sort();

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await admin.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled") {
			throw new Error("Pilot readiness PostgreSQL is disabled");
		}
	});

	beforeEach(() => {
		harness.userId = null;
		harness.organizationId = null;
	});

	afterAll(async () => {
		await cleanup();
		await admin.end();
	});

	it("blocks an unprepared organization's absence Telegram pilot and names every missing gate", async () => {
		await seedOrganization();

		const report = await assessApprovalPilotReadiness({ organizationId: ids.organization });

		const telegram = combination(report, "absence", "telegram");
		expect(telegram.verdict).toBe("blocked");
		expect(telegram.delivery).toEqual({ active: false, activatedAt: null, work: {} });
		expect(codes(telegram.findings)).toEqual([
			"authority_not_canonical",
			"evidence_capture_inactive",
			"presentation_not_actionable",
			"provider_not_configured",
		]);
		expect(telegram.findings.every((finding) => finding.severity === "blocker")).toBe(true);
	});

	it("reports a prepared canonical absence organization ready before any delivery control", async () => {
		await seedOrganization();
		await prepareAbsence();

		const report = await assessApprovalPilotReadiness({ organizationId: ids.organization });

		const telegram = combination(report, "absence", "telegram");
		expect(telegram).toMatchObject({
			verdict: "ready",
			findings: [],
			delivery: { active: false, activatedAt: null },
		});
		// Slack cards are review-only and need no presentation control.
		expect(combination(report, "absence", "slack")).toMatchObject({
			verdict: "ready",
			findings: [],
		});
		expect(codes(combination(report, "absence", "teams").findings)).toEqual([
			"presentation_not_actionable",
			"provider_not_configured",
		]);
	});

	it("holds pending absences whose intents predate activation as web-inbox-only in-flight work", async () => {
		await seedOrganization();
		await prepareAbsence();
		await submitAbsence("2026-11-02");

		const before = combination(
			await assessApprovalPilotReadiness({ organizationId: ids.organization }),
			"absence",
			"telegram",
		);
		// Activating now would leave this pending absence without a card.
		expect(before.verdict).toBe("hold");
		expect(before.findings).toEqual([
			{ code: "in_flight_before_activation", severity: "hold", count: 1 },
		]);

		await activateDelivery("absence", "telegram");
		await submitAbsence("2026-11-09");

		const after = combination(
			await assessApprovalPilotReadiness({ organizationId: ids.organization }),
			"absence",
			"telegram",
		);
		expect(after.delivery.active).toBe(true);
		expect(after.delivery.activatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
		// Only the absence submitted before activation stays web-inbox-only.
		expect(after.findings).toEqual([
			{ code: "in_flight_before_activation", severity: "hold", count: 1 },
		]);
	});

	it("classifies pending submitted evidence exactly as the decision owner holds it", async () => {
		await seedOrganization();
		await prepareAbsence({ capture: false });
		// Submitted before capture: no revision, held once capture is on.
		await submitAbsence("2026-11-02");
		await enableCapture("absence");
		await submitAbsence("2026-11-09");
		const changed = await submitAbsence("2026-11-16");
		// An in-place material change after submission.
		await admin.query("update absence_entry set end_date = '2026-11-17' where id = $1", [changed]);

		const report = await assessApprovalPilotReadiness({ organizationId: ids.organization });

		expect(report.kinds.find((kind) => kind.workflowType === "absence")).toEqual({
			workflowType: "absence",
			authority: "canonical",
			lifecycleMode: "canonical",
			evidenceMode: "capture",
			pending: { total: 3, current: 1, notCaptured: 1, materialChange: 1, authorityChange: 0 },
		});
		expect(combination(report, "absence", "telegram").findings).toEqual([
			{ code: "evidence_held", severity: "hold", count: 2 },
			{ code: "in_flight_before_activation", severity: "hold", count: 3 },
		]);
	});

	it("admits legacy expense cards on Telegram only and counts claims without a post-activation intent", async () => {
		await seedOrganization();
		await prepareExpense();
		// Teams actions share the bound path but are unverified for expenses.
		await admin.query(
			`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
			 values ($1, 'travel_expense', 'teams', 'actionable')`,
			[ids.organization],
		);
		await submittedClaim();
		await activateDelivery("travel_expense", "telegram");
		await submittedClaim({ intent: true });

		const report = await assessApprovalPilotReadiness({ organizationId: ids.organization });

		expect(report.kinds.find((kind) => kind.workflowType === "travel_expense")).toMatchObject({
			authority: "legacy",
			lifecycleMode: null,
			evidenceMode: "capture",
			// Seeded without a frozen submission: held while capture is on.
			pending: { total: 2, notCaptured: 2 },
		});
		const telegram = combination(report, "travel_expense", "telegram");
		expect(telegram.delivery.active).toBe(true);
		expect(telegram.findings).toEqual([
			{ code: "evidence_held", severity: "hold", count: 2 },
			{ code: "in_flight_before_activation", severity: "hold", count: 1 },
		]);
		expect(codes(combination(report, "travel_expense", "teams").findings)).toEqual([
			"combination_unverified",
			"evidence_held",
			"presentation_actionable_unverified",
			"provider_not_configured",
		]);
		expect(codes(combination(report, "travel_expense", "slack").findings)).toContain(
			"combination_unverified",
		);
	});

	it("blocks expense cards once a rollout claims canonical expense authority", async () => {
		await seedOrganization();
		await prepareExpense();
		await admin.query(
			`insert into approval_workflow_rollout
			 (organization_id, workflow_type, lifecycle_mode, side_effect_mode, created_at, updated_at)
			 values ($1, 'travel_expense', 'canonical', 'canonical', $2, $2)`,
			[ids.organization, SEEDED_AT],
		);

		const report = await assessApprovalPilotReadiness({ organizationId: ids.organization });

		expect(report.kinds.find((kind) => kind.workflowType === "travel_expense")).toMatchObject({
			authority: "canonical",
			lifecycleMode: "canonical",
		});
		expect(combination(report, "travel_expense", "telegram")).toMatchObject({
			verdict: "blocked",
			findings: [{ code: "authority_not_legacy", severity: "blocker" }],
		});
	});

	it("admits time cards on Telegram, Slack review-only summaries, and blocks unverified providers", async () => {
		await seedOrganization();
		await prepareTime();
		// Teams actions share the bound path but were never exercised for time kinds (#325).
		await admin.query(
			`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
			 values ($1, 'manual_time_submission', 'teams', 'actionable')`,
			[ids.organization],
		);

		const report = await assessApprovalPilotReadiness({ organizationId: ids.organization });

		for (const kind of TIME_KINDS) {
			expect(report.kinds.find((entry) => entry.workflowType === kind)).toEqual({
				workflowType: kind,
				authority: "canonical",
				lifecycleMode: "canonical",
				evidenceMode: "capture",
				pending: { total: 0, current: 0, notCaptured: 0, materialChange: 0, authorityChange: 0 },
			});
			expect(combination(report, kind, "telegram")).toMatchObject({
				verdict: "ready",
				findings: [],
			});
			// Slack summaries are review-only and need no presentation control.
			expect(combination(report, kind, "slack")).toMatchObject({ verdict: "ready", findings: [] });
			expect(codes(combination(report, kind, "discord").findings)).toEqual([
				"combination_unverified",
				"provider_not_configured",
			]);
		}
		expect(codes(combination(report, "manual_time_submission", "teams").findings)).toEqual([
			"combination_unverified",
			"presentation_actionable_unverified",
			"provider_not_configured",
		]);
		expect(codes(combination(report, "policy_clock_out", "teams").findings)).toEqual([
			"combination_unverified",
			"provider_not_configured",
		]);
	});

	it("blocks time cards under legacy authority, and any bound card without compatibility requests", async () => {
		await seedOrganization();
		await prepareAbsence();
		await prepareTime({ mode: "legacy" });

		const legacy = await assessApprovalPilotReadiness({ organizationId: ids.organization });

		// Legacy-authoritative time approvals stay review-only on bots (#432).
		for (const kind of TIME_KINDS) {
			expect(report(legacy, kind)).toMatchObject({ authority: "legacy", lifecycleMode: "legacy" });
			for (const provider of ["telegram", "slack"]) {
				expect(combination(legacy, kind, provider)).toMatchObject({
					verdict: "blocked",
					findings: [{ code: "authority_not_canonical", severity: "blocker" }],
				});
			}
		}

		// Without the compatibility mirror presentation has no request to start
		// from: owner work becomes `unsupported_route` attention (#325 blocker 2).
		await admin.query(
			`update approval_workflow_rollout set lifecycle_mode = 'complete'
			 where organization_id = $1 and workflow_type in ('time_correction', 'absence')`,
			[ids.organization],
		);

		const complete = await assessApprovalPilotReadiness({ organizationId: ids.organization });

		for (const kind of ["time_correction", "absence"]) {
			expect(report(complete, kind)).toMatchObject({
				authority: "canonical",
				lifecycleMode: "complete",
			});
			for (const provider of ["telegram", "slack"]) {
				expect(combination(complete, kind, provider)).toMatchObject({
					verdict: "blocked",
					findings: [{ code: "authority_complete_unsupported", severity: "blocker" }],
				});
			}
		}
	});

	it("observes an active combination's delivery work and surfaces work that needs recovery", async () => {
		await seedOrganization();
		await prepareAbsence();
		await activateDelivery("absence", "telegram");
		const absenceId = await submitAbsence("2026-11-02");
		const {
			rows: [lifecycle],
		} = await admin.query<{ workflow_id: string; assignment_id: string; outbox_id: string }>(
			`select a.approval_workflow_id as workflow_id, sa.id as assignment_id,
			  (select o.id from approval_outbox o where o.workflow_id = a.approval_workflow_id
			   order by o.created_at desc limit 1) as outbox_id
			 from absence_entry a
			 join approval_stage_assignment sa on sa.workflow_id = a.approval_workflow_id
			 where a.id = $1`,
			[absenceId],
		);
		// Work rows as the delivery owner leaves them: one exhausted, one whose
		// worker lease expired, one awaiting destination repair.
		await admin.query(
			`insert into approval_delivery_work
			 (organization_id, outbox_id, workflow_id, effect, provider, assignment_id,
			  recipient_employee_id, dedupe_key, status, claim_token, claimed_at, lease_expires_at)
			 values
			 ($1, $2, $3, 'initial', 'telegram', $4, $5, 't328-exhausted', 'exhausted', null, null, null),
			 ($1, $2, $3, 'initial', 'telegram', $4, $5, 't328-leased', 'processing',
			  gen_random_uuid(), now() - interval '10 minutes', now() - interval '5 minutes'),
			 ($1, $2, $3, 'initial', 'telegram', $4, $5, 't328-repair', 'awaiting_repair', null, null, null),
			 ($1, $2, $3, 'initial', 'slack', $4, $5, 't328-slack', 'exhausted', null, null, null)`,
			[
				ids.organization,
				lifecycle?.outbox_id,
				lifecycle?.workflow_id,
				lifecycle?.assignment_id,
				ids.manager,
			],
		);

		const report = await assessApprovalPilotReadiness({ organizationId: ids.organization });

		const telegram = combination(report, "absence", "telegram");
		expect(telegram.delivery).toMatchObject({
			active: true,
			work: { exhausted: 1, processing: 1, awaiting_repair: 1 },
		});
		expect(telegram.findings).toEqual([
			{ code: "delivery_awaiting_repair", severity: "hold", count: 1 },
			{ code: "delivery_exhausted", severity: "hold", count: 1 },
			{ code: "delivery_lease_expired", severity: "hold", count: 1 },
		]);
		// Slack's own work is reported under Slack, not Telegram.
		expect(combination(report, "absence", "slack").delivery.work).toEqual({ exhausted: 1 });
	});

	it("counts old-path cards of pending approvals as historical-only", async () => {
		await seedOrganization();
		await prepareAbsence();
		const absences = [await submitAbsence("2026-11-02"), await submitAbsence("2026-11-09")];
		const { rows: requests } = await admin.query<{ id: string }>(
			`select id from approval_request where entity_id = any($1::uuid[]) and status = 'pending'
			 order by created_at`,
			[absences],
		);
		// Cards the existing Telegram path sent before activation: one still
		// open, one whose press was already recorded.
		await admin.query(
			`insert into telegram_approval_message
			 (organization_id, approval_request_id, chat_id, message_id, recipient_user_id, status,
			  updated_at)
			 values ($1, $2, '328', '1', $4, 'sent', now()),
			        ($1, $3, '328', '2', $4, 'approved', now())`,
			[ids.organization, requests[0]?.id, requests[1]?.id, ids.managerUser],
		);
		await activateDelivery("absence", "telegram");

		const report = await assessApprovalPilotReadiness({ organizationId: ids.organization });

		expect(combination(report, "absence", "telegram").findings).toEqual([
			{ code: "in_flight_before_activation", severity: "hold", count: 2 },
			{ code: "legacy_cards_historical_only", severity: "hold", count: 1 },
		]);
		expect(codes(combination(report, "absence", "slack").findings)).not.toContain(
			"legacy_cards_historical_only",
		);
	});

	it("stays inside the requested organization and refuses an unknown one", async () => {
		await seedOrganization();
		await prepareAbsence();
		await submitAbsence("2026-11-02");
		// Another organization with its own controls, bot and attention.
		await admin.query(
			`insert into organization (id, name, slug, created_at) values ($1, 'T328 other', $1, $2)`,
			[ids.otherOrganization, SEEDED_AT],
		);
		await admin.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider)
			 values ($1, 'absence', 'telegram')`,
			[ids.otherOrganization],
		);
		await admin.query(
			`insert into discord_bot_config
			 (organization_id, application_id, public_key, bot_token, webhook_secret, setup_status,
			  enable_approvals, updated_at)
			 values ($1, 't328-app', 't328-key', 'vault:managed', 't328-secret', 'active', true, now())`,
			[ids.otherOrganization],
		);
		await admin.query(
			`insert into approval_escalation_attention (organization_id, dedupe_key, reason, status, evidence)
			 values ($1, 't328-other-attention', 'delivery_exhausted', 'open', '{}'::jsonb)`,
			[ids.otherOrganization],
		);

		const report = await assessApprovalPilotReadiness({ organizationId: ids.organization });

		expect(report.organizationId).toBe(ids.organization);
		expect(combination(report, "absence", "telegram").delivery.active).toBe(false);
		expect(codes(combination(report, "absence", "discord").findings)).toContain(
			"provider_not_configured",
		);
		expect(report.escalation.openAttention).toEqual({});
		expect(report.kinds.find((kind) => kind.workflowType === "absence")?.pending.total).toBe(1);
		const other = await assessApprovalPilotReadiness({ organizationId: ids.otherOrganization });
		expect(other.kinds.find((kind) => kind.workflowType === "absence")?.pending.total).toBe(0);

		await expect(
			assessApprovalPilotReadiness({ organizationId: "t328-no-such-org" }),
		).rejects.toThrow("Unknown organization t328-no-such-org");
	});

	it("classifies escalation ownership, policy, transfer history and open attention separately", async () => {
		await seedOrganization();
		await prepareAbsence();

		const unswitched = (await assessApprovalPilotReadiness({ organizationId: ids.organization }))
			.escalation;
		// No control row: legacy escalation jobs still own the organization.
		expect(unswitched).toMatchObject({
			owner: "legacy",
			automationPaused: false,
			policy: null,
			verdict: "blocked",
		});
		expect(codes(unswitched.findings)).toEqual([
			"escalation_legacy_owner",
			"escalation_policy_missing",
		]);

		await admin.query(
			`insert into approval_escalation_control
			 (organization_id, owner, automation_paused, escalation_owned_since)
			 values ($1, 'escalation', false, now())`,
			[ids.organization],
		);
		await admin.query(
			`insert into approval_escalation_policy
			 (organization_id, enabled, response_window_hours, revision, migration_provenance,
			  conflict_review_status, updated_at)
			 values ($1, true, 24, 1, '{}'::jsonb, 'pending', now())`,
			[ids.organization],
		);
		await admin.query(
			`insert into approval_escalation_attention
			 (organization_id, dedupe_key, reason, status, evidence, closed_at)
			 values ($1, 't328-attention-1', 'delivery_exhausted', 'open', '{}'::jsonb, null),
			        ($1, 't328-attention-2', 'no_eligible_backup', 'open', '{}'::jsonb, null),
			        ($1, 't328-attention-3', 'no_eligible_backup', 'resolved', '{}'::jsonb, now())`,
			[ids.organization],
		);
		// A human legacy transfer whose delivery event has no replacement card yet (#408).
		const claimId = await submittedClaim();
		const {
			rows: [request],
		} = await admin.query<{ id: string }>("select id from approval_request where entity_id = $1", [
			claimId,
		]);
		const {
			rows: [transfer],
		} = await admin.query<{ id: string }>(
			`insert into approval_escalation_transfer
			 (organization_id, operation_key, initiator, authority_mode, workflow_type,
			  legacy_approval_request_id, legacy_source_sequence, source_approver_employee_id,
			  replacement_approver_employee_id, requester_employee_id, receipt_idempotency_key,
			  receipt_actor_fingerprint, receipt_command_fingerprint, request_fingerprint,
			  actor_kind, actor_user_id, actor_employee_id, transferred_at)
			 values ($1, 't328-transfer', 'human', 'legacy', 'travel_expense', $2, 0, $3, $4, $4,
			  't328-receipt', 'actor', 'command', 'request', 'user', $5, $3, now())
			 returning id`,
			[ids.organization, request?.id, ids.manager, ids.requester, ids.managerUser],
		);
		await admin.query(
			`insert into approval_escalation_transfer_event
			 (organization_id, transfer_id, event_type, payload)
			 values ($1, $2, 'assignment_transferred', '{}'::jsonb)`,
			[ids.organization, transfer?.id],
		);

		const switched = (await assessApprovalPilotReadiness({ organizationId: ids.organization }))
			.escalation;
		expect(switched).toMatchObject({
			owner: "escalation",
			automationPaused: false,
			policy: { enabled: true, responseWindowHours: 24, conflictReviewStatus: "pending" },
			transfers: { canonical: 0, legacy: 1, pendingLegacyEvents: 1 },
			openAttention: { delivery_exhausted: 1, no_eligible_backup: 1 },
			verdict: "blocked",
		});
		expect(switched.ownedSince).toMatch(/Z$/);
		expect(switched.findings).toEqual([
			{ code: "escalation_policy_conflicts_unreviewed", severity: "blocker" },
			{ code: "legacy_transfer_without_replacement", severity: "hold", count: 1 },
			{ code: "attention_open", severity: "hold", count: 2 },
		]);
	});

	it("holds a card combination whose integration does not deliver escalations once escalation owns transfers", async () => {
		await seedOrganization();
		// The seeded Telegram bot delivers approvals but not escalations; Slack does both.
		await prepareAbsence();
		await prepareTime();
		const telegramBefore = combination(
			await assessApprovalPilotReadiness({ organizationId: ids.organization }),
			"absence",
			"telegram",
		);
		// Legacy escalation still owns transfers: no replacement cards to miss yet.
		expect(telegramBefore.findings).toEqual([]);

		await admin.query(
			`insert into approval_escalation_control
			 (organization_id, owner, automation_paused, escalation_owned_since)
			 values ($1, 'escalation', false, now())`,
			[ids.organization],
		);
		await admin.query(
			`insert into approval_escalation_policy
			 (organization_id, enabled, response_window_hours, revision, migration_provenance,
			  conflict_review_status, updated_at)
			 values ($1, true, 24, 1, '{}'::jsonb, 'none', now())`,
			[ids.organization],
		);

		const report = await assessApprovalPilotReadiness({ organizationId: ids.organization });

		expect(combination(report, "absence", "telegram")).toMatchObject({
			verdict: "hold",
			findings: [{ code: "escalation_delivery_disabled", severity: "hold" }],
		});
		expect(combination(report, "absence", "slack").findings).toEqual([]);
		// Canonical time kinds escalate too (#326) and get replacement cards (#300).
		for (const kind of TIME_KINDS) {
			expect(combination(report, kind, "telegram")).toMatchObject({
				verdict: "hold",
				findings: [{ code: "escalation_delivery_disabled", severity: "hold" }],
			});
			expect(combination(report, kind, "slack").findings).toEqual([]);
		}
		// Expense claims have no escalation transfers.
		expect(codes(combination(report, "travel_expense", "telegram").findings)).not.toContain(
			"escalation_delivery_disabled",
		);
	});
});
